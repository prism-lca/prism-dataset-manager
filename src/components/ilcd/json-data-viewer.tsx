import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { downloadFile } from '@/lib/source-artifacts'
export function JsonDataViewer({value}:{value:unknown}) {
  const [search,setSearch]=useState(''),[page,setPage]=useState(0)
  const text=JSON.stringify(value,null,2),size=30000,total=Math.max(1,Math.ceil(text.length/size)),current=Math.min(page,total-1)
  return <div className="flex flex-col gap-3">
    <div className="flex gap-2"><Input aria-label="Search dataset content" placeholder="Search content" value={search} onChange={e=>setSearch(e.target.value)} /><Button variant="outline" onClick={()=>{let index=text.toLowerCase().indexOf(search.toLowerCase(),(current+1)*size);if(index<0)index=text.toLowerCase().indexOf(search.toLowerCase());setPage(Math.max(0,Math.floor(index/size)))}}>Find next</Button></div>
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-4 text-xs">{text.slice(current*size,(current+1)*size)}</pre>
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={current===0} onClick={()=>setPage(current-1)}>Previous section</Button><span className="text-sm">Section {current+1} / {total}</span><Button size="sm" variant="outline" disabled={current===total-1} onClick={()=>setPage(current+1)}>Next section</Button><Button size="sm" variant="outline" onClick={()=>downloadFile(new Blob([text],{type:'application/json'}),'converted-dataset.json')}>Download current JSON</Button></div>
  </div>
}
