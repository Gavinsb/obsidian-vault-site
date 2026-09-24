/**
 * S7-10 — slash menu model.
 *
 * The slash menu is a *text substitution* system: every entry resolves to a
 * plain Markdown scaffold that replaces the `/query` token the user typed at
 * the start of an empty block. No schema, no AST — the inserted string is the
 * new source, and everything around the token survives byte-identically.
 *
 * Pure by design: the CM6 layer (`src/client/components/slash-menu.ts`) and the
 * React overlay (`SlashMenu.tsx`) only consume this module, so the scaffold
 * table can be asserted exactly in tests.
 */
import {
  formatAgentHeader,
  generateAgentId,
  type AgentHeaderType,
} from "./agent-status.js";

/**
 * Caret placeholder used inside scaffold text. `insertScaffold()` removes it
 * and reports where the caret should land; nothing else ever sees the byte.
 */
export const SLASH_CARET = "\u0000";

/** Categories the spec requires the menu to cover (§4.2, §8). */
export type ScaffoldCategory =
  | "CommonMark"
  | "Callout"
  | "Embed"
  | "Properties"
  | "Tag"
  | "Task"
  | "Mermaid"
  | "Agent";

/** Values the agent scaffolds need; supplied by the editor, faked in tests. */
export interface ScaffoldContext {
  agentId?: string;
  target?: string;
}

export interface Scaffold {
  id: string;
  label: string;
  category: ScaffoldCategory;
  hint: string;
  /** Extra search terms (the label itself always matches). */
  keywords: string[];
  /** Raw scaffold text; may contain exactly one {@link SLASH_CARET}. */
  text: string;
}

/**
 * The full registry. Order is the menu's default order: the CommonMark basics
 * first, then the Obsidian/ Doug KX-native block types.
 */
export const SCAFFOLDS: readonly Scaffold[] = Object.freeze([
  { id: "text", label: "Text", category: "CommonMark", hint: "Plain paragraph", keywords: ["paragraph", "body"], text: "" },
  { id: "h1", label: "Heading 1", category: "CommonMark", hint: "#", keywords: ["h1", "title"], text: "# " },
  { id: "h2", label: "Heading 2", category: "CommonMark", hint: "##", keywords: ["h2", "section"], text: "## " },
  { id: "h3", label: "Heading 3", category: "CommonMark", hint: "###", keywords: ["h3", "subsection"], text: "### " },
  { id: "bulleted", label: "Bulleted list", category: "CommonMark", hint: "-", keywords: ["ul", "bullet", "unordered"], text: "- " },
  { id: "numbered", label: "Numbered list", category: "CommonMark", hint: "1.", keywords: ["ol", "ordered", "number"], text: "1. " },
  { id: "quote", label: "Quote", category: "CommonMark", hint: ">", keywords: ["blockquote"], text: "> " },
  { id: "code", label: "Code block", category: "CommonMark", hint: "```", keywords: ["fence", "pre"], text: `\`\`\`\n${SLASH_CARET}\n\`\`\`` },
  { id: "divider", label: "Divider", category: "CommonMark", hint: "---", keywords: ["hr", "rule", "separator"], text: "---\n" },
  { id: "callout", label: "Callout", category: "Callout", hint: "> [!type]", keywords: ["admonition", "note", "warning"], text: `> [!note] ${SLASH_CARET}` },
  { id: "embed-note", label: "Embed note", category: "Embed", hint: "![[Note]]", keywords: ["transclusion", "include"], text: `![[${SLASH_CARET}]]` },
  { id: "embed-block", label: "Embed block", category: "Embed", hint: "![[#^id]]", keywords: ["transclusion", "block ref"], text: `![[#^${SLASH_CARET}]]` },
  { id: "properties", label: "Properties", category: "Properties", hint: "YAML frontmatter", keywords: ["frontmatter", "yaml", "meta"], text: `---\n${SLASH_CARET}\n---\n` },
  { id: "tag", label: "Tag", category: "Tag", hint: "#tag", keywords: ["hashtag", "label"], text: `#${SLASH_CARET}` },
  { id: "task", label: "Task", category: "Task", hint: "- [ ]", keywords: ["todo", "checkbox", "to-do"], text: `- [ ] ${SLASH_CARET}` },
  { id: "mermaid", label: "Mermaid diagram", category: "Mermaid", hint: "```mermaid", keywords: ["diagram", "flowchart", "graph"], text: `\`\`\`mermaid\nflowchart TD\n  ${SLASH_CARET}A --> B\n\`\`\`` },
  { id: "agent-instruction", label: "Agent instruction", category: "Agent", hint: "> [!agent]", keywords: ["task", "instruction", "agent"], text: "" },
  { id: "agent-review", label: "Agent review", category: "Agent", hint: "> [!agent-review]", keywords: ["review", "proposal", "agent"], text: "" },
]);

const SCAFFOLD_BY_ID: ReadonlyMap<string, Scaffold> = new Map(
  SCAFFOLDS.map((scaffold) => [scaffold.id, scaffold]),
);

function agentHeader(type: AgentHeaderType, ctx: ScaffoldContext): string {
  const id = ctx.agentId ?? generateAgentId([]);
  const target = ctx.target ?? "document";
  return type === "agent"
    ? formatAgentHeader("agent", { status: "new", id, target })
    : formatAgentHeader("agent-review", { id });
}

/** Categories in the order the menu groups them (spec §4.2 / §8). */
export const SCAFFOLD_CATEGORIES: readonly ScaffoldCategory[] = Object.freeze([
  "CommonMark",
  "Callout",
  "Embed",
  "Properties",
  "Tag",
  "Task",
  "Mermaid",
  "Agent",
]);

/**
 * Exact scaffold text for `id`, with the caret marker left in place. Agent
 * scaffolds are canonical `formatAgentHeader()` output so the slash menu can
 * never invent a header spelling the validator/profile rejects.
 */
export function scaffoldText(id: string, ctx: ScaffoldContext = {}): string | null {
  if (id === "agent-instruction") {
    return `${agentHeader("agent", ctx)}\n> ${SLASH_CARET}`;
  }
  if (id === "agent-review") {
    return `${agentHeader("agent-review", ctx)}\n> ${SLASH_CARET}`;
  }
  const scaffold = SCAFFOLD_BY_ID.get(id);
  return scaffold ? scaffold.text : null;
}

/**
 * Score a scaffold against a query. Prefix > word-boundary > substring, with
 * the label outranking keywords; ties keep registry order.
 */
export function scoreScaffold(scaffold: Scaffold, query: string): number {
  const q = query.toLowerCase();
  if (!q) return 1;
  const label = scaffold.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  const words = label.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => word.startsWith(q))) return 80;
  if (label.includes(q)) return 60;
  if (scaffold.id.startsWith(q)) return 50;
  if (scaffold.keywords.some((word) => word.toLowerCase().startsWith(q))) return 40;
  if (scaffold.hint.toLowerCase().includes(q)) return 20;
  return 0;
}

/** Filtered + ranked scaffolds for a menu query (`""` returns all). */
export function filterScaffolds(
  query: string,
  scaffolds: readonly Scaffold[] = SCAFFOLDS,
): Scaffold[] {
  return scaffolds
    .map((scaffold, index) => ({ scaffold, index, score: scoreScaffold(scaffold, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.scaffold);
}

export interface SlashTrigger {
  /** Offset of the `/` token start (the span the scaffold replaces). */
  from: number;
  /** Caret offset — the end of the span. */
  to: number;
  /** Characters typed after the `/`. */
  query: string;
}

function fencedAt(source: string, pos: number): boolean {
  const before = source.slice(0, pos);
  const lines = before.split(/\r?\n/);
  let fence: string | null = null;
  for (const line of lines.slice(0, -1)) {
    const m = /^\s*(```|~~~)/.exec(line);
    if (m) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : m[1];
  }
  return fence !== null;
}

/**
 * Resolve a slash trigger at `pos`: `/` at the start of an otherwise empty
 * block, optionally followed by a non-space query. Returns null inside fenced
 * code or anywhere the `/` is not block-leading.
 */
export function resolveSlashTrigger(source: string, pos: number): SlashTrigger | null {
  if (pos < 0 || pos > source.length) return null;
  if (fencedAt(source, pos)) return null;
  const lineStart = Math.max(source.lastIndexOf("\n", pos - 1) + 1, 0);
  const line = source.slice(lineStart, pos);
  const match = /^([ \t]*)\/([^\s/]*)$/.exec(line);
  if (!match) return null;
  const from = lineStart + match[1].length;
  return { from, to: pos, query: match[2] };
}

export interface ScaffoldInsertion {
  /** Scaffold text with the caret marker removed. */
  text: string;
  /** Where the caret should land, relative to the start of `text`. */
  caretOffset: number;
}

/** Resolve a scaffold to its insertion text and caret offset. */
export function scaffoldInsertion(
  id: string,
  ctx: ScaffoldContext = {},
): ScaffoldInsertion | null {
  const raw = scaffoldText(id, ctx);
  if (raw === null) return null;
  const markerAt = raw.indexOf(SLASH_CARET);
  const text = raw.split(SLASH_CARET).join("");
  return { text, caretOffset: markerAt < 0 ? text.length : markerAt };
}

/**
 * Replace the `[from, to)` slash token with the scaffold for `id`. A single
 * text-range splice; surrounding bytes are untouched. Returns null for an
 * unknown id.
 */
export function insertScaffold(
  source: string,
  from: number,
  to: number,
  id: string,
  ctx: ScaffoldContext = {},
): { source: string; cursor: number } | null {
  const insertion = scaffoldInsertion(id, ctx);
  if (!insertion) return null;
  return {
    source: source.slice(0, from) + insertion.text + source.slice(to),
    cursor: from + insertion.caretOffset,
  };
}
