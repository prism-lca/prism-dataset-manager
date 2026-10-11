#!/usr/bin/env node
// Read-only live catalog audit. --backup exports a private catalog snapshot to
// a new directory outside the repository; it is not a full Supabase backup.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const env = { ...process.env }
for (const filename of [".env", ".env.local"]) {
  if (!fs.existsSync(filename)) continue
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "")
  }
}
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for a complete catalog audit.")
}
const types = new Set(["model", "process", "flow", "flow_property", "unit_group", "source", "contact"])
const roles = {
  referenceToFlowDataSet: "flow", referenceToFlowPropertyDataSet: "flow_property",
  referenceToReferenceUnitGroup: "unit_group", referenceToProcess: "process",
  referenceToDataSource: "source", referenceToContact: "contact",
  referenceToCommissioner: "contact", referenceToPersonOrEntityGeneratingTheDataSet: "contact",
  referenceToOwnershipOfDataSet: "contact",
}
async function fetchTable(table) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=*&order=id&offset=${offset}&limit=500`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    })
    if (!response.ok) throw new Error(`Could not read ${table}: HTTP ${response.status}`)
    const batch = await response.json()
    rows.push(...batch)
    if (batch.length < 500) return rows
  }
}
const datasets = await fetchTable("datasets")
const byId = new Map(datasets.map((row) => [row.id, row]))
const issues = []
let references = 0
function walk(value, source, pointer = "", role = "reference") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, source, `${pointer}/${index}`, role))
    return
  }
  if (!value || typeof value !== "object") return
  if (value.refObjectId != null) {
    references++
    const id = value.refObjectId
    const expected = roles[role] ?? value.type
    const target = typeof id === "string" ? byId.get(id.toLowerCase()) : undefined
    const reason = typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      ? "invalid reference ID"
      : !types.has(expected) || (Object.hasOwn(value, "type") && value.type !== expected)
        ? "invalid expected type"
        : !target ? "missing target" : target.type !== expected ? "wrong target type"
          : target.visibility !== "public" && (source.visibility === "public" || source.created_by !== target.created_by)
            ? "inaccessible target" : null
    if (reason) issues.push({ source_id: source.id, path: `${pointer}/refObjectId`, reason })
  }
  for (const [key, child] of Object.entries(value)) {
    const token = key.replaceAll("~", "~0").replaceAll("/", "~1")
    walk(child, source, `${pointer}/${token}`, key)
  }
}
for (const row of datasets) {
  if (!row.name?.trim() || row.name.length > 1000 || !types.has(row.type) || !row.payload
      || typeof row.payload !== "object" || Array.isArray(row.payload)) {
    issues.push({ source_id: row.id, reason: "invalid dataset metadata or payload" })
  }
  walk(row.payload, row)
}
console.log(JSON.stringify({ dataset_count: datasets.length, reference_count: references, issues }, null, 2))
if (process.argv.includes("--backup")) {
  const import_batches = await fetchTable("import_batches")
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prism-catalog-backup-"))
  const filename = path.join(directory, "catalog.json")
  fs.writeFileSync(filename, JSON.stringify({ exported_at: new Date().toISOString(), datasets, import_batches }), { mode: 0o600 })
  console.log(`Catalog snapshot saved to ${filename}`)
}
if (issues.length) process.exitCode = 1
