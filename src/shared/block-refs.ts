/**
 * S7-9 — block anchors (`^block-id`) and copyable block references.
 *
 * A block anchor is a line-trailing `^id`; a block reference is the wikilink
 * `[[Note#^id]]` that points at it. Both directions are lossless and
 * fence-aware: this module only *reads* source and reports spans, so copying a
 * reference never rewrites the document.
 */

export interface BlockAnchor {
  id: string;
  /** Offsets of the `^id` token (including the caret). */
  start: number;
  end: number;
  /** One-based line number of the anchor. */
  line: number;
}

const FENCE = /^\s*(```|~~~)/;
const ANCHOR = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const WIKILINK = /^!?\[\[([^\][\n]+?)\]\]$/;

/** Every `^block-id` anchor in source, ignoring fenced examples. */
export function findBlockAnchors(source: string): BlockAnchor[] {
  const out: BlockAnchor[] = [];
  const lines = source.match(/.*(?:\r\n|\n|$)/g) ?? [];
  let fence: string | null = null;
  let offset = 0;
  let line = 0;
  for (const raw of lines) {
    if (!raw) continue;
    line++;
    const text = raw.replace(/\r?\n$/, "");
    const fm = FENCE.exec(text);
    if (fm) {
      fence = fence ? (text.trim().startsWith(fence) ? null : fence) : fm[1];
      offset += raw.length;
      continue;
    }
    if (!fence) {
      const m = ANCHOR.exec(text);
      if (m) {
        const caret = offset + text.length - m[0].length + m[0].indexOf("^");
        out.push({
          id: m[1],
          start: caret,
          end: caret + 1 + m[1].length,
          line,
        });
      }
    }
    offset += raw.length;
  }
  return out;
}

/** Resolve a `^id` (with or without the caret) to its anchor, or null. */
export function resolveBlockRef(
  source: string,
  blockId: string,
): BlockAnchor | null {
  const id = blockId.replace(/^\^/, "").trim();
  if (!id) return null;
  return findBlockAnchors(source).find((a) => a.id === id) ?? null;
}

/** Build the copyable reference `[[target#^id]]` (alias optional). */
export function formatBlockRef(
  target: string,
  blockId: string,
  alias?: string,
): string {
  const id = blockId.replace(/^\^/, "").trim();
  const t = target.trim();
  const label = alias && alias.trim() ? `|${alias.trim()}` : "";
  return `[[${t}#^${id}${label}]]`;
}

export interface ParsedBlockRef {
  target: string;
  block?: string;
  heading?: string;
  alias?: string;
}

/** Parse a wikilink/embed reference into its target, block id and alias. */
export function parseBlockRef(link: string): ParsedBlockRef | null {
  const m = WIKILINK.exec(link.trim());
  if (!m) return null;
  let inner = m[1];
  let alias: string | undefined;
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    alias = inner.slice(pipe + 1).trim();
    inner = inner.slice(0, pipe);
  }
  let heading: string | undefined;
  let block: string | undefined;
  const hash = inner.indexOf("#");
  if (hash !== -1) {
    const after = inner.slice(hash + 1);
    inner = inner.slice(0, hash);
    if (after.startsWith("^")) block = after.slice(1).trim();
    else heading = after.trim();
  }
  const out: ParsedBlockRef = { target: inner.trim() };
  if (alias) out.alias = alias;
  if (block) out.block = block;
  if (heading) out.heading = heading;
  return out;
}

/**
 * True when `link` names a real anchor in `source`. Used to prove a copied
 * block reference resolves rather than merely round-tripping.
 */
export function blockRefResolves(
  source: string,
  link: string,
): BlockAnchor | null {
  const parsed = parseBlockRef(link);
  if (!parsed?.block) return null;
  return resolveBlockRef(source, parsed.block);
}
