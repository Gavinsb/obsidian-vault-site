/**
 * Obsidian wiki-link, tag, and embed parsing.
 *
 * These helpers are deliberately lossless: they only *read* the source and
 * report spans. Nothing here rewrites the document, so unsupported syntax is
 * never destroyed.
 */
import type { LinkRef } from './types.js';

export interface WikiLinkSpan {
  raw: string;
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
  start: number;
  end: number;
}

/** Strip fenced code blocks and inline code so we don't parse links inside them. */
export function stripCode(text: string): string {
  let out = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, ' '));
  return out;
}

const WIKI_RE = /(!?)\[\[([^\][\n]+?)\]\]/g;

/**
 * Parse `[[target]]`, `[[target|alias]]`, `[[target#heading]]`,
 * `[[target#^block]]`, and embeds `![[...]]`.
 */
export function parseWikiLinks(text: string, opts: { includeEmbeds?: boolean } = {}): WikiLinkSpan[] {
  const includeEmbeds = opts.includeEmbeds ?? true;
  const scrubbed = stripCode(text);
  const spans: WikiLinkSpan[] = [];
  let m: RegExpExecArray | null;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(scrubbed)) !== null) {
    const isEmbed = m[1] === '!';
    if (isEmbed && !includeEmbeds) continue;
    let inner = m[2];
    let alias: string | undefined;
    const pipe = inner.indexOf('|');
    if (pipe !== -1) {
      alias = inner.slice(pipe + 1).trim();
      inner = inner.slice(0, pipe);
    }
    let heading: string | undefined;
    let block: string | undefined;
    const hash = inner.indexOf('#');
    if (hash !== -1) {
      const after = inner.slice(hash + 1);
      inner = inner.slice(0, hash);
      if (after.startsWith('^')) block = after.slice(1).trim();
      else heading = after.trim();
    }
    spans.push({
      raw: m[0],
      target: inner.trim(),
      alias,
      heading,
      block,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return spans;
}

export function toLinkRefs(text: string): LinkRef[] {
  return parseWikiLinks(text).map((s) => ({
    target: s.target,
    alias: s.alias,
    heading: s.heading,
    block: s.block,
  }));
}

const TAG_RE = /(^|[\s(（[,;:>'"“”])#([\p{L}\p{N}_][\p{L}\p{N}_/\-]*)/gu;

/**
 * Extract tags: inline `#tag`, nested `#a/b`, and checkboxes excluded.
 * Ignore tags inside code, URLs, and heading markers (## Title).
 */
export function extractInlineTags(text: string): string[] {
  const scrubbed = stripCode(text);
  const tags = new Set<string>();
  const lines = scrubbed.split('\n');
  for (let line of lines) {
    // Skip markdown headings ("## Heading") — that's not a tag.
    line = line.replace(/^\s{0,3}#{1,6}\s.*$/, '');
    // Remove URLs to avoid treating #fragment as a tag.
    line = line.replace(/https?:\/\/\S+/g, ' ');
    let m: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(line)) !== null) {
      const t = m[2];
      if (/^\d+$/.test(t)) continue; // #123 is not a tag
      tags.add(t);
    }
  }
  return [...tags];
}

/** Extract markdown-standard links [text](url) — for "standard Markdown links" support. */
export function extractMarkdownLinks(text: string): { text: string; url: string }[] {
  const scrubbed = stripCode(text);
  const out: { text: string; url: string }[] = [];
  const re = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scrubbed)) !== null) out.push({ text: m[1], url: m[2] });
  return out;
}

/** Extract headings with their level and slug for internal-heading links. */
export function extractHeadings(text: string): { level: number; text: string; slug: string }[] {
  const scrubbed = stripCode(text);
  const out: { level: number; text: string; slug: string }[] = [];
  const re = /^(#{1,6})\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scrubbed)) !== null) {
    const text2 = m[2].replace(/\s*#+\s*$/, '').trim();
    out.push({ level: m[1].length, text: text2, slug: slugify(text2) });
  }
  return out;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/** Obsidian-style callout: > [!note] Title */
export interface CalloutInfo {
  type: string;
  title: string;
}

export function parseCalloutStart(line: string): CalloutInfo | null {
  const m = /^\s*>\s*\[!([\w-]+)\]([+-])?\s*(.*)$/.exec(line);
  if (!m) return null;
  return { type: m[1].toLowerCase(), title: m[3].trim() };
}

/** Extract task list items: - [ ] / - [x] */
export function extractTasks(text: string): { text: string; checked: boolean }[] {
  const out: { text: string; checked: boolean }[] = [];
  const re = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ checked: m[1].toLowerCase() === 'x', text: m[2] });
  return out;
}

/** Extract fenced code blocks with their language. */
export function extractCodeBlocks(text: string): { lang: string; code: string }[] {
  const out: { lang: string; code: string }[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ lang: m[1].trim(), code: m[2] });
  return out;
}
