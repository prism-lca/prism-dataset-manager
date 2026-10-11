import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { inspectSourceFile, sha256, MAX_UPLOAD_BYTES, loadOriginal, type ImportArtifact, uploadSource } from './source-artifacts'
import manifest from '../../tests/fixtures/imports/manifest.json'

const { download,lookup,getUser,upload }=vi.hoisted(()=>({download:vi.fn(),lookup:vi.fn(),getUser:vi.fn(),upload:vi.fn()}))
vi.mock('./supabase',()=>({supabase:{auth:{getUser},from:()=>({select:()=>({eq:()=>({maybeSingle:lookup})})}),storage:{from:()=>({download,upload})}}}))

describe('original source preservation', () => {
  for (const fixture of manifest) it(`inventories exact ${fixture.format} bytes`, async () => {
    const bytes=readFileSync(new URL(`../../tests/fixtures/imports/${fixture.file}`,import.meta.url))
    const source=await inspectSourceFile(new File([bytes],fixture.file))
    expect(source.sha256).toBe(fixture.sha256)
    expect(source.file.size).toBe(fixture.bytes)
    for(const entry of source.entries) {
      const content=source.contents.get(entry.path)!
      expect(await sha256(content)).toBe(entry.sha256)
      expect(content.length).toBe(entry.byte_size)
    }
    if(fixture.file.endsWith('.zip')) {
      expect(source.entries.map(e=>e.path)).toContain('unsupported/custom.json')
      expect(source.entries.map(e=>e.path)).toContain('unsupported/binary.bin')
      expect(new TextDecoder().decode(source.contents.get('unsupported/source-notes.txt'))).toContain('Français seulement')
    } else expect(source.contents.get(fixture.file)).toEqual(new Uint8Array(bytes))
  })
  it('loads metadata round-tripped through jsonb regardless of object key order',async()=>{
    const bytes=readFileSync(new URL('../../tests/fixtures/imports/openlca-json-ld.zip',import.meta.url))
    const source=await inspectSourceFile(new File([bytes],'fixture.zip'))
    const entries=source.entries.map(e=>({sha256:e.sha256,media_type:e.media_type,byte_size:e.byte_size,path:e.path}))
    const artifact={source_filename:'fixture.zip',media_type:'application/zip',byte_size:source.file.size,sha256:source.sha256,entry_inventory:entries,storage_bucket:'import-originals',storage_path:'test'} as ImportArtifact
    download.mockResolvedValue({data:new Blob([bytes]),error:null})
    expect((await loadOriginal(artifact)).sha256).toBe(source.sha256)
    await expect(loadOriginal({...artifact,entry_inventory:[]})).rejects.toThrow('inventory')
    await expect(loadOriginal({...artifact,sha256:'0'.repeat(64)})).rejects.toThrow('checksum')
  })
  it('reuses a verified confirmed original after an interrupted RPC response',async()=>{
    const file=new File(['Original bytes'],'original.csv'),source=await inspectSourceFile(file)
    const artifact={id:'10000000-0000-4000-8000-000000000001',created_by:'owner',source_format:'simapro-csv',source_filename:file.name,media_type:'text/csv',byte_size:file.size,sha256:source.sha256,entry_inventory:source.entries,storage_bucket:'import-originals',storage_path:'owner/batch/original'} as ImportArtifact
    getUser.mockResolvedValue({data:{user:{id:'owner'}},error:null})
    lookup.mockResolvedValue({data:artifact,error:null})
    download.mockResolvedValue({data:new Blob(['Original bytes']),error:null})
    expect(await uploadSource(source,artifact.id)).toEqual(artifact)
    expect(upload).not.toHaveBeenCalled()
    await expect(uploadSource({...source,sha256:'b'.repeat(64)},artifact.id)).rejects.toThrow('differs')
  })
  it('rejects traversal paths and empty uploads',async()=>{
    await expect(inspectSourceFile(new File([zipSync({'../escape.json':strToU8('{}')})],'bad.zip'))).rejects.toThrow('unsafe')
    await expect(inspectSourceFile(new File([],'empty.csv'))).rejects.toThrow('non-empty')
  })
  it('refuses an upload over the explicit size limit',async()=>{
    await expect(inspectSourceFile(new File([new Uint8Array(MAX_UPLOAD_BYTES+1)],'large.csv'))).rejects.toThrow('25 MB')
  })
})
