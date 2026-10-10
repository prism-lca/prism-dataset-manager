# October 10 — Supabase implementation stages

Status: proposed design; no database changes applied.

## Clarifying the main table

The recommendation is to store Processes, Flows, Flow Properties, Unit Groups,
Models, Sources, and Contacts as **rows**, not as seven columns.

`type` identifies what each row represents. `payload` contains that dataset's
ILCD document. Shared columns describe its identity, ownership, and visibility.

| id (illustrative) | type | name | payload |
|---|---|---|---|
| process-A | process | Cotton production | Process information and exchanges |
| flow-B | flow | Cotton fibre | Flow information and flow-property references |
| property-C | flow_property | Mass | Flow-property information and unit-group reference |
| unitgroup-D | unit_group | Units of mass | Units and their conversion factors |

Actual persisted IDs are UUIDs; the labels above are for explanation.

A table with columns named `process`, `flow`, and `property` would require
deciding what one row represents. If it represents a process, that process can
have many flows, and each flow can have multiple properties. Packing these into
single columns would require arrays or nested JSON, duplicate shared datasets,
or create many empty cells for standalone records. It would also complicate
independent editing, ownership, and linking of each dataset.

The intended structure is therefore one catalog table, with supporting tables
for relationships and imports. If the goal is to browse each category
separately in Supabase, filtered views can provide that presentation without
splitting the underlying storage. Views exposed through the API must preserve
the underlying row-level security.

## Stage 1 — Strengthen the existing main table

Keep `datasets` and its existing columns:

```text
id
type
name
description
payload
created_by
visibility
import_batch_id
created_at
```

Add `updated_at` and `schema_version`. The latter describes the JSON structure
the application understands, separately from a dataset's published version.

Keep nested ILCD fields in `payload`. Keep identity, ownership, visibility, and
regularly queried metadata in ordinary columns. Require non-empty names,
non-null object payloads, and an allowed dataset type. Validate against the
subset of ILCD supported by this application. Ordinary edits should not change
dataset identity or type.

## Stage 2 — Add the supporting relationship table

Create `dataset_references` with:

```text
id                    UUID primary key
source_dataset_id     UUID references datasets.id
target_dataset_id     UUID references datasets.id
expected_target_type  TEXT
reference_role        TEXT
reference_path        TEXT
```

Each row represents one internal link in a dataset's payload:

| source_dataset_id | target_dataset_id | expected_target_type | reference_path |
|---|---|---|---|
| process-A | flow-B | flow | Path to an exchange's flow reference |
| flow-B | property-C | flow_property | Path to a flow-property reference |
| property-C | unitgroup-D | unit_group | Path to the reference unit group |

Make `(source_dataset_id, reference_path)` unique. Index `target_dataset_id`.
Deleting a source should remove its outgoing edges; deleting a target should
be rejected while incoming references remain. Preserve null, free-text
references in the payload without creating edges.

The JSON payload remains authoritative. Reference rows are extracted and
maintained by the database, not edited independently by browser clients.

## Stage 3 — Maintain and validate references on every write

Forms currently write directly to `datasets`; imports use `import_datasets`.
Both paths must use the same database validation. Use database triggers backed
by shared functions to extract references and maintain their relational index.

For each write:

1. Validate the payload and extract non-null internal references.
2. Check every target exists and has the expected type.
3. Check ownership and visibility permit the relationship.
4. Replace the source's reference rows within the same transaction.

Allowed relationships:

- Public dataset to public dataset.
- Private dataset to public dataset.
- Private dataset to private dataset belonging to the same owner.

Validate incoming edges before changes to target type, ownership, or visibility.
Foreign keys establish existence; they do not establish permission to access a
target. Apply RLS and grants to the reference table so it cannot expose other
users' private dataset IDs.

For imports, all batch documents must exist before reference validation.
Design deferred validation so an early process row can reference a flow inserted
later in the same transaction. Any failure must roll back the complete import.
Preserve the existing batch-based retry behavior.

Keep `import_batches` for import provenance and reports. Retain incoming source
IDs and versions in explicit provenance fields; do not make source IDs globally
unique because different users may import copies of the same source.

## Stage 4 — Roll out and improve queries

1. Back up the deployed database and inspect its actual schema.
2. Audit existing payloads for missing, wrong-type, or inaccessible targets.
3. Add and populate the reference table; resolve reported conflicts before
   enforcing integrity checks.
4. Install write validation and update the import RPC together.
5. Verify ordinary edits, multi-user permissions, protected deletion, atomic
   import rollback, and retries. Check payload/reference consistency.
6. Change detail pages to fetch only their dependencies. Add pagination and
   lightweight projections to catalog lists and reference pickers.

The initial target is three application tables: `datasets`, `import_batches`,
and `dataset_references`. Supabase-managed `auth.users` remains separate.

Reconsider dedicated type tables when a concrete requirement needs different
type-specific permissions, workflows, relational calculations, or direct
compatibility with TianGong's database/API. Seven JSON document tables alone
would not enforce links embedded inside those documents.

## References

- [Existing design review](plan.md#2026-10-10--supabase-table-design-recommendation--proposed)
- [Supabase JSON guidance](https://supabase.com/docs/guides/database/json)
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
