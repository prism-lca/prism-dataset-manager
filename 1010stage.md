# October 10 — Supabase implementation stages

Status: all four stages completed and deployed on 2026-10-11. Local PostgreSQL
15 acceptance, live PostgreSQL 17 migration, and deployed browser/REST checks
passed. Live app: https://prism-lca.github.io/prism-dataset-manager/.

## Implementation and rollout status

- Migration: `supabase/migrations/202610100001_dataset_references.sql`.
- Adds the relationship table, timestamps/schema version, source-ID/version
  fields, private trigger functions, read policies, and dependency lookup RPC.
- Ordinary writes synchronize relationships automatically. Imports preserve
  retry reports and validate the complete graph at transaction end.
- Known reference roles enforce expected types. Unknown extension references
  must supply a valid dataset type. Null references do not create edges.
- Source IDs are retained; source versions remain null unless the engine
  explicitly supplies them. Normalized document versions are not assumed to be
  original source versions.
- List pages use 50-row pages and omit payloads. Reference pickers fetch small
  projections; Process, Flow, and Flow Property details fetch only their
  reachable dependencies. Export reads now paginate to avoid server truncation.
- Local tests cover user isolation, public reads, forbidden graph links,
  wrong-type targets, edit synchronization, deletion protection, atomic import
  rollback, retry behavior, cyclic references, and dependency queries.
- TypeScript/build, lint, and all 10 frontend unit tests passed. The seed
  generator and checked-in seed now flush deferred graph checks before their
  final table alterations, so reseeding also works after this migration.
- Live read-only audit: 85 datasets, 145 internal references, zero issues.
  A catalog/import-batch snapshot was exported outside the repository with
  restricted permissions. The migration was exercised on a local copy of that
  snapshot and preserved every existing document, owner, and visibility.

The October migration has been applied once through the Management API after
the September migration. A full logical database archive and role definitions
(without role passwords) were saved outside the repository before migration:
`/workspaces/tiangong-simple-backups/20261011-pre-dataset-references/`.
The archive includes Auth data, decoded successfully, and has a checksum
manifest. Storage object files are not included in a database backup.
All 85 original datasets and the one import batch were preserved exactly.
Read-only verification confirmed 145 valid, payload-consistent reference rows
and correct permissions. Temporary backup login and smoke-test accounts/data
were removed. Do not rerun either migration on this deployed project. Never
put management tokens or service-role keys in frontend configuration.

Catalog writes currently use a transaction-level advisory lock to serialize
graph maintenance. This favors correctness for today's small catalog; evaluate
finer-grained locking if write throughput becomes a measured limitation.

Full per-type JSON Schema validation, a complete source-artifact archive, and
lossless form editing remain separate work. This implementation validates basic
dataset fields and internal links, without claiming complete ILCD conformance.

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

Acceptance on 2026-10-11: passed on a fresh local PostgreSQL 15 database.
`supabase/tests/dataset_main_table.sql` verifies defaults, automatic update
timestamps, preservation of nested payloads during metadata edits, rejection of
empty/null names, null/non-object payloads, invalid types/schema versions, and
changes to dataset identity or type. Migration rehearsal preserved all 77
checked-in seed rows, including payloads, owners, visibility, and existing
metadata. Existing reference integration checks also passed. This acceptance
uses the repository seed; it does not establish the current live database state
or complete per-type ILCD schema validation. Production rollout is recorded in
Stage 4 below.

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

Acceptance on 2026-10-11: passed on a fresh local PostgreSQL 15 database.
`supabase/tests/dataset_relationship_table.sql` verifies valid backfill
endpoints, the target lookup index, exact array/escaped JSON Pointer paths,
separate edges for repeated targets, null/free-text preservation, path
uniqueness, metadata-edit stability, payload-edit replacement, failed-edit
rollback, protected target deletion, source-delete cascading, and browser
write restrictions. The seed produced 137 reference rows for 77 datasets;
all acceptance fixtures were rolled back. Stage 1 and existing reference
integration checks also passed. Production rollout is recorded in Stage 4.

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

Acceptance on 2026-10-11: passed on a fresh local PostgreSQL 15 database.
Expanded `supabase/tests/dataset_references.sql` checks mixed valid/invalid
batch rollback, exact retry reports and row counts, hidden private documents
and import reports, zero-row cross-user edits/deletes, cross-user batch reuse
rejection, and immutable ownership/visibility for ordinary users. Existing
checks cover permitted/forbidden links, source-before-target imports, wrong
types, incoming-edge visibility changes, and cycles.
`supabase/tests/import_transactions.py` uses independent local connections to
verify rollback at actual COMMIT and two concurrent submissions yielding one
batch, two datasets, one edge, and an unchanged retry report. Fixtures were
removed; Stage 1 and Stage 2 checks also passed. These are local database
acceptance checks; production/browser acceptance is recorded in Stage 4.

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

Preparation on 2026-10-11: live read-only audit found 85 datasets and 145
references with no issues. A new restricted catalog/import-batch snapshot was
saved outside the repository. Rehearsal on that snapshot preserved all original
dataset columns and the one import batch, created 145 relationship rows, and
passed all three local acceptance suites plus real-commit/concurrent-retry
checks. This snapshot is not a full database backup.

Production acceptance on 2026-10-11: after refreshing the management token,
confirmed PostgreSQL 17.6, the September schema, and no available automatic
backup. Created/decoded a full logical database archive and saved role
definitions using a temporary CLI login, then removed that login. Applied
`supabase/migrations/202610100001_dataset_references.sql` once transactionally.
`supabase/tests/verify_dataset_references_rollout.sql` passed on production:
85 datasets, 145 references, one batch. Compared every original dataset field
and import batch before/after migration and after smoke cleanup: identical.

Built frontend browser acceptance against real Supabase passed signed-in
create/edit, pagination controls, import confirmation/provenance/reference
remapping, dependency RPC, deletion protection, two-user/anonymous isolation,
atomic rollback, and retry reports. Only the engine conversion response was
stubbed; auth and persistence were real. Test accounts, datasets, and batches
were removed.

Frontend release `728385b` deployed successfully through GitHub Pages run
`38099896624`. The deployed site passed the same signed-in browser/REST smoke
and anonymous list/Process/Flow/Flow Property detail checks. Lists omit payloads;
detail pages fetch only the root and paginated reachable dependencies. Tests
produced no browser page errors. Temporary production fixtures were removed,
and final integrity checks preserved the original 85 datasets/145 edges/one
batch. This completes the staged plan; full ILCD validation, source-artifact
archiving, and lossless editing remain separate work as noted above.

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
