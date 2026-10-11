# AI Agentic Tools Template

A minimal starting point for working with AI coding assistants in a dev container. The container image comes pre-loaded with all tools — this repo only needs the config files to get everything running.

This repo also houses **PRISM LCA**, a minimal clone of [tiangong-lca-next](https://github.com/linancn/tiangong-lca-next)'s sidebar/data-browsing shell (see `docs/plans/plan_09-07_project-roadmap.md` for the full design). See below for how to run and deploy it. Browse the [documentation index](docs/README.md) for plans, database explanations, history, and setup guides.

---

## PRISM LCA

A React + Vite + Supabase app with a collapsible sidebar over 7 "Open Data" types (Models, Processes, Flows, Flow Properties, Unit Groups, Sources, Contacts), backed by one generic `datasets` table.

### Running locally

```
npm install
npm run dev
```

Supabase must be configured (below) before the app will load any data — without it, dataset pages show a "Supabase is not configured" error.

### Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the Supabase SQL editor, run `supabase/seed.sql` to create the tables,
   owner-scoped RLS policies, and 77-row public MCP-backed snapshot. Then run
   `supabase/migrations/202609160001_multi_user_import.sql` to install the
   idempotent atomic-import RPC (the migration is also safe to apply to an
   existing deployment).
   Finally run `supabase/migrations/202610100001_dataset_references.sql` to
   backfill and enforce dataset relationships and install dependency lookup.
   Apply this migration before deploying the frontend changes that use it.
   For an existing project, run only the new migration, once; do not re-run
   the older import migration afterward because it replaces the import RPC.
3. Copy `.env.example` to `.env` and fill in your project's URL and anon key (Project Settings → API):
   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```
4. Restart `npm run dev` — the app now reads/writes through Supabase, and magic-link sign-in (sidebar footer) becomes usable.

After intentional changes to the live dataset, refresh the checked-in snapshot with:

```
python3 scripts/export_seed.py
```

The exporter reads the public dataset fields using the Supabase URL and anon key from `.env`. Review and commit the resulting `supabase/seed.sql`.

### Original file preservation

Apply migrations in filename order. Existing deployed projects additionally need
`202610110001_lossless_import.sql` and, on hosted Supabase,
`202610110002_import_original_cleanup.sql`. The latter enables `http` and
`pg_cron`; configure these two private Vault secrets before its daily 03:23 UTC
job runs:

- `prism_import_cleanup_url`: project Supabase URL.
- `prism_import_cleanup_key`: backend service-role key. Keep it out of browser
  environment variables, repository files and logs.

Create/update them through Supabase Vault with administrator access. The live
project's secrets and daily job were configured during this rollout. Cleanup
uses the Storage API rather than deleting `storage.objects` rows; confirmed
artifacts are excluded. An optional server-only manual cleanup is available:

```
SUPABASE_URL=<project-url> node scripts/cleanup_import_originals.mjs
```

Supply `SUPABASE_SERVICE_ROLE_KEY` through your backend environment. The manual
script claims expired uploads before removal, serializing against confirmation.

New imports archive the exact uploaded bytes in a private bucket. Browser upload
and retrieval verify SHA-256; confirmation saves the artifact, normalized rows
and source records atomically. Original download is separate from converted
export/current dataset JSON. Historical originals cannot be reconstructed from
old normalized rows. Five formats have reproducible integration samples; this
is not exhaustive compatibility with every vendor variation.

Every detail page has **Source data and additional fields** below the domain
views. Preview and saved sources provide the full package inventory,
JSON/XML/text search, paged long text, binary entry download, selectable text
encoding, and exact original download. Mapping is explicitly **unassessed**
until the engine supplies field-level coverage. Editing preserves unknown fields
and rejects stale writes. Existing imports may omit fields required for new
manual records; editing does not force these missing fields to be invented. See [the staged roadmap](docs/plans/plan_09-16_lossless-import-ui.md).

Verification:

```
npm run lint
npm test
npm run build
# After building, start a preview on the engine's allowed local origin:
npm run preview -- --host 127.0.0.1 --port 5173
# Separate terminal, with Supabase URL/anon/backend key supplied as environment:
npx playwright install chromium
node tests/lossless-import.browser.mjs
```

The opt-in browser acceptance uses the real conversion engine and Supabase,
creates two temporary accounts, exercises five formats and seven edit forms,
and removes test accounts/data/originals afterward. `SMOKE_BASE_URL` overrides
the origin; `CHROMIUM_EXECUTABLE` can select an existing browser. Do not run it
without the intended database's administrator authorization.

For disposable local PostgreSQL, apply the existing bootstrap, seed and earlier
migrations, then `supabase/tests/storage_bootstrap.sql` and
`202610110001_lossless_import.sql`. Run
`python3 supabase/tests/lossless_import.py YOUR_DISPOSABLE_DATABASE` as local
postgres. Hosted scheduled cleanup is tested separately through its actual
Storage API.

### Dataset relationships

All seven categories remain rows in `datasets`. `import_batches` tracks imports,
and `dataset_references` is a database-maintained index of links inside each
payload. Forms continue saving payloads normally; triggers synchronize the
links and enforce target types and ownership. Referenced records cannot be
deleted until their incoming links are removed. Imports validate at transaction
end, allowing forward references within a batch.

For a complete read-only live audit, with the service-role key available only
in the local environment:

```
node scripts/audit_dataset_references.mjs
node scripts/audit_dataset_references.mjs --backup
```

`--backup` saves a restricted-permission catalog/import-batch JSON snapshot in a
new temporary directory outside this repository. It does not back up Supabase
Auth, Storage, or the complete database schema. Obtain a full project backup
before production migration. The migration is transactional and aborts on
invalid existing references instead of silently changing documents.

To verify the schema on a fresh disposable local PostgreSQL database (never run
`bootstrap.sql` on the live project):

```
psql -X -v ON_ERROR_STOP=1 -d YOUR_TEST_DATABASE \
  -f supabase/tests/bootstrap.sql \
  -f supabase/seed.sql \
  -f supabase/migrations/202609160001_multi_user_import.sql \
  -f supabase/migrations/202610100001_dataset_references.sql \
  -f supabase/tests/dataset_main_table.sql \
  -f supabase/tests/dataset_relationship_table.sql \
  -f supabase/tests/dataset_references.sql
python3 supabase/tests/import_transactions.py YOUR_TEST_DATABASE
```

Run both commands as the local PostgreSQL administrator. The Python check
opens separate local connections to test COMMIT rollback and concurrent import
retries, then removes its fixtures. Use only a disposable local database.

See [1010stage.md](docs/plans/plan_10-10_database-implementation-stages.md) for rollout status and the implementation stages.

### Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds on every push to `main` and deploys `dist/` to GitHub Pages.

1. In the repo's **Settings → Secrets and variables → Actions**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as your `.env`) — the workflow needs them at build time since Vite inlines `import.meta.env.*` into the bundle.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. Push to `main`; the workflow builds and deploys automatically.

---

## Quick Start

1. Click **"Use this template"** button (top right of this repo)
2. Select **"Create a new repository"**
3. Name your repository and click **"Create repository from template"**
4. Open your new repo in GitHub Codespaces:
   - Click **Code** → **Codespaces** → **Create codespace on main**
5. VS Code will open and the dev container will automatically build
6. The postCreateCommand will run:
   - Set up SSH keys and PATH
   - Install and configure MCP servers
   - Initialize skills infrastructure
   - Install the skill-creator tool
   - Sync all skills to your agents

**That's it!** All AI agents (Claude Code, OpenCode, Copilot, Crush, Gemini, Codex) are ready to use.

---

## What's in the Dev Container

Your container includes:

- **[Claude Code](https://code.claude.com/docs/en/overview)** — AI agentic coding tool from Anthropic
- **[OpenCode](https://github.com/opencode-ai/opencode)** — Open source code-focused AI tool
- **[Copilot](https://github.com/features/copilot)** — GitHub's AI pair programmer
- **[Crush](https://github.com/charmbracelet/crush)** — A beautifully themed assistant for command-line work
- **[Codex](https://github.com/openai/codex)** — OpenAI's agentic tool
- **[Gemini](https://github.com/google-gemini/gemini-cli)** — Google's AI coding assistant

**Configuration managed by:**
- `configs/mcp-servers.conf` — Model Context Protocol servers available to all agents
- `.skillshare/` — Custom skills available to all agents (single source of truth)

---

## Starting the Agents

All launcher scripts live in `permissions/` inside the container (baked into the image). Each one starts its tool with the right flags so you're not interrupted by permission prompts.

### Claude Code

```
# claude.sh
```

Runs `claude` with `IS_SANDBOX=1` and `--dangerously-skip-permissions`. In a dev container this is safe and makes the experience much smoother.

### OpenCode

```
# opencode.sh
```

Permissions are handled by `.opencode/opencode.json`, already configured with `read`, `write`, and `execute` set to `allow`.

### Copilot

```
# copilot.sh
```

Runs `copilot --allow-all`.

### Crush

```
# crush.sh
```

Runs `crush --yolo`.

### Codex

```
# codex.sh
```

Permissions are handled via `.codex/config.toml`, already configured for a sandbox environment.

---

## MCPs (Model Context Protocol Servers)

MCP servers extend AI tools with access to external data and services. All MCP configuration flows from a single file: `configs/mcp-servers.conf`

### Adding Additional MCPs

Edit `configs/mcp-servers.conf` and add entries using this format:

```
# SSE MCP (no authentication):
dolt=https://bus-mgmt-databases.mcp.mathplosion.com/mcp-dolt-database/sse

# HTTP MCP with authentication (credential from environment variable):
# stitch=https://stitch.googleapis.com/mcp|http|X-Goog-Api-Key:$STITCH_API_KEY
```

The `dolt` entry above is already active and provides access to a version-controlled SQL database. To add other authenticated MCPs like Stitch, uncomment the entry and provide the API key via environment variables.

After editing `configs/mcp-servers.conf`, run:

```
# install-mcps.sh
```

This reads the conf file and registers each MCP in all AI tools — Claude, OpenCode, Gemini, Crush, Copilot, and Codex. Safe to re-run; existing entries are replaced with current values.

### For Authenticated MCPs

To use authenticated MCPs like Stitch:

1. Add the secret (e.g., `STITCH_API_KEY`) at [github.com/settings/codespaces](https://github.com/settings/codespaces) under "Repository secrets"
2. Declare the secret in `.devcontainer/devcontainer.json` under `"secrets"` — this works in both GitHub Codespaces and local devcontainers:
   ```json
   "secrets": {
     "STITCH_API_KEY": "STITCH_API_KEY"
   }
   ```
3. Uncomment the MCP entry in `configs/mcp-servers.conf` and reference the secret variable (e.g., `$STITCH_API_KEY`)
4. Run `install-mcps.sh`

### Uninstalling MCPs

```
# uninstall-mcps.sh
```

Removes all MCP registrations listed in the conf file from every tool's config.

---

## Skills (All Agents)

Skills are custom slash commands available across all your AI agents. The `.skillshare/` directory is the **single source of truth** for all skills.

### Editing Skills

**Always edit skills directly in the `.skillshare/` directory.** Never manually edit skills in other tool directories — the `.skillshare/` folder is where skillshare manages your skills. Changes to skills in other locations will be overwritten during sync.

### Installing Skills

Install individual skills using:

```
# skillshare install github.com/anthropics/skills/skill-creator
# skillshare install github.com/your-org/your-skill-name
```

### Syncing Skills to All Agents

After installing or modifying skills in `.skillshare/`, sync them to all your configured AI agents:

```
# sync-skills.sh
```

This deploys skills to the platforms listed in `.skillshare/config.yaml` (Claude Code, OpenCode, Copilot, Gemini, Crush, Codex, etc.).

---

## Optional Add-ons

These scripts are available inside the container:

### Data Science Tools

```
# install-datascience.sh
```

Installs Python data science libraries, Jupyter, Quarto, and TinyTeX. Includes: numpy, pandas, matplotlib, seaborn, requests.

### Dolt Database

```
# install-dolt.sh
```

Installs [Dolt](https://github.com/dolthub/dolt), a version-controlled SQL database.

---

## Container Image

The image is built from [calvinw/ai-agentic-tools](https://github.com/calvinw/ai-agentic-tools) and published to:

```
ghcr.io/calvinw/ai-course-devcontainer:latest
```

It is rebuilt automatically on Dockerfile changes and weekly via GitHub Actions.
