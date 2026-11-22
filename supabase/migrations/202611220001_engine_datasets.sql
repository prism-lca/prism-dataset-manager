begin;

-- Keep the Dataset Manager's catalog/import contract. The engine reads
-- per-type tables with the same IDs and complete ILCD documents.
create schema prism_engine;
revoke all on schema prism_engine from public;
grant usage on schema prism_engine to anon, authenticated, service_role;

create table prism_engine.datasets (
  id uuid not null references public.datasets(id) on delete cascade on update cascade,
  type text not null,
  version text,
  catalog_version integer not null,
  name text not null,
  payload jsonb not null,
  primary key (type, id)
) partition by list (type);

create table prism_engine.lifecycle_models partition of prism_engine.datasets for values in ('model');
create table prism_engine.processes partition of prism_engine.datasets for values in ('process');
create table prism_engine.flows partition of prism_engine.datasets for values in ('flow');
create table prism_engine.flow_properties partition of prism_engine.datasets for values in ('flow_property');
create table prism_engine.unit_groups partition of prism_engine.datasets for values in ('unit_group');
create table prism_engine.sources partition of prism_engine.datasets for values in ('source');
create table prism_engine.contacts partition of prism_engine.datasets for values in ('contact');

alter table prism_engine.datasets enable row level security;
alter table prism_engine.lifecycle_models enable row level security;
alter table prism_engine.processes enable row level security;
alter table prism_engine.flows enable row level security;
alter table prism_engine.flow_properties enable row level security;
alter table prism_engine.unit_groups enable row level security;
alter table prism_engine.sources enable row level security;
alter table prism_engine.contacts enable row level security;

-- Bind read visibility to the existing catalog's row policies.
create policy read_visible_engine_datasets on prism_engine.datasets
for select to anon, authenticated using (
  exists (select 1 from public.datasets d where d.id = datasets.id)
);
revoke all on all tables in schema prism_engine from public, anon, authenticated, service_role;
grant select on prism_engine.datasets to anon, authenticated, service_role;

create function prism_engine.sync_dataset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.type is distinct from new.type then
    delete from prism_engine.datasets where id = new.id and type = old.type;
  end if;

  insert into prism_engine.datasets (id, type, version, catalog_version, name, payload)
  values (new.id, new.type,
    coalesce(new.source_version, new.payload #>> '{administrativeInformation,dataSetVersion}'),
    new.schema_version, new.name, new.payload)
  on conflict (type, id) do update
    set version = excluded.version, catalog_version = excluded.catalog_version,
        name = excluded.name, payload = excluded.payload;
  return new;
end;
$$;
revoke all on function prism_engine.sync_dataset() from public, anon, authenticated, service_role;

create trigger sync_engine_dataset
after insert or update of id, type, source_version, schema_version, name, payload on public.datasets
for each row execute function prism_engine.sync_dataset();

insert into prism_engine.datasets (id, type, version, catalog_version, name, payload)
select id, type,
       coalesce(source_version, payload #>> '{administrativeInformation,dataSetVersion}'),
       schema_version, name, payload
from public.datasets;

-- The deployment must never silently skip a source record during the backfill.
do $$
begin
  if (select count(*) from prism_engine.datasets) <> (select count(*) from public.datasets) then
    raise exception 'Engine dataset backfill does not match the PRISM catalog';
  end if;
end;
$$;

create function public.engine_model_bundle(p_model_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'model', to_jsonb(model),
    'dependencies', coalesce((
      select jsonb_agg(to_jsonb(dependency) order by dependency.type, dependency.id)
      from public.dataset_dependencies(model.id) as catalog
      join prism_engine.datasets dependency on dependency.type = catalog.type and dependency.id = catalog.id
    ), '[]'::jsonb)
  )
  from prism_engine.datasets model
  where model.type = 'model' and model.id = p_model_id;
$$;
revoke all on function public.engine_model_bundle(uuid) from public;
grant execute on function public.engine_model_bundle(uuid) to anon, authenticated, service_role;

commit;
