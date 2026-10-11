-- Requires 202609160001_multi_user_import.sql. Transactional: invalid existing
-- references abort the migration without changing the catalog.
begin;

create schema if not exists prism_private;
revoke all on schema prism_private from public, anon, authenticated;

alter table public.datasets
  add column updated_at timestamptz not null default now(),
  add column schema_version integer not null default 1 check (schema_version > 0),
  add column source_id text,
  add column source_version text;
alter table public.datasets alter column payload set not null;
alter table public.datasets add constraint datasets_payload_object
  check (jsonb_typeof(payload) = 'object');
alter table public.datasets add constraint datasets_name_nonempty
  check (length(btrim(name)) between 1 and 1000);

create table public.dataset_references (
  id uuid primary key default gen_random_uuid(),
  source_dataset_id uuid not null references public.datasets(id) on delete cascade,
  target_dataset_id uuid not null references public.datasets(id)
    on delete no action deferrable initially deferred,
  expected_target_type text not null check (expected_target_type in
    ('model','process','flow','flow_property','unit_group','source','contact')),
  reference_role text not null,
  reference_path text not null,
  unique (source_dataset_id, reference_path)
);
create index dataset_references_target_idx
  on public.dataset_references(target_dataset_id);

alter table public.dataset_references enable row level security;
revoke all on public.dataset_references from public, anon, authenticated;
grant select on public.dataset_references to anon, authenticated;
create policy "read accessible dataset references"
on public.dataset_references for select to anon, authenticated
using (
  exists (select 1 from public.datasets s where s.id = source_dataset_id)
  and exists (select 1 from public.datasets t where t.id = target_dataset_id)
);

-- JSON Pointer paths distinguish array entries and escape '/' and '~' in keys.
-- Known ILCD roles enforce a type even if the incoming reference omits 'type'.
-- Unknown extension references must declare their expected dataset type.
create function prism_private.extract_references(p_payload jsonb)
returns table(target_dataset_id uuid, expected_target_type text,
              reference_role text, reference_path text)
language plpgsql immutable set search_path = '' as $$
declare
  r record;
  expected text;
begin
  for r in
    with recursive nodes(value, path, role) as (
      select p_payload, ''::text, 'reference'::text
      union all
      select child.value, n.path || '/' || child.token, child.role
      from nodes n
      cross join lateral (
        select o.value, replace(replace(o.key, '~', '~0'), '/', '~1') token,
               o.key role
        from jsonb_each(case when jsonb_typeof(n.value) = 'object'
          then n.value else '{}'::jsonb end) o
        union all
        select a.value, (a.ordinality - 1)::text, n.role
        from jsonb_array_elements(case when jsonb_typeof(n.value) = 'array'
          then n.value else '[]'::jsonb end) with ordinality a
      ) child
    )
    select * from nodes where jsonb_typeof(value) = 'object'
      and value ? 'refObjectId' and value -> 'refObjectId' <> 'null'::jsonb
  loop
    if jsonb_typeof(r.value -> 'refObjectId') <> 'string'
       or (r.value ->> 'refObjectId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023',
        message = format('Invalid dataset reference at %s.', r.path);
    end if;
    expected := case r.role
      when 'referenceToFlowDataSet' then 'flow'
      when 'referenceToFlowPropertyDataSet' then 'flow_property'
      when 'referenceToReferenceUnitGroup' then 'unit_group'
      when 'referenceToProcess' then 'process'
      when 'referenceToDataSource' then 'source'
      when 'referenceToContact' then 'contact'
      when 'referenceToCommissioner' then 'contact'
      when 'referenceToPersonOrEntityGeneratingTheDataSet' then 'contact'
      when 'referenceToOwnershipOfDataSet' then 'contact'
      else r.value ->> 'type' end;
    if expected is null or expected not in
       ('model','process','flow','flow_property','unit_group','source','contact')
       or (r.value ? 'type' and (r.value ->> 'type') is distinct from expected) then
      raise exception using errcode = '22023',
        message = format('Invalid dataset reference type at %s.', r.path);
    end if;
    target_dataset_id := (r.value ->> 'refObjectId')::uuid;
    expected_target_type := expected;
    reference_role := r.role;
    reference_path := r.path || '/refObjectId';
    return next;
  end loop;
end;
$$;

-- Serialize catalog writes while this small catalog's graph is maintained.
-- This also prevents concurrent ownership/visibility edits from racing edge
-- validation. Revisit locking granularity when measured write volume warrants it.
create function prism_private.lock_dataset_graph()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(1010, 1);
  return null;
end;
$$;
create trigger datasets_lock_graph before insert or update or delete
on public.datasets for each statement
execute function prism_private.lock_dataset_graph();

create function prism_private.prepare_dataset_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id or new.type is distinct from old.type then
      raise exception using errcode = '22023',
        message = 'Dataset identity and type cannot be changed. Create a new dataset instead.';
    end if;
    if current_setting('role', true) in ('anon', 'authenticated') and
       (new.created_by is distinct from old.created_by
        or new.visibility is distinct from old.visibility
        or new.import_batch_id is distinct from old.import_batch_id
        or new.created_at is distinct from old.created_at
        or new.source_id is distinct from old.source_id
        or new.source_version is distinct from old.source_version
        or new.schema_version is distinct from old.schema_version) then
      raise exception using errcode = '42501', message = 'Dataset ownership and provenance cannot be changed.';
    end if;
  end if;
  if new.import_batch_id is not null and not exists (
    select 1 from public.import_batches b
    where b.id = new.import_batch_id and b.created_by = new.created_by
  ) then
    raise exception using errcode = '42501', message = 'Import batch must belong to the dataset owner.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger datasets_prepare_write before insert or update on public.datasets
for each row execute function prism_private.prepare_dataset_write();

-- Only the trigger can write edges. SECURITY DEFINER is confined to this
-- private schema, uses a fixed search path, and is not callable through the API.
create function prism_private.sync_dataset_references()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.dataset_references where source_dataset_id = new.id;
  insert into public.dataset_references
    (source_dataset_id, target_dataset_id, expected_target_type, reference_role, reference_path)
  select new.id, r.* from prism_private.extract_references(new.payload) r;
  return null;
end;
$$;
create trigger datasets_sync_references after insert or update of payload
on public.datasets for each row
execute function prism_private.sync_dataset_references();

create function prism_private.validate_dataset_references()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Read final transaction state, not the NEW image of an earlier queued edit.
  if exists (
    select 1 from public.dataset_references r
    join public.datasets s on s.id = r.source_dataset_id
    left join public.datasets t on t.id = r.target_dataset_id
    where (r.source_dataset_id = new.id or r.target_dataset_id = new.id)
      and (t.id is null or t.type <> r.expected_target_type
        or (t.visibility <> 'public' and
          (s.visibility = 'public' or s.created_by is distinct from t.created_by)))
  ) then
    raise exception using errcode = '23503',
      message = 'A dataset reference is missing, has the wrong type, or is not accessible.';
  end if;
  return null;
end;
$$;
create constraint trigger datasets_validate_references
after insert or update on public.datasets deferrable initially deferred
for each row execute function prism_private.validate_dataset_references();

-- Backfill without rewriting existing payloads. Abort rather than repair data
-- silently if the deployed catalog contains an invalid relationship.
insert into public.dataset_references
  (source_dataset_id, target_dataset_id, expected_target_type, reference_role, reference_path)
select d.id, r.* from public.datasets d
cross join lateral prism_private.extract_references(d.payload) r;
do $$
begin
  if exists (
    select 1 from public.dataset_references r
    join public.datasets s on s.id = r.source_dataset_id
    left join public.datasets t on t.id = r.target_dataset_id
    where t.id is null or t.type <> r.expected_target_type
      or (t.visibility <> 'public' and
        (s.visibility = 'public' or s.created_by is distinct from t.created_by))
  ) then
    raise exception 'Existing catalog has invalid references. Audit and correct them before applying this migration.';
  end if;
end;
$$;

-- Preserve RPC signature and retry reports; reject SQL NULL/missing fields.
create or replace function public.import_datasets(
  p_batch_id uuid, p_source_format text, p_source_filename text, p_rows jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_report jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sign in before importing datasets.';
  end if;
  if p_batch_id is null then
    raise exception using errcode = '22023', message = 'An import batch ID is required.';
  end if;
  -- Serialize same-batch retries before checking their persisted report.
  -- Take the graph lock first to match transactions that already edited a row.
  perform pg_advisory_xact_lock(1010, 1);
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 1010));
  select summary into v_report from public.import_batches
  where id = p_batch_id and created_by = v_user_id;
  if found then return v_report || jsonb_build_object('idempotent', true); end if;
  if coalesce(btrim(p_source_format), '') = ''
     or length(p_source_filename) > 500
     or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid import source or rows.';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 then
    raise exception using errcode = '22023', message = 'The import contains no datasets.';
  end if;
  if v_count > 1000 or pg_column_size(p_rows) > 10485760 then
    raise exception using errcode = '54000', message = 'The import exceeds the 1000-dataset or 10 MB limit.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item(value)
    where jsonb_typeof(item.value) is distinct from 'object'
      or coalesce(item.value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(item.value ->> 'type', '') not in
        ('model','process','flow','flow_property','unit_group','source','contact')
      or jsonb_typeof(item.value -> 'name') is distinct from 'string'
      or length(btrim(coalesce(item.value ->> 'name', ''))) not between 1 and 1000
      or jsonb_typeof(item.value -> 'payload') is distinct from 'object'
      or (item.value ? 'source_id' and jsonb_typeof(item.value -> 'source_id') not in ('string','null'))
      or (item.value ? 'source_version' and jsonb_typeof(item.value -> 'source_version') not in ('string','null'))
  ) or (select count(distinct lower(item.value ->> 'id'))
        from jsonb_array_elements(p_rows) item(value)) <> v_count then
    raise exception using errcode = '22023', message = 'One or more import rows are invalid or duplicate.';
  end if;
  v_report := jsonb_build_object(
    'batch_id', p_batch_id, 'created_count', v_count,
    'summary', (select jsonb_object_agg(type, amount) from (
      select item.value ->> 'type' type, count(*) amount
      from jsonb_array_elements(p_rows) item(value) group by item.value ->> 'type'
    ) counts),
    'datasets', (select jsonb_agg(jsonb_build_object('id', item.value ->> 'id',
      'type', item.value ->> 'type', 'name', item.value ->> 'name') order by item.ordinality)
      from jsonb_array_elements(p_rows) with ordinality item(value, ordinality))
  );
  insert into public.import_batches(id, created_by, source_format, source_filename, summary)
  values(p_batch_id, v_user_id, btrim(p_source_format), nullif(btrim(p_source_filename), ''), v_report);
  insert into public.datasets
    (id, type, name, description, payload, created_by, visibility, import_batch_id, source_id, source_version)
  select (item.value ->> 'id')::uuid, item.value ->> 'type', btrim(item.value ->> 'name'),
    nullif(item.value ->> 'description', ''), item.value -> 'payload',
    v_user_id, 'private', p_batch_id, item.value ->> 'source_id', item.value ->> 'source_version'
  from jsonb_array_elements(p_rows) item(value);
  return v_report;
end;
$$;

revoke all on all functions in schema prism_private from public, anon, authenticated;
revoke all on function public.import_datasets(uuid, text, text, jsonb) from public, anon;
grant execute on function public.import_datasets(uuid, text, text, jsonb) to authenticated;

-- UNION deduplicates IDs, including cycles. Invoker security keeps both the
-- root and every traversed edge/dataset subject to the caller's normal RLS.
create function public.dataset_dependencies(p_dataset_id uuid)
returns setof public.datasets language sql stable security invoker
set search_path = '' as $$
  with recursive reachable(id) as (
    select id from public.datasets where id = p_dataset_id
    union
    select r.target_dataset_id from reachable parent
    join public.dataset_references r on r.source_dataset_id = parent.id
  )
  select d.* from public.datasets d join reachable r on r.id = d.id
  where d.id <> p_dataset_id
$$;
revoke all on function public.dataset_dependencies(uuid) from public;
grant execute on function public.dataset_dependencies(uuid) to anon, authenticated;

commit;
