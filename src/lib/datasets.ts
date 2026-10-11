import { supabase } from "@/lib/supabase"

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    )
  }
  return supabase
}

export type DatasetType =
  | "model"
  | "process"
  | "flow"
  | "flow_property"
  | "unit_group"
  | "source"
  | "contact"

export interface Dataset {
  id: string
  type: DatasetType
  name: string
  description: string | null
  payload: Record<string, unknown>
  created_by: string | null
  visibility: "public" | "private"
  import_batch_id: string | null
  created_at: string
  updated_at: string
  schema_version: number
  source_id: string | null
  source_version: string | null
}

export type DatasetSummary = Pick<Dataset,
  "id" | "type" | "name" | "description" | "created_by" | "visibility" | "created_at">

const SUMMARY_COLUMNS = "id,type,name,description,created_by,visibility,created_at"

export async function listDatasetSummaries(
  type: DatasetType, page = 0, pageSize = 50, lookahead = false,
): Promise<DatasetSummary[]> {
  const { data, error } = await requireSupabase().from("datasets")
    .select(SUMMARY_COLUMNS).eq("type", type)
    .order("created_at", { ascending: false }).order("id")
    .range(page * pageSize, (page + 1) * pageSize - 1 + Number(lookahead))
  if (error) throw error
  return data as DatasetSummary[]
}

export async function listDatasetOptions(type: DatasetType): Promise<DatasetSummary[]> {
  const rows: DatasetSummary[] = []
  for (let page = 0; ; page++) {
    const batch = await listDatasetSummaries(type, page, 500)
    rows.push(...batch)
    if (batch.length < 500) return rows
  }
}

export async function getDatasetDependencies(id: string): Promise<Dataset[]> {
  const rows: Dataset[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase()
      .rpc("dataset_dependencies", { p_dataset_id: id })
      .order("id").range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...data as Dataset[])
    if (data.length < pageSize) return rows
  }
}

export interface DatasetTypeInfo {
  type: DatasetType
  label: string
  singular: string
}

export const DATASET_TYPES: DatasetTypeInfo[] = [
  { type: "model", label: "Models", singular: "Model" },
  { type: "process", label: "Processes", singular: "Process" },
  { type: "flow", label: "Flows", singular: "Flow" },
  { type: "flow_property", label: "Flow Properties", singular: "Flow Property" },
  { type: "unit_group", label: "Unit Groups", singular: "Unit Group" },
  { type: "source", label: "Sources", singular: "Source" },
  { type: "contact", label: "Contacts", singular: "Contact" },
]

export function getDatasetTypeInfo(type: string): DatasetTypeInfo | undefined {
  return DATASET_TYPES.find((t) => t.type === type)
}

export async function listDatasets(type: DatasetType): Promise<Dataset[]> {
  const rows: Dataset[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await requireSupabase().from("datasets")
      .select("*").eq("type", type)
      .order("created_at", { ascending: false }).order("id")
      .range(offset, offset + 499)
    if (error) throw error
    rows.push(...data as Dataset[])
    if (data.length < 500) return rows
  }
}

export async function getDataset(id: string): Promise<Dataset | undefined> {
  const { data, error } = await requireSupabase()
    .from("datasets")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return data ?? undefined
}

export interface NewDataset {
  type: DatasetType
  name: string
  description: string | null
  payload: Record<string, unknown>
}

export async function createDataset(input: NewDataset): Promise<Dataset> {
  if (!supabase) {
    throw new Error("Supabase is not configured, so datasets can't be added.")
  }
  const { data, error } = await supabase
    .from("datasets")
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as Dataset
}

export async function updateDataset(id: string, input: NewDataset, expectedUpdatedAt?: string): Promise<Dataset> {
  if (!supabase) {
    throw new Error("Supabase is not configured, so datasets can't be edited.")
  }
  let query = supabase
    .from("datasets")
    .update(input)
    .eq("id", id)
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt)
  const { data, error } = await query
    .select()
    .single()
  if (error?.code === "PGRST116") throw new Error("This dataset changed or is no longer editable. Reload it before saving again.")
  if (error) throw error
  return data as Dataset
}

export async function deleteDataset(id: string): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase is not configured, so datasets can't be deleted.")
  }
  const { error } = await supabase.from("datasets").delete().eq("id", id)
  if (error?.code === "23503") {
    throw new Error("This dataset is still referenced by another dataset. Remove those references before deleting it.")
  }
  if (error) throw error
}
