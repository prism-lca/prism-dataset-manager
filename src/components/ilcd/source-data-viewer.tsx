import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { downloadFile, type SourcePackage } from '@/lib/source-artifacts'

function scalarRows(value: unknown, path='', out: {path:string;value:string}[]=[]): {path:string;value:string}[] {
  if(out.length>=100000) return out
  if(value && typeof value==='object') {
    for(const [key,child] of Object.entries(value)) scalarRows(child,`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,out)
  } else out.push({path:path || '/',value:String(value)})
  return out
}
function parseText(text: string, media: string) {
  if(media==='application/json') return JSON.parse(text)
  if(media==='application/xml') {
    const doc=new DOMParser().parseFromString(text,'application/xml')
    if(doc.querySelector('parsererror')) throw new Error('XML parse error')
    const rows:Record<string,string>={}
    function walk(el:Element,path:string) {
      for(const attr of el.attributes) rows[`${path}/@${attr.name}`]=attr.value
      if(!el.children.length) rows[path]=el.textContent ?? ''
      const counts:Record<string,number>={}
      for(const child of el.children) { counts[child.tagName]=(counts[child.tagName]??0)+1;walk(child,`${path}/${child.tagName}[${counts[child.tagName]}]`) }
    }
    walk(doc.documentElement,`/${doc.documentElement.tagName}`);return rows
  }
  // Source lines retain CSV headers, comments and all sections, including those
  // the converter does not interpret. Raw mode keeps exact quoting/newlines.
  return Object.fromEntries(text.split(/\r?\n/).map((line,i)=>[`line ${i+1}`,line]))
}
export function SourceDataViewer({source}:{source:SourcePackage}) {
  const [path,setPath]=useState(source.entries[0]?.path ?? '')
  const [showUnknownText,setShowUnknownText]=useState(false)
  const [encoding,setEncoding]=useState('utf-8')
  const [mode,setMode]=useState<'raw'|'structured'>('raw')
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[fileSearch,setFileSearch]=useState('')
  const entry=source.entries.find(e=>e.path===path)
  const bytes=source.contents.get(path)
  const text=useMemo(()=>bytes ? new TextDecoder(encoding,{fatal:false}).decode(bytes) : '',[bytes,encoding])
  const structured=useMemo(()=>{
    if(mode!=='structured' || !entry) return []
    try{return scalarRows(parseText(text,entry.media_type))}catch{return [{path:'Parse unavailable',value:'Use Raw to view the complete source.'}]}
  },[text,entry,mode])
  const filtered=structured.filter(row=>`${row.path} ${row.value}`.toLowerCase().includes(search.toLowerCase()))
  const chunkSize=30000,total=mode==='raw'?Math.max(1,Math.ceil(text.length/chunkSize)):Math.max(1,Math.ceil(filtered.length/100))
  const currentPage=Math.min(page,total-1)
  function findText(){ const index=text.toLowerCase().indexOf(search.toLowerCase(),(currentPage+1)*chunkSize);setPage(index<0?Math.max(0,Math.floor(text.toLowerCase().indexOf(search.toLowerCase())/chunkSize)):Math.floor(index/chunkSize)) }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={()=>downloadFile(source.file,source.file.name)}>Download original</Button>
      <span className="text-sm break-all">{source.file.name} · {source.file.size.toLocaleString()} bytes</span>
    </div>
    <p className="text-sm text-muted-foreground">The original file includes all uploaded content. Business views show only supported fields; an empty field does not establish that it was absent from the source.</p>
    <div className="grid gap-4 md:grid-cols-[minmax(180px,1fr)_3fr]">
      <div className="flex flex-col gap-2">
        <Input aria-label="Search source files" placeholder="Search files" value={fileSearch} onChange={e=>setFileSearch(e.target.value)} />
        <div className="max-h-96 overflow-auto rounded border p-2">
          {source.entries.filter(e=>e.path.toLowerCase().includes(fileSearch.toLowerCase())).map(e=><button key={e.path} type="button" className={`block w-full break-all rounded p-2 text-left text-sm ${path===e.path?'bg-muted':''}`} onClick={()=>{setPath(e.path);setPage(0);setSearch('');setShowUnknownText(false)}}>{e.path}<span className="block text-xs text-muted-foreground">{e.byte_size.toLocaleString()} bytes</span></button>)}
        </div>
      </div>
      <div className="min-w-0 flex flex-col gap-3">
        {entry && <>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Source text encoding" className="rounded border px-2 text-sm" value={encoding} onChange={e=>{setEncoding(e.target.value);setPage(0)}}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select>
            <Button size="sm" variant={mode==='raw'?'default':'outline'} onClick={()=>{setMode('raw');setPage(0)}}>Raw</Button>
            <Button size="sm" variant={mode==='structured'?'default':'outline'} onClick={()=>{setMode('structured');setPage(0)}}>Structured</Button>
            <Button size="sm" variant="outline" onClick={()=>bytes && downloadFile(new Blob([new Uint8Array(bytes).buffer]),entry.path.split('/').pop() ?? 'source')}>Download entry</Button>
          </div>
          <div className="flex gap-2"><Input aria-label="Search source content" placeholder="Search source paths or text" value={search} onChange={e=>{setSearch(e.target.value);if(mode==='structured')setPage(0)}} />{mode==='raw'&&<Button variant="outline" onClick={findText}>Find next</Button>}</div>
          {entry.media_type==='application/octet-stream' && !showUnknownText ? <div><p>This entry is binary or has an unrecognized format. Download it to inspect the complete bytes, or try a text view.</p><Button size="sm" variant="outline" onClick={()=>setShowUnknownText(true)}>View as text</Button></div> : mode==='raw' ? <pre className="max-h-[36rem] overflow-auto rounded border bg-muted/30 p-4 whitespace-pre-wrap break-words text-xs">{text.slice(currentPage*chunkSize,(currentPage+1)*chunkSize)}</pre> : <div className="max-h-[36rem] overflow-auto rounded border p-3">{filtered.slice(currentPage*100,(currentPage+1)*100).map((row,i)=><div key={i} className="mb-3"><code className="break-all text-xs text-muted-foreground">{row.path}</code><p className="whitespace-pre-wrap break-words text-sm">{row.value}</p></div>)}</div>}
          {structured.length>=100000&&<p className="text-sm">Structured view has reached its display limit. Raw and downloads contain the complete source.</p>}
          <div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous section</Button><span className="text-sm">Section {currentPage+1} / {total}</span><Button size="sm" variant="outline" disabled={currentPage>=total-1} onClick={()=>setPage(currentPage+1)}>Next section</Button></div>
        </>}
      </div>
    </div>
  </div>
}
