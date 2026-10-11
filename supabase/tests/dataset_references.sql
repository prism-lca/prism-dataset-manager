-- Run after seed.sql and both migrations in a disposable local PostgreSQL DB.
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

insert into auth.users values
 ('a0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000001');
insert into public.datasets(id,type,name,payload,visibility) values
 ('c0000000-0000-4000-8000-000000000001','flow','Public flow','{}','public');
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
set local "request.jwt.claim.sub" = 'a0000000-0000-4000-8000-000000000001';

-- One ordinary form write immediately creates edges, including repeat targets.
insert into public.datasets(id,type,name,payload) values
 ('a0000000-0000-4000-8000-000000000010','process','Owner process',
 '{"exchanges":[{"referenceToFlowDataSet":{"refObjectId":"c0000000-0000-4000-8000-000000000001","type":"flow"}},{"referenceToFlowDataSet":{"refObjectId":"c0000000-0000-4000-8000-000000000001","type":"flow"}}],"optional":{"refObjectId":null}}');
set constraints all immediate;
select pg_temp.assert_true((select count(*) = 2 from public.dataset_references
 where source_dataset_id = 'a0000000-0000-4000-8000-000000000010'), 'repeated references have distinct paths');
select pg_temp.assert_true((select bool_and(reference_path like '/exchanges/%/referenceToFlowDataSet/refObjectId')
 from public.dataset_references where source_dataset_id = 'a0000000-0000-4000-8000-000000000010'), 'JSON pointer paths');
set constraints all deferred;

-- Import with source before its target: all records are validated together.
select public.import_datasets('a0000000-0000-4000-8000-000000000100','openlca','test.zip',
 '[{"id":"a0000000-0000-4000-8000-000000000020","type":"process","name":"Imported process","source_id":"original-process","source_version":"1.0","payload":{"exchanges":[{"referenceToFlowDataSet":{"refObjectId":"a0000000-0000-4000-8000-000000000021","type":"flow"}}]}},{"id":"a0000000-0000-4000-8000-000000000021","type":"flow","name":"Imported flow","payload":{}}]');
set constraints all immediate;
select pg_temp.assert_true((select count(*) = 1 from public.dataset_references
 where source_dataset_id = 'a0000000-0000-4000-8000-000000000020'), 'import edges created');
select pg_temp.assert_true((select count(*) = 1 from public.dataset_dependencies(
 'a0000000-0000-4000-8000-000000000020')), 'dependency lookup finds only the used flow');
select pg_temp.assert_true((select source_id = 'original-process' and source_version = '1.0'
 from public.datasets where id = 'a0000000-0000-4000-8000-000000000020'), 'source provenance retained');
select pg_temp.assert_true((public.import_datasets('a0000000-0000-4000-8000-000000000100',null,null,null)
 ->> 'idempotent')::boolean, 'retry returns existing report');
select pg_temp.assert_true((select
 public.import_datasets(id,null,null,null) = summary || '{"idempotent":true}'::jsonb
 from public.import_batches where id = 'a0000000-0000-4000-8000-000000000100'),
 'retry preserves the complete original report');
select pg_temp.assert_true((select count(*) = 2 from public.datasets
 where import_batch_id = 'a0000000-0000-4000-8000-000000000100'), 'retry creates no duplicate rows');
set constraints all deferred;

select pg_temp.expect_error($cmd$delete from public.datasets
 where id = 'a0000000-0000-4000-8000-000000000021'$cmd$, '23503');
select pg_temp.expect_error($cmd$update public.datasets set payload =
 '{"exchanges":[{"referenceToFlowDataSet":{"refObjectId":"a0000000-0000-4000-8000-000000000020","type":"flow"}}]}'
 where id = 'a0000000-0000-4000-8000-000000000010'$cmd$, '23503');
select pg_temp.expect_error($cmd$update public.datasets set payload =
 '{"exchanges":[{"referenceToFlowDataSet":{"refObjectId":"c0000000-0000-4000-8000-000000000001","type":"contact"}}]}'
 where id = 'a0000000-0000-4000-8000-000000000010'$cmd$, '22023');
select pg_temp.expect_error($cmd$update public.datasets set payload =
 '{"extension":{"refObjectId":"not-a-uuid","type":"flow"}}'
 where id = 'a0000000-0000-4000-8000-000000000010'$cmd$, '22023');
select pg_temp.expect_error($cmd$update public.datasets set type = 'flow'
 where id = 'a0000000-0000-4000-8000-000000000010'$cmd$, '22023');
select pg_temp.expect_error($cmd$update public.datasets set source_id = 'tampered'
 where id = 'a0000000-0000-4000-8000-000000000020'$cmd$, '42501');
select pg_temp.expect_error($cmd$insert into public.dataset_references
 (source_dataset_id,target_dataset_id,expected_target_type,reference_role,reference_path)
 values ('a0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000001','flow','extension','/fake')$cmd$, '42501');
select pg_temp.expect_error($cmd$select public.import_datasets(
 'a0000000-0000-4000-8000-000000000101','openlca','bad.zip',
 '[{"id":"a0000000-0000-4000-8000-000000000030","type":"process","name":"Bad process","payload":{"referenceToProcess":{"refObjectId":"a0000000-0000-4000-8000-000000000021","type":"process"}}}]')$cmd$, '23503');
select pg_temp.assert_true(not exists (select 1 from public.import_batches
 where id = 'a0000000-0000-4000-8000-000000000101'), 'invalid graph rolls back import batch');
select pg_temp.assert_true(not exists (select 1 from public.datasets
 where id = 'a0000000-0000-4000-8000-000000000030'), 'invalid graph rolls back datasets');
-- A valid row before an invalid row must also roll back, including its edges.
select pg_temp.expect_error($cmd$select public.import_datasets(
 'a0000000-0000-4000-8000-000000000103','openlca','mixed.zip',
 '[{"id":"a0000000-0000-4000-8000-000000000031","type":"process","name":"Valid first row","payload":{"referenceToFlowDataSet":{"refObjectId":"c0000000-0000-4000-8000-000000000001"}}},{"id":"a0000000-0000-4000-8000-000000000032","type":"process","name":"Missing target","payload":{"referenceToFlowDataSet":{"refObjectId":"a0000000-0000-4000-8000-000000000099"}}}]')$cmd$, '23503');
select pg_temp.assert_true(not exists(select 1 from public.import_batches
 where id = 'a0000000-0000-4000-8000-000000000103')
 and not exists(select 1 from public.datasets where id in
 ('a0000000-0000-4000-8000-000000000031','a0000000-0000-4000-8000-000000000032'))
 and not exists(select 1 from public.dataset_references where source_dataset_id in
 ('a0000000-0000-4000-8000-000000000031','a0000000-0000-4000-8000-000000000032')),
 'mixed batch rolls back valid rows, invalid rows, edges, and batch report');
select pg_temp.expect_error($cmd$select public.import_datasets(
 'a0000000-0000-4000-8000-000000000102','openlca','bad.zip',null)$cmd$, '22023');
select pg_temp.expect_error($cmd$select public.import_datasets(
 'a0000000-0000-4000-8000-000000000102','openlca','bad.zip',
 '[{"id":"a0000000-0000-4000-8000-000000000030","name":"Missing type/payload"}]')$cmd$, '22023');

-- A different user sees no owner-A private documents or edges.
set local "request.jwt.claim.sub" = 'b0000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(not exists(select 1 from public.datasets
 where id = 'a0000000-0000-4000-8000-000000000020')
 and not exists(select 1 from public.import_batches
 where id = 'a0000000-0000-4000-8000-000000000100'), 'other owner documents and reports hidden');
with changed as (update public.datasets set name = 'Unauthorized edit'
 where id = 'a0000000-0000-4000-8000-000000000020' returning id)
select pg_temp.assert_true(not exists(select 1 from changed), 'other owner update affects zero rows');
with removed as (delete from public.datasets
 where id = 'a0000000-0000-4000-8000-000000000020' returning id)
select pg_temp.assert_true(not exists(select 1 from removed), 'other owner delete affects zero rows');
select pg_temp.expect_error($cmd$select public.import_datasets(
 'a0000000-0000-4000-8000-000000000100','openlca','stolen-batch.zip',
 '[{"id":"b0000000-0000-4000-8000-000000000040","type":"flow","name":"Other user row","payload":{}}]')$cmd$, '23505');
select pg_temp.assert_true(not exists(select 1 from public.datasets
 where id = 'b0000000-0000-4000-8000-000000000040'), 'other owner cannot reuse batch or obtain retry report');
select pg_temp.assert_true(not exists(select 1 from public.dataset_references
 where source_dataset_id = 'a0000000-0000-4000-8000-000000000010'), 'other owner edges hidden');
select pg_temp.assert_true(not exists(select 1 from public.dataset_dependencies(
 'a0000000-0000-4000-8000-000000000020')), 'other owner cannot traverse private root');
select pg_temp.expect_error($cmd$insert into public.datasets(id,type,name,payload) values
 ('b0000000-0000-4000-8000-000000000010','process','Forbidden link',
 '{"referenceToProcess":{"refObjectId":"a0000000-0000-4000-8000-000000000020","type":"process"}}')$cmd$, '23503');

set local role anon;
set local "request.jwt.claim.sub" = '';
select pg_temp.assert_true(not exists(select 1 from public.dataset_references
 where source_dataset_id = 'a0000000-0000-4000-8000-000000000010'), 'anonymous private edges hidden');
select pg_temp.expect_error($cmd$select public.import_datasets(null,null,null,null)$cmd$, '42501');

reset role;
insert into public.datasets(id,type,name,payload,visibility) values
 ('c0000000-0000-4000-8000-000000000020','process','Public process',
 '{"referenceToFlowDataSet":{"refObjectId":"c0000000-0000-4000-8000-000000000001","type":"flow"}}','public');
set constraints all immediate;
set constraints all deferred;
set local role anon;
select pg_temp.assert_true((select count(*) = 1 from public.dataset_dependencies(
 'c0000000-0000-4000-8000-000000000020')), 'anonymous public traversal works');
reset role;
-- Administrative changes must preserve incoming-edge visibility too.
select pg_temp.expect_error($cmd$update public.datasets set visibility = 'private',
 created_by = 'b0000000-0000-4000-8000-000000000001'
 where id = 'c0000000-0000-4000-8000-000000000001'$cmd$, '23503');
select pg_temp.expect_error($cmd$insert into public.datasets(id,type,name,payload,visibility) values
 ('c0000000-0000-4000-8000-000000000010','process','Public to private',
 '{"referenceToProcess":{"refObjectId":"a0000000-0000-4000-8000-000000000020","type":"process"}}','public')$cmd$, '23503');

-- Cycles are valid relationships; recursive lookup must terminate.
insert into public.datasets(id,type,name,payload,visibility) values
 ('c0000000-0000-4000-8000-000000000030','contact','Contact one',
 '{"referenceToContact":[{"refObjectId":"c0000000-0000-4000-8000-000000000031","type":"contact"}]}','public'),
 ('c0000000-0000-4000-8000-000000000031','contact','Contact two',
 '{"referenceToContact":[{"refObjectId":"c0000000-0000-4000-8000-000000000030","type":"contact"}]}','public');
set constraints all immediate;
select pg_temp.assert_true((select count(*) = 1 from public.dataset_dependencies(
 'c0000000-0000-4000-8000-000000000030')), 'cycles terminate without repeating root');
set constraints all deferred;
delete from public.datasets where id in
 ('c0000000-0000-4000-8000-000000000030','c0000000-0000-4000-8000-000000000031');
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
set local "request.jwt.claim.sub" = 'a0000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select name = 'Imported process' from public.datasets
 where id = 'a0000000-0000-4000-8000-000000000020'), 'unauthorized edit preserved original row');
select pg_temp.expect_error($cmd$update public.datasets set created_by =
 'b0000000-0000-4000-8000-000000000001'
 where id = 'a0000000-0000-4000-8000-000000000020'$cmd$, '42501');
select pg_temp.expect_error($cmd$update public.datasets set visibility = 'public'
 where id = 'a0000000-0000-4000-8000-000000000020'$cmd$, '42501');
update public.datasets set payload = '{}' where id = 'a0000000-0000-4000-8000-000000000020';
set constraints all immediate;
select pg_temp.assert_true(not exists(select 1 from public.dataset_references
 where source_dataset_id = 'a0000000-0000-4000-8000-000000000020'), 'edits remove old edges');
delete from public.datasets where id = 'a0000000-0000-4000-8000-000000000021';
delete from public.datasets where id = 'a0000000-0000-4000-8000-000000000010';
select pg_temp.assert_true(not exists(select 1 from public.dataset_references
 where source_dataset_id = 'a0000000-0000-4000-8000-000000000010'), 'source delete cleans edges');
rollback;
\echo 'Dataset reference integration checks passed.'
