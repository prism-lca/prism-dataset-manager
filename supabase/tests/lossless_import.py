"""Run as local postgres in disposable DB, after all migrations + storage mock."""
import json,sys,uuid
from import_transactions import query

def main(db):
 if any(c in db for c in ':/='):raise ValueError('Local disposable database only')
 owner,other,batch,dataset=[str(uuid.uuid4()) for _ in range(4)]
 path=f'{owner}/{batch}/original'
 q=lambda sql,**kw:query(db,sql,**kw)
 auth=lambda user: f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL \"request.jwt.claim.sub\"='{user}'; "
 artifact={'storage_bucket':'import-originals','storage_path':path,'sha256':'a'*64,'byte_size':4,'media_type':'application/zip','entry_inventory':[]}
 rows=[{'id':dataset,'type':'flow','name':'Original preservation test','payload':{'future':{'retained':42}}}]
 sources=[{'dataset_id':dataset,'source_kind':'unassessed','locators':[],'mapping_report':{'status':'unassessed'}}]
 def call(b=batch,r=rows,a=artifact,s=sources):
  return f"SELECT public.import_datasets('{b}','openlca-json-ld','fixture.zip',$j${json.dumps(r)}$j$::jsonb,$j${json.dumps(a)}$j$::jsonb,$j${json.dumps(s)}$j$::jsonb);"
 q(f"INSERT INTO auth.users VALUES ('{owner}'),('{other}');")
 try:
  failed=q(auth(owner)+call()+"COMMIT;",expect_success=False)
  assert failed.returncode and 'Upload and verify' in failed.stderr
  q(auth(owner)+f"INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('import-originals','{path}','{owner}','{{\"size\":4}}'); COMMIT;")
  invalid={**rows[0],'payload':{'referenceToFlowDataSet':{'refObjectId':str(uuid.uuid4()),'type':'flow'}}}
  failed=q(auth(owner)+call(r=[invalid])+"COMMIT;",expect_success=False)
  assert failed.returncode and ('reference' in failed.stderr.lower())
  assert q(f"SELECT (SELECT count(*) FROM public.import_artifacts WHERE id='{batch}'),(SELECT count(*) FROM public.import_batches WHERE id='{batch}'),(SELECT count(*) FROM public.datasets WHERE id='{dataset}');").stdout.strip()=='0|0|0'
  report=json.loads(q(auth(owner)+call()+"COMMIT;").stdout)
  assert report['created_count']==1 and report['artifact_id']==batch
  retry=json.loads(q(auth(owner)+call()+"COMMIT;").stdout)
  assert retry=={**report,'idempotent':True}
  failed=q(auth(owner)+call(a={**artifact,'sha256':'b'*64})+"COMMIT;",expect_success=False)
  assert failed.returncode and 'differs' in failed.stderr
  failed=q(auth(other)+call()+"COMMIT;",expect_success=False)
  assert failed.returncode and 'another account' in failed.stderr
  for user,count in [(owner,'1|1|1'),(other,'0|0|0')]:
   assert q(auth(user)+f"SELECT (SELECT count(*) FROM public.import_artifacts WHERE id='{batch}'),(SELECT count(*) FROM public.dataset_source_records WHERE dataset_id='{dataset}'),(SELECT count(*) FROM storage.objects WHERE name='{path}'); COMMIT;").stdout.strip()==count
  assert q(auth(owner)+f"DELETE FROM storage.objects WHERE name='{path}' RETURNING id; COMMIT;").stdout.strip()==''
  failed=q(auth(owner)+f"UPDATE public.import_artifacts SET sha256=repeat('b',64) WHERE id='{batch}'; COMMIT;",expect_success=False)
  assert failed.returncode and 'permission denied' in failed.stderr
  print('Lossless DB acceptance passed: upload required, graph rollback, one atomic artifact graph, retry/hash checks, RLS isolation, immutable confirmed originals.')
 finally:
  q(f"BEGIN; DELETE FROM public.datasets WHERE id='{dataset}'; UPDATE public.import_batches SET artifact_id=NULL WHERE id='{batch}'; DELETE FROM public.import_artifacts WHERE id='{batch}'; DELETE FROM public.import_batches WHERE id='{batch}'; DELETE FROM storage.objects WHERE name='{path}'; DELETE FROM auth.users WHERE id IN ('{owner}','{other}'); COMMIT;")

if __name__=='__main__':main(sys.argv[1])
