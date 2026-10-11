-- Read-only post-migration verification for the Supabase SQL Editor/admin.
-- Safe on production: no fixture writes or schema changes.
begin transaction read only;

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'datasets'
      and column_name = 'updated_at' and is_nullable = 'NO')
    or not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'datasets'
      and column_name = 'schema_version' and is_nullable = 'NO') then
    raise exception 'Required main-table columns are missing';
  end if;
  if not (select relrowsecurity from pg_class
    where oid = 'public.dataset_references'::regclass) then
    raise exception 'Relationship RLS is not enabled';
  end if;
  if has_table_privilege('anon','public.dataset_references','INSERT')
    or has_table_privilege('anon','public.dataset_references','UPDATE')
    or has_table_privilege('anon','public.dataset_references','DELETE')
    or has_table_privilege('authenticated','public.dataset_references','INSERT')
    or has_table_privilege('authenticated','public.dataset_references','UPDATE')
    or has_table_privilege('authenticated','public.dataset_references','DELETE') then
    raise exception 'Browser roles can mutate relationships';
  end if;
  if has_function_privilege('anon','public.import_datasets(uuid,text,text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.import_datasets(uuid,text,text,jsonb)','EXECUTE')
    or not has_function_privilege('anon','public.dataset_dependencies(uuid)','EXECUTE') then
    raise exception 'Unexpected RPC permissions';
  end if;
  if exists (
    select 1 from public.dataset_references r
    join public.datasets s on s.id = r.source_dataset_id
    left join public.datasets t on t.id = r.target_dataset_id
    where t.id is null or t.type <> r.expected_target_type
      or (t.visibility <> 'public' and
        (s.visibility = 'public' or s.created_by is distinct from t.created_by))
  ) then
    raise exception 'Invalid graph relationship';
  end if;
  if exists (
    with expected as (
      select d.id as source_dataset_id, r.* from public.datasets d
      cross join lateral prism_private.extract_references(d.payload) r
    ), actual as (
      select source_dataset_id,target_dataset_id,expected_target_type,
        reference_role,reference_path from public.dataset_references
    )
    (select * from expected except select * from actual)
    union all (select * from actual except select * from expected)
  ) then
    raise exception 'Payload and relationship rows differ';
  end if;
end;
$$;

select 'Post-migration verification passed' as status,
  (select count(*) from public.datasets) as datasets,
  (select count(*) from public.dataset_references) as references,
  (select count(*) from public.import_batches) as import_batches;

commit;
