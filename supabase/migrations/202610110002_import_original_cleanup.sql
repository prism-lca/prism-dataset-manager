-- Hosted Supabase: scheduled cleanup uses the Storage API, never SQL deletion.
-- Configure Vault secrets prism_import_cleanup_url and prism_import_cleanup_key
-- before the scheduled job runs. Neither credential is exposed through PostgREST.
begin;
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;
create function public.cleanup_import_originals() returns integer
language plpgsql security definer set search_path='' as $$
declare
 paths jsonb; project_url text; api_key text; response extensions.http_response;
begin
 -- claim_import_orphans holds the shared graph lock until this transaction ends.
 select jsonb_agg(storage_path) into paths from public.claim_import_orphans();
 if paths is null then return 0; end if;
 select decrypted_secret into project_url from vault.decrypted_secrets where name='prism_import_cleanup_url';
 select decrypted_secret into api_key from vault.decrypted_secrets where name='prism_import_cleanup_key';
 if project_url is null or api_key is null then raise exception 'Configure the original cleanup Vault secrets.'; end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT','15');
 select * into response from extensions.http((
  'DELETE',rtrim(project_url,'/') || '/storage/v1/object/import-originals',
  array[extensions.http_header('Authorization','Bearer ' || api_key),extensions.http_header('apikey',api_key)],
  'application/json',jsonb_build_object('prefixes',paths)::text
 )::extensions.http_request);
 if response.status<>200 then raise exception 'Original cleanup Storage API returned HTTP %.',response.status; end if;
 return jsonb_array_length(response.content::jsonb);
end;
$$;
revoke all on function public.cleanup_import_originals() from public,anon,authenticated;
grant execute on function public.cleanup_import_originals() to service_role;
select cron.schedule('prism-clean-interrupted-originals','23 3 * * *','select public.cleanup_import_originals();');
commit;
