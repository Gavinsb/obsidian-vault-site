# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single primary user (Gav) — the owner of one Obsidian vault. He is the human in the loop: he consumes, stores, deletes, and revises knowledge, and he reviews what an agent produces. The product is not designed for multiple concurrent users or a shared team account.

## Product Purpose

A web-visible knowledge base ("Doug KX") layered over an existing Obsidian vault. An **agent curates, creates, and updates** the knowledge; a **human consumes, stores, deletes, and revises** it easily. The purpose is to make an agent-built knowledge corpus usable and editable by a person without friction — the vault stays a living, human-readable Markdown store rather than an opaque AI artifact.

Success means: knowledge an agent creates or revises can be stored, found, edited, and deleted by the human easily and safely, with the vault remaining coherent over time.

## Positioning

The agent is a first-class curator of a real Obsidian vault, not a chat that emits notes. The mechanism a neighboring product could not truthfully copy is the pairing of **agent-driven authoring** with a **human approval gate on every vault write**, on top of plain Markdown files that remain the single source of truth. The app never becomes a second knowledge database; it reads and writes the actual vault files and keeps only disposable, rebuildable derived state.

The design intent is **unconstrained by default** — flexible enough that an agent can build and reshape a workable knowledge base — but bounded by **just enough integrity** to keep the vault trustworthy.

## Operating Context

- The vault is a writable Obsidian vault of Markdown files on the same machine.
- The app runs locally (localhost) and is shared to remote/phone access through a **Cloudflare tunnel**.
- An agent works against the vault as a curator; the human reviews and approves writes.
- The human's workflows: browse and read notes; search across titles, aliases, tags, frontmatter, filenames, folders, and body; edit, create, rename, move, and delete documents; rate pages (1–5 stars, persisted into source YAML); inspect the knowledge graph, tags, orphans, and a Knowledge Health panel; and review "What's changed?" activity.
- Node.js ≥ 20 is required; the vault must be readable/writable by the app process.

## Capabilities and Constraints

- Markdown files in the vault are the **single source of truth**; the app maintains a disposable, rebuildable index and treats everything else as derived state.
- The **agent proposes; the human approves each vault write.** No AI-generated change is written to the vault without explicit human approval (see README §28).
- Write safety: **backups before destructive operations**, **conflict-safe writes** that never silently overwrite newer external content, and traversal-safe vault-relative paths with validation on write.
- Filesystem watching with debounce so external edits (Obsidian, VS Code, Git) appear live; reconciliation on startup detects offline changes.
- Pluggable vault backends via a `VaultProvider` interface; the shipped backend is the Obsidian filesystem provider.
- Explicitly out of scope: CRDT/multi-user collaboration, live Mermaid/KaTeX rendering, model execution, a general table schema, multi-vault indexing.
- AI is an extension point, not a requirement: semantic search, summaries, suggested links, duplicate detection, gaps, and tagging are kept possible without being mandatory.

## Brand Commitments

- Product/site name: **Doug KX**.
- Dark + light themes are supported; the interface presents a rich knowledge-operating-system surface over plain Markdown.

## Evidence on Hand

- A representative test vault at `tests/fixtures/test-vault/` (wiki links, aliases, nested tags, frontmatter, ratings, images/attachments, broken links, orphans, nested folders) used by the automated QA pass.
- An automated delivery checklist at `tests/qa/qa.mjs` (27 end-to-end checks) and a Vitest suite.
- Durable sprint history in `docs/sprints.md` (S1–S8) and per-sprint plans under `docs/`.

## Product Principles

1. **The vault is the product.** Markdown files are authoritative; everything else is a disposable, rebuildable view.
2. **Agent proposes, human approves.** No vault write from AI without explicit human sign-off.
3. **Flexible, not fragile.** Stay unconstrained enough for an agent to build and reshape knowledge, but enforce just enough integrity to trust the result.
4. **Never lose the human's knowledge.** Back up before destructive ops and never silently overwrite newer external edits.
5. **Usable by a human at a glance.** An agent-built corpus must remain easy for a person to read, find, edit, and delete.
