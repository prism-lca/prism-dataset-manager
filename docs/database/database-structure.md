# Current Database Structure and Design Rationale

PRISM Dataset Manager uses one shared dataset table and supporting tables for
relationships, import history, original files, and source tracking. This summary
reflects the repository migrations through October 11, 2026.

## Table Structure

| Table | Purpose | Fields |
| --- | --- | --- |
| `datasets` | Stores all seven dataset types | `id`, `type`, `name`, `description`, `payload`, `created_by`, `visibility`, `import_batch_id`, `source_id`, `source_version`, `schema_version`, `created_at`, `updated_at` |
| `dataset_references` | Stores references between datasets | `id`, `source_dataset_id`, `target_dataset_id`, `expected_target_type`, `reference_role`, `reference_path` |
| `import_batches` | Records each confirmed import and its result | `id`, `created_by`, `source_format`, `source_filename`, `summary`, `artifact_id`, `created_at` |
| `import_artifacts` | Records original upload metadata and storage location | `id`, `created_by`, `source_format`, `source_filename`, `media_type`, `byte_size`, `sha256`, `storage_bucket`, `storage_path`, `entry_inventory`, `created_at` |
| `dataset_source_records` | Links a dataset to its original artifact and source mapping information | `id`, `dataset_id`, `artifact_id`, `source_kind`, `locators`, `mapping_report`, `created_at` |
| `import_cleanup_claims` | Coordinates cleanup of unconfirmed uploads | `storage_path`, `claimed_at` |

Each dataset occupies one row in `datasets`. The `type` field identifies a
Model, Process, Flow, Flow Property, Unit Group, Source, or Contact. Its domain
content is stored in `payload` as a JSONB object. Shared information such as
identity, name, ownership, visibility, and timestamps is stored in ordinary
columns.

`source_id` and `source_version` retain source identifiers and explicitly
provided source versions. `schema_version` describes the application's payload
structure; it is separate from the source dataset's version.

Original uploaded bytes are stored in the private Supabase Storage bucket
`import-originals`. The database records the file's location, size, SHA-256 hash,
and package entry inventory. Supabase-managed authentication and storage tables
are separate from the application tables listed above.

## Why This Design

### 1. One catalog supports all dataset types

The seven types share identity, ownership, visibility, and import workflows.
Keeping them in one table gives the application a consistent way to list,
search, authorize, and import datasets. Filtering by `type` provides separate
category views.

A Process may reference many Flows, and a Flow may reference multiple Flow
Properties. Independent rows allow those datasets to be reused and edited
without duplicating their content inside each Process.

### 2. JSONB preserves nested domain content

LCA documents contain nested structures, repeatable items, multilingual text,
and format-specific fields. JSONB supports this structure while ordinary columns
keep frequently queried metadata easy to filter and index. The editing forms
patch retained payloads so untouched and unknown fields survive supported edits.

This requires deliberate validation: the current database checks basic payload
shape and internal references, while complete per-type ILCD validation remains
separate work.

### 3. A relationship table makes embedded links enforceable

References remain part of the authoritative JSON payload. Database functions
extract them into `dataset_references` and synchronize the rows on writes.
`reference_path` identifies the exact location of each link, including repeated
references to the same target.

This index supports dependency queries, target-type checks, access checks, and
protection against deleting a dataset that is still referenced. Imports validate
the complete graph within one transaction, allowing a Process to reference a
Flow inserted later in the same batch.

### 4. Import batches support traceability and safe retries

`import_batches` records the owner, input format, filename, and import result.
The import RPC saves related records atomically and supports retries using the
same batch ID. This prevents partial imports and duplicate records when a
successful response is interrupted.

### 5. Original files remain recoverable after conversion and editing

Conversion may normalize information or leave some source fields unmapped.
Keeping the exact original artifact preserves those bytes, including unsupported
package entries. Users can download the original independently of exporting
their current edited datasets.

The private Storage bucket holds file bytes; `import_artifacts` holds searchable
metadata and integrity information. Confirmed artifacts are immutable and
owner-scoped. An original remains private even when its normalized dataset is
public. Historical datasets do not automatically gain missing original files.

### 6. Source records provide a foundation for mapping coverage

`dataset_source_records` connects each tracked dataset to an artifact and has
fields for source locators, derivation status, and mapping reports. These can
eventually explain which source fields were mapped, derived, or left unmapped.

Current source records use `unassessed`: complete engine-provided locators and
field-level mapping coverage are still pending. Original-file preservation does
not establish lossless conversion or edit/export round trips for every format.

### 7. Cleanup handles abandoned uploads safely

An upload can reach Storage before the user confirms an import.
`import_cleanup_claims` coordinates cleanup with confirmation so an active
confirmation cannot lose its original file. Scheduled cleanup removes only
unconfirmed uploads older than 24 hours.

## Schema Sources

- [Base dataset schema](../../supabase/seed.sql)
- [Ownership and import batches](../../supabase/migrations/202609160001_multi_user_import.sql)
- [Dataset constraints and relationships](../../supabase/migrations/202610100001_dataset_references.sql)
- [Original artifacts and source records](../../supabase/migrations/202610110001_lossless_import.sql)
- [Scheduled original-file cleanup](../../supabase/migrations/202610110002_import_original_cleanup.sql)
- [Preservation roadmap and remaining acceptance](../plans/plan_09-16_lossless-import-ui.md)
