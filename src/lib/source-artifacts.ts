import { unzipSync } from 'fflate'
import { supabase } from './supabase'
import { sameJson } from './lossless-edits'

export const ARTIFACT_BUCKET = 'import-originals'
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export interface SourceEntry { path: string; byte_size: number; sha256: string; media_type: string }
export interface SourcePackage { file: File; sha256: string; entries: SourceEntry[]; contents: Map<string, Uint8Array> }
export interface ImportArtifact {
  id: string; created_by: string; source_format: string; source_filename: string; media_type: string
  byte_size: number; sha256: string; storage_bucket: string; storage_path: string; entry_inventory: SourceEntry[]
}
export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const input = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input))).map(v => v.toString(16).padStart(2,'0')).join('')
}
function mediaType(path: string) {
  const ext = path.toLowerCase().split('.').pop()
  return ext === 'json' ? 'application/json' : ['xml','spold'].includes(ext ?? '') ? 'application/xml' : ext === 'csv' ? 'text/csv' : ext === 'txt' ? 'text/plain' : 'application/octet-stream'
}
export async function inspectSourceFile(file: File): Promise<SourcePackage> {
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error('Choose a non-empty file of at most 25 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contents = new Map<string, Uint8Array>()
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let count=0, expanded=0
    const seen=new Set<string>()
    const unzipped = unzipSync(bytes, { filter: entry => {
      if (++count>5000 || (expanded+=entry.originalSize)>250*1024*1024) throw new Error('The archive is too large to inspect.')
      if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..') || seen.has(entry.name)) throw new Error('The archive contains an unsafe or duplicate entry path.')
      seen.add(entry.name)
      return true
    } })
    for (const [path, data] of Object.entries(unzipped)) contents.set(path,data)
  } else contents.set(file.name,bytes)
  const entries: SourceEntry[] = []
  for (const [path,data] of contents) entries.push({path,byte_size:data.length,sha256:await sha256(data),media_type:mediaType(path)})
  return {file,sha256:await sha256(bytes),entries,contents}
}
export async function uploadSource(pkg: SourcePackage, batchId: string): Promise<ImportArtifact> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const {data:{user},error:authError}=await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in before importing.')
  const confirmed=await getImportArtifact(batchId)
  if(confirmed) {
    if(confirmed.sha256!==pkg.sha256)throw new Error('Retry original differs from the confirmed file.')
    await loadOriginal(confirmed)
    return confirmed
  }
  const path=`${user.id}/${batchId}/original`
  // Retry an ambiguous prior upload without ever overwriting original bytes.
  const upload=await supabase.storage.from(ARTIFACT_BUCKET).upload(path,pkg.file,{upsert:false,contentType:pkg.file.type || 'application/octet-stream'})
  if (upload.error && !['Duplicate','409','400'].includes(upload.error.name) && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error
  try {
    const download=await supabase.storage.from(ARTIFACT_BUCKET).download(path)
    if (download.error) throw download.error
    if (download.data.size!==pkg.file.size || await sha256(await download.data.arrayBuffer())!==pkg.sha256) throw new Error('Original file verification failed. The import was not confirmed.')
  } catch(error) {
    await removeUnconfirmedSource(path).catch(()=>{})
    throw error
  }
  return {id:batchId,created_by:user.id,source_format:'',source_filename:pkg.file.name,media_type:pkg.file.type || 'application/octet-stream',byte_size:pkg.file.size,sha256:pkg.sha256,storage_bucket:ARTIFACT_BUCKET,storage_path:path,entry_inventory:pkg.entries}
}
export async function removeUnconfirmedSource(path: string) {
  // Storage policy forbids deleting confirmed artifacts, even on an ambiguous RPC failure.
  if (supabase) await supabase.storage.from(ARTIFACT_BUCKET).remove([path])
}
export async function getImportArtifact(batchId: string): Promise<ImportArtifact | null> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const {data,error}=await supabase.from('import_artifacts').select('*').eq('id',batchId).maybeSingle()
  if (error) throw error
  return data
}
export async function loadOriginal(artifact: ImportArtifact): Promise<SourcePackage> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const {data,error}=await supabase.storage.from(artifact.storage_bucket).download(artifact.storage_path)
  if (error) throw error
  const pkg=await inspectSourceFile(new File([data],artifact.source_filename,{type:artifact.media_type}))
  if (pkg.sha256!==artifact.sha256 || pkg.file.size!==artifact.byte_size) throw new Error('The original file does not match its stored checksum.')
  if (!sameJson(pkg.entries,artifact.entry_inventory)) throw new Error('The archive inventory does not match the saved original.')
  return pkg
}
export function downloadFile(file: Blob, filename: string) {
  const url=URL.createObjectURL(file),link=document.createElement('a')
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
