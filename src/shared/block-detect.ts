import { GFM, parser as markdownParser } from "@lezer/markdown";

import { parseAgentBlocks } from "./agent-blocks.js";

export type BlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "listItem"
  | "task"
  | "quote"
  | "callout"
  | "fence"
  | "table"
  | "frontmatter"
  | "agent"
  | "embed"
  | "hr";

/** End-exclusive source offsets and one-based, inclusive line numbers. */
export interface BlockRange {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  type: BlockType;
  nesting: number;
}

interface SpecialRange {
  start: number;
  end: number;
  type: "frontmatter" | "agent";
}

/** Structural subset shared by all compatible @lezer/common versions. */
interface MarkdownNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly firstChild: MarkdownNode | null;
  readonly nextSibling: MarkdownNode | null;
}

const parser = markdownParser.configure(GFM);
const CALLOUT = /^>\s*\[![^\]\r\n]+\][+-]?(?:[ \t]|$)/i;
const EMBED = /^!\[\[[^\]\r\n]+\]\](?:[ \t]+\^[A-Za-z0-9-]+)?$/;

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
}

/** Include the line ending after a Lezer block, just as parseAgentBlocks does. */
function throughLineEnding(source: string, end: number): number {
  if (source.charCodeAt(end) === 13 && source.charCodeAt(end + 1) === 10)
    return end + 2;
  if (source.charCodeAt(end) === 10) return end + 1;
  return end;
}

function frontmatterRange(source: string): SpecialRange | null {
  const firstEnd = source.indexOf("\n");
  const first = source
    .slice(0, firstEnd < 0 ? source.length : firstEnd)
    .replace(/\r$/, "");
  if (!/^---[ \t]*$/.test(first)) return null;

  let offset = firstEnd < 0 ? source.length : firstEnd + 1;
  while (offset < source.length) {
    const newline = source.indexOf("\n", offset);
    const end = newline < 0 ? source.length : newline;
    const line = source.slice(offset, end).replace(/\r$/, "");
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
      return {
        start: 0,
        end: newline < 0 ? source.length : newline + 1,
        type: "frontmatter",
      };
    }
    offset = newline < 0 ? source.length : newline + 1;
  }
  return null;
}

function overlapsSpecial(
  from: number,
  to: number,
  specials: readonly SpecialRange[],
): boolean {
  return specials.some((range) => from < range.end && to > range.start);
}

function directChildNamed(node: MarkdownNode, name: string): boolean {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return true;
  }
  return false;
}

function classify(node: MarkdownNode, source: string): BlockType | null {
  switch (node.name) {
    case "Paragraph": {
      const text = source.slice(node.from, node.to).trim();
      return EMBED.test(text) ? "embed" : "paragraph";
    }
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
    case "SetextHeading1":
    case "SetextHeading2":
      return "heading";
    case "BulletList":
    case "OrderedList":
      return "list";
    case "ListItem":
      return directChildNamed(node, "Task") ? "task" : "listItem";
    case "Blockquote":
      return CALLOUT.test(source.slice(node.from, node.to))
        ? "callout"
        : "quote";
    case "FencedCode":
    case "CodeBlock":
      return "fence";
    case "Table":
      return "table";
    case "HorizontalRule":
      return "hr";
    case "HTMLBlock":
    case "LinkReference":
      return "paragraph";
    default:
      return null;
  }
}

function hasBlockChildren(type: BlockType): boolean {
  return (
    type === "list" ||
    type === "listItem" ||
    type === "task" ||
    type === "quote" ||
    type === "callout"
  );
}

/**
 * Detect Markdown blocks from the Lezer tree. The result is a flat, source-
 * ordered view of the hierarchy: container ranges precede children at the
 * same offset, and nesting records their depth. Agent callouts deliberately
 * come from parseAgentBlocks(), so examples inside fences cannot become tasks.
 */
export function detectBlocks(source: string): BlockRange[] {
  if (!source) return [];

  const starts = lineStarts(source);
  const frontmatter = frontmatterRange(source);
  const specials: SpecialRange[] = [
    ...(frontmatter ? [frontmatter] : []),
    ...parseAgentBlocks(source)
      .filter(
        (block) =>
          !frontmatter ||
          block.end <= frontmatter.start ||
          block.start >= frontmatter.end,
      )
      .map((block) => ({
        start: block.start,
        end: block.end,
        type: "agent" as const,
      })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  const ranges: BlockRange[] = [];
  const add = (
    start: number,
    end: number,
    type: BlockType,
    nesting: number,
  ) => {
    if (end <= start) return;
    ranges.push({
      start,
      end,
      startLine: lineAt(starts, start),
      endLine: lineAt(starts, end - 1),
      type,
      nesting,
    });
  };

  for (const range of specials)
    add(range.start, range.end, range.type, 0);

  const walkChildren = (
    node: MarkdownNode,
    nesting: number,
    parentType: BlockType,
  ): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (overlapsSpecial(child.from, child.to, specials)) continue;
      const type = classify(child, source);
      if (!type) continue;
      if (
        (parentType === "listItem" || parentType === "task") &&
        type === "paragraph"
      )
        continue;
      add(
        child.from,
        throughLineEnding(source, child.to),
        type,
        nesting,
      );
      if (hasBlockChildren(type)) walkChildren(child, nesting + 1, type);
    }
  };

  const walk = (node: MarkdownNode, nesting: number): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (overlapsSpecial(child.from, child.to, specials)) continue;
      const type = classify(child, source);
      if (!type) {
        walk(child, nesting);
        continue;
      }
      add(
        child.from,
        throughLineEnding(source, child.to),
        type,
        nesting,
      );
      if (hasBlockChildren(type)) walkChildren(child, nesting + 1, type);
    }
  };

  walk(parser.parse(source).topNode, 0);
  ranges.sort(
    (a, b) =>
      a.start - b.start ||
      a.nesting - b.nesting ||
      b.end - a.end ||
      a.type.localeCompare(b.type),
  );
  return ranges;
}
