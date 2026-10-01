---
name: Doug KX
description: A web-visible knowledge base over a real Obsidian vault — an agent curates, a human approves.
colors:
  obsidian-bg: "#0f1115"
  panel-bg: "#161a21"
  card-bg: "#1b2029"
  hairline: "#2a3140"
  ink: "#e6e9ef"
  ink-dim: "#9aa3b2"
  signal-blue: "#4f8cff"
  signal-blue-soft: "#1f293f"
  control-surface: "#232a37"
  control-border: "#3a4357"
  success: "#37c877"
  warning: "#e0a63a"
  danger: "#e2574f"
  on-accent: "#ffffff"
  warn-ink: "#241a05"
  scrim: "rgba(0, 0, 0, 0.5)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.4px"
  small:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  nano:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.4px"
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  stat:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  prose-h1:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 700
  prose-h2:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
  prose-h3:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  rank:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
  cloud:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(0.9rem, 1.8rem, 2.8rem)"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-secondary:
    backgroundColor: "{colors.control-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.card-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.card-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  chip:
    backgroundColor: "{colors.signal-blue-soft}"
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  nav-item-active:
    backgroundColor: "{colors.signal-blue-soft}"
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: Doug KX

## Overview

**Creative North Star: "The Polished Instrument"**

Doug KX is a working instrument, not a showcase. It is a knowledge-operating surface laid over a real Obsidian vault: an agent proposes and a human approves, and the interface exists to make that loop fast, legible, and trustworthy. The visual world is dark-first — a near-black canvas with a single blue signal accent — because the tool is used for long, focused sessions where the content, not the chrome, must hold attention.

The voice is **authoritative**: precise, quiet, and unhedged. The interface states what is true (what changed, what is orphaned, what is pending approval) without decoration or apology. Every affordance earns its place; nothing is ornamental. Density is high but never crowded, because structure — hairlines, tonal layering, and a strict accent budget — carries the hierarchy that ornament would otherwise be asked to do.

Components feel **refined and restrained**: quiet controls that recede so the content is the interface. Depth is deliberately shallow — surfaces are flat at rest and separated by 1px low-contrast hairlines and tonal steps, not by heavy shadows. Shadow is reserved for genuinely floating layers (menus, the command palette, popovers) so that "raised" always means "temporarily above the document." The result reads as a precision tool: calm, ordered, and dependable under the hand.

**Key Characteristics:**
- Dark-first, near-black canvas with one blue signal accent.
- Authoritative, low-noise voice: state facts, skip decoration.
- Refined and restrained controls that recede behind the content.
- Flat by default; hairlines and tone create structure, shadows only for floating layers.
- One accent used sparingly — its rarity is what makes it a signal.
- Native system type; no webfonts, no waiting, no drift.

## Colors

A near-black neutral ramp carries the entire interface; a single blue accent marks action and selection, and three semantic hues (success / warning / danger) mark state.

### Primary
- **Signal Blue** (#4f8cff): The one accent. Primary buttons, active nav, links, selection outlines, focus rings, and the `primary` action in every toolbar. It is a *signal*, not a surface — used to say "this is interactive" or "this is current," never as decoration.
- **Signal Blue Soft** (#1f293f): The accent's low-key companion. Fills selected chips, active nav rows, and selected tag rows where a full accent fill would shout. Pairs with Signal Blue text for ~4.5:1 contrast on the dark canvas.

### Neutral
- **Obsidian Canvas** (#0f1115): The app background — the deepest surface, behind everything.
- **Panel** (#161a21): Secondary surface for the sidebar body, property panels, and embed backgrounds; one tonal step up from the canvas.
- **Card** (#1b2029): Raised content surface for cards, inputs, and stat tiles; the "material" the user reads and edits on.
- **Hairline** (#2a3140): The 1px border used on essentially every bounded surface. Structure comes from this line and the tonal step, not from shadow.
- **Ink** (#e6e9ef): Primary text. Near-white, deliberately short of pure white to reduce glare on the dark canvas.
- **Ink Dim** (#9aa3b2): Secondary text — metadata, breadcrumbs, counts, placeholders. Verified ≥4.5:1 on both card and canvas.

### Semantic (state, not decoration)
- **Success** (#37c877): Applied / finished agent states, positive health.
- **Warning** (#e0a63a): Pending approval, conflicts, "heads-up" states — the review gate lives here.
- **Danger** (#e2574f): Rejected / failed states and destructive actions (delete, move).

### Control surfaces
- **Control Surface** (#232a37) / **Control Border** (#3a4357): The resting fill and border of secondary (non-primary) buttons — a slightly lifted neutral so controls read as controls without borrowing the accent.
- **On-Accent** (#ffffff): The text/icon color *on top of* Signal Blue (primary button labels, badge text). Never used as a background or on the neutral canvas.
- **Warn Ink** (#241a05): The dark text color used on Warning fills (the override button), chosen for contrast against the amber.
- **Scrim** (`rgba(0, 0, 0, 0.5)`): The full-viewport dimmer behind the command palette and the mobile sidebar drawer. A near-black wash, never a colored overlay.

**Light theme.** Every token above has a light-theme counterpart under `html[data-theme='light']`: canvas `#f6f7fa`, panel/card `#ffffff`, hairline `#e1e5ec`, ink `#1c2230`, ink-dim `#5c6371`, accent `#2a63cd`, accent-soft `#e0eafb`, control surface `#f1f3f7` / border `#c9d0dc`. The dark set is the canonical source in the frontmatter; the light set mirrors it token-for-token.

**The One Signal Rule.** The accent appears on ≤10% of any given screen. Its scarcity is the point — if everything is blue, nothing is.

**The Hairline Rule.** Structure is drawn with 1px hairlines and tonal steps, never with heavy strokes or fills. If a region needs to separate from its neighbor, change its tone or add a hairline — do not reach for a shadow.

## Typography

**Body Font:** system UI stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`) at a 15px base
**Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` at 13px

**Character:** The type is the operating system's own voice — native, immediate, and invisible. There is no webfont, no FOUT, no brand letterform; the interface loads instantly and reads as an extension of the machine it runs on. Mono appears only where a machine value is being shown literally: code, paths, IDs, and frontmatter.

### Hierarchy
- **Display** (700, 22px, 1.25): Page titles — the single `<h1>` per view ("Dashboard", "Notes", a document title). Establishes the page without competing with content.
- **Title** (600, 15px, 1.4): Card and section headings (`h2`), toolbar labels. Same size as body, differentiated by weight — hierarchy by weight, not scale.
- **Body** (400, 15px, 1.5): The default text size for the entire interface, including controls. Rendered Markdown follows the same base with its own internal scale (h1 26px → h3 16px).
- **Label** (600, 12–13px, tracking 0.4px, uppercase where structural): Metadata, counts, section eyebrows, breadcrumbs, status pills. Uppercase is reserved for true section labels, not for emphasis.
- **Mono** (400, 13px): Code blocks, inline code, file paths, and machine identifiers.

### Rendered prose scale

Markdown rendered in the reading view and the article view uses its own internal scale, independent of the UI hierarchy above — sized for comfortable long-form reading on the same 15px base:

- **Prose H1** (700, 26px): Document title in the reading/article view, closed by a 1px hairline underline.
- **Prose H2** (700, 20px): Section headings inside a document.
- **Prose H3** (600, 16px): Subsection headings inside a document.

Small-format sizes fill the gaps where 13px is still too large: **Body-sm** (400, 14px) for embed note bodies, **Small** (400, 12px) for chips and counts, **Micro** (400, 11px) for caret hints, and **Nano** (600, 10px, uppercase) for the smallest badges and matched-field markers. The **Stat** size (700, 24px) is reserved for the dashboard figure value, and **Rank** (700, 18px) for the Knowledge Health rank figure.

The **tag cloud** is the one data-driven type exception: chip size is computed from tag frequency on a fluid scale (`clamp(0.9rem, 1.8rem, 2.8rem)`), so the cloud's visual weight encodes frequency directly. This is the only place type size varies with data rather than role.

**The Native Type Rule.** No webfonts. The system UI font is the interface; adding a display face would add latency and break the tool's native immediacy.

**The Weight-Not-Size Rule.** Section headings stay at 15px and separate themselves by weight (600) and color, not by growing. Only the page title earns a larger size.

## Layout

A fixed two-column shell: a persistent left **sidebar** (vault identity, nav, footer) and a scrolling **main** column, height-locked to the viewport (`100dvh`). The sidebar owns navigation; the main column owns content and never scrolls the whole page — only the content region scrolls.

Content sits in a centered column capped at **1000px** (the document view relaxes to **1100px** for reading and editing), padded `20px 24px`. Collections flow into auto-fitting grids rather than fixed columns: stat tiles at `minmax(120px, 1fr)`, dashboard columns at `minmax(280px, 1fr)`, tag layouts at `minmax(0,1fr) minmax(230px,300px)`.

Spacing follows a small, consistent rhythm — `4 / 8 / 12 / 16 / 24px` — applied through flex `gap` and grid `gap` rather than per-element margins, so density stays even. Two breakpoints collapse the layout: **860px** and **760px**, where multi-column grids fold to a single column and the tag cloud stops scaling.

**The Scroll-Once Rule.** The page frame never scrolls; exactly one region inside it does. Navigation and identity stay put while content moves.

## Elevation & Depth

This system is **flat by default**. Depth is conveyed by tonal layering (canvas → panel → card) and 1px hairlines, not by shadow. Shadows exist, but they are reserved for elements that are genuinely floating *above* the document — menus, the command palette, search-result popovers, and toasts — so that a shadow always carries the same meaning: "this is temporarily above the page."

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 12px 30px rgba(0,0,0,.35)`): Dropdown menus and autocomplete panels.
- **Search results** (`box-shadow: 0 10px 30px rgba(0,0,0,0.3)`): The graph/search result list floating over content.
- **Palette** (`box-shadow: 0 20px 60px rgba(0,0,0,0.5)`): The command palette — the deepest layer, deliberately the most separated.
- **Overlay** (`box-shadow: 0 0 40px rgba(0,0,0,0.4)`): Modal/dialog backdrop glow.
- **Floating** (`box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35)`) and **Floating LG** (`box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4)`): Draggable/raised interactive surfaces and the block toolbar.

**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow appears only when an element leaves the document flow — never to decorate a card that is simply sitting in the page.

## Shapes

The form language is **gently rounded and precisely bounded**. Corners are soft but restrained, scaled to the element's size, and every bounded surface is closed by a 1px hairline.

- **Inline tokens** (inline code, tiny badges): `4px` (`--radius-xs`).
- **Controls** (buttons, inputs, chips-within-fields): `6px` (`--radius-sm`).
- **Cards and panels**: `10px` (`--radius`).
- **Large floating panels** (command palette): `14px` (`--radius-lg`).
- **Chips / pills**: fully round, `999px` (`--radius-pill`) — reserved for tag chips and status pills, where the pill shape signals "a discrete, dismissible token."

Borders are always 1px; nothing uses a 2px+ stroke except transient state outlines (a 2px accent `outline` for focus and selection, offset so it never reflows the element).

**The Pill-Is-A-Token Rule.** Fully round shapes are reserved for discrete tokens — tags and statuses. Buttons, cards, and inputs never use the pill radius; their soft-cornered rectangle is what says "control" or "container."

## Components

### Buttons
- **Shape:** Soft-cornered rectangle (`6px`).
- **Primary:** Signal Blue fill, white text, matching border, `6px 12px` padding. One primary per view region — it is the single "do the thing" action (approve, save, create).
- **Secondary (default):** Control Surface fill (`#232a37`), Control Border hairline, Ink text. Everything that isn't the one primary action.
- **Hover / Focus:** Secondary buttons shift background and take an accent border on hover; primary brightens (`filter: brightness(1.08)`). Active state presses down 1px (`translateY(1px)`) for a tactile click. Focus uses a 2px accent outline with offset.
- **Disabled:** 50% opacity, `not-allowed` cursor. No color shift.

### Cards / Containers
- **Corner Style:** `10px`.
- **Background:** Card (`#1b2029`).
- **Border:** 1px Hairline (`#2a3140`) — always, on all four sides.
- **Shadow Strategy:** None at rest (see Elevation). Cards are flat.
- **Internal Padding:** `16px`.

### Inputs / Fields
- **Style:** Card fill, 1px hairline, `6px` radius, `8px 10px` padding (compact header/search fields use `4px 10px`).
- **Focus:** 2px accent outline with a 1px offset; the border shifts to accent. No glow, no shadow.
- **Placeholder / Dim:** Ink Dim for placeholder and helper text.

### Navigation
- **Style:** A vertical flex column of rows in the sidebar (`2px` gap), each a `6px`-radius row with a 10px icon gap.
- **Default:** Ink Dim text, transparent background — nav recedes until it's current.
- **Hover:** Panel-toned background, Ink text.
- **Active:** Signal Blue Soft fill with Signal Blue text — the accent's low-key mode, not a full accent block.
- **Mobile:** Below 760px the multi-column layouts fold; the shell collapses to a single column.

### Chips / Tags
- **Style:** Signal Blue Soft background, Signal Blue text, pill radius, `1px 8px` padding, 12px type.
- **State:** Selected tag rows use the same soft-accent pairing; the visual tag cloud uses a 2px accent outline (offset 3px) rather than a fill, so the cloud keeps its shape.

### Stats (signature)
- **Shape:** Card surface, `10px` radius.
- **Content:** A 24px/700 value over a 13px Ink Dim label — the "at a glance" numbers on the dashboard and Knowledge Health panel. Pairs a large number with a quiet label so the figure reads first.

## Do's and Don'ts

### Do:
- **Do** keep the accent to ≤10% of a screen — buttons, links, active nav, and selection only (**The One Signal Rule**).
- **Do** build structure from 1px hairlines and tonal steps (canvas → panel → card) before reaching for any other separator (**The Hairline Rule**).
- **Do** reserve shadows for genuinely floating layers; a card at rest is flat (**The Flat-By-Default Rule**).
- **Do** use the system UI font and let weight (600) carry section hierarchy instead of size (**The Native Type Rule**, **The Weight-Not-Size Rule**).
- **Do** match radius to role: `6px` controls, `10px` cards, `14px` large panels, `999px` chips.
- **Do** use the semantic hues only for state (success / warning / danger) — never as decorative color.

### Don't:
- **Don't** introduce a webfont, a display face, or any typeface beyond the system UI and mono stacks.
- **Don't** use the pill radius on buttons, cards, or inputs — round means "token," not "control."
- **Don't** add a shadow to an element that is not floating above the document.
- **Don't** use the accent as a fill for large surfaces or as decoration; it marks interaction and current state only.
- **Don't** replace hairline separation with heavy strokes, thick borders, or filled dividers.
- **Don't** invent additional accent hues — one signal color, plus the three semantic states.
