/**
 * S7-11 — block manipulation.
 *
 * All block math comes from `detectBlocks()` ranges; nothing here re-parses
 * Markdown. Every operation resolves to a set of *text-range splices* that the
 * client dispatches as exactly one CM6 transaction, so native undo restores
 * the exact source and the document around the operation stays byte-identical.
 */
import { type BlockRange } from "./block-detect.js";
import { SLASH_CARET, type ScaffoldContext } from "./slash-menu.js";
import { formatAgentHeader } from "./agent-status.js";

/** One replacement in the original document's coordinates. */
export interface BlockChange {
  from: number;
  to: number;
  insert: string;
}

export interface AppliedEdit {
  source: string;
  /** Caret position in the new source (when the caller wants to place one). */
  cursor: number;
}

/** Where a dropped block lands relative to its target. Left/right are excluded. */
export type DropZone = "before" | "after" | "nest";

export const DROP_ZONES: readonly DropZone[] = Object.freeze(["before", "after", "nest"]);

/* ------------------------------------------------------------------ *
 * Block selection helpers                                             *
 * ------------------------------------------------------------------ */

function strictlyContains(outer: BlockRange, inner: BlockRange): boolean {
  return (
    outer.start <= inner.start &&
    outer.end >= inner.end &&
    (outer.start < inner.start || outer.end > inner.end)
  );
}

/**
 * Outermost blocks: drop the nested children (list items, callout bodies) so
 * operations act on the block the user sees, not its internals.
 */
export function outermostBlocks(blocks: readonly BlockRange[]): BlockRange[] {
  return blocks.filter(
    (block) => !blocks.some((other) => other !== block && strictlyContains(other, block)),
  );
}

/**
 * The outermost blocks touched by a source range. Used by the multi-block
 * selection so the snapped range always starts/ends on a block boundary and
 * can never split a block in half.
 */
export function blocksInRange(
  blocks: readonly BlockRange[],
  from: number,
  to: number,
): BlockRange[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return outermostBlocks(blocks).filter((block) => block.start < hi && block.end > lo);
}

/** Snap a selection to the block boundaries of everything it touches. */
export function selectionSpan(
  blocks: readonly BlockRange[],
  from: number,
  to: number,
): { anchor: number; head: number } | null {
  const touched = blocksInRange(blocks, from, to);
  if (touched.length === 0) return null;
  const first = touched[0];
  const last = touched[touched.length - 1];
  return { anchor: first.start, head: last.end };
}

/** A contiguous run of blocks (no gaps larger than the blank lines between). */
export function isContiguous(blocks: readonly BlockRange[]): boolean {
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].start < blocks[i - 1].end) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Splice planning                                                     *
 * ------------------------------------------------------------------ */

/** Length of the run of blank lines starting at `at`. */
function blankRunAfter(source: string, at: number): number {
  const match = /^(?:[ \t]*\r?\n)+/.exec(source.slice(at));
  return match ? match[0].length : 0;
}

/**
 * Move a contiguous selection of blocks relative to `target`.
 *
 * The moved span absorbs the blank lines that followed it, so the result is
 * well-formed Markdown (a list is never left lazily glued to the paragraph
 * that follows) and the bytes outside the operation are untouched.
 */
export function planReorder(
  source: string,
  moving: readonly BlockRange[],
  target: BlockRange,
  zone: DropZone,
): BlockChange[] {
  if (moving.length === 0 || !isContiguous(moving)) return [];
  const first = moving[0];
  const last = moving[moving.length - 1];
  // Dropping a block onto itself (or its own span) is a no-op.
  if (target.start >= first.start && target.end <= last.end) return [];

  const core = source.slice(first.start, last.end);
  const gapLength = blankRunAfter(source, last.end);
  const separator = gapLength > 0 ? source.slice(last.end, last.end + gapLength) : "\n";
  const removeTo = last.end + gapLength;

  let at: number;
  let insert: string;
  if (zone === "nest") {
    // Nest: directly after the target's first line, so the moved block becomes
    // that block's child (list items nest, quotes gain a nested body).
    const newline = source.indexOf("\n", target.start);
    at = newline === -1 ? target.end : newline + 1;
    insert = indentBlock(core);
  } else if (zone === "before") {
    at = target.start;
    insert = core + separator;
  } else {
    at = target.end;
    insert = separator + core;
  }
  if (at >= first.start && at <= removeTo) return [];
  return [
    { from: first.start, to: removeTo, insert: "" },
    { from: at, to: at, insert },
  ];
}

/** Indent every non-empty line by two spaces (nesting a dropped block). */
export function indentBlock(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split(/(?<=\n)/)
    .map((line) => (line.trim().length === 0 ? line : pad + line))
    .join("");
}

/** Delete the selected blocks (one splice, from first start to last end). */
export function planDeleteBlocks(moving: readonly BlockRange[]): BlockChange[] {
  if (moving.length === 0 || !isContiguous(moving)) return [];
  const first = moving[0];
  const last = moving[moving.length - 1];
  return [{ from: first.start, to: last.end, insert: "" }];
}

/** Duplicate the selected blocks directly after themselves. */
export function planDuplicateBlocks(
  source: string,
  moving: readonly BlockRange[],
): BlockChange[] {
  if (moving.length === 0 || !isContiguous(moving)) return [];
  const first = moving[0];
  const last = moving[moving.length - 1];
  const text = source.slice(first.start, last.end);
  return [{ from: last.end, to: last.end, insert: text }];
}

/** Copy as Markdown never mutates the document. */
export function blockMarkdown(source: string, block: BlockRange): string {
  return source.slice(block.start, block.end);
}

/**
 * Turn one block's text into another type. Pure string substitution — no
 * schema, no AST: the caller splices the result over the block's range.
 */
export type TurnIntoId =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bulleted"
  | "numbered"
  | "todo"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "agent"
  | "agent-review";

export interface TurnIntoOption {
  id: TurnIntoId;
  label: string;
}

/** Menu order mirrors the block context menu in the spec (§4.2). */
export const TURN_INTO_OPTIONS: readonly TurnIntoOption[] = Object.freeze([
  { id: "paragraph", label: "Paragraph" },
  { id: "h1", label: "Heading 1" },
  { id: "h2", label: "Heading 2" },
  { id: "h3", label: "Heading 3" },
  { id: "bulleted", label: "Bulleted list" },
  { id: "numbered", label: "Numbered list" },
  { id: "todo", label: "To-do" },
  { id: "toggle", label: "Toggle" },
  { id: "quote", label: "Quote" },
  { id: "callout", label: "Callout" },
  { id: "code", label: "Code block" },
  { id: "agent", label: "Agent instruction" },
  { id: "agent-review", label: "Agent review" },
]);

/** Split raw block text into bare lines, remembering CRLF/LF and finality. */
function splitLines(text: string): { lines: string[]; ending: string; trailing: boolean } {
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.endsWith("\n")
    ? text.slice(0, text.endsWith("\r\n") ? -2 : -1)
    : text;
  const lines = body.length === 0 ? [] : body.split(/\r?\n/);
  return { lines, ending, trailing: text.endsWith("\n") };
}

type LineFamily = "heading" | "task" | "bullet" | "ordered" | "quote" | "plain";

/** Indentation + marker family, used to find a block's sibling lines. */
export function lineFamily(line: string): { indent: string; family: LineFamily } {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  const rest = line.slice(indent.length);
  if (/^>/.test(rest)) return { indent, family: "quote" };
  if (/^#{1,6}[ \t]/.test(rest)) return { indent, family: "heading" };
  if (/^[-*+][ \t]+\[[^\]\r\n]\][ \t]/.test(rest)) return { indent, family: "task" };
  if (/^[-*+][ \t]/.test(rest)) return { indent, family: "bullet" };
  if (/^\d+[.)][ \t]/.test(rest)) return { indent, family: "ordered" };
  return { indent, family: "plain" };
}

/** Strip every leading block marker from one line, keeping its indentation. */
export function stripBlockMarker(line: string): string {
  let text = line;
  for (;;) {
    const quote = /^[ \t]*>[ \t]?/.exec(text);
    if (!quote) break;
    text = text.slice(quote[0].length);
  }
  const callout = /^\[![^\]\r\n]+\][+-]?[ \t]*/.exec(text);
  if (callout) text = text.slice(callout[0].length);
  text = text.replace(/^#{1,6}[ \t]+/, "");
  text = text.replace(/^[-*+][ \t]+\[[^\]\r\n]\][ \t]+/, "");
  text = text.replace(/^[-*+][ \t]+/, "");
  text = text.replace(/^\d+[.)][ \t]+/, "");
  return text;
}

function firstLineMarker(target: TurnIntoId): string {
  switch (target) {
    case "paragraph":
      return "";
    case "h1":
      return "# ";
    case "h2":
      return "## ";
    case "h3":
      return "### ";
    case "bulleted":
      return "- ";
    case "numbered":
      return "1. ";
    case "todo":
      return "- [ ] ";
    case "toggle":
      return "- ";
    case "quote":
      return "> ";
    case "callout":
      return "> [!note] ";
    default:
      return "";
  }
}

function agentHeaderText(type: TurnIntoId, ctx: ScaffoldContext): string {
  const id = ctx.agentId ?? "AAAAAA";
  const target = ctx.target ?? "document";
  return type === "agent"
    ? formatAgentHeader("agent", { status: "new", id, target })
    : formatAgentHeader("agent-review", { id });
}

/**
 * Convert a block's raw text to `target`.
 *
 * Rules (documented so the tests can assert them):
 * - only the block's own bytes change;
 * - the leading marker of the first line is replaced with the target's;
 * - quote/callout/agent targets re-prefix every line of the block;
 * - leaving a quote/callout strips the quote markers from every line;
 * - `code` wraps the block and drops the first-line marker only.
 */
export function turnIntoBlockText(
  text: string,
  target: TurnIntoId,
  ctx: ScaffoldContext = {},
): string {
  const { lines, ending, trailing } = splitLines(text);
  if (lines.length === 0) return text;
  const rebuild = (out: string[]) => {
    const joined = out.join(ending);
    return trailing ? joined + ending : joined;
  };

  const wasQuoted = /^[ \t]*>/.test(lines[0]);

  if (target === "code") {
    const body = lines.map((line, index) => (index === 0 ? stripBlockMarker(line) : line));
    return rebuild(["```", ...body, "```"]);
  }

  if (target === "agent" || target === "agent-review") {
    const body = lines.map(stripBlockMarker);
    const quoted = body.map((line) => (line.length ? `> ${line}` : ">"));
    return rebuild([agentHeaderText(target, ctx), ...quoted]);
  }

  const isQuoteTarget = target === "quote" || target === "callout";
  if (wasQuoted || isQuoteTarget) {
    const body = lines.map(stripBlockMarker);
    // Leaving a quote for a non-quote target still applies that target's
    // first-line marker (e.g. `> [!note] item` → `## item`).
    const head =
      target === "callout"
        ? "> [!note] "
        : isQuoteTarget
          ? "> "
          : firstLineMarker(target);
    const out = body.map((line, index) => {
      if (index === 0) return head + line;
      if (!isQuoteTarget) return line;
      return line.length ? `> ${line}` : ">";
    });
    return rebuild(out);
  }

  // Sibling lines: same indentation and marker family as the block's first
  // line. Nested children keep their own markers, so nesting survives.
  const { indent, family } = lineFamily(lines[0]);
  const isSibling = (line: string) => {
    const info = lineFamily(line);
    return info.indent === indent && info.family === family;
  };
  const listTarget =
    target === "bulleted" || target === "numbered" || target === "todo" || target === "toggle";
  const out = [...lines];
  let ordinal = 0;
  out.forEach((line, index) => {
    if (!isSibling(line)) return;
    const content = stripBlockMarker(line);
    if (listTarget) {
      ordinal += 1;
      const marker =
        target === "numbered" ? `${ordinal}. ` : target === "todo" ? "- [ ] " : firstLineMarker(target);
      out[index] = marker + content;
    } else if (index === 0) {
      out[index] = firstLineMarker(target) + content;
    } else {
      // Heading/paragraph targets demote sibling list items to plain lines;
      // plain siblings are already marker-free.
      out[index] = content;
    }
  });
  return rebuild(out);
}

/** Turn every selected block into `target` (one splice per block). */
export function planTurnIntoBlocks(
  source: string,
  moving: readonly BlockRange[],
  target: TurnIntoId,
  ctx: ScaffoldContext = {},
): BlockChange[] {
  return moving.map((block) => ({
    from: block.start,
    to: block.end,
    insert: turnIntoBlockText(source.slice(block.start, block.end), target, ctx),
  }));
}

/** Insert a scaffold (or any text) below a block, one splice. */
export function planInsertBelow(block: BlockRange, text: string): BlockChange[] {
  return [{ from: block.end, to: block.end, insert: text }];
}

/**
 * Resolve the drop zone for a source offset inside the blocks. The zone is
 * purely vertical (before / nest / after); left/right two-column zones are
 * excluded by design.
 */
export function dropZoneAt(
  source: string,
  pos: number,
  blocks: readonly BlockRange[],
): { block: BlockRange; zone: DropZone } | null {
  const outer = outermostBlocks(blocks);
  if (outer.length === 0) return null;
  const clamped = Math.max(0, Math.min(pos, source.length));
  let block = outer.find((candidate) => clamped >= candidate.start && clamped < candidate.end) ?? null;
  if (!block) {
    // Between blocks: pick the nearest and drop on the side we are closest to.
    let best: BlockRange | null = null;
    let bestDistance = Infinity;
    for (const candidate of outer) {
      const distance = Math.min(
        Math.abs(clamped - candidate.start),
        Math.abs(clamped - candidate.end),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (!best) return null;
    return { block: best, zone: clamped <= best.start ? "before" : "after" };
  }
  const lineEnd = source.indexOf("\n", block.start);
  const lineEndOffset = lineEnd === -1 ? block.end : lineEnd;
  const lineLength = Math.max(1, lineEndOffset - block.start);
  if (clamped >= lineEndOffset) return { block, zone: "after" };
  const fraction = (clamped - block.start) / lineLength;
  // Vertical thirds only: top edge inserts before, the centre nests, the
  // bottom edge inserts after. Left/right (two-column) zones are excluded.
  if (fraction < 1 / 3) return { block, zone: "before" };
  if (fraction > 2 / 3) return { block, zone: "after" };
  return { block, zone: "nest" };
}

/** Apply planned splices right-to-left so original offsets stay valid. */
export function applyChanges(source: string, changes: readonly BlockChange[]): AppliedEdit {
  const ordered = [...changes].sort((a, b) => b.from - a.from || b.to - a.to);
  let out = source;
  let cursor = 0;
  for (const change of ordered) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
    cursor = change.from + change.insert.length;
  }
  return { source: out, cursor };
}

/** True when the change set leaves the document around [start, end) untouched. */
export function changesInside(changes: readonly BlockChange[], start: number, end: number): boolean {
  return changes.every((change) => change.from >= start && change.to <= end);
}

export { SLASH_CARET };
