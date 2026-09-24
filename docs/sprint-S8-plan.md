# Sprint S8 Implementation Plan — Editor Modes, Header Layout & Tables

**Status:** PLANNED 2026-09-24 — Q1–Q2 answered; Q3–Q7 pending; awaiting "start build".
**Sprint:** S8 (20 items, `S8-1` … `S8-20`)
**Opened:** 2026-09-24 (collection) · **Plan:** 2026-09-24
**Repository:** `Gavinsb/obsidian-vault-site`
**Baseline commit:** `bfe9838` (S8 item list)
**Related:** [`docs/sprints.md`](sprints.md), [`docs/sprint-S7-plan.md`](sprint-S7-plan.md)

---

## 1. Objective

Fix the note header layout and the editing experience surfaced by the 2026-09-24 review of `eb439a0`:

- remove Split view and replace it with a **Raw** markdown source editor alongside Read/Edit;
- make **rating and favourite read-only-mode affordances**;
- remove the two concurrency hazards (post-mutation stale ETag, read→edit poll race);
- flatten the stacked chrome above the writing surface and de-duplicate File info / Properties;
- make **tables creatable and editable** with visible row/column affordances instead of a hidden right-click menu;
- keep the Editing help truthful for the editor actually in use, and shown only while editing.

**Hard boundaries (unchanged):** Markdown files stay authoritative; the site never executes a model; anonymous projections never expose agent content or IDs; the draft/baseline/ETag machine, `412` conflict contract and byte-exact frontmatter round-trip are preserved.

---

## 2. Locked decisions (Gav, 2026-09-24)

1. **Remove Split view** entirely — no third split pane.
2. **Add a Raw source editor back as an option** (so the mode set is `Read | Edit | Raw`).
3. **Ratings and favourite are read-only-mode only** — not available (and not shown) in Edit or Raw.
4. **Raw mode is a dedicated source editor** built from the `@codemirror/*` packages already installed — plain markdown source with line numbers, and **no live preview, no block chrome, no agent console and no Properties editor**. `AtomicCodeMirrorEditor` stays the Edit-mode engine only. *(Answered 2026-09-24, Q1.)*
5. **Table row/column controls are added by patching and vendoring the editor package in-repo** — a local workspace copy of `@atomic-editor/editor@0.6.2` whose `table-widget` gains the visible affordances (S8-17/18/19). Upstream later. *(Answered 2026-09-24, Q2 = option a.)*

Everything else is as collected in `docs/sprints.md` (S8-1 … S8-20).

---

## 3. Open questions — answer before `start build`

**Q1 — Raw editor engine — ANSWERED 2026-09-24.** A dedicated `RawEditor` built from the already-installed `@codemirror/*` packages: markdown language, line numbers, **no** live preview, **no** block affordances, **no** agent console and **no Properties editor** — pure markdown source, with frontmatter left as text at the top.

**Q2 — Table controls — ANSWERED 2026-09-24.** Option **(a)**: patch and vendor `@atomic-editor/editor@0.6.2` in-repo (a local workspace copy of the package under `vendor/`), extending its `table-widget` with visible row/column affordances while keeping the upstream shape so the change can be offered upstream later.

**Q3 — S8-18 symptom confirmation.** On your device, does a single click/tap inside a table cell put the caret *in the cell* so you can type? Which device/browser were you on? My headless test could not confirm it either way (programmatic focus worked; a synthetic click focused the outer editor). A real check decides whether S8-18 is a bug fix or a discoverability fix.

**Q4 — S8-11 gate definition.** Is "overlap" = block-level (a blocking finding whose block intersects the changed line range in the draft) acceptable? And should the "save anyway" escape be **admin-only** (recommended) or any signed-in user?

**Q5 — S8-6 scope.** Drop **both** File info and Properties collapsibles from the read article (rail keeps them), or keep File info in the article and drop only Properties?

**Q6 — S8-7 overflow contents.** Confirm the `⋯` menu holds **Show agent blocks** and **Delete** (Favourite moves next to the rating and only shows in read mode). Any other action to move?

**Q7 — Release shape.** One S8 release at the end, or a checkpoint after the layout/mode wave (W1) so you can see it before table work?

---

## 4. As-built constraints to preserve

- `DocView.tsx` owns mode/draft/baseline/ETag/conflict state and the explicit Save; `Editor.tsx` is the CM6 host.
- Saves are atomic with a canonicalised `If-Match`; `428` (missing), `400` (malformed), `412` (stale) semantics must not change.
- The read poll (`/api/docs/*`, 4 s) and the `?agents=1` unmasked projection keep their masking and cache headers.
- `PropertiesEditor` splices single value spans (byte-exact); unchanged frontmatter bytes must survive.
- Regression tests for this project read component source and assert tokens/ordering; real-router integration tests cover auth-gated behaviour. Any UI change needs the same style of test.

---

## 5. Waves

Dependency order only; one release.

### W0 — Baseline & guardrails
- Snapshot `npx tsc --noEmit`, `vitest run` (expect 278/278), `npm run build`, `npm run qa` against the fixture vault.
- Add a **mode matrix test** (Read/Edit/Raw × signed-in/out) asserting which chrome renders, replacing the current split assumptions.

### W1 — Editor modes & header layout — *S8-1, S8-2, S8-5, S8-6, S8-8, S8-9, S8-10, S8-12, S8-14*
- `DocView.tsx`: `type Mode = "read" | "edit" | "raw"`; delete the split branch and the split JSX; keep one `enter()` path per mode.
- New `RawEditor.tsx` (per Q1) sharing the host's `value` / `onChange` / Save contract.
- `styles.css`: remove `.doc-body.split` rules; make `.doc-toolbar` sticky; move Save/Cancel into it; align the breadcrumb row (mobile); collapse the Properties box while editing; retire the standalone `.editor-bar` when empty.
- Read article: drop the duplicated File info / Properties collapsibles (per Q5).
- Add the `⋯` overflow menu (pattern from `BlockToolbar.tsx`) for Show agent blocks / Delete.
- Hide the mode toggle when signed out; show a muted note title beside the breadcrumbs while editing; add an unsaved-changes guard before Delete.
- Move `EditingHelp` out of the read rail (lands in W3).

### W2 — Mutation safety & save gating — *S8-3, S8-4, S8-11*
- Rating bar + Favourite render only in read mode; remove `mutate()` from the editing path (post-mutation `baseEtag` refresh becomes moot in read mode, but refresh it anyway for safety).
- Poll race: stop/guard the interval across the read→edit transition and bump `seq.current` inside `loadSource()`.
- Save gate: compute changed line ranges from `draft` vs `baseline`, block only on blocking findings that intersect them; add an admin "save anyway" (per Q4).

### W3 — Editing help — *S8-13, S8-20*
- Render `EditingHelp` only in Edit/Raw; rewrite copy per editor (live-preview Edit vs Raw source); document tables (creation, row/column controls, Tab/Enter, cell editing).

### W4 — Table creation — *S8-15, S8-16*
- `src/shared/slash-menu.ts`: add a `Table` scaffold to `SCAFFOLDS` (new `Table` category) inserting a starter table and placing the caret in the first header cell; extend `slash-menu.test` coverage.
- `src/shared/block-manipulation.ts`: add `table` to `TurnIntoId` + `TURN_INTO_OPTIONS` and `turnIntoBlockText()` (paragraph → starter table; table → paragraph / code).

### W5 — Table editing controls — *S8-17, S8-18, S8-19* — **blocked on Q3**
- Per Q2(a), vendor `@atomic-editor/editor@0.6.2` in-repo and patch `table-widget` to add visible row/column affordances (edge `+` / `⋮` handles or a caret-in-table toolbar) wired to the existing insert/delete row/column operations; point the app's import at the vendored copy.
- Fix/verify cell focus on click and tap (Q3).
- Define last-row/last-column behaviour (convert the table to a paragraph rather than silently no-op).

### W6 — Verification, docs, deploy, release
- `npx tsc --noEmit`; `vitest run`; `npm run build`; `npm run qa` (27/27); live deploy via `kv-microsite.service` + tunnel; headless screenshots of Read / Edit / Raw on desktop and mobile; ETag `412` regression; anonymous masking regression (`/raw/*.md` 404, `/source` session-gated).
- Update `docs/sprints.md` (S8 → released, per-wave commits) and this plan's status; commit and push.

---

## 6. Verification plan

- Lint/type, full Vitest suite, production build, safe-fixture QA.
- Component-source tests for the mode matrix and the new toolbar/help/table text.
- Real-router integration test for the read-only rating gate and the poll-race guard.
- Live acceptance: service restart, local + public `200`, one saved edit per mode, one deliberate `412`, masked anonymous read.

---

## 7. Out of scope

CRDT/multi-user collaboration; live Mermaid/KaTeX rendering; model execution; a general table *schema*; re-theming; auth redesign; multi-vault indexing; rewriting the table widget unless Q2 chooses option (c).
