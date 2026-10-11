-- Additive: retain the four-argument RPC for older deployed clients.
begin;
create table public.import_artifacts (
 id uuid primary key references public.import_batches(id),
 created_by uuid not null references auth.users(id),
 source_format text not null,
 source_filename text not null check(length(source_filename) between 1 and 500),
 media_type text not null,
 byte_size bigint not null check(byte_size between 1 and 26214400),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 storage_bucket text not null check(storage_bucket='import-originals'),
 storage_path text not null unique,
 entry_inventory jsonb not null check(jsonb_typeof(entry_inventory)='array'),
 created_at timestamptz not null default now(),
 check(storage_path=created_by::text || '/' || id::text || '/original')
);
alter table public.import_batches add column artifact_id uuid references public.import_artifacts(id) deferrable initially deferred;
create table public.dataset_source_records (
 id uuid primary key default gen_random_uuid(),
 dataset_id uuid not null unique references public.datasets(id) on delete cascade,
 artifact_id uuid not null references public.import_artifacts(id),
 source_kind text not null check(source_kind in ('direct','derived','synthetic','unassessed')),
 locators jsonb not null check(jsonb_typeof(locators)='array'),
 mapping_report jsonb not null check(jsonb_typeof(mapping_report)='object'),
 created_at timestamptz not null default now()
);
alter table public.import_artifacts enable row level security;
alter table public.dataset_source_records enable row level security;
revoke all on public.import_artifacts,public.dataset_source_records from public,anon,authenticated;
grant select on public.import_artifacts,public.dataset_source_records to authenticated;
create policy "owners read original artifacts" on public.import_artifacts for select to authenticated using(created_by=auth.uid());
create policy "owners read source mappings" on public.dataset_source_records for select to authenticated using(exists(select 1 from public.import_artifacts a where a.id=artifact_id and a.created_by=auth.uid()));

-- Cleanup claims serialize with confirmation; cleanup never races a confirmed import.
create table public.import_cleanup_claims(storage_path text primary key,claimed_at timestamptz not null default now());
alter table public.import_cleanup_claims enable row level security;
revoke all on public.import_cleanup_claims from public,anon,authenticated;

create function public.claim_import_orphans() returns table(storage_path text)
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(1010,1);
 return query with candidates as (
  select o.name from storage.objects o
  where o.bucket_id='import-originals' and o.created_at<now()-interval '24 hours'
   and not exists(select 1 from public.import_artifacts a where a.storage_path=o.name)
  order by o.created_at limit 100
 ), claims as (
  insert into public.import_cleanup_claims(storage_path) select name from candidates
  on conflict on constraint import_cleanup_claims_pkey do update set claimed_at=now()
  returning import_cleanup_claims.storage_path
 ) select claims.storage_path from claims;
end;
$$;
revoke all on function public.claim_import_orphans() from public,anon,authenticated;
grant execute on function public.claim_import_orphans() to service_role;

-- A fresh snapshot after the graph lock protects against an in-flight confirm.
create function public.can_remove_import_original(p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if split_part(p_path,'/',1) is distinct from auth.uid()::text then return false; end if;
 perform pg_advisory_xact_lock(1010,1);
 return not exists(select 1 from public.import_artifacts a where a.storage_path=p_path);
end;
$$;
revoke all on function public.can_remove_import_original(text) from public,anon;
grant execute on function public.can_remove_import_original(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit) values('import-originals','import-originals',false,26214400);
create policy "upload own unconfirmed original" on storage.objects for insert to authenticated with check (
 bucket_id='import-originals' and split_part(name,'/',1)=auth.uid()::text
 and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/original$'
 and not exists(select 1 from public.import_artifacts a where a.storage_path=name)
);
create policy "read own original" on storage.objects for select to authenticated using(bucket_id='import-originals' and split_part(name,'/',1)=auth.uid()::text);
create policy "remove own unconfirmed original" on storage.objects for delete to authenticated using (
 bucket_id='import-originals' and split_part(name,'/',1)=auth.uid()::text
 and public.can_remove_import_original(name)
);
-- No UPDATE policy: confirmed and pending original objects cannot be overwritten.

create function public.import_datasets(
 p_batch_id uuid,p_source_format text,p_source_filename text,p_rows jsonb,
 p_artifact jsonb,p_sources jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); report jsonb; expected_path text; existing public.import_artifacts;
begin
 if actor is null then raise exception using errcode='42501',message='Sign in before importing.'; end if;
 if p_batch_id is null then raise exception using errcode='22023',message='Import batch ID is required.'; end if;
 perform pg_advisory_xact_lock(1010,1);
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,1010));
 select * into existing from public.import_artifacts where id=p_batch_id;
 if found then
  if existing.created_by<>actor then raise exception using errcode='42501',message='Import batch belongs to another account.'; end if;
  if p_artifact->>'sha256' is distinct from existing.sha256 then raise exception using errcode='22023',message='Retry original differs from the confirmed file.'; end if;
  select summary into report from public.import_batches where id=p_batch_id and created_by=actor;
  return report || jsonb_build_object('idempotent',true);
 end if;
 if exists(select 1 from public.import_batches where id=p_batch_id) then
  raise exception using errcode='22023',message='This batch has no original artifact. Start a new import.';
 end if;
 expected_path:=actor::text || '/' || p_batch_id::text || '/original';
 if exists(select 1 from public.import_cleanup_claims c where c.storage_path=expected_path) then
  raise exception using errcode='22023',message='This interrupted upload has expired. Start a new import.';
 end if;
 if jsonb_typeof(p_artifact) is distinct from 'object'
  or p_artifact->>'storage_bucket' is distinct from 'import-originals'
  or p_artifact->>'storage_path' is distinct from expected_path
  or coalesce(p_artifact->>'sha256','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_artifact->'entry_inventory') is distinct from 'array'
  or jsonb_typeof(p_sources) is distinct from 'array'
  or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_sources)<>jsonb_array_length(p_rows) then
  raise exception using errcode='22023',message='Original artifact or source records are invalid.';
 end if;
 perform 1 from storage.objects o where o.bucket_id='import-originals'
  and o.name=expected_path and o.owner_id=actor::text
  and (o.metadata->>'size')::bigint=(p_artifact->>'byte_size')::bigint for share;
 if not found then
  raise exception using errcode='22023',message='Upload and verify the original file before confirming.';
 end if;
 if exists(select 1 from jsonb_array_elements(p_sources) s where
  coalesce(s->>'source_kind','') not in ('direct','derived','synthetic','unassessed')
  or jsonb_typeof(s->'locators') is distinct from 'array'
  or jsonb_typeof(s->'mapping_report') is distinct from 'object'
  or not exists(select 1 from jsonb_array_elements(p_rows) r where r->>'id'=s->>'dataset_id'))
  or (select count(distinct s->>'dataset_id') from jsonb_array_elements(p_sources) s)<>jsonb_array_length(p_rows) then
  raise exception using errcode='22023',message='Source records must cover each imported dataset exactly once.';
 end if;
 report:=public.import_datasets(p_batch_id,p_source_format,p_source_filename,p_rows);
 insert into public.import_artifacts(id,created_by,source_format,source_filename,media_type,byte_size,sha256,storage_bucket,storage_path,entry_inventory)
 values(p_batch_id,actor,p_source_format,p_source_filename,p_artifact->>'media_type',(p_artifact->>'byte_size')::bigint,p_artifact->>'sha256','import-originals',expected_path,p_artifact->'entry_inventory');
 insert into public.dataset_source_records(dataset_id,artifact_id,source_kind,locators,mapping_report)
 select (s->>'dataset_id')::uuid,p_batch_id,s->>'source_kind',s->'locators',s->'mapping_report' from jsonb_array_elements(p_sources) s;
 report:=report || jsonb_build_object('artifact_id',p_batch_id);
 update public.import_batches set artifact_id=p_batch_id,summary=report where id=p_batch_id and created_by=actor;
 return report;
end;
$$;
revoke all on function public.import_datasets(uuid,text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.import_datasets(uuid,text,text,jsonb,jsonb,jsonb) to authenticated;
commit;
