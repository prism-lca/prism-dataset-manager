import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getDataset, type Dataset } from '@/lib/datasets'
import { useSessionStore } from '@/state/session'
import { getImportArtifact, loadOriginal, type ImportArtifact, type SourcePackage } from '@/lib/source-artifacts'
import { SourceDataViewer } from './source-data-viewer'
import { Button } from '@/components/ui/button'
import { JsonDataViewer } from './json-data-viewer'

export function DatasetSourceData() {
  const {id}=useParams<{id:string}>(),userId=useSessionStore(s=>s.session?.user.id)
  return <DatasetSourceContent key={`${id}:${userId}`} id={id} userId={userId} />
}
function DatasetSourceContent({id,userId}:{id?:string;userId?:string}) {
  const [record,setRecord]=useState<{id:string;userId?:string;dataset:Dataset|null;artifact:ImportArtifact|null}>()
  const [source,setSource]=useState<SourcePackage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  useEffect(()=>{
    let cancelled=false
    setSource(null);setError('')
    if(!id) return
    getDataset(id).then(async dataset=>{
      const artifact=dataset?.import_batch_id&&userId?await getImportArtifact(dataset.import_batch_id):null
      if(!cancelled)setRecord({id,userId,dataset:dataset??null,artifact})
    }).catch(()=>{if(!cancelled)setError('Could not load source metadata.')})
    return ()=>{cancelled=true}
  },[id,userId])
  const current=record?.id===id&&record?.userId===userId?record:undefined
  async function openSource(){
    if(!current?.artifact)return
    setLoading(true);setError('')
    try{setSource(await loadOriginal(current.artifact))}catch(e){setError(e instanceof Error?e.message:'Could not load original.')}finally{setLoading(false)}
  }
  if(!current?.dataset) return error?<p role="alert">{error}</p>:null
  return <details className="mx-auto mt-6 max-w-4xl rounded-lg border p-5">
    <summary className="cursor-pointer font-medium">Source data and additional fields</summary>
    <div className="mt-4 flex flex-col gap-4">
      {current.artifact ? <><p className="text-sm">{current.artifact.source_filename} · {current.artifact.source_format}</p><p className="text-sm text-muted-foreground">Mapping coverage has not been assessed for this package. Use the complete original to inspect fields outside the business views.</p><Button variant="outline" disabled={loading} onClick={openSource}>{loading?'Verifying original…':'View original source'}</Button></> : <p className="text-sm text-muted-foreground">No original file was archived for this record, or it is private to another account. Previously imported original files cannot be recovered from normalized data alone.</p>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      {source&&<SourceDataViewer key={source.sha256} source={source} />}
      <details><summary className="cursor-pointer text-sm font-medium">Complete current dataset</summary><p className="my-3 text-sm text-muted-foreground">Includes stored fields outside the business views. This is converted data, separate from the original file.</p><JsonDataViewer value={current.dataset.payload} /></details>
    </div>
  </details>
}
