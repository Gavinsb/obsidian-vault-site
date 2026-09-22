# Sprint S6 Implementation Plan

**Status:** plan finalized — awaiting explicit `start build`; no implementation authorized
**Sprint:** S6
**Created:** 2026-09-22
**Repository:** `Gavinsb/obsidian-vault-site`

## Scope

S6 contains one collected item:

1. **S6-1 — Show agent blocks in the read-only view for signed-in users**, with a toggle to show/hide the view, rendered in a "blueprint" admin aesthetic with encapsulation linkage (matching ID tags, bracket margin line, hover shading), theme-adaptable.

No product implementation is authorized until Gav says `start build`.

## Current behavior (grounding)

- `src/server/api.ts` — `GET /api/docs/*` (read projection) applies `maskAgentBlocks(doc.content)` for **everyone**, signed-in or not; `Cache-Control: public, max-age=30`.
- `src/server/vault-service.ts` — same masking in the indexed read path (`line 149`).
- `src/shared/agent-blocks.ts` — `parseAgentBlocks(source)` returns blocks with `{ type, header, metadata, content, start, end, id?, target? }`; `maskAgentBlocks` strips them. Fenced examples are ignored.
- `src/client/components/DocView.tsx` — read mode renders `stripFrontmatter(doc.content)` → `splitTitle` → `<Markdown content={rest}>`. Auth comes from `useAuth()`, `canEdit = !!user`. Toolbar right side has Read/Split/Edit + favorite/delete for editors.
- `src/client/components/Markdown.tsx` — renders callouts generically (`> [!note]` → `.callout`), so agent blocks currently render as ordinary callouts when unmasked (they never are, today).
- Theme: `:root` (dark) + `html[data-theme='light']` CSS variable overrides; `useEffectiveTheme` resolves `system`.
- Tests: source-inspection style (read component files, assert tokens) via Vitest.

## Key design decisions

### D1 — Server: gated unmasked read variant
Add `?agents=1` (name TBD) to `GET /api/docs/*`:

- **Anonymous:** ignored — response stays masked with `Cache-Control: public, max-age=30`.
- **Signed-in:** returns the document with agent blocks **intact**, `Cache-Control: private, no-store` (same posture as the S5 protected `/source` route). No new endpoint shape; no masking change for the public projection.

Rationale: keeps public read identical, keeps the masking guarantee server-side, and gives the read-only view an authenticated feed that doesn't require entering edit mode (which fetches `/source` and sets editor state).

### D2 — Client: toggle in the read toolbar
- Visible **only when signed in** (`canEdit`), in `toolbar-right`.
- Toggle label e.g. `Show agent blocks` / `Hide agent blocks` with an `active` class when on (matches existing toolbar toggle pattern).
- Default state and persistence: TBD (open question Q1).
- When ON, read mode loads the unmasked variant; when OFF (or signed out), behavior is exactly today's.

### D3 — Rendering: segment the body, don't re-type the markdown pipeline
A new shared helper (in `src/shared/agent-blocks.ts`) segments a body string:

```
segmentBodyByAgentBlocks(body) →
  [{ kind: "text", text }, { kind: "agent", block }, ...]
```

`DocView` read mode (agents ON):

- Runs `stripFrontmatter` → `splitTitle` → `rest`, then `segmentBodyByAgentBlocks(rest)`.
- Renders `text` segments through the existing `<Markdown>` component unchanged.
- Renders each agent block as `<AdminBlockCard>`:
  - dashed border, light desaturated background, pill badge `Admin Instruction` / `ID: #…`, monospace details (exact palette via CSS variables, D4).
- **Pairing (encapsulation):** blocks sharing the same `id` metadata form a start/end pair:
  - both cards get the same color-coded ID tag (e.g. emerald);
  - the markdown segments between them are wrapped in an `.encapsulated` container with a left vertical dashed **bracket** element spanning from start-block bottom to end-block top;
  - hovering the start card, end card, or bracket line applies a faint tint + outline to the encapsulated section (CSS group-hover, no JS listeners).
- Unpaired blocks (unique id, both `agent` and `agent-review`) render as standalone cards, no bracket.

The Markdown component itself is untouched — agent blocks become styled cards **instead of** being fed through `marked` in this mode.

### D4 — Theme-adaptable blueprint palette
New CSS variables in `styles.css`, defined in `:root` (dark) and `html[data-theme='light']`:

| Token | Dark (recommended) | Light (recommended) |
|---|---|---|
| `--agent-block-bg` | desaturated slate/amber tint (e.g. `#232a21` or amber-muted) | light amber/lavender (`#f7f3ea` / `#f0f4f8`) |
| `--agent-block-border` | muted dashed (`#6b7280`-ish) | `#0066cc`-ish or gray |
| `--agent-badge-bg` | `--accent`-derived | `#0066cc` |
| `--agent-pair-accent` | emerald dark (`#34d399`) | emerald (`#059669`) |
| `--agent-hover-tint` | translucent accent | `rgba(0,102,204,0.03)` |

Badge/ID text uses the existing `--text` / `--text-dim` / mono font stack (`font-family: var(--font-mono)` if present, else `monospace`).

### D5 — Polarity safety
- Toggle visually disabled/hidden for signed-out users (no dead control).
- Unmasked variant never served over the public cache: `private, no-store` and only with a valid session (reuse the S5 auth helper that guards `/source`).
- `agent-review` blocks appear too, but **Accept/Reject staging remains draft-only** — read view is display-only, no mutation affordances added.

## Build order

### Wave 1 — Shared segmentation helper
1. Add `segmentBodyByAgentBlocks(body)` to `src/shared/agent-blocks.ts`; returns ordered segments using existing `parseAgentBlocks` offsets; pairs by `id` (first = start, last = end; content between = encapsulated).
2. Unit tests: standalone cards, paired bracket wrapping, unpaired ids, fenced-example immunity, review blocks included.

### Wave 2 — Server gated read variant
1. In `api.ts` `GET /docs/*`: accept `agents=1` query; if session signed in → return unmasked content + `Cache-Control: private, no-store`; else current masked behavior unchanged.
2. Integration test: anonymous `?agents=1` still masked; authenticated returns agent text; `cache-control` per case.

### Wave 3 — Client view + toggle
1. `api.ts`: add `getDocAgents(p)` client method (or `agents: true` option on `getDoc`).
2. `DocView.tsx`: read-mode state `agentsOn`; toolbar toggle (signed-in only); when ON, load unmasked doc and segment-render (`AdminBlockCard` + `.encapsulated` + bracket); when OFF/read, existing path unchanged. Polling loop follows the active mode.
3. New component file(s) under `src/client/components/` for the card + bracket rendering.

### Wave 4 — Styling
1. Add the D4 variable set to `styles.css` for both themes.
2. Card, badge, bracket, and hover-shading rules; responsive behavior on narrow widths (bracket shrinks/indent only, no horizontal overflow — matches S5-2 constraint style).

### Wave 5 — Tests, docs, release
1. Source-inspection tests (`tests/admin-read-view.test.ts`): toggle gated on `canEdit`; segment helper pairing; both theme palettes present (`:root` + `[data-theme='light']` tokens); public-mask guarantee intact.
2. Update `docs/sprints.md` + this plan with evidence and final commit.
3. `npm run lint`, `npm test`, `npm run build`, `npm run qa`, `git diff --check`.
4. Restart `kv-microsite.service`; verify local + HTTPS endpoints; commit with `Gavinsb` identity, push `master`, confirm HEAD parity.

## Open questions (Gav to confirm before build)

- **Q1 — Toggle default & persistence:** on by default for signed-in users, off by default, or remember last choice (localStorage)?
- **Q2 — Block types:** show only `> [!agent]` instructions, or also `> [!agent-review]` blocks (recommended: both, since read view is display-only)?
- **Q3 — Pairing rule:** derive start/end pairs from identical `ID:` metadata (recommended), or expect explicit `START`/`END` markers in headers?

## Definition of done

- Signed-in users can toggle agent blocks in read-only view; signed-out users never see them and the public API stays masked.
- Agent blocks render as blueprint cards (dashed border, badge, mono details); start/end pairs show color-coded ID tags, a vertical bracket line, and hover shading over the encapsulated section.
- Palette switches correctly with the light/dark theme.
- Editing/accept/reject flows are completely unaffected; no mutation capabilities added to read view.
- Existing + new tests pass; deployed, committed, pushed, HEAD parity verified.