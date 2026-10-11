-- Stage 1 acceptance. Run after seed.sql and both migrations locally.
-- All test writes are rolled back.
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

insert into public.datasets(id, type, name, payload, visibility) values
 ('d0000000-0000-4000-8000-000000000001', 'flow', 'Stage 1 fixture', '{"nested":{"value":42}}', 'public');
select pg_temp.assert_true((select updated_at is not null and schema_version = 1
  and source_id is null and source_version is null from public.datasets
  where id = 'd0000000-0000-4000-8000-000000000001'), 'new-row defaults');
create temporary table stage1_before as select * from public.datasets
  where id = 'd0000000-0000-4000-8000-000000000001';
select pg_sleep(0.01);
update public.datasets set name = 'Edited fixture'
  where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select d.updated_at > b.updated_at
  and d.created_at is not distinct from b.created_at and d.payload = b.payload
  from public.datasets d join stage1_before b using (id)), 'edit updates timestamp and preserves document');

select pg_temp.expect_error($cmd$update public.datasets set name = '   '
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '23514');
select pg_temp.expect_error($cmd$update public.datasets set name = null
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '23502');
select pg_temp.expect_error($cmd$update public.datasets set payload = null
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '23502');
select pg_temp.expect_error($cmd$update public.datasets set payload = '[]'
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '23514');
select pg_temp.expect_error($cmd$update public.datasets set payload = 'null'
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '23514');
select pg_temp.expect_error($cmd$update public.datasets set schema_version = 0
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '23514');
select pg_temp.expect_error($cmd$update public.datasets set id = 'd0000000-0000-4000-8000-000000000002'
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '22023');
select pg_temp.expect_error($cmd$update public.datasets set type = 'process'
  where id = 'd0000000-0000-4000-8000-000000000001'$cmd$, '22023');
select pg_temp.expect_error($cmd$insert into public.datasets(type,name,payload,visibility)
  values ('unsupported','Invalid type','{}','public')$cmd$, '23514');

rollback;
\echo Stage 1 main-table acceptance passed.
