-- Stage 2 acceptance. Run after seed.sql and both migrations locally.
-- All fixture writes are rolled back.
\set ON_ERROR_STOP on
begin;

create function pg_temp.assert_true(value boolean, message text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'Assertion failed: %', message; end if;
end $$;
create function pg_temp.expect_error(command text, expected_state text) returns void
language plpgsql as $$
declare caught boolean := false;
begin
  begin
    execute command;
    set constraints all immediate;
  exception when others then
    if SQLSTATE <> expected_state then
      raise exception 'Expected %, got %: %', expected_state, SQLSTATE, SQLERRM;
    end if;
    caught := true;
  end;
  if not caught then raise exception 'Expected % for %', expected_state, command; end if;
end $$;

-- Existing catalog was backfilled with valid endpoints and types.
select pg_temp.assert_true(not exists (
  select 1 from public.dataset_references r
  left join public.datasets s on s.id = r.source_dataset_id
  left join public.datasets t on t.id = r.target_dataset_id
  where s.id is null or t.id is null or t.type <> r.expected_target_type
), 'backfilled relationships have valid endpoints');
select pg_temp.assert_true(exists (
  select 1 from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
  where i.indrelid = 'public.dataset_references'::regclass
    and a.attname = 'target_dataset_id' and i.indisvalid
), 'incoming-reference lookup is indexed');

insert into public.datasets(id,type,name,payload,visibility) values
 ('e0000000-0000-4000-8000-000000000001','flow','First target','{}','public'),
 ('e0000000-0000-4000-8000-000000000002','flow','Replacement target','{}','public'),
 ('e0000000-0000-4000-8000-000000000003','process','Source',
 '{"exchanges":[{"referenceToFlowDataSet":{"refObjectId":"e0000000-0000-4000-8000-000000000001"}},{"referenceToFlowDataSet":{"refObjectId":"e0000000-0000-4000-8000-000000000001","type":"flow"}}],"a/b~c":{"refObjectId":"e0000000-0000-4000-8000-000000000001","type":"flow"},"freeText":{"refObjectId":null,"shortDescription":"Unresolved literature reference"}}',
 'public');
set constraints all immediate;

-- Same target at three paths yields three edges; null/free text yields none.
create temporary table expected_paths(path text);
insert into expected_paths values
 ('/exchanges/0/referenceToFlowDataSet/refObjectId'),
 ('/exchanges/1/referenceToFlowDataSet/refObjectId'),
 ('/a~1b~0c/refObjectId');
select pg_temp.assert_true(not exists (
  (select reference_path from public.dataset_references
   where source_dataset_id = 'e0000000-0000-4000-8000-000000000003'
   except select path from expected_paths)
  union all
  (select path from expected_paths except
   select reference_path from public.dataset_references
   where source_dataset_id = 'e0000000-0000-4000-8000-000000000003')
), 'exact paths, array positions, and JSON Pointer escaping');
select pg_temp.assert_true((select count(*) = 3
  and bool_and(target_dataset_id = 'e0000000-0000-4000-8000-000000000001'
    and expected_target_type = 'flow') from public.dataset_references
  where source_dataset_id = 'e0000000-0000-4000-8000-000000000003'), 'duplicate targets remain separate edges');
select pg_temp.assert_true((select payload #>> '{freeText,shortDescription}' = 'Unresolved literature reference'
  and payload #> '{freeText,refObjectId}' = 'null'::jsonb
  from public.datasets where id = 'e0000000-0000-4000-8000-000000000003'), 'free-text reference preserved');
select pg_temp.expect_error($cmd$insert into public.dataset_references
 (source_dataset_id,target_dataset_id,expected_target_type,reference_role,reference_path)
 values ('e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000001',
 'flow','referenceToFlowDataSet','/exchanges/0/referenceToFlowDataSet/refObjectId')$cmd$, '23505');

create temporary table before_metadata_edit as select * from public.dataset_references
  where source_dataset_id = 'e0000000-0000-4000-8000-000000000003';
update public.datasets set name = 'Renamed source'
  where id = 'e0000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(not exists (
 (select * from before_metadata_edit except select * from public.dataset_references)
), 'metadata-only edit preserves edge identities');
select pg_temp.expect_error($cmd$delete from public.datasets
 where id = 'e0000000-0000-4000-8000-000000000001'$cmd$, '23503');
select pg_temp.assert_true(exists(select 1 from public.datasets
  where id = 'e0000000-0000-4000-8000-000000000001'), 'protected target survives failed deletion');

-- Changing the payload replaces old edges and frees the old target for deletion.
update public.datasets set payload =
 '{"referenceToFlowDataSet":{"refObjectId":"e0000000-0000-4000-8000-000000000002","type":"flow"}}'
 where id = 'e0000000-0000-4000-8000-000000000003';
select pg_temp.assert_true((select count(*) = 1 and bool_and(
  target_dataset_id = 'e0000000-0000-4000-8000-000000000002'
  and reference_path = '/referenceToFlowDataSet/refObjectId')
  from public.dataset_references
  where source_dataset_id = 'e0000000-0000-4000-8000-000000000003'), 'payload edit replaces all obsolete edges');
delete from public.datasets where id = 'e0000000-0000-4000-8000-000000000001';

-- Failed replacement restores both authoritative payload and edge rows.
create temporary table before_failed_edit as select * from public.dataset_references
  where source_dataset_id = 'e0000000-0000-4000-8000-000000000003';
select pg_temp.expect_error($cmd$update public.datasets set payload =
 '{"referenceToFlowDataSet":{"refObjectId":"e0000000-0000-4000-8000-000000000099"}}'
 where id = 'e0000000-0000-4000-8000-000000000003'$cmd$, '23503');
select pg_temp.assert_true(not exists (
 (select * from before_failed_edit except select * from public.dataset_references)
), 'failed edit restores original edges');
select pg_temp.assert_true((select payload #>> '{referenceToFlowDataSet,refObjectId}'
  = 'e0000000-0000-4000-8000-000000000002' from public.datasets
  where id = 'e0000000-0000-4000-8000-000000000003'), 'failed edit restores original payload');
delete from public.datasets where id = 'e0000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(not exists(select 1 from public.dataset_references
 where source_dataset_id = 'e0000000-0000-4000-8000-000000000003'), 'source deletion cascades to edges');
delete from public.datasets where id = 'e0000000-0000-4000-8000-000000000002';

-- Browser roles cannot mutate the derived relationship table independently.
select pg_temp.assert_true(
 not has_table_privilege('authenticated','public.dataset_references','INSERT')
 and not has_table_privilege('authenticated','public.dataset_references','UPDATE')
 and not has_table_privilege('authenticated','public.dataset_references','DELETE')
 and not has_table_privilege('anon','public.dataset_references','INSERT')
 and not has_table_privilege('anon','public.dataset_references','UPDATE')
 and not has_table_privilege('anon','public.dataset_references','DELETE'),
 'derived relationships are protected from browser writes');

rollback;
\echo Stage 2 relationship-table acceptance passed.
