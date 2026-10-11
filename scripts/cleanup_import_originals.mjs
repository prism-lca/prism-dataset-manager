// Server-only. Never include the service role key in Vite or browser code.
import { createClient } from '@supabase/supabase-js'
const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key) throw new Error('Server Supabase URL and service role key are required.')
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
let removed=0
for(let page=0;page<20;page++) {
  const {data,error}=await client.rpc('claim_import_orphans')
  if(error)throw new Error(error.message)
  if(!data.length)break
  const result=await client.storage.from('import-originals').remove(data.map(row=>row.storage_path))
  if(result.error)throw new Error(result.error.message)
  removed+=result.data.length
  if(data.length<100)break
}
console.log(`Removed ${removed} interrupted original uploads older than 24 hours.`)
