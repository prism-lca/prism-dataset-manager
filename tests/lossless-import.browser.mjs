/** Opt-in live acceptance: uses two temporary accounts and cleans all fixtures.
 * Required env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: SMOKE_BASE_URL, CHROMIUM_EXECUTABLE. Run with a built preview server.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
const cfg=process.env
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient(cfg.VITE_SUPABASE_URL,cfg.SUPABASE_SERVICE_ROLE_KEY,opts)
const anon=createClient(cfg.VITE_SUPABASE_URL,cfg.VITE_SUPABASE_ANON_KEY,opts)
const base=cfg.SMOKE_BASE_URL??'http://localhost:5173/prism-dataset-manager/'
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/imports/manifest.json',import.meta.url)))
const users=[],paths=[]
const browser=await chromium.launch({headless:true,executablePath:cfg.CHROMIUM_EXECUTABLE,args:['--no-sandbox']})
const requireData=result=>{if(result.error)throw new Error(result.error.message);return result.data}
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
let normalized=[]
try {
 for(let i=0;i<2;i++) {
  const email=`lossless-${crypto.randomUUID()}@example.invalid`,password=crypto.randomBytes(24).toString('hex')
  const user=requireData(await admin.auth.admin.createUser({email,password,email_confirm:true})).user
  users.push({id:user.id})
  const client=createClient(cfg.VITE_SUPABASE_URL,cfg.VITE_SUPABASE_ANON_KEY,opts)
  const {session}=requireData(await client.auth.signInWithPassword({email,password}))
  Object.assign(users.at(-1),{client,session})
 }
 const [owner,other]=users
 const context=await browser.newContext()
 const key=`sb-${new URL(cfg.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
 await context.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key,session:owner.session})
 const page=await context.newPage(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 for(const fixture of fixtures) {
  await page.goto(base+'import')
  const conversion=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/interchange/import/openlca'))
  await page.locator('input[type=file]').setInputFiles(new URL('./fixtures/imports/'+fixture.file,import.meta.url).pathname)
  const preview=await conversion;assert(preview.ok(),`Engine HTTP ${preview.status()}`)
  await page.getByRole('button',{name:'Confirm import',exact:true}).waitFor()
  if(fixture.file.endsWith('.zip')) {
   await page.getByRole('button',{name:/unsupported\/custom.json/}).click()
   await page.getByRole('button',{name:'Structured',exact:true}).click()
   await page.getByRole('textbox',{name:'Search source content',exact:true}).fill('Source review preserved')
   await page.getByText('Source review preserved',{exact:true}).waitFor()
   await page.getByRole('button',{name:/unsupported\/source-notes.txt/}).click()
   await page.getByRole('button',{name:'Raw',exact:true}).click()
   assert(await page.getByRole('button',{name:'Next section',exact:true}).isEnabled())
   await page.getByRole('button',{name:'Next section',exact:true}).click()
   assert((await page.locator('pre').first().innerText()).includes('Français seulement'))
  }
  const committed=page.waitForResponse(r=>r.url().includes('/rest/v1/rpc/import_datasets'))
  await page.getByRole('button',{name:'Confirm import',exact:true}).click()
  const response=await committed;assert(response.ok(),await response.text())
  const report=await response.json()
  await page.getByText(`Imported ${fixture.datasets} private datasets successfully.`,{exact:true}).waitFor()
  const artifact=requireData(await owner.client.from('import_artifacts').select('*').eq('id',report.batch_id).single())
  paths.push(artifact.storage_path)
  assert.equal(artifact.sha256,fixture.sha256)
  const original=requireData(await owner.client.storage.from('import-originals').download(artifact.storage_path))
  assert.equal(digest(Buffer.from(await original.arrayBuffer())),fixture.sha256)
  assert.equal(requireData(await other.client.from('import_artifacts').select('id').eq('id',report.batch_id)).length,0)
  assert((await other.client.storage.from('import-originals').download(artifact.storage_path)).error)
  assert((await anon.storage.from('import-originals').download(artifact.storage_path)).error)
  const deletion=await owner.client.storage.from('import-originals').remove([artifact.storage_path])
  assert(!deletion.data?.length)
  const overwrite=await owner.client.storage.from('import-originals').upload(artifact.storage_path,new Blob(['changed']),{upsert:true})
  assert(overwrite.error)
  const rows=requireData(await owner.client.from('datasets').select('*').eq('import_batch_id',report.batch_id))
  if(fixture.format==='openlca-json-ld')normalized=rows
  const sources=requireData(await owner.client.from('dataset_source_records').select('*').in('dataset_id',rows.map(r=>r.id)))
  assert.equal(sources.length,rows.length);assert(sources.every(s=>s.source_kind==='unassessed'))
  const retry=requireData(await owner.client.rpc('import_datasets',{p_batch_id:report.batch_id,p_source_format:fixture.format,p_source_filename:fixture.file,p_rows:[],p_artifact:artifact,p_sources:[]}))
  assert.deepEqual(retry,{...report,idempotent:true})
  await page.goto(base+`open-data/${rows[0].type}/${rows[0].id}`)
  await page.locator('summary').filter({hasText:'Source data and additional fields'}).click()
  await page.getByRole('button',{name:'View original source',exact:true}).click()
  await page.getByRole('button',{name:'Download original',exact:true}).waitFor()
  const downloaded=page.waitForEvent('download')
  await page.getByRole('button',{name:'Download original',exact:true}).click()
  const download=await downloaded
  assert.equal(digest(fs.readFileSync(await download.path())),fixture.sha256)
  await page.reload()
  await page.locator('summary').filter({hasText:'Source data and additional fields'}).click()
  await page.getByRole('button',{name:'View original source',exact:true}).click()
  await page.getByRole('button',{name:'Download original',exact:true}).waitFor()
  console.log(`${fixture.format}: real conversion, atomic import, exact original, refresh, ownership, immutable bytes, retry passed.`)
 }
 // Exercise all seven real edit forms, keeping unknown fields at the root and inside items.
 for(const type of ['source']) {
  const root=type==='source'?'sourceInformation':'contactInformation'
  const row=requireData(await owner.client.from('datasets').insert({type,name:'French fixture',description:'Original description',payload:{[root]:{dataSetInformation:{name:[{lang:'fr',text:'Nom français'}],shortName:[{lang:'fr',text:'Nom court'}]}}}}).select().single())
  normalized.push(row)
 }
 for(const type of ['model','process','flow','flow_property','unit_group','source','contact']) {
  const row=normalized.find(r=>r.type===type)
  const payload=structuredClone(row.payload);payload.futureField={review:{text:'Keep untouched'},numeric:42}
  for(const [key,value]of Object.entries(payload))if(Array.isArray(value)&&value[0]&&typeof value[0]==='object')value[0].futureItemField={retain:true,key}
  requireData(await owner.client.from('datasets').update({payload}).eq('id',row.id))
  await page.goto(base+`open-data/${type}/${row.id}/edit`)
  await page.getByRole('button',{name:'Save changes',exact:true}).waitFor()
  console.log(`${type}: testing imported form save.`)
  const patch=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().includes('/rest/v1/datasets'))
  await page.getByRole('button',{name:'Save changes',exact:true}).click()
  const response=await patch;assert(response.ok(),await response.text())
  const unchanged=requireData(await owner.client.from('datasets').select('*').eq('id',row.id).single())
  assert.deepEqual(unchanged.payload,payload);assert.equal(unchanged.name,row.name);assert.equal(unchanged.description,row.description)
  await page.goto(base+`open-data/${type}/${row.id}/edit`)
  await page.getByRole('button',{name:'Save changes',exact:true}).waitFor()
  const input=page.locator('input:not([placeholder="Language code (fr, de…)"])').first()
  await input.fill('One field edited')
  const changed=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().includes('/rest/v1/datasets'))
  await page.getByRole('button',{name:'Save changes',exact:true}).click()
  const changedResponse=await changed;assert(changedResponse.ok(),await changedResponse.text())
  const after=requireData(await owner.client.from('datasets').select('*').eq('id',row.id).single())
  assert.deepEqual(after.payload.futureField,payload.futureField)
  for(const [key,value]of Object.entries(payload))if(Array.isArray(value)&&value[0]?.futureItemField)assert.deepEqual(after.payload[key][0].futureItemField,value[0].futureItemField)
  console.log(`${type}: actual no-op save identical; one-field edit retains unknown root/item fields.`)
 }
 const processRow=normalized.find(row=>row.type==='process')
 const processBefore=requireData(await owner.client.from('datasets').select('payload').eq('id',processRow.id).single()).payload
 await page.goto(base+`open-data/process/${processRow.id}/edit`)
 await page.getByRole('tab',{name:'Inputs and Outputs',exact:true}).click()
 await page.getByRole('button',{name:'Remove exchange',exact:true}).first().click()
 const deletionDialog=page.waitForEvent('dialog')
 const saveAttempt=page.getByRole('button',{name:'Save changes',exact:true}).click()
 const dialog=await deletionDialog;assert(dialog.message().includes('additional imported data'));await dialog.dismiss();await saveAttempt
 await page.getByText('Deletion cancelled. The original data has not been changed.',{exact:true}).waitFor()
 assert.deepEqual(requireData(await owner.client.from('datasets').select('payload').eq('id',processRow.id).single()).payload,processBefore)
 console.log('Deleting an exchange with hidden fields prompts; cancellation keeps the payload identical.')
 const flow=normalized.find(row=>row.type==='flow')
 await page.goto(base+`open-data/flow/${flow.id}/edit`)
 await page.getByRole('button',{name:'Save changes',exact:true}).waitFor()
 const latest={...requireData(await owner.client.from('datasets').select('payload').eq('id',flow.id).single()).payload,otherSessionEdit:'Retain newer write'}
 requireData(await owner.client.from('datasets').update({payload:latest}).eq('id',flow.id))
 await page.getByRole('button',{name:'Save changes',exact:true}).click()
 await page.getByText('This dataset changed or is no longer editable. Reload it before saving again.',{exact:true}).waitFor()
 assert.deepEqual(requireData(await owner.client.from('datasets').select('payload').eq('id',flow.id).single()).payload,latest)
 console.log('Stale edit rejected without overwriting the newer payload.')
 const countBefore=requireData(await owner.client.from('import_artifacts').select('id')).length
 await page.goto(base+'import')
 await page.locator('input[type=file]').setInputFiles(new URL('./fixtures/imports/tidas-missing-owner.zip',import.meta.url).pathname)
 await page.getByRole('button',{name:'Confirm import',exact:true}).waitFor()
 await page.getByRole('button',{name:'Confirm import',exact:true}).click()
 await page.getByText(/Cannot confirm:.*dataset references are missing/).waitFor()
 assert.equal(requireData(await owner.client.from('import_artifacts').select('id')).length,countBefore)
 console.log('Converted package with missing owner references rejected before uploading or persisting.')
 const recoveryFixture=fixtures.find(f=>f.format==='openlca-json-ld')
 await page.goto(base+'import')
 await page.locator('input[type=file]').setInputFiles(new URL('./fixtures/imports/'+recoveryFixture.file,import.meta.url).pathname)
 await page.getByRole('button',{name:'Confirm import',exact:true}).waitFor()
 const archiveCount=requireData(await owner.client.from('import_artifacts').select('id')).length
 const rowCount=requireData(await owner.client.from('datasets').select('id')).length
 // The RPC actually commits. Only its response is deliberately interrupted.
 await page.route('**/rest/v1/rpc/import_datasets',async route=>{
  const committed=await route.fetch();assert(committed.ok())
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SIMULATED_RESPONSE_LOSS',message:'Simulated interrupted response'})})
 })
 await page.getByRole('button',{name:'Confirm import',exact:true}).click()
 await page.getByText('Simulated interrupted response',{exact:true}).waitFor()
 const recoveryArtifact=requireData(await owner.client.from('import_artifacts').select('*').order('created_at',{ascending:false}).limit(1).single())
 paths.push(recoveryArtifact.storage_path)
 await page.unroute('**/rest/v1/rpc/import_datasets')
 await page.getByRole('button',{name:'Confirm import',exact:true}).click()
 await page.getByText(`Imported ${recoveryFixture.datasets} private datasets successfully.`,{exact:true}).waitFor()
 assert.equal(requireData(await owner.client.from('import_artifacts').select('id')).length,archiveCount+1)
 assert.equal(requireData(await owner.client.from('datasets').select('id')).length,rowCount+recoveryFixture.datasets)
 assert.equal(digest(Buffer.from(await requireData(await owner.client.storage.from('import-originals').download(recoveryArtifact.storage_path)).arrayBuffer())),recoveryFixture.sha256)
 console.log('Successful commit with interrupted response recovers through the UI; no duplicate rows, artifact unchanged.')
 assert.deepEqual(errors,[])
 await context.close()
 console.log('All five formats and all seven forms passed live browser acceptance.')
} finally {
 await browser.close()
 for(const user of users) {
  const userArtifacts=requireData(await admin.from('import_artifacts').select('storage_path').eq('created_by',user.id))
  requireData(await admin.from('datasets').delete().eq('created_by',user.id).eq('type','model'))
  requireData(await admin.from('datasets').delete().eq('created_by',user.id).eq('type','process'))
  requireData(await admin.from('datasets').delete().eq('created_by',user.id).eq('type','flow'))
  requireData(await admin.from('datasets').delete().eq('created_by',user.id).eq('type','flow_property'))
  requireData(await admin.from('datasets').delete().eq('created_by',user.id))
  requireData(await admin.from('import_batches').update({artifact_id:null}).eq('created_by',user.id))
  requireData(await admin.from('import_artifacts').delete().eq('created_by',user.id))
  requireData(await admin.from('import_batches').delete().eq('created_by',user.id))
  const ownedPaths=[...new Set([...paths.filter(p=>p.startsWith(user.id+'/')),...userArtifacts.map(a=>a.storage_path)])]
  if(ownedPaths.length)requireData(await admin.storage.from('import-originals').remove(ownedPaths))
  requireData(await admin.auth.admin.deleteUser(user.id))
 }
 console.log('Temporary live fixtures, private originals and accounts removed.')
}
