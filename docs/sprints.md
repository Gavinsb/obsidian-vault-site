# Sprint History

Durable record of every sprint on this project. A **sprint** is a
*collect → plan → build* cycle over the Obsidian vault microsite ("Doug KX").

This file exists so any agent (or human) can see what changed, when, and why,
without reading the raw git log. Each sprint has a sequential reference id
(`S1`, `S2`, …). Items within a sprint are numbered `1..n` and referenceable
as e.g. `S4-3`.

---

## S7 — planned (open)

- **Status:** unified specification and detailed plan complete; **no implementation authorised until `start build`**
- **Opened:** 2026-09-22 (collection) · **Unified plan:** 2026-09-24
- **Specification:** [`docs/wysiwyg-editor-spec.md`](wysiwyg-editor-spec.md) — v4.1 unified WYSIWYG editor + Agent Block Console design
- **Detailed plan:** [`docs/sprint-S7-plan.md`](sprint-S7-plan.md)
- **Goal:** replace the raw textarea with one CodeMirror 6 block-aware WYSIWYG release containing the complete Agent Block Console, server-ranked completions, validator R1–R15, structured Properties, embeds/preview, and full block manipulation.
- **Decisions:** Q1–Q9 remain locked. Former Phase 1/MVP and Phase 2 are merged into one S7 release. Final completions use the new server endpoint; validator ships R1–R15; drag/drop is functional (before/after/nest only); the ID index is vault-wide; two-column layout and live Mermaid rendering remain excluded.
- **Items (13):**
  1. **S7-1 — Foundation verdict spike** (direct CM6 vs prior art; evidence, no product code)
  2. **S7-2 — Block-boundary detector** (shared, nested/fence/CRLF-safe, byte-exact)
  3. **S7-3 — Unified server-ranked completions** (notes/tags/headings/block refs/callout types; keyboard + caret UI)
  4. **S7-4 — Agent status, vault-wide ID index, validator R1–R15**
  5. **S7-5 — CM6 editor core** (live inline rendering, cursor-reveals-source, core OFM)
  6. **S7-6 — Agent Block Console** (legal statuses, ID/TARGET/pairing/feedback/halt/accept-reject)
  7. **S7-7 — Console placement + complete validator UI** (side panel + inline, edit-scoped Save gate)
  8. **S7-8 — Structured Properties/frontmatter editor**
  9. **S7-9 — Embeds, block refs, masked hover preview**
  10. **S7-10 — Gutter, bubble toolbar, slash menu, turn-into**
  11. **S7-11 — Drag/drop, nested drag, multi-select, bulk actions**
  12. **S7-12 — Save/concurrency/masking/safety integration**
  13. **S7-13 — Verification, docs, deployment, commit/push**
- **Out of scope:** CRDT/multi-user collaboration; inline comments/history; two-column layout; live Mermaid/KaTeX rendering; plugin block API; model execution; auth redesign; multi-vault indexing.

---

## S6 — complete ✅

- **Status:** complete — implemented, verified, deployed, committed, and pushed
- **Opened:** 2026-09-22
- **Completed:** 2026-09-22
- **Implementation commit:** `ea26eed` — "Complete Sprint S6: agent blocks in read-only view with toggle"
- **Verification:** lint passed; Vitest 112/112 (18 files); production build passed (1609 modules); safe-fixture QA 27/27; `git diff --check` passed; live anonymous checks confirm public masking holds on both default and `?agents=1` projections through the HTTPS tunnel
- **Deployment:** `kv-microsite.service` active/enabled (user systemd); local `127.0.0.1:18790` and external tunnel return `200`
- **Detailed plan:** [`docs/sprint-S6-plan.md`](sprint-S6-plan.md)
- **Decisions:** S6-1 = signed-in-only `?agents=1` read variant (public masking unchanged); blueprint cards segmented out of the markdown pipeline; start/end pairs by matching `ID:` metadata; CSS tokens for dark + light; toggle remembers last choice (`kv.agentBlocksView`), default off.
- **Items (1):**
  1. **S6-1 — Show agent blocks in read-only view (signed-in):** signed-in readers get a toolbar toggle (default off, persisted) that switches the read view to the unmasked projection (`?agents=1`, `Cache-Control: private, no-store, no-transform`, `Vary: Cookie`). Agent/agent-review blocks render as blueprint cards (dashed border, light desaturated background, `Admin Instruction` / `ID: #…` pill badge, monospace details) via new `AgentBlocksView` + `segmentBodyByAgentBlocks`; blocks sharing an `ID:` pair as start/end with color-coded emerald tags, a dashed bracket margin line around the encapsulated section, and hover shading over it. Palette adapts to dark/light via new CSS tokens. Accept/Reject staging remains draft-only; no mutation capabilities added to the read view.

---

## S5 — complete ✅

- **Status:** complete — implemented, verified, deployed, committed, and pushed
- **Opened:** 2026-09-20
- **Completed:** 2026-09-20
- **Implementation commit:** `a85680f` — "Complete Sprint S5: ETag mutation fix and editing help"
- **Verification:** lint passed; Vitest 97/97 (16 files); production build passed (1608 modules); safe-fixture QA 27/27; `git diff --check` passed; live mutation verifier (`~/.config/kv-microsite/verify-s5-mutations`) **skipped** — script present but never executed; acceptance rests on local test matrix and HTTPS endpoint checks
- **Deployment:** `kv-microsite.service` is active/enabled on loopback with an HTTPS cloudflared tunnel; live acceptance verified strong, weak `W/`, and unquoted ETag variants for saves and ratings
- **Detailed plan:** [`docs/sprint-S5-plan.md`](sprint-S5-plan.md)
- **Decisions:** S5-1 = normalize proxy/browser ETag variants while preserving concurrency contract; S5-2 = editors-only, collapsed-by-default help between File info and Backlinks.
- **Items (2):**
  1. **S5-1 — Fix `invalid_if_match` mutation failures:** `parseIfMatch` now accepts strong quoted, proxy-weak `W/`, unquoted, and re-quoted forms; canonicalizes to lowercase strong token; malformed/wildcard/multi/internal-quote rejected (400); missing precondition stays 428; stale well-formed stays 412; matching writes atomically with fresh ETag. Protected source adds `no-transform`. Client 400/428 errors show friendly retry message and preserve draft.
  2. **S5-2 — Add an "Editing help" box to note view:** `EditingHelp.tsx` rendered in right context column between File info and Backlinks for signed-in editors, collapsed by default. Documents core Markdown, Obsidian wikilinks/aliases/embeds/callouts/tags, `[[`/`#` autocomplete triggers and code suppression, copyable `> [!agent] TARGET: document` template, public masking, external OpenClaw execution, review Accept/Reject draft-only staging, safety, saving, and conflict behavior.

---

## S4 — complete ✅

- **Status:** complete — implemented, verified, deployed, committed, and pushed
- **Opened:** 2026-09-19
- **Completed:** 2026-09-20
- **Implementation commit:** `0cdfceb` — "Complete Sprint S4 secure editing and auth"
- **Verification:** lint passed; Vitest 89/89 (14 files); production build passed (1607 modules); safe-fixture QA 27/27; `git diff --check` passed; live local/HTTPS API security checks and headless-browser UI smoke tests passed
- **Deployment:** `kv-microsite.service` is active/enabled on loopback with an HTTPS cloudflared tunnel; auth/session secrets and encrypted auth state are mode `0600`, outside the vault, and excluded from Git; initial admin bootstrap and read-only authenticated acceptance passed
- **Detailed plan:** [`docs/sprint-S4-plan.md`](sprint-S4-plan.md)
- **Decisions:** S4-5 = textarea + autocomplete (no WYSIWYG); S4-3 = AES-256-GCM encrypted file-only user/session store (no SQLite); S4-6 = site does syntax/mask/stage only, OpenClaw runs AI externally.
- **Security/integrity:** public read projections remain open and mask agent blocks; every mutation is authenticated (admin-gated where applicable); signed HTTP-only/SameSite/Secure sessions are stateful/revocable; writes require ETag/If-Match and inject server-owned UTC `updated`; live acceptance did not mutate real vault notes.
- **Known follow-up:** production audit reports two moderate React Router advisories whose available fix requires a major-version migration; this was not silently forced into S4.
- **Items (6):**
  1. Edit mode: no auto-save; save only on "Save" click; update `updated` date on save
  2. Tag cloud redesign + right-side tag list with counts, sortable by count + alphabetical
  3. Authenticated editing & access control (public read, session-gated writes, admin + multi-user)
  4. Atomic metadata management & concurrency control (ETag/If-Match optimistic locking)
  5. Existing raw Markdown editor + live vault autocomplete for `[[wikilinks]]` / `#tags` (no WYSIWYG in S4)
  6. Embedded AI instruction support (`> [!agent]` syntax, public masking, review staging); AI execution remains external in OpenClaw

---

## S3 — complete ✅

- **Commit:** `3254cda` — "Plan #3: 13 UI/UX fixes — icon library, image rendering, search, button system"
- **Items (13):**
  1. Replace native `alert()`/`confirm()` with inline delete-confirm + create-error UI
  2. Branded "Document not found" card + primary "Back to home"
  3. Skeleton loader instead of "Loading document…"
  4. `height:100vh` → `100dvh` (iOS address-bar jump)
  5. Base font 14px → 15px, bump smallest 11–12px text one notch
  6. Unified button system (single primary + secondary)
  7. Icon library (lucide-react) replaces mixed emoji/glyph icons
  8. Consistent radius scale via `--radius-sm/md/lg/pill` tokens
  9. Settings: separate stacked cards (Vault/Index/Theme/About)
  10. Graph: optical centring (`preserveAspectRatio`) + controls reconnected to toolbar
  11. Search: empty-state example-query chips
  12. Header search bar reads `?q=` param on arrival (was showing no results)
  13. Standard markdown images `![alt](path)` resolve relative to note folder → `/api/raw/`

---

## S2 — complete ✅

- **Commit:** `d77e1dc` — "Fix 11-item plan"
- **Items (11):**
  1. Edit conflict: use server `contentHash` (SHA-256) baseline (was FNV vs SHA-256 mismatch)
  2. Home page tags clickable → filter notes by tag
  3. Header search bar
  4. Timeline dates never wrap/truncate
  5. Settings "Last indexed" labels never wrap (desktop + mobile)
  6. Remove "saved to frontmatter" rating-bar hint
  7. Read mode: strip frontmatter → title → collapsible metadata → body
  8. Right "File info" panel always expanded
  9. Wiki links `[[Page]]` render as clickable links (regex char-class bug)
  10. Tags word cloud (random placement, size ∝ count, multi-hue palette)
  11. Graph: Fruchterman-Reingold layout + fit-to-view (fix single-blob collapse)

---

## S1 — complete ✅

- **Commit:** `15c018b` — "Doug KX: 13-item UI/UX pass"
- **Items (13):**
  1. Safari-safe knowledge graph (removed CSS `filter`, explicit viewBox, wheel/pinch)
  2. System theming (OS light/dark live)
  3. Mobile responsive (hamburger, slide-in sidebar, stacked panels, scrollable tables)
  4. Home overlap fix (tags no longer collide with titles)
  5. Home quick links (Open Home Note / Knowledge Map / Graph)
  6. Collapsible file-info (frontmatter) section
  7. Clickable wiki + markdown links (folder resolution fix)
  8. Edit-mode markdown legend
  9. Settings index status/stats + "Re-index now"
  10. Page rating bar
  11. Graph features (zoom/pan, node size, colour, hover, neighbours, search, legend)
  12. Tag cloud (size + colour by frequency)
  13. Branding: compass favicon + site renamed "Doug KX"
