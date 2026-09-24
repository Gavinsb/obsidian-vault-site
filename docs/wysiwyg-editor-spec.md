# Design Specification: WYSIWYG Markdown Editor + Agent Block Console

### A block-aware, vault-compatible editor for the **Doug KX** microsite (replacing the raw `<textarea>`)

**Version:** 4.1 — unified delivery plan; supersedes the standalone v3.0 spec and the v4.0 phased split
**Prepared for:** Gavin Bergheim
**Date:** 24 September 2026
**Project:** `obsidian-vault-site` ("Doug KX" microsite)
**Status:** specification only — no implementation authorised

---

## 0. Provenance and framing

This spec is built from three inputs:

| Input | What it contributes |
|---|---|
| **v3.0 WYSIWYG spec** (attached) | The architecture thesis: CodeMirror 6 standalone, block-level editing, Obsidian Flavored Markdown (OFM) fidelity, visual design system, phased feature matrix. |
| **This repository, as-built** | The real editor that exists *today*: a plain `<textarea>` with vault-backed autocomplete (wikilink + tag), an Agent staging panel, ETag/If-Match concurrency, session-gated writes, and public agent-block masking. |
| **Knowledge Orchestration sweep workflow** (pasted) | The authoritative agent-block contract: `[!agent]` / `[!agent-review]` blocks, the seven case-sensitive statuses, the state machine, ID rules, safety gate, and validation requirements. |

Two things change relative to v3.0:

1. **v3.0 invented a concurrency model (§5.3). Doug KX already has one** — ETag/If-Match optimistic locking with `428`/`412` semantics, a conflict banner, draft preservation, and a "Load external version / Overwrite with mine" flow. This spec keeps the existing model and extends it, rather than re-designing it.
2. **v3.0 knew nothing about agent blocks.** Doug KX's whole reason for an editor-on-top-of-Obsidian is the agent task workflow. v4.1 therefore adds a first-class editing surface for agent blocks — the **Agent Block Console** (§7) — with dropdown-driven status control and a structural **validator** (§7.6). This is the largest new component in the spec.

**Non-negotiable engineering constraints carried over:**

- The `.md` file on disk is the only source of truth; no proprietary intermediate format.
- Two independent programs (Obsidian.app and this site) may read/write the same file. No silent clobbering.
- The microsite **never executes a model**. It parses, renders, masks, validates, and writes text. Model execution stays in the external OpenClaw sweep.
- Public read projections stay masked; agent blocks are never exposed to anonymous readers.

---

## 1. Executive summary

Replace the `<textarea>` with a **CodeMirror 6 (CM6) editor** running standalone in the browser, extended with a Notion-style **block layer** and a purpose-built **Agent Block Console**.

**Why CM6 (unchanged from v3.0, and still correct):** CM6 is a plain-text editor, not a rich-text tree. That is exactly the model needed to round-trip arbitrary OFM without a lossy JSON↔markdown conversion step. Its Lezer markdown grammar is the same lineage Obsidian uses, so a custom grammar extension can add OFM syntax (`[[…]]`, `![[…]]`, `> [!type]`, `^block-id`, frontmatter) without fighting an unrelated schema. It virtualises the viewport, so long notes stay smooth.

**Foundation verdict (S7-1):** adopt and extend `@atomic-editor/editor` v0.6.2 rather than recreating its preview layer directly. Its React wrapper and exported CM6 primitives preserve raw Markdown, accept consumer extensions, and passed the repository's OFM round-trip spike; Doug KX-specific block detection, completion, validation and controls remain local extensions.

**What is genuinely new in v4.1:**

- **A unified completion layer (§6)** that folds today's ad-hoc `[[`/`#` autocomplete into one provider interface, shared by inline triggers, the slash menu, and the agent console — and *promotes the existing behaviours to spec* instead of leaving them as implicit code.
- **The Agent Block Console (§7):** dropdowns to read and change each task's action state (`status:new` → `status:HRR` → `status:apply` → `status:finished`, plus `rejected`, `cancelled`, `halted`), structured editing of the review block, and a live **validator** that refuses to let an invalid agent block be saved silently.

**What we deliberately do *not* do:** no Yjs/CRDT collaboration, inline comments, version-history timeline, two-column layout, live Mermaid/KaTeX rendering, plugin block API, or AI/model execution from the site. These exclusions are explicit product boundaries, not a second delivery phase.

---

## 2. As-built inventory (what exists today)

This is the baseline the new editor must not regress. Every item below is implemented and covered by tests.

### 2.1 Editor surface

- `src/client/components/DocView.tsx` — three modes: **Read / Split / Edit**. Edit mode is a single `<textarea class="editor-pane">`.
- `src/shared/editor-utils.ts` — `findAutocompleteTrigger()` + `applyAutocomplete()`: the current, complete autocomplete implementation.
- `src/client/components/EditingHelp.tsx` — collapsed in-product reference (Formatting, Obsidian syntax, Autocomplete, Agent instructions, Saving & conflicts).
- `src/client/components/CommandPalette.tsx` — existing **Cmd/Ctrl-K command palette** (new note, search, graph, knowledge map, recent changes, health, + document jump). The new slash menu should reuse this component's keyboard model, not fork it.

### 2.2 Current autocomplete behaviour (to be preserved *and* generalised — see §6)

| Aspect | Current behaviour |
|---|---|
| Wikilink trigger | `[[` opens; query runs to the cursor with no `[` and no newline; insertion strips a trailing `.md` → `[[Note Name]]` |
| Tag trigger | `#` at line start or after whitespace/`(` (regex `(^|[\s(])#([\p{L}\p{N}_/-]*)$`) → `#tag`, nested `#a/b` allowed |
| Code suppression | Never fires inside inline `` `code` `` or ```` ``` ````/`~~~` fences (fence toggle tracked per line) |
| Suggestion source | Wikilink → `GET /api/search?q=` top 8 (detail = folder); tag → cached `GET /api/tags`, substring filter, top 8 (detail = "N notes") |
| Async safety | 200 ms debounce + monotonic sequence guard; stale responses discarded |
| Dismiss / insert | `Esc` closes; click inserts (`onMouseDown` + `preventDefault`); caret restored after insertion |
| Rendering | `.autocomplete-panel` (absolute, `z-index:30`, max-height 260px, scrollable) — not caret-anchored |

### 2.3 Agent blocks (read path) — S6

- `src/shared/agent-blocks.ts` — `parseAgentBlocks()` (offset-based, fence-aware), `maskAgentBlocks()`, `segmentBodyByAgentBlocks()` (text / standalone / paired start-end segments), `acceptAgentReview()`, `rejectAgentReview()`.
- `src/client/components/AgentBlocksView.tsx` — signed-in read view: blueprint cards, `Admin Instruction` / `Agent Review` badges, `STATUS:` pill, paired blocks bracketed by a dashed `.encapsulated` region.
- Public projection masks agent/agent-review blocks for everyone; only an **authenticated** `?agents=1` request gets the unmasked document (`Cache-Control: private, no-store, no-transform`, `Vary: Cookie`).
- Agent tokens already ship for both themes: `--agent-block-bg/-border`, `--agent-badge-bg/-fg`, `--agent-pair-accent/-soft`, `--agent-hover-tint`.

### 2.4 Concurrency, auth, save

- Optimistic locking via `ETag` / `If-Match`: missing → `428`, stale → `412` (no write), match → atomic write + fresh ETag. Proxy/browser variants (`W/"…"`, unquoted, re-quoted) are canonicalised; malformed/wildcard/multi-value still `400`.
- The server owns the UTC `updated` frontmatter field; it is injected on save.
- Every mutation is session-authenticated; `/docs/*/source` is session-gated; `/raw/*` 404s for `.md`.
- Edit mode **never** auto-saves. Draft preserved across conflict and 400/428 errors.

### 2.5 Gaps this spec must close

1. No live rendering — you edit raw source text only.
2. No block-level affordances (gutter, drag, turn-into, slash menu).
3. No way to change a task's **status** without typing `status:…` by hand (the explicit ask).
4. No **validation** that agent blocks are structurally correct before save.
5. Autocomplete is caret-agnostic, not keyboard-navigable, and limited to two triggers.

---

## 3. Core design principles

1. **The `.md` file on disk is the only source of truth.** Every visual state is a rendering of plain text; every edit serialises back to the *same syntax the user typed* (preserve `-` vs `*`, `==highlight==`, wikilink aliases, frontmatter ordering).
2. **OFM is first-class.** Wikilinks, embeds, block refs, callouts, tags, properties, task states render and round-trip — see §8.
3. **Two zoom levels, one surface.** A *block* is a paragraph, heading, list, table, fence, quote, callout, or embed; an *item/mark* is inline content. Both are edited on the same rendered surface. No separate source pane (the existing Split mode survives as an optional view, not a requirement).
4. **Reveal complexity on demand.** Gutter, toolbars, and syntax delimiters appear on hover, caret, or selection.
5. **Never silently clobber a concurrent edit.** Existing ETag model, unchanged (§9).
6. **The agent contract is authoritative and typed, not free text.** Statuses are a closed, case-sensitive vocabulary; the editor offers them as dropdowns and validates structure — it never invents a status.
7. **The site validates; the agent decides.** The validator checks *structure, identity, and consistency*. It does **not** run the safety gate, judge evidence, or approve work — those stay with the OpenClaw sweep and the human reviewer. This boundary is load-bearing and must be visible in the UI.
8. **Brand-native visuals.** Site tokens (`--bg`, `--ink`→`--text`, `--accent`, plus the S6 agent tokens), never Obsidian's CSS variables.

---

## 4. Editing model — the two layers

### 4.1 Inline (item-level)

- **Cursor-reveals-source:** marks render fully (`**Deloitte**` → **Deloitte**) until the caret enters them, then delimiters fade in at ~40% opacity.
- **Typing shorthand:** `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==highlight==`, `[[…`, `#tag`.
- **Bubble toolbar on selection:** Bold, Italic, Strikethrough, Inline code, Link, Wikilink, Highlight, Comment (`%% … %%`). Floats above selection, dismisses on Esc / click-away.
- **Wikilink hover-preview:** a small popover previews the target note, fetched on demand through the masked preview endpoint.

### 4.2 Block-level

- **Hover gutter:** `+` (insert block below) and `⠿` (drag handle) as CM6 line decorations, positioned in reserved margin so text never shifts on hover.
- **Block context menu** (via `⠿`): Turn into (Paragraph / H1–H3 / Bulleted / Numbered / To-do / Toggle / Quote / Callout / Code / **Agent instruction** / **Agent review**), Duplicate, Delete, Copy as Markdown, Copy link to block (`^block-id`), Color.
- **Slash menu:** `/` at the start of an empty block opens a filterable menu covering CommonMark blocks *and* the Obsidian/ Doug KX-native types (Callout, Embed note, Embed block, Properties, Tag, Task, Mermaid, **Agent instruction**, **Agent review**). Reuse the `CommandPalette` keyboard contract (↑/↓/Enter/Esc).
- **Drag-and-drop reorder:** implemented as a **text-range splice**, never a tree mutation. A block-boundary detector (§5.2) resolves start/end lines including nested children. Collision zones support insert-before, insert-after, and nest only; left/right two-column zones are excluded because two-column layout is out of scope. Drop-line indicator + 40%-opacity ghost; surrounding blocks reflow with FLIP animation.
- **Turn into:** a text substitution (`- item` → `- [ ] item` → `> [!note] item` → `## item`), not a schema change.
- **Multi-block select:** click-drag / `Shift+↓` over a contiguous range snapped to block boundaries.

### 4.3 Where the layers meet

Gutter and bubble toolbar are mutually exclusive on screen: hover shows the gutter; selection shows the bubble toolbar and fades the gutter.

---

## 5. Architecture and data model

### 5.1 Engine: CodeMirror 6, standalone

| Requirement | Why CM6 |
|---|---|
| Exact markdown round-trip | Edits text directly; no intermediate rich-text tree |
| OFM fidelity | Lezer grammar lineage; custom extensions add OFM without an unrelated schema |
| Standalone browser, no vendor runtime | Proven feasible (v3.0 cites the "Atomic Editor" OSS project as prior art — evaluate it as a foundation before building the block layer from scratch) |
| Virtualised rendering | Only the viewport is rendered |

### 5.2 Building blocks

- **Lezer markdown parser + OFM extensions:** wikilinks `[[…]]`, embeds `![[…]]`, block refs `^id`, callouts `> [!type]`, tags `#tag`, YAML frontmatter.
- **Block-boundary detector** (build and test first): walks the syntax tree and returns flat top-level block ranges `{startLine, endLine, type, nesting}`. Everything block-level depends on it.
- **CM6 View Plugins** for viewport-positioned decorations (gutter icons, drop-line, ghost preview).
- **CM6 Decorations** to paint without touching underlying text.
- **CM6 State Fields / transactions** for structural edits, routed through CM6's undo history so `Ctrl+Z` is correct.

### 5.3 Reuse the existing shared parsers

Do **not** re-implement parsing. The new editor consumes the same pure modules the read view uses:

- `parseAgentBlocks()` — already offset-based, fence-aware, and returns `{start, end, header, metadata:{id,status,target}, content, type}`. **Extend this**, don't replace it; the Agent Console and the validator both read from it.
- `segmentBodyByAgentBlocks()` — pairing/segmentation for rendering.
- `parseWikiLinks()`, `extractInlineTags()`, `extractHeadings()`, `parseCalloutStart()`, `extractTasks()`, `extractCodeBlocks()` (`src/shared/wiki.ts`).
- `findAutocompleteTrigger()` / `applyAutocomplete()` — the seed of the unified completion layer (§6).

### 5.4 New shared modules

| Module | Purpose |
|---|---|
| `src/shared/agent-status.ts` | The status vocabulary, the state machine, transition legality, ID format + generator, header grammar (de)serialisation. Single source of truth, used by both client and server. |
| `src/shared/agent-validation.ts` | Pure validator: `validateAgentBlocks(source, ctx) → Finding[]` (§7.6). |
| `src/shared/completions.ts` | Provider registry + ranking for the unified completion layer (§6). |

### 5.5 Server endpoints

Existing: `GET /docs/*` (+`?agents=1`), `GET /docs/*/source`, `PUT`/save with `If-Match`, `GET /api/search`, `GET /api/tags`, `GET /api/attachment/*`, `GET /api/raw/*`, `GET /api/config`.

New / extended:

| Endpoint | Purpose |
|---|---|
| `GET /api/agent/ids` | Reserved ID set = all `ID:` values parsed from vault `.md` files **plus** IDs appearing in `Agent_Sweep_Log.md`. Powers collision checks and next-ID generation. Cached with the vault index. |
| `GET /api/agent/blocks?path=` | Optional: server-side parse of a note's agent blocks for cross-client consistency. Client-side parse is acceptable if the parser stays shared. |
| `GET /api/note-preview?target=` | Hover-preview content for a wikilink target (respects masking — never returns agent blocks). |
| `GET /api/completions?kind=&q=&path=` | Unified server-ranked completions for note titles, tags, headings, block refs, and observed callout types; preserves public masking and excludes agent content. |

**Masking invariant:** every new endpoint that returns vault text must apply the same masking rules as `/docs/*`. Agent blocks and IDs must never reach an anonymous caller.

---

## 6. Unified completion layer (current autocomplete, promoted and generalised)

The ask: *"include the editor's current autocomplete features and embed these in a nicer manner."* Today's behaviour is good but implicit. v4.1 turns it into one documented, extensible system.

### 6.1 One provider interface

```
interface CompletionProvider {
  id: string;                       // 'wikilink' | 'tag' | 'heading' | 'callout' | 'slash' | 'agent-status' | …
  trigger: TriggerSpec;             // char(s), context predicate, suppression rules
  query(ctx): Promise<Completion[]>;// debounced + sequence-guarded (as today)
  render(item): { label, detail, kind };
  apply(item, ctx): { source, cursor }; // mirrors today's applyAutocomplete()
}
```

Existing `findAutocompleteTrigger()` becomes the **trigger resolver** that dispatches to a provider by `kind`; `applyAutocomplete()` becomes the shared insertion primitive. No behaviour changes to wikilink/tag semantics — the current tests (`tests/editor-utils.test.ts`) must keep passing unchanged.

### 6.2 Trigger catalogue

| Provider | Trigger | Source | Insertion | Notes |
|---|---|---|---|---|
| **Wikilink** | `[[` | unified `GET /api/completions?kind=note` | `[[Note Name]]` (`.md` stripped) | Ranking moves server-side; insertion/suppression semantics unchanged |
| **Tag** | `#` at start/after whitespace or `(` | unified `GET /api/completions?kind=tag` | `#tag` | Existing result semantics preserved |
| **Heading / block ref** | `[[Note#` | headings and block IDs of the target note | `[[Note#Heading]]`, `[[Note#^block-id]]` | Served by the unified server completion endpoint |
| **Callout type** | `> [!` | static list + vault-observed types | `> [!type] Title` | includes `agent`, `agent-review`, `error` |
| **Slash** | `/` at empty block start | block-type registry | block scaffold | reuses `CommandPalette` keys |
| **Agent status** | *(dropdown, not typed)* | `agent-status.ts` | rewrites the header token | see §7.3 |

### 6.3 Behavioural spec (superset of today)

- **Debounce & staleness:** 200 ms debounce; monotonic sequence guard; discard stale responses. *(current behaviour, keep)*
- **Code suppression:** never inside inline code or fences. *(current, keep — but re-implement against the Lezer tree rather than the current line-scan, so fences nested in lists/quotes are covered.)*
- **Keyboard navigation:** ↑/↓ move, `Enter`/`Tab` accept, `Esc` dismiss, `Ctrl/Cmd+Space` force-open. *(upgrade — today it is mouse-only)*
- **Caret-anchored popover:** position at the token start using CM6 `coordsAtPos()` instead of the current fixed `top:48px` panel. *(upgrade)*
- **Ranking:** prefix match → word-boundary match → fuzzy; ties by existing order (note count / alpha). Document the ranking so it is testable.
- **Insertion fidelity:** insertion never removes surrounding whitespace; alias pipe insertion (`[[Note|<caret>]]`) is a distinct completion for wikilinks.
- **Empty-result & error states:** show "No matches" and never block typing *(today errors silently clear)*.
- **Accessibility:** listbox semantics, `aria-activedescendant`, screen-reader labels.

### 6.4 Explicitly preserved (must not regress)

The five bullet points in §2.2 are contractual. The regression test for this section asserts: `[[` + query → top-8 titles; `#` + query → top-8 tags with counts; suppression inside code; `Esc` closes; insertion form and caret position identical to `applyAutocomplete()`.

---

## 7. Agent Block Console (new component)

This is the additional editing component requested, derived from the Knowledge Orchestration sweep workflow.

### 7.1 What it is

A structured editor that sits beside (or replaces the rendering of) each `[!agent]` / `[!agent-review]` pair in Edit and Split modes. It gives you **dropdowns and controls** instead of hand-typing metadata, and it **validates** every block before you save.

It is *not* a second source of truth: every control writes back into the same callout text using span-precise splices from `parseAgentBlocks()`.

### 7.2 Block anatomy and canonical grammar

```md
> [!agent] status:new ID: A1B2C3 TARGET: document
> Research the central claim and propose sourced additions.
>
> - [ ] follow-up item

> [!agent-review] ID: A1B2C3
> **Proposal**
> ...proposed content...
>
> **Evidence**
> [[Source Note]] …
>
> **Reviewer feedback**
> ...
```

Rules the console enforces:

- **Key order:** `status:` then `ID:` then `TARGET:` on the `[!agent]` header; `ID:` only on the `[!agent-review]` header.
- **Key matching is case-insensitive** (`status:`/`STATUS:` both parse) but the **written canonical form is lowercase keys**; the **value case is preserved exactly** (`HRR` ≠ `hrr`).
- **Normalisation is edit-scoped (LOCKED, Q7):** a block is rewritten into canonical form only when the user edits **that block** in the Console/surface. An untouched legacy header (`STATUS: ready`, missing `ID:`, legacy marker) is passed through byte-for-byte, so opening a note to fix an unrelated typo never rewrites agent metadata.
- **Authority:** the `[!agent]` block is the sole authoritative status source. A legacy `status:` field left inside an `[!agent-review]` block is flagged for removal (§7.6 rule R7).
- **Every line, including blank lines, keeps the `> ` prefix.** The console edits a block as a line array and re-serialises with the prefix; enabling/disabling the prefix is not a user option.
- **`[!error]` halt callouts** are task-linked and edited read-only (their text is produced by the sweep, not by the console) — see §7.5.

### 7.3 Status control (the dropdown)

A `<select>` bound to the parent `[!agent]` header's `status:` token.

| Value | Meaning | Terminal |
|---|---|---|
| `new` | Awaiting processing | no |
| `HRR` | Human Review Required | no |
| `apply` | Authorised for application | no |
| `rejected` | Awaiting revision on feedback | no |
| `finished` | Successfully applied | **yes** |
| `cancelled` | Abandoned, proposal not applied | **yes** |
| `halted` | Safety/integrity failure; needs human | no (blocks until resolved) |

**Dropdown behaviour — LOCKED (Q1):**

- All seven statuses are listed, but **only legal transitions are enabled**; illegal targets are shown **disabled** with a tooltip naming the rule that blocks them. No "advanced" free-select mode.
- Transition legality comes from `agent-status.ts`:
  - `new → HRR | apply`
  - `HRR → apply | rejected | cancelled`
  - `rejected → HRR`
  - `apply → finished` *(sweep-only in practice — see below)*
  - `*  → halted` (safety/integrity only)
- **`finished` is never offered from the console (LOCKED, Q3).** It has no enabled incoming transition from any editable state, so the disabled option shows *"Set by the OpenClaw sweep once an `apply` has actually been applied."* The console cannot attest that an application happened, so it must not claim it.
- **Guard rails shown in the UI:**
  - Choosing `apply` shows: *"Authorises the external OpenClaw sweep to apply this proposal. The site does not execute anything."* This is a **standing capability, not a per-note gate (LOCKED, Q2)** — the human click is the authorisation the sweep waits for.
  - Choosing `rejected` requires the review block to contain reviewer feedback; otherwise the control explains that feedback is required first.
  - Choosing `halted` requires a reason and offers to insert the standard `[!error]` scaffold.
- **Silence is not approval:** the console never auto-advances status. No timer, no "looks good, apply it".

> **Design note (policy, LOCKED Q2/Q3):** one asymmetry is deliberate. `apply` is a human **authorisation signal** and is settable here; `finished` is a **fact about what the sweep did** and is not. That keeps `apply` cheap to give and `finished` trustworthy.

### 7.4 Other controls

| Control | Writes | Notes |
|---|---|---|
| **ID** | `ID:` token, both blocks | Validated `^[A-Za-z0-9]{6}$`; "Generate" button produces a collision-free ID from `GET /api/agent/ids`. Editing the ID rewrites the review block's mirror ID. |
| **Block type** | header line | `[!agent]` ⇄ `[!agent-review]` toggle with structural repair (see R3/R4). |
| **TARGET** | `TARGET:` token | Free text, `document` suggested; autocomplete from block ids found in the note. |
| **Pairing** | metadata | "Pair with review block" picker when >1 candidate; shows the paired block inline. |
| **Body** | quoted content lines | Markdown-editable via the normal editor surface; prefix managed automatically. |
| **Proposal markers** | content markers | When a proposal uses content markers, the console exposes *"extract proposal body"* and highlights the merge payload; a "Materialise into draft" action keeps today's `acceptAgentReview()` semantics (draft-only). |
| **Reviewer feedback** | `**Reviewer feedback**` section in the review block | Parseable labelled section (LOCKED, Q8); free prose is tolerated in existing blocks, and the console offers a one-click move into the labelled section. Required before a task may be set to `rejected`. |
| **Reject / Accept** | draft transforms | Today's `acceptAgentReview` / `rejectAgentReview`, unchanged and still draft-only. |
| **Task actions** | — | "Go to source" (existing), "Copy block", "Copy ID". |
| **Audit reference** | — | Read-only link to the matching `Agent_Sweep_Log.md` entry when an ID is found there. |

### 7.5 Halt (`[!error]`) handling

The console **renders** a task-linked error callout read-only when present:

```
> [!error] Agent Halt A1B2C3
> Reason: [specific safety or integrity problem]
> Required resolution: [what must be clarified or corrected]
```

It shows `status:halted` on the parent, and offers **"Resolve halt"** which — after the user edits the note to satisfy the requirement — proposes the corrective status (typically `HRR`) but never applies it silently. Halt content is never generated locally; it comes from the sweep.

### 7.6 The validator

Pure function `validateAgentBlocks(source, ctx)` returning findings:

```
Finding = {
  severity: 'error' | 'warning' | 'info',
  rule: string,                  // R1 …
  blockId?: string,
  range: { start, end },         // byte span for highlight/click-to-jump
  message: string,
  fix?: { label: string, apply(source): string }  // optional one-click structural repair
}
```

**Rules:**

| Rule | Checks | Severity |
|---|---|---|
| **R1 — Well-formed callout** | Header matches `^>\s*\[!(agent\|agent-review)\][+-]?\s*(.*)$`; every body line is quoted (`^> ?`); no unquoted line terminates the block early | error |
| **R2 — ID present & formatted** | `ID:` exists on both blocks; matches `^[A-Za-z0-9]{6}$` | error |
| **R3 — ID uniqueness** | ID unique across vault `.md` files and `Agent_Sweep_Log.md`; not reused for different tasks | error |
| **R4 — Pairing** | Exactly one `[!agent-review]` per parent ID; review sits immediately below its parent; no duplicates | error |
| **R5 — Status vocabulary** | Parent status ∈ {`new`,`HRR`,`apply`,`rejected`,`finished`,`cancelled`,`halted`}; exact case; never a bare number (state numbers are not task IDs) | error |
| **R6 — Status authority** | Status read from the parent only; a review block carrying its own status is flagged | warning |
| **R7 — Legacy migration** | Legacy `status:pending` → `new`; legacy review `Status: Pending Human Approval` + processed parent → `HRR`; `status:Human Approved` → `apply`; legacy review status field must be removed; existing ID preserved | warning + fix |
| **R8 — Transition legality** | The status change is a legal edge (advisory — flags illegal hops rather than blocking save) | warning |
| **R9 — Target** | `TARGET:` present and non-empty; a non-`document` target resolves to a real paragraph/block id in the note | warning |
| **R10 — Proposal payload** | For a review with a proposal, content markers are present, balanced, and non-empty; for `REPLACE`, a baseline excerpt exists | warning |
| **R11 — Safety-gate surfacing** | Heuristic flags: instruction requests deleting frontmatter/global tags, contains injection-like phrasing, or has ambiguous target boundaries → prompts "this will likely be `halted` by the sweep" (informational only) | info |
| **R12 — `PERFORM AUTOMATICALLY` scope** | Recognised only when it appears as a directive in the block body — never inside quoted text, fenced examples, staged proposal content, or the review block | info |
| **R13 — Stray/example blocks** | Blocks inside fenced code or quoted documentation are ignored (never offered in the console, never validated as tasks) | info |
| **R14 — Orphan cleanup** | `cancelled` with leftover annotations; `finished` retaining a callout (should be cleaned); `[!error]` without matching task | warning |
| **R15 — Terminal hygiene** | `finished`/`cancelled` blocks that still carry a review body/annotations are flagged for cleanup | warning |

**Severity semantics:**

- **error** → the Console shows a red validation panel and the Save button is **disabled only when the block was changed in this session** (LOCKED, Q5). An untouched pre-existing malformed block shows an amber advisory banner instead and never blocks Save; there is deliberately no "save anyway" escape hatch, so a newly authored error must be fixed before it can be persisted.
- **warning** → inline amber marker with a "fix" affordance where a structural fix exists (R7 legacy migration is one-click).
- **info** → muted note; never blocks.

**Validator scope boundary (restated):** the validator proves *structure, identity, and consistency*. It does not run the safety gate, evaluate evidence, or decide approval. The UI must say so, so a green check is never mistaken for "this task is safe/approved".

### 7.7 Placement in the UI

- **Edit / Split mode (LOCKED, Q9):** an **Agent Tasks** side panel lists every block in the note (type, ID, status pill), each row expanding into the Console controls. Mirrors and extends today's "Agent staging" panel.
- **Inline (LOCKED, Q9):** each agent block renders as a card in the editor surface (same blueprint styling as the read view, token-driven) with a compact status dropdown in the card header. Panel and inline controls read the same parsed state (single source), so they cannot disagree.
- **Read mode:** unchanged (S6 `AgentBlocksView`), except the `STATUS:` pill reflects the canonical vocabulary and gains a legend tooltip.

---

## 8. OFM content types the editor must support (first-class)

| Syntax | Meaning | Treatment |
|---|---|---|
| `[[Note]]`, `[[Note\|Alias]]`, `[[Note#Heading]]`, `[[Note#^block-id]]` | Wikilink | Inline mark; unified autocomplete; masked hover-preview |
| `![[Note]]`, `![[image.png\|300]]` | Embed / transclusion | Own gutter block; rendered inline; draggable as a unit |
| `^block-id` | Block anchor | Exposed via "Copy link to block" |
| `> [!type] Title` / `> [!type]-` | Callout | First-class block type; fold state preserved |
| `==highlight==` | Highlight | Bubble toolbar |
| `%% comment %%` | Comment | Rendered dimmed, not hidden |
| `#tag`, `#nested/tag` | Tag | Inline mark + autocomplete |
| YAML frontmatter | Properties | Structured key/value UI at top (matching Obsidian 1.4+), not raw YAML |
| `- [ ]` / `- [x]` / `- [/]` / `- [?]` | Task | Clickable checkbox; in "Turn into" |
| ` ```mermaid ` | Diagram source | Slash-menu scaffold and fenced-code editing only; live diagram rendering is explicitly out of scope |
| **`> [!agent]` / `> [!agent-review]` / `> [!error]`** | **Agent task blocks** | **Agent Block Console (§7); masked from public** |

---

## 9. File I/O and concurrency (extend the existing model)

Doug KX already implements what v3.0 proposed. v4.1 keeps it and closes the two gaps the new editor introduces:

1. **Structural edits are still single saves.** A gutter drag or slash insert must not issue a partial save; the draft model is unchanged — one save, one If-Match, one new ETag. CM6 transactions batch into the same `draft` string.
2. **Device-local UI state must never enter the file.** Gutter open state, dropdown selection, validator findings, and mode are UI-only. Only text changes are saved.
3. **Agent status writes go through the same save path.** Flipping a dropdown is a draft edit, not an immediate mutation. It is persisted only on Save, with the same conflict handling — so a status change made while Obsidian changed the same note still yields `412` + conflict UI, never a silent overwrite.
4. **Byte-for-byte pass-through** for syntax the editor does not understand (plugin code blocks, unusual callouts): unchanged text, never reformatted.
5. **Masked projection safety:** the unmasked `?agents=1` variant stays authenticated-only, `private, no-store, no-transform`, `Vary: Cookie`. The Console is not exposed without a session.

---

## 10. Visual design system (site-native)

- **Canvas:** centred content column 72ch (`--markdown-body` already uses `max-width: 72ch`), line-height 1.5–1.8, generous block margins so the gutter has room without shifting text.
- **Tokens:** reuse the existing set — `--bg`, `--bg-alt`, `--bg-card`, `--border`, `--text`, `--text-dim`, `--accent`, `--ok`, `--warn`, `--err`, radius scale, `--radius-pill`, `--font-mono` — plus the S6 agent palette (`--agent-block-bg/-border`, `--agent-badge-*`, `--agent-pair-accent/-soft`, `--agent-hover-tint`). **Every new component must define both `:root` (dark) and `html[data-theme='light']` values** — the S5 regression (missing light tokens for `--btn-bg`/`--btn-border`) is the cautionary example.
- **Status colours:** map the seven statuses to semantic pairs (e.g. `new` neutral, `HRR` amber `--warn`, `apply` blue `--accent`, `rejected` red `--err`, `finished` green `--ok`, `cancelled` grey, `halted` red-on-warn). Define once, consume everywhere (pill, dropdown, panel row, read-view badge).
- **Micro-interactions:** 150–200 ms ease-out on hover reveal; 40% drag ghost; accent drop-line; fade/scale-in on insert.
- **Empty states:** placeholder in empty blocks ("Type '/' for commands, or just start writing…").
- **Focus/Typewriter modes (optional):** dim non-active paragraphs / centre the active line.

---

## 11. Unified delivery scope

S7 ships **one integrated editor plan**. The dependency waves in §12 are implementation order only; they are not separate product phases and none of the former Phase 2 items is deferred beyond this sprint.

| Area | Delivered scope |
|---|---|
| **Editor core** | CM6 editor, live inline rendering, cursor-reveals-source, core OFM blocks, light/dark tokens, existing ETag conflict flow. |
| **Completion system** | Provider registry, keyboard navigation, caret anchoring, empty/error states, and a new masked server-ranked endpoint for note titles, tags, headings, block refs, and observed callout types. |
| **Agent workflow** | Status model, Agent Block Console, panel + inline controls, vault-wide ID index, and the complete validator rules R1–R15 including legacy migration. |
| **Block editing** | Hover gutter, slash menu, bubble toolbar, turn-into, working drag-and-drop reorder, nested drag, multi-block selection, and bulk actions. |
| **Structured content** | Properties/frontmatter editor with byte-preserving pass-through and server-owned `updated`; embeds/transclusion, block-reference copy, and masked wikilink hover preview. |
| **Safety and release** | Single-splice transactions, one-save/one-ETag semantics, masking/auth tests for every new endpoint, full gates, deployment, docs, commit and push. |

### 11.1 Server-ranked completion endpoint

Add a single session-appropriate completion endpoint over the existing indexer/tokenizer for note titles, tags, headings, block refs, and observed callout types. The client provider interface preserves current trigger, insertion, suppression, debounce, and caret semantics while replacing the transitional per-provider `/api/search` / `/api/tags` paths before release.

- **Acceptance:** ranking is unit-tested server-side; the editor issues no legacy `/api/search` call for wikilinks; anonymous responses cannot expose agent content; existing insertion semantics remain byte-identical.

### 11.2 Complete validator (R1–R15)

Implement the full table in §7.6 in one shared `agent-validation.ts`, including one-click legacy migration, transition legality, proposal payload checks, directive scoping, orphan cleanup, and terminal hygiene. The edit-scoped blocking rule from Q5 applies to every error.

- **Acceptance:** one unit test per rule; two-task fixtures prove fixes never cross block boundaries; untouched malformed legacy blocks remain advisory; edited invalid blocks cannot be saved.

### 11.3 Block manipulation

Deliver drag-and-drop reorder, turn-into, multi-block select + bulk actions, and nested-block drag on top of the block detector. Reordering is always a CM6 text-range splice. Collision zones support before, after, and nest; **two-column left/right drops are excluded**.

- **Acceptance:** one CM6 transaction per operation, correct native undo, no partial save, no text shift on gutter hover, and byte-identical untouched surroundings.

### 11.4 Properties editor

Deliver a structured YAML frontmatter editor matching Obsidian semantics while preserving key order, comments where safely possible, scalar style, and untouched bytes. The server-owned UTC `updated` field is visible but not editable.

- **Acceptance:** untouched frontmatter round-trips byte-identically; edits affect only the selected key/value span; save still injects authoritative `updated`.

### 11.5 Embeds, refs, and hover preview

Deliver `![[note]]` transclusion, `![[image|width]]`, block-reference copy, and wikilink hover preview through `GET /api/note-preview?target=`. Preview and transclusion endpoints use the same masking guarantees as public document reads.

- **Acceptance:** relative and attachment images render; note embeds and previews never expose agent blocks to anonymous callers; copied block refs resolve to a real `^block-id`.

### 11.6 Vault-wide agent ID index

`GET /api/agent/ids` serves reserved IDs from the active vault's Markdown files plus `Agent_Sweep_Log.md`. This is **vault-wide**, not multi-vault. It powers R3, ID generation, review pairing, and audit links.

- **Acceptance:** endpoint is session-gated; collision with an ID found only in the sweep log is caught before save; generated IDs match `^[A-Za-z0-9]{6}$` and avoid the reserved set.

### 11.7 Explicit exclusions

The unified plan still excludes: real-time CRDT/Yjs collaboration; inline comments; version-history timeline; two-column layout; live Mermaid/KaTeX rendering (the slash menu may insert a fenced scaffold); plugin-style custom block API; AI/model execution from the site; and authentication/permission redesign.

---

## 12. Build approach and verification

All work below belongs to the single S7 release. Intermediate commits and green gates are encouraged, but the sprint is not complete until every wave is done.

1. **Foundation verdict:** spike CM6 direct vs. prior art; record licence, bundle, extension, and byte-round-trip evidence. No product code before the verdict.
2. **Shared primitives:** block-boundary detector, status model, complete R1–R15 validator, header splices, and vault-wide reserved-ID index contracts.
3. **Unified completions:** provider registry plus the final server-ranked endpoint; preserve current behaviour while adding headings/block refs, keyboard navigation, ARIA, caret anchoring, and error/empty states.
4. **CM6 editor core:** replace the textarea while preserving DocView's draft/baseline/ETag state machine; live inline rendering and cursor-reveals-source for core OFM.
5. **Agent Console:** structured edits, legal status dropdown, feedback, pairing, halt display, side panel + inline controls, and edit-scoped validation Save gate.
6. **Structured content:** Properties editor, note/image embeds, block-ref copy, and masked hover preview.
7. **Block interaction:** gutter, bubble toolbar, slash menu, turn-into, drag/drop, nested drag, multi-select, and bulk actions.
8. **Safety integration:** single-splice transactions, native undo, exactly one save per user save action, conflict tests, endpoint auth/masking, untouched-byte fidelity.
9. **Release:** update Editing Help and sprint docs; run lint, full tests, build, QA, and diff-check; deploy; live-check both themes and masking; commit, push, and confirm HEAD parity.

**Verification expectations:**

- Unit tests for each parser/status/validator/block-manipulation rule.
- Existing `tests/editor-utils.test.ts` remains green until replaced by equivalent provider-contract assertions; insertion and suppression semantics cannot regress.
- Real-router tests for completions, ID index, note preview, embeds, auth, masking, and status-change conflict → `412`.
- Real-vault-shaped fixture covering paired tasks, halt, legacy statuses, fenced impostors, duplicate IDs, Properties, embeds, headings, block refs, and two tasks in one file.
- UI/source-inspection tests for both theme token sets, panel/inline single-source state, Save gating, slash-menu contents, and gutter-not-shifting.
- Manual acceptance for drag/drop + undo, hover preview, image/note embed, keyboard completion, public masking, and light/dark rendering.

---

## 13. Resolved design decisions

All nine choices are resolved and are binding for the unified S7 build.

**Q1 — Status dropdown strictness. ✅ RESOLVED.** Show only legal transitions enabled; illegal targets disabled with an explanation. No advanced free-select.

**Q2 — May the site set `status:apply`? ✅ RESOLVED.** Yes. A human click is the authorisation the sweep waits for. The site sets the signal; it still executes nothing.

**Q3 — May the site set `status:finished`? ✅ RESOLVED.** No. `finished` is never offered from the console; it is sweep-only, because the console cannot attest that an application actually occurred.

**Q4 — Completion ranking: client or server? ✅ RESOLVED.** The unified delivery lands the new server-ranked completion endpoint over the existing indexer/tokenizer, covering note titles, headings, block refs, and tags. The provider interface preserves current insertion/suppression semantics while replacing the transitional `/api/search` path before release.

**Q5 — Blocking scope of validator errors. ✅ RESOLVED.** (A) Errors block Save only for blocks edited this session; untouched pre-existing errors are advisory and never block Save. No "save anyway" escape hatch.
→ Consequence: a newly authored structural error must be corrected before the task can be persisted, while legacy notes stay editable.

**Q6 — Collaboration assumption. ✅ RESOLVED.** Single-user, confirmed. The concurrency concern is only "me on the site vs. me in Obsidian.app", handled by the existing optimistic-locking model. Real-time CRDT collaboration is out of scope, not deferred; it carries an architectural cost (external sync store) that conflicts with the file-as-source-of-truth constraint.

**Q7 — Canonical header grammar. ✅ RESOLVED.** New and edited blocks use the canonical form `> [!agent] status:<STATUS> ID: <ID6> TARGET: <target>` (lowercase keys, fixed order). Untouched legacy headers are **passed through byte-for-byte** — merely opening and saving a note never rewrites an agent header it did not edit.

**Q8 — Where does reviewer feedback live? ✅ RESOLVED.** A parseable `**Reviewer feedback**` section inside the `[!agent-review]` block (so "no `rejected` without a reason" is enforceable and the sweep can locate the text). Free prose is still tolerated for existing blocks; the console offers to move it into the labelled section.

**Q9 — Console placement. ✅ RESOLVED.** (A) An Agent Tasks side panel listing all tasks **plus** an inline status dropdown on each card in the document. Both read the same parsed state.

---

*Sources reviewed: this repository (`src/shared/agent-blocks.ts`, `editor-utils.ts`, `wiki.ts`; `src/client/components/DocView.tsx`, `AgentBlocksView.tsx`, `EditingHelp.tsx`, `CommandPalette.tsx`, `Markdown.tsx`; `src/client/styles.css`; `docs/sprints.md`; test suite), the attached v3.0 WYSIWYG specification, and the pasted Knowledge Orchestration sweep workflow. Current as of 24 September 2026.*
