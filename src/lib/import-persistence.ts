import type { DatasetType } from "@/lib/datasets"
import type { ImportedRow, ImportResult } from "@/lib/openlca-import"
import { supabase } from "@/lib/supabase"
import { importReferences, missingImportReferences } from './import-reference-check'
import { uploadSource, removeUnconfirmedSource, type SourcePackage } from './source-artifacts'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface PreparedImportRow {
  id: string
  type: DatasetType
  name: string
  description: string | null
  payload: Record<string, unknown>
  source_id: string
  source_version: string | null
}

export interface ImportedDatasetSummary {
  id: string
  type: DatasetType
  name: string
}

export interface ImportCommitReport {
  batch_id: string
  created_count: number
  summary: Partial<Record<DatasetType, number>>
  datasets: ImportedDatasetSummary[]
  artifact_id?: string
  idempotent?: boolean
}

function addAlias(aliases: Map<string, string>, alias: string, id: string) {
  if (!alias) return
  const existing = aliases.get(alias)
  if (existing && existing !== id) {
    throw new Error(`The import contains a duplicate source identifier: ${alias}`)
  }
  aliases.set(alias, id)
}

function rewriteReferences(value: unknown, aliases: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteReferences(item, aliases))
  }
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "refObjectId" && typeof child === "string") {
        return [key, aliases.get(child) ?? child]
      }
      return [key, rewriteReferences(child, aliases)]
    }),
  )
}

function validateRows(rows: ImportedRow[]) {
  if (rows.length === 0) throw new Error("The preview doesn't contain any datasets to import.")

  const temporaryIds = new Set<string>()
  const sourceIds = new Set<string>()
  for (const row of rows) {
    if (!row.temporary_id || !row.source_id || !row.id) {
      throw new Error("The engine response is missing an import identifier.")
    }
    if (temporaryIds.has(row.temporary_id)) {
      throw new Error(`The import contains a duplicate temporary ID: ${row.temporary_id}`)
    }
    if (sourceIds.has(row.source_id)) {
      throw new Error(`The import contains a duplicate source ID: ${row.source_id}`)
    }
    temporaryIds.add(row.temporary_id)
    sourceIds.add(row.source_id)
  }
}

export function prepareImportRows(
  rows: ImportedRow[],
  createUuid: () => string = () => crypto.randomUUID(),
): PreparedImportRow[] {
  validateRows(rows)

  const aliases = new Map<string, string>()
  const ids = rows.map((row) => {
    const id = createUuid()
    if (!UUID_PATTERN.test(id)) throw new Error("Failed to allocate a valid dataset UUID.")
    addAlias(aliases, row.temporary_id, id)
    addAlias(aliases, row.source_id, id)
    addAlias(aliases, row.id, id)
    return id
  })

  if (new Set(ids).size !== ids.length) {
    throw new Error("Failed to allocate unique dataset UUIDs.")
  }

  return rows.map((row, index) => ({
    id: ids[index],
    type: row.type,
    name: row.name,
    description: row.description || null,
    payload: rewriteReferences(row.payload, aliases) as Record<string, unknown>,
    source_id: row.source_id,
    source_version: row.source_version ?? null,
  }))
}

export async function commitImport(
  result: ImportResult,
  sourceFilename: string,
  batchId: string,
  source: SourcePackage,
): Promise<ImportCommitReport> {
  if (!supabase) {
    throw new Error("Supabase is not configured, so this preview can't be imported.")
  }
  if (!result.valid || result.errors.length > 0) {
    throw new Error("Resolve the preview errors before importing this package.")
  }

  const rows = prepareImportRows(result.datasets)
  const refs = importReferences(rows)
  const known = new Map(rows.map(row=>[row.id.toLowerCase(),row.type]))
  const external = [...new Set(refs.filter(ref=>!known.has(ref.id)).map(ref=>ref.id))]
  for(let offset=0;offset<external.length;offset+=100) {
    const {data,error}=await supabase.from('datasets').select('id,type').in('id',external.slice(offset,offset+100))
    if(error)throw error
    for(const row of data)known.set(row.id,row.type as DatasetType)
  }
  const missing=missingImportReferences(refs,known)
  if(missing.length)throw new Error(`Cannot confirm: ${missing.length} dataset references are missing, inaccessible, or have the wrong type. ${missing.slice(0,10).map(ref=>`${ref.dataset}: ${ref.path} → ${ref.type} ${ref.id}`).join('; ')}. Include the referenced datasets in the package or resolve them first. The original has not been uploaded.`)
  const artifact = await uploadSource(source, batchId)
  artifact.source_format = result.format
  const { data, error } = await supabase.rpc("import_datasets", {
    p_batch_id: batchId,
    p_source_format: result.format,
    p_source_filename: sourceFilename,
    p_rows: rows,
    p_artifact: artifact,
    p_sources: rows.map((row) => ({
      dataset_id: row.id,
      source_kind: 'unassessed',
      locators: [],
      mapping_report: { status: 'unassessed', source_id: row.source_id,
        message: 'Complete original retained. Field mapping coverage is not provided by the conversion engine.' },
    })),
  })
  if (error) {
    await removeUnconfirmedSource(artifact.storage_path).catch(()=>{})
    throw new Error(error.message)
  }
  return data as ImportCommitReport
}
