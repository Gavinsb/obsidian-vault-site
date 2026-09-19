# Sprint History

Durable record of every sprint on this project. A **sprint** is a
*collect → plan → build* cycle over the Obsidian vault microsite ("Doug KX").

This file exists so any agent (or human) can see what changed, when, and why,
without reading the raw git log. Each sprint has a sequential reference id
(`S1`, `S2`, …). Items within a sprint are numbered `1..n` and referenceable
as e.g. `S4-3`.

---

## S4 — current sprint

- **Status:** collecting (open)
- **Opened:** 2026-09-19
- **Items:** awaiting first item

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
