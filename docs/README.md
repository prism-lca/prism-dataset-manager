# Documentation

## Plans

Plan filenames follow `plan_MM-DD_title.md`. The date is the original creation
date; updates stay in the same document. Use hyphens in dates because `/` is a
directory separator. The year is recorded in the document.

| Document | Purpose |
| --- | --- |
| [Project roadmap](plans/plan_09-07_project-roadmap.md) | Overall project plan and current sequencing |
| [Import feature](plans/plan_09-13_import-feature.md) | Initial browser import proposal |
| [Engine import/export](plans/plan_09-14_engine-import-export.md) | Conversion service proposal |
| [Multi-user import](plans/plan_09-16_multi-user-import.md) | Ownership, isolation, and atomic imports |
| [Lossless import UI](plans/plan_09-16_lossless-import-ui.md) | Original preservation, safe editing, and remaining mapping work |
| [Database implementation stages](plans/plan_10-10_database-implementation-stages.md) | Completed database relationship rollout |

## Database

- [Current structure and rationale](database/database-structure.md)
- [Schema design comparison](database/schema-options-comparison.md)

## History and Guides

- [Work log](history/worklog.md)
- [VS Code dev container installation](guides/vscode-dev-container-installation.md)

## Repository Layout

| Folder | Contents |
| --- | --- |
| `docs/plans/` | Project and feature plans |
| `docs/database/` | Database structure and design explanations |
| `docs/history/` | Implementation and release history |
| `docs/guides/` | Development setup guides |
| `src/` | Application code |
| `scripts/` | Export, audit, and maintenance scripts |
| `supabase/migrations/` | Database migrations |
| `supabase/tests/` | Database acceptance checks |
| `tests/fixtures/imports/` | Required automated import samples |
| `configs/` | Connector configuration |

The root README, license, agent instructions, and tool configuration files stay
at the repository root so existing tooling can find them.
