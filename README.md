# Obsidian Knowledge Vault — Microsite

A **local-first microsite** that puts a rich, visual knowledge‑operating‑system interface on top of an existing Obsidian vault.

The **Obsidian Markdown files are the single source of truth.** This application never becomes a second knowledge database: it reads and writes the real vault files, maintains a *disposable* index it can rebuild at any time, and treats everything else as derived state.

```
OBSIDIAN VAULT  (authoritative source)
      ↕
VaultProvider  →  ObsidianFileSystemVaultProvider (file service + watcher)
      ↕
Indexing + Metadata layer  (disposable, rebuildable)
      ↕
Microsite application  (Express API)
      ↕
Browser UI  (React)
```

---

## Features

- Browse, read, edit, create, rename, move, and delete Markdown documents.
- Interactive wiki links (`[[Page]]`, `[[Page|alias]]`, `[[Page#heading]]`, `[[Page#^block]]`), backlinks, outgoing links, and unresolved links.
- Full-vault search across titles, aliases, tags, frontmatter, filenames, folders, and body — with filters (tag, folder, rating, dates, link state) and snippets.
- 1–5 star **page ratings persisted into source YAML frontmatter** (configurable scale).
- Knowledge graph (pan/zoom/drag/hover) and per-note local relationship graphs with hop expansion.
- Tag explorer (incl. nested `#a/b`), folders, orphans, and a **Knowledge Health** panel (broken links, orphans, stale, empty, duplicate titles, unrated, missing attachments …).
- “What’s changed?” buckets (Today / Yesterday / This Week / Older) and an activity timeline.
- Command palette (**Cmd/Ctrl+K**), dark + light themes, breadcrumbs, hover page previews.
- **Filesystem watching** with debounce so external edits (Obsidian, VS Code, Git) appear live; reconciliation on startup detects offline changes (§2).
- Conflict-safe editing: never silently overwrites newer external content.

---

## Requirements

- Node.js ≥ 20 (developed against Node 24).
- npm.
- A writable Obsidian vault (Markdown files).

## Installation

```bash
cd obsidian-vault-site
npm install
```

## Development setup

```bash
npm run dev            # runs API (tsx watch) + Vite dev server together
```

- API: `http://127.0.0.1:18790/api`
- UI: `http://127.0.0.1:5173` (Vite proxies `/api` to the server)

A `VAULT_PATH` must be set (see below). For a quick try against the bundled test vault:

```bash
VAULT_PATH=tests/fixtures/test-vault npm run dev
```

## Production run

```bash
npm run build          # compiles server (dist/) + bundles client (dist/client)
VAULT_PATH=/path/to/vault npm start
```

Open `http://127.0.0.1:18790/`. The server serves the built SPA when `dist/client` exists.

## Configuration

Never hard-code a vault path. Configuration priority:

1. Environment overrides (`VAULT_PATH`, `KV_SITE_NAME`, `KV_THEME`, `KV_RATING_SCALE`).
2. A config file passed as `KV_CONFIG` or the first CLI argument (`node dist/server/server.js /path/to/config.json`).
3. `config/default.json`.

```jsonc
// config/default.json
{
  "vaultPath": "",               // REQUIRED — set via config or VAULT_PATH
  "siteName": "Knowledge Vault",
  "theme": "dark",               // "dark" | "light" | "system"
  "ratingScale": 5,
  "excludedFolders": [".obsidian", ".git", ".trash", "90 Templates"],
  "excludedFiles": [],
  "attachmentFolders": ["Attachments"],
  "gitIntegration": "auto",      // "auto" | "on" | "off"
  "fileWatching": true,
  "backupBeforeDestructive": true,
  "backupDir": "data/backups",
  "server": { "host": "127.0.0.1", "port": 18790 }
}
```

All app-generated indexes, caches, and backups live inside the **project’s own `data/` directory** — never inside the vault (§30). Nothing app-owned is written into the vault except intentional metadata changes to Markdown (e.g. `rating:`).

## Connect an Obsidian vault

```bash
# Example — your base vault:
VAULT_PATH="/path/to/your/obsidian-vault" npm run dev
```

On startup the app **validates** the vault and reports useful errors when the directory is missing, unreadable, or unwritable. To point the *same* build at a different vault, change configuration only — no rebuild needed ("build once, connect to many vaults", §31). Vault-specific state (index, history, backups) is isolated in `data/`.

## How synchronization works

- On start, the vault is scanned and fully indexed (this is also the offline reconciliation pass).
- While running, a filesystem watcher (chokidar) detects external `create / modify / delete / rename` events, **debounces** bursts, re-parses the changed document, then updates links → backlinks → search → graph (§26).
- The UI shows a live sync bar: `Vault synced` / `Indexing N files…` / `External change detected`.
- Everything is derived: delete `data/` and the app rebuilds its state from the Markdown. No knowledge is lost by clearing the index.

## How ratings are stored

Ratings live in the **source Markdown frontmatter** (§9):

```yaml
---
rating: 4
---
```

If frontmatter already exists, only the `rating:` line is added or updated in place; **every other YAML key, value, comment, order, and quoting style is preserved byte-for-byte.** If the note has no frontmatter, a block is created. Ratings are writable from the document view, filterable, and sortable. Unrated notes are surfaced in Health.

The same mechanism supports future metadata (`status`, `favorite`, `importance`, `confidence`, `reviewed`, `review-after`) — all optional, never forced into existing notes.

## How editing works

- **Read / Edit / Split** modes. Split shows the editor beside a live rendered preview.
- Save goes through a **write-temp-file → validate → atomic rename** sequence.
- Edits target the actual Markdown file; the index updates immediately after save.
- Uns preserve unsupported Obsidian syntax — the app parses but never rewrites content it doesn’t understand.

## How conflict handling works

Every document carries a content hash. When you open a doc, the client remembers your baseline. On save the server compares the **current file hash** to that baseline:

- If unchanged → write succeeds.
- If the file changed externally since you opened it → the server returns a **409 conflict**; the UI offers:
  - **Load external version**
  - **Compare / overwrite with mine** (explicit, after warning)

External content is **never** silently overwritten. A forced save (explicit overwrite) is the only way past a conflict.

## How indexing works

The index is an in-memory Map/Set store rebuilt from source: notes, a link‑target index (base/title/alias), tags, folders, ratings, incoming/backlink tracking, and graph edges. Search uses scored token matching over that index (title/alias/tag/frontmatter/filename beat body hits). For a realistic vault (tens of thousands of notes) this stays responsive without re-reading files per request. The index is registered behind an interface, so a SQLite/FTS backend could be swapped in later without changing the UI or API.

## Security considerations

- **Path traversal is blocked**: every path is validated to stay inside the configured vault root (see `src/shared/path-utils.ts` + its tests).
- Writes outside the vault, to excluded folders (`.obsidian`, …), or to non-Markdown files are rejected.
- Rendered HTML is **sanitized** (DOMPurify).
- NUL bytes and absolute escapes are rejected; filenames are sanitized.
- The server binds to `127.0.0.1` by default. For LAN use, change `server.host` and put it behind your reverse proxy (e.g. `.72` on your LAN) rather than exposing raw.
- Useful error logs go to the console.

## Backup recommendations

- The app can write a timestamped backup into `data/backups/` before destructive operations (`backupBeforeDestructive: true`).
- Because the source of truth is plain Markdown, the best backup is the vault itself (e.g. Git). Keep a copy of your vault; the app index is rebuildable and does not need backing up.

## Git integration

- Git remains **optional**. If the vault is inside a Git repo, `gitIntegration: "auto"` surfaces last-commit metadata per document and the "renamed" change type benefits from it. A plain filesystem vault works with no Git at all.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No vault path configured` | Set `VAULT_PATH` or add `vaultPath` to config. |
| `Vault validation failed` | Check the directory exists and is readable/writable; ensure it’s actually an Obsidian vault. |
| Port already in use | Change `server.port` in config. |
| External changes not showing | Confirm `fileWatching: true`; the sync bar shows detection. You can also hit `POST /api/vault/reindex`. |
| Search misses a new file | The watcher should catch it; otherwise trigger a reindex. |
| Ratings not persisting | Confirm the vault directory is writable by the app process. |

## Tests & QA

```bash
npm test          # unit + integration (data integrity, conflicts, traversal, ratings)
npm run qa        # boots the real server against a copy of the test vault and runs the full §34 delivery checklist
```

`tests/fixtures/test-vault/` is a representative vault (wiki links, aliases, nested tags, frontmatter, ratings, images/attachments, broken links, orphans, nested folders). The QA pass verifies 25 checks end‑to‑end — including that **no app cache is written into the vault** and that the same build works against a **second vault**.

## Project structure

```
obsidian-vault-site/
├─ config/default.json         # configuration (vault path via env/config, never hard-coded)
├─ src/
│  ├─ shared/                  # portable, framework-free logic
│  │  ├─ frontmatter.ts        # lossless, byte-preserving YAML field updates
│  │  ├─ wiki.ts               # wiki links, tags, callouts, embeds (read-only parsing)
│  │  ├─ path-utils.ts         # traversal-safe vault-relative paths
│  │  ├─ config.ts             # load + validate vault config
│  │  └─ types.ts
│  ├─ server/
│  │  ├─ vault-provider.ts     # VaultProvider interface (pluggable backends, §29)
│  │  ├─ obsidian-filesystem-provider.ts   # safe atomic writes, conflicts, watcher
│  │  ├─ vault-service.ts      # orchestrates index + watcher + history + backups
│  │  ├─ indexer.ts / search.ts / graph.ts / health.ts / history.ts
│  │  ├─ api.ts                # Express routes
│  │  └─ server.ts
│  └─ client/                  # React SPA (sidebar, dashboard, viewer/editor, graph…)
├─ tests/
│  ├─ *.test.ts                # vitest suite
│  ├─ fixtures/test-vault/     # representative QA vault
│  └─ qa/qa.mjs                # automated §34 delivery checklist
└─ data/                       # app index/backups (created at runtime; never in the vault)
```

## A note on future AI features

The architecture keeps AI-ready extension points (semantic search, summaries, suggested links, duplicate detection, gaps, tagging) without making AI a requirement. Any AI-generated change would require **explicit user approval before writing to the vault** (§28).