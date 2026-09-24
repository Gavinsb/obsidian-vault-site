# Sprint S7 Implementation Plan — Unified WYSIWYG Editor + Agent Block Console

**Status:** all nine waves (0–8) implemented and verified 2026-09-24 — release gate in progress: docs updated, final deploy and release commit/push still to land. S7 is not released until Wave 8's deploy and commit complete.
**Sprint:** S7
**Opened:** 2026-09-22 (collection) · **Unified plan:** 2026-09-24
**Repository:** `Gavinsb/obsidian-vault-site`
**Authority:** [`docs/wysiwyg-editor-spec.md`](wysiwyg-editor-spec.md) v4.1
**Related:** [`docs/sprints.md`](sprints.md), [`docs/sprint-S6-plan.md`](sprint-S6-plan.md)

---

## 1. Objective

Replace the raw `<textarea>` with a CodeMirror 6 block-aware WYSIWYG Markdown editor and deliver a first-class Agent Block Console. The former MVP and Phase 2 scopes are merged into **one S7 release**; waves below are dependency order only, not separate product phases.

The unified release includes:

- live inline OFM rendering with cursor-reveals-source;
- one server-ranked completion system for notes, tags, headings, block refs, and callout types;
- complete Agent Block Console, status model, vault-wide ID index, and validator R1–R15;
- gutter, toolbar, slash menu, turn-into, drag/drop, nested drag, multi-select and bulk actions;
- structured Properties/frontmatter editor;
- embeds/transclusion, block-reference copy, and masked wikilink hover preview;
- existing ETag/If-Match conflict safety, public masking, light/dark support, full verification and deployment.

**Hard boundaries:** Markdown files remain authoritative; the site never executes a model; anonymous projections never expose agent content or IDs; no proprietary document model.

---

## 2. Locked decisions

All prior Q1–Q9 decisions remain binding:

1. Status dropdown lists all statuses but enables only legal transitions.
2. Console may set `apply` and must show the external-sweep authorisation note.
3. Console never sets `finished`; the sweep owns that transition.
4. Final completion architecture is the new server-ranked endpoint; trigger/insertion semantics remain unchanged.
5. Validation errors block Save only for agent blocks edited this session; untouched legacy errors are advisory.
6. Single-user only; no CRDT/Yjs.
7. New/edited agent headers are canonical; untouched legacy headers pass through byte-for-byte.
8. Reviewer feedback lives in a parseable `**Reviewer feedback**` section.
9. Agent Console appears both in a side panel and inline, backed by one parsed state.

Consolidation resolutions (no new user choice required):

- Drag/drop supports before, after and nest; **no two-column drop zones**.
- Mermaid may be inserted as a fenced scaffold but has **no live renderer**.
- The ID index is **vault-wide** (active vault + `Agent_Sweep_Log.md`), not multi-vault.
- Validator ships complete at R1–R15; no v1/v2 release split.

---

## 3. As-built constraints to preserve

- `DocView.tsx` owns read/edit/split modes, draft/baseline state, conflict UI and explicit Save.
- `editor-utils.ts` defines current `[[` and `#` trigger/suppression/insertion semantics.
- `agent-blocks.ts` is the shared, offset-based, fence-aware parser and draft transform source.
- `Markdown.tsx` is the safe rendered form and must stay aligned with edit rendering.
- Public reads mask agent blocks; authenticated `?agents=1` and `/source` are private/no-store.
- Writes remain atomic and require canonicalised `If-Match`; `412` preserves the draft.
- Every new visual token needs both dark and light values.

---

## 4. Unified items

### S7-1 — Foundation verdict spike

Compare direct CodeMirror 6 integration with the cited Atomic Editor prior art before product code begins.

- Verify licence, maintenance, bundle cost, extension fit, and byte-identical round-trip for frontmatter, wikilinks, callouts and agent blocks.
- Keep the throwaway spike off `master`; record the verdict and evidence in this plan.
- **Acceptance:** explicit build/adopt decision with measured evidence; no downstream wave starts before it.

### S7-2 — Shared block-boundary detector

Add `src/shared/block-detect.ts` with `detectBlocks(source): BlockRange[]`.

- Types: paragraph, heading, list/listItem, task, quote, callout, fence, table, frontmatter, agent, embed, hr.
- Lezer/host-tree based, fence-aware, CRLF-safe, nesting-aware; agent spans must agree with `parseAgentBlocks()`.
- **Acceptance:** nested-list, quote, fence-impostor, table, frontmatter, callout, agent, embed and CRLF tests; slices reconstruct source exactly.

### S7-3 — Unified server-ranked completion system

Add the provider registry in `src/shared/completions.ts` and final endpoint `GET /api/completions?kind=&q=&path=`.

- Kinds: note, tag, heading, block ref, observed/static callout type.
- Preserve current `[[` / `#` trigger boundaries, code suppression, insertion shape, 200 ms debounce, stale-result guard and caret restoration.
- Add ↑/↓/Enter/Tab/Esc, ARIA listbox state, caret anchoring and explicit empty/error states.
- Retire editor dependence on legacy `/api/search` and `/api/tags` completion calls before release.
- **Acceptance:** server ranking tests; existing insertion/suppression tests stay green; anonymous completion cannot expose agent text; keyboard and caret tests pass.

### S7-4 — Agent status model, vault-wide ID index, complete validator

Add `agent-status.ts`, `agent-validation.ts`, and session-gated `GET /api/agent/ids`.

- Seven exact statuses and locked transition table; `finished` disabled in the console.
- Canonical header order: `status → ID → TARGET`; tolerant parser, edit-scoped writer.
- Six-character ID generator avoids IDs in all vault Markdown plus `Agent_Sweep_Log.md`.
- Implement **R1–R15** from spec §7.6, including migrations, transition legality, proposal payload, directive scope, orphan cleanup and terminal hygiene.
- **Acceptance:** one test per rule; sweep-log-only collision test; two-task isolation fixture; untouched malformed legacy blocks never block Save.

### S7-5 — CM6 editor core

Create `Editor.tsx` and replace the textarea while retaining DocView's state machine.

- Live inline rendering and cursor-reveals-source for core CommonMark/OFM.
- Native CM6 transactions and undo; no proprietary tree or hidden shadow document.
- Core types: paragraph, headings, lists/tasks, quote, callout, fence, table, hr, frontmatter, wikilink/embed syntax, tags, highlight/comment, agent blocks.
- Mermaid remains fenced source only.
- **Acceptance:** fixture output agrees with read view; frontmatter never leaks into article rendering; native undo order; both themes verified.

### S7-6 — Agent Block Console

Add `AgentConsole.tsx` and span-splice helpers.

- Legal-transition dropdown, apply note, disabled finished explanation.
- ID generate/edit + mirrored review ID, type toggle, TARGET completion, pairing picker, quoted-body editing.
- Parseable reviewer-feedback section required before rejected.
- Accept/Reject remain draft-only; Go to source, Copy block/ID, audit reference, read-only halt display and proposed halt resolution.
- Only edited blocks are canonicalised; unrelated bytes are untouched.
- **Acceptance:** splice-fidelity tests for every operation; untouched legacy header survives; panel and inline controls share one state.

### S7-7 — Console placement and complete validator UI

- **Side panel:** all tasks with type, ID, status and expandable controls.
- **Inline:** blueprint card with compact status dropdown.
- Findings panel with click-to-jump ranges and optional safe fixes.
- Save disabled only for errors on session-edited blocks; legacy findings appear amber.
- Read-mode status pill uses canonical vocabulary and legend tooltip.
- **Acceptance:** shared-state test; exact Save-gate expression test; edited-vs-legacy validation scenarios.

### S7-8 — Properties/frontmatter editor

- Structured key/value editor matching Obsidian semantics.
- Preserve ordering, scalar style, comments where safe, and untouched bytes.
- `updated` visible but read-only; server remains authoritative.
- **Acceptance:** byte-identical no-op round-trip; single-field splice isolation; save reinjects authoritative UTC `updated`.

### S7-9 — Embeds, block refs and masked hover preview

- Render `![[note]]` transclusion and `![[image|width]]` inline.
- Copy/resolve real `^block-id` references.
- Add masked `GET /api/note-preview?target=` and hover UI.
- Reuse existing attachment/raw image paths.
- **Acceptance:** images and note embeds render; previews never expose agent blocks anonymously; block-ref copy resolves correctly.

### S7-10 — Block affordances and slash menu

- Reserved hover gutter with `+` and functional drag handle; no text shift.
- Bubble toolbar: bold, italic, strike, code, link, wikilink, highlight, comment.
- Slash menu uses CommandPalette keyboard contract and supports CommonMark, Callout, Embed, Properties, Tag, Task, Mermaid scaffold, Agent instruction/review.
- Turn-into is a text substitution, not schema conversion.
- **Acceptance:** exact scaffold tests; toolbar dismissal/accessibility; gutter-not-shifting check.

### S7-11 — Block manipulation

- Drag/drop reorder, nested drag, contiguous multi-block select and bulk operations.
- Text-range splices only; drop zones = before/after/nest.
- One CM6 transaction per operation, native undo, drop-line and ghost styling.
- **Acceptance:** byte-identical untouched surroundings; undo restores exact source; no two-column output; no partial save.

### S7-12 — Save, concurrency, masking and safety integration

- All structural/status/content changes mutate the local draft only.
- Explicit Save issues exactly one existing If-Match request and receives one fresh ETag.
- Concurrent Obsidian changes produce `412`, preserve draft and use existing conflict UI.
- UI state never enters Markdown.
- Completion, ID, preview and any transclusion endpoints get auth/masking tests.
- **Acceptance:** real-router conflict test; exactly-one-save test; anonymous-leak tests; malformed/wildcard/missing preconditions unchanged.

### S7-13 — Verification, docs and release

- Update `EditingHelp.tsx`, spec, plan and sprint history.
- Gates: lint, full tests, production build, QA, `git diff --check`.
- Manual checks: keyboard completion, drag/drop + undo, Properties, embed/preview, Agent Console, validation, conflict UI, responsive light/dark.
- Restart `kv-microsite.service`; verify local and tunnel endpoints and public masking.
- Commit with Gavinsb identity, push `master`, confirm HEAD parity.

---

## 5. Build waves

| Wave | Items | Exit gate |
|---|---|---|
| **0** | S7-1 | Foundation verdict recorded; spike proves OFM round-trip. |
| **1** | S7-2, S7-4 contracts | Shared parsers/status/IDs/validator R1–R15 green. |
| **2** | S7-3 | Final completion endpoint + client contract green; no legacy editor completion path. |
| **3** | S7-5 | CM6 core replaces textarea with save/conflict state intact. |
| **4** | S7-6, S7-7 | Console, panel/inline state and complete Save gate green. |
| **5** | S7-8, S7-9 | Properties, embeds/refs/preview green with masking. |
| **6** | S7-10, S7-11 | Affordances and full block manipulation green with undo fidelity. |
| **7** | S7-12 | Concurrency, exactly-one-save and endpoint safety tests green. |
| **8** | S7-13 | Full gate, live acceptance, deploy, docs, commit and push. |

The waves are not separate releases. S7 is incomplete until Wave 8 passes.

---

## 6. Test plan

**New unit/integration suites:**

- `block-detect.test.ts` — ranges, nesting, CRLF, fences, splice reconstruction.
- `completions.test.ts` + endpoint tests — ranking, providers, keyboard, caret, auth/masking.
- `agent-status.test.ts` — statuses, transitions, headers, ID generation.
- `agent-validation.test.ts` — R1–R15, migrations, edit-scoped blocking, two-task isolation.
- `agent-console.test.ts` — span splices, feedback, pairing, legacy pass-through.
- `properties-editor.test.ts` — ordering/scalars/comments/no-op fidelity/read-only `updated`.
- `embeds-preview.test.ts` — transclusion, images, refs, preview masking.
- `block-manipulation.test.ts` — drag/nest/multi-select/bulk/undo.
- Real-router status-conflict and exactly-one-save tests.

**Regression requirements:** public masking, authenticated agent read, ETag parser, current read rendering, Editing Help, existing autocomplete insertion/suppression, QA fixture integrity.

**Real-vault-shaped fixture:** paired tasks, halt, legacy statuses, review-owned status, fenced fake block, duplicate ID, two tasks in one file, frontmatter variants, note/image embed, heading and block refs.

---

## 7. Definition of done

1. CM6 is the only edit surface and Markdown remains the source of truth.
2. Final server-ranked completions cover notes/tags/headings/block refs/callout types without insertion regressions.
3. Agent Console enforces legal transitions, complete R1–R15 validation and edit-scoped Save blocking.
4. Vault-wide ID collisions include sweep-log IDs.
5. Properties, embeds, refs and masked hover preview ship.
6. Gutter, toolbar, slash menu, turn-into, drag/drop, nested drag, multi-select and bulk actions ship with native undo.
7. Untouched legacy syntax and unrelated bytes survive exactly.
8. One explicit Save → one If-Match write; stale writes return `412` and preserve the draft.
9. Anonymous callers cannot receive agent content or IDs from any endpoint.
10. Both themes/responsive layouts pass; lint/test/build/QA/diff-check pass; deployment, docs, commit, push and HEAD parity are complete.

---

## 8. Explicit exclusions

- CRDT/Yjs or multi-user live collaboration.
- Inline comments and version-history timeline.
- Two-column layout (including left/right drag zones).
- Live Mermaid/KaTeX rendering; Mermaid scaffold/source editing only.
- Plugin-style custom block API.
- AI/model execution from the site.
- Authentication/permission redesign.
- Multi-vault indexing.

---

## Execution log

- **2026-09-22 — Sprint S7 opened** for collection.
- **2026-09-24 — Collection completed** and WYSIWYG + Agent Console specification drafted.
- **2026-09-24 — Q1–Q9 resolved** by Gav.
- **2026-09-24 — Initial phased plan authored.**
- **2026-09-24 — Plan consolidated at Gav's request.** Former MVP and Phase 2 scopes merged into one 13-item, nine-wave S7 release; completion, validator, drag/drop, Properties, embeds/preview and vault-wide ID index are all in-sprint. Two-column drag zones and live Mermaid rendering remain explicitly excluded.
- **2026-09-24 — Build authorised.** Gav said `start build`; Wave 0 / S7-1 foundation spike started.
- **2026-09-24 — S7-1 verdict: VALIDATED — adopt and extend `@atomic-editor/editor` v0.6.2.** Evidence: MIT licence; upstream HEAD `b6ed65f` (2026-07-11); React 18/19 + CM6 peer model; typecheck/build and 75/75 upstream tests passed; a dedicated happy-dom OFM test mounted frontmatter, wikilinks/embeds, callouts, agent blocks and fenced impostors, then applied an isolated edit with byte-identical surrounding content; consumer `extensions` accepted a custom StateField. Equal Vite library builds measured direct CM6+Markdown at 563,233 B raw / 172,837 B gzip versus Atomic + CSS at 733,987 B raw / 218,987 B gzip (+46,150 B gzip). The package tarball is 101,292 B compressed / 402,598 B unpacked. `npm audit` findings were confined to upstream dev/test tooling (`vitest`, `postcss`, `nanoid`); runtime dependencies are peers owned by this app. Recommendation: use Atomic's React wrapper and exported primitives, pin the package and CM6 peers, and layer Doug KX parsing/validation/completions as consumer extensions. The throwaway spike remains under ignored `.tmp/openclaw-spikes/` and will not ship.
- **2026-09-24 — Wave 1 started:** S7-2 block detector and S7-4 status/ID/validator shared contracts.
- **2026-09-24 — Wave 1 complete.** S7-2 `block-detect.ts` (Lezer/GFM tree, fence-aware, agent spans from `parseAgentBlocks`, flat ranges + nesting) with 10 tests. S7-4 `agent-status.ts` (seven statuses, locked `TRANSITIONS` incl. `halted→new|HRR|cancelled`, `canTransition→{ok,reason}`, tolerant header parse, edit-scoped canonical writer, `ID_RE`/`generateId`, legacy map) and `agent-validation.ts` (R1–R15 with ranges, safe fixes, edit-scoped blocking) with 7 + 18 tests. S7-4 also lands the session-gated vault-wide `GET /api/agent/ids` (`agent-ids.ts`, cached on the index signature; note IDs plus sweep-log `(ID: …)` references; IDs only, no agent content) with 3 integration tests. The rate-limited subagent's output was repaired by hand: a `??`/`||` syntax error, an R8 `.ok` call site, a union-type typecheck error, the R13 nested-quote regex, the transition-table/exports contract, and a missing `.js` import extension. Gates: lint clean; Vitest **152/152 across 22 files**; production build passed; QA 27/27.
- **2026-09-24 — Wave 2 complete.** `completions.ts` + public `GET /api/completions?kind=note|tag|heading|blockref|callout&q=&path=&limit=` (note ranking reuses `searchIndex` so today's results are preserved; tags keep count ordering; headings/block refs/callout types derive from **masked** content so anonymous callers never see agent text or IDs) with 6 tests, plus `api.completions()` on the client. Gates: lint clean; Vitest **158/158 across 23 files**; production build passed; QA 27/27.
- **2026-09-24 — Wave 3 complete.** `Editor.tsx` wraps `@atomic-editor/editor`'s `AtomicCodeMirrorEditor` and replaces the `DocView` `<textarea>` (draft/baseline/ETag/412-conflict/flash machine untouched); a CM6 completion source drives the unified `/api/completions` for note/tag/heading/blockref/callout with 200 ms debounce, stale-response guarding, code suppression via the Lezer tree, and plain-value insertion only. Fixed a real pre-existing blocker: duplicate `@lezer/common` (root 1.2.3 vs nested 1.5.2) crashed CM6's tree highlighter on every mount (`tags is not iterable`), silently killing highlighting — pins raised to `@lezer/common@1.5.2` / `@lezer/highlight@1.2.4` so it dedupes, plus `happy-dom` added as a devDependency (it had been installed `--no-save`). `vitest.config.ts` inlines the Atomic package for its extensionless ESM dist. A no-console-error regression guard now covers the crash. Gates: lint clean; Vitest **172/172 across 24 files**; production build passed; QA 27/27.
- **2026-09-24 — Wave 4 complete (S7-6 + S7-7).** New `agent-splice.ts` (pure, right-to-left span splices that rewrite exactly one block; header edits re-serialise only that header and keep body bytes verbatim, and vice versa; untouched blocks survive byte-identical) and `AgentConsole.tsx` (one shared store feeding both the side panel and the inline card; legal-transition dropdown with `finished` always disabled, ID generate/edit with mirrored review ID, type toggle, TARGET completion, pairing picker, quoted-body editing, a parseable **Reviewer feedback** gate before `rejected`, draft-only Accept/Reject, Go to source / Copy / audit reference, read-only halt display + resolve-to-HRR), the findings panel (click-to-jump + safe fixes, `blocks save` vs `pre-existing — advisory`), the exact Save gate `findings.some(f => f.blocking)`, and the canonical read-mode status pill with a legend tooltip. **Fixed the Wave 1 endpoint bug it exposed:** `GET /api/agent/ids` merged note IDs with sweep-log IDs, so R3 flagged every existing block in the open note; the endpoint now takes `?path=` to exclude the note under validation and returns a separate `externalIds` set (sweep-log only). Documented, not changed: `validateAgentBlocks` treats "no edit scope supplied" as blocking (the console/DocView always pass scope; the R1 contract test encodes the default). Gates: lint clean; Vitest **203/203 across 25 files**; production build passed; QA 27/27.
- **2026-09-24 — Wave 5 complete (S7-8 + S7-9).** `properties.ts` (byte-offset `PropertyRow`s, single-value-span splices, byte-exact rebuild, quote-style-preserving encode, read-only `updated`) + `PropertiesEditor.tsx` (editable above the editor in edit/split, read-only panel in read; no-op edits never churn the draft) — Properties are part of the draft and ride the untouched Save/ETag/412 machine. `block-refs.ts` (fence-aware `findBlockAnchors`, `resolveBlockRef`, `formatBlockRef`, `parseBlockRef`) + `Embeds.tsx` (`splitNoteEmbeds`, masked depth-1 `NoteEmbed`, `MarkdownWithEmbeds`); `Markdown.tsx` now emits `![[image|300]]` widths, copyable `^id` block anchors and `[[Note#^id]]` navigation; a public masked `GET /api/note-preview?target=` (reuses `maskAgentBlocks`; `resolved:false` rather than errors) backs transclusion, and `api.notePreview()` is on the client. Dark + light tokens for both features. 23 new tests. Gates: lint clean; Vitest **226/226 across 27 files**; production build passed; QA 27/27.
- **2026-09-24 — Wave 6 complete (S7-10 + S7-11).** New shared modules `slash-menu.ts` (block-start-only, fence-suppressed trigger; prefix > word > substring ranking), `inline-marks.ts` (8 marks: bold/italic/strike/code/link/wikilink/highlight/comment) and `block-manipulation.ts` (reorder/nest/delete/duplicate/turn-into/bulk as text-range splices from `detectBlocks` ranges; drop zones exactly `before|after|nest`); client `slash-menu.ts` (CM6 field + keymap), `block-affordances.ts` (hover gutter with `+` and drag handle as decorations — absolute positioning in a reserved margin, so text never shifts — plus drag/drop and selection reporting), `editor-actions.ts` (single write path), `SlashMenu.tsx` and `BlockToolbar.tsx`. `CommandPalette.tsx` gained a shared `paletteKeyIntent` keyboard contract used by both menus. Every block operation is **exactly one CM6 transaction** and `undo()` restores the byte-identical original; the exact scaffold table is asserted byte-for-byte (agent headers built via `formatAgentHeader`). 43 new tests. **Carried forward:** slash-inserted agent IDs use `generateAgentId([])` and so do not avoid the vault reserved set — wiring reserved IDs into the editor is a host change for Wave 7. Gates: lint clean; Vitest **269/269 across 29 files**; production build passed; QA 27/27.
- **2026-09-24 — Wave 7 complete (S7-12).** New `tests/s7-integration.test.ts` (9 tests) drives a real Express router, a real temp vault and a mounted real `DocView` through a counting fetch stub, proving: every structural/status change stays in the local draft (`writes == []`); one explicit Save issues **exactly one** `PUT` with the loaded `If-Match` and returns one fresh ETag (a second Save writes nothing; a batched double activation collapses to one write); a concurrent on-disk change yields `412` with the draft preserved and the existing conflict UI; no ephemeral UI marker ever reaches the saved source; and the endpoint safety contract holds — anonymous `/completions`, `/agent/ids` and `/note-preview` expose no agent text/IDs, while `428`/`400`/`412` If-Match behaviour is unchanged. **Carried-forward fix landed:** the slash-menu agent scaffold now seeds `generateAgentId` with the host's reserved IDs (`slash-menu.ts` `ScaffoldContext.reservedIds`, an `Editor` `reservedIds` prop, and `DocView` fetching `api.agentIds(canonicalPath)` then re-adding the live draft's own block IDs), with a deterministic test that a reserved first candidate is skipped. **Flake found and fixed during verification:** the save assertion used a fixed `settle(40)` and intermittently read the write before its ETag was recorded; replaced with a deterministic `waitFor` poll (suite then green at 278/278). Gates: lint clean; Vitest **278/278 across 30 files**; production build passed; QA 27/27.
