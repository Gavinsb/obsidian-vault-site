/**
 * Frontmatter handling.
 *
 * Design goal: preserve source-file integrity. When we update one managed
 * field (rating, favorite, status, reviewed, ...) we do NOT re-serialize the
 * whole frontmatter. Instead we perform a targeted line edit inside the
 * frontmatter block, which preserves every other key, value, comment, order,
 * and quoting style byte-for-byte.
 *
 * If the frontmatter block does not exist and we need to write a field, a new
 * block is prepended.
 */
import yaml from 'js-yaml';

export interface ParsedFrontmatter {
  /** The raw text between the --- delimiters (no delimiters). */
  raw: string;
  /** Parsed object ({} when absent/unparseable). */
  data: Record<string, unknown>;
  /** Body content after the frontmatter block. */
  content: string;
  /** Whether a well-formed frontmatter block exists. */
  hasFrontmatter: boolean;
  /** Offset where the frontmatter content (raw) begins in the original text. */
  contentStart: number;
  /** Offset where body starts in the original text. */
  bodyStart: number;
}

const FM_RE = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(text: string): ParsedFrontmatter {
  const m = FM_RE.exec(text);
  if (!m) {
    return {
      raw: '',
      data: {},
      content: text,
      hasFrontmatter: false,
      contentStart: 0,
      bodyStart: 0,
    };
  }
  const raw = m[1];
  let data: Record<string, unknown> = {};
  try {
    const loaded = yaml.load(raw);
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      data = loaded as Record<string, unknown>;
    }
  } catch {
    // Leave data empty; raw is still preserved for round-tripping.
  }
  const contentStart = m.index + m[0].indexOf(m[1]);
  return {
    raw,
    data,
    content: text.slice(m[0].length),
    hasFrontmatter: true,
    contentStart,
    bodyStart: m[0].length,
  };
}

export function getField(text: string, key: string): unknown {
  return parseFrontmatter(text).data[key];
}

/** Normalise an arbitrary value to a YAML fragment suitable for a scalar line. */
function serializeScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  const s = String(value);
  // Quote strings that could be misread by YAML: reserved scalars, special
  // chars, surrounding whitespace, or anything numeric/date-like.
  const reserved = /^(true|false|null|yes|no|on|off|~|nil)$/i;
  const numeric = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  if (
    reserved.test(s) ||
    numeric.test(s) ||
    s === '' ||
    /[:#\-?[\]{}&*!|>'"%@`]/.test(s) ||
    /^\s|\s$/.test(s)
  ) {
    return JSON.stringify(s);
  }
  return s;
}

/**
 * Set a scalar frontmatter field, preserving all other bytes.
 * Replaces an existing top-level `key:` line, else inserts before the closing
 * `---`. Creates a frontmatter block if none exists.
 */
export function setFrontmatterField(text: string, key: string, value: unknown): string {
  const fm = parseFrontmatter(text);
  const line = `${key}: ${serializeScalar(value)}`;

  if (!fm.hasFrontmatter) {
    const body = text.replace(/^\uFEFF/, '');
    return `---\n${line}\n---\n\n${body}`;
  }

  const fmStart = text.indexOf('---') + 3;
  const blockRaw = fm.raw;
  const blockLines = blockRaw.split(/\r?\n/);

  // Match a top-level key line (no leading whitespace) for this exact key.
  const keyRe = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  let replaced = false;
  for (let i = 0; i < blockLines.length; i++) {
    if (keyRe.test(blockLines[i])) {
      const indent = blockLines[i].match(/^\s*/)?.[0] ?? '';
      blockLines[i] = `${indent}${line}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    // Remove a trailing empty line so we don't accumulate blanks.
    while (blockLines.length && blockLines[blockLines.length - 1].trim() === '') blockLines.pop();
    blockLines.push(line);
  }

  const newBlock = blockLines.join('\n');
  return text.slice(0, fmStart) + '\n' + newBlock + text.slice(fm.contentStart + blockRaw.length);
}

/** Remove a top-level scalar field, preserving everything else. */
export function removeFrontmatterField(text: string, key: string): string {
  const fm = parseFrontmatter(text);
  if (!fm.hasFrontmatter) return text;
  const fmStart = text.indexOf('---') + 3;
  const blockLines = fm.raw.split(/\r?\n/);
  const keyRe = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  const kept = blockLines.filter((l) => !keyRe.test(l));
  return text.slice(0, fmStart) + '\n' + kept.join('\n') + text.slice(fm.contentStart + fm.raw.length);
}

/** Coerce a frontmatter value (string | number | array) to a string[] for tags/aliases. */
export function toStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => toStringArray(x));
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    // Support comma or space separated inline values.
    return s.includes(',') ? s.split(',').map((x) => x.trim()).filter(Boolean) : [s];
  }
  return [String(v)];
}

export function coerceRating(v: unknown, scale: number): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (Number.isNaN(n)) return undefined;
  if (n < 0) return 0;
  if (n > scale) return scale;
  return n;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { yaml };
