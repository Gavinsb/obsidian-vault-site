/**
 * S7-8 — structured Properties (YAML frontmatter) contract.
 *
 * The Properties editor is a *splice* editor. It parses the leading frontmatter
 * block into ordered rows that carry exact byte offsets, then rewrites only the
 * value span of the one key being edited. Everything else — key order, quoting
 * style, inline comments, blank lines, nested blocks, the whole body — is
 * preserved verbatim, so:
 *
 *   - a no-op edit round-trips the document byte-identically;
 *   - a single-field edit cannot touch any other byte;
 *   - `updated` stays server-owned (visible, never editable here).
 *
 * This is the same design goal as `frontmatter.ts` (targeted line edits rather
 * than re-serialisation), extended with the offsets and comment/quote awareness
 * the structured UI needs.
 */

export type PropertyKind =
  | "string"
  | "number"
  | "boolean"
  | "empty"
  | "list"
  | "object"
  | "raw";

export interface PropertyRow {
  key: string;
  /** Decoded value (quotes stripped) for the editor widget. */
  value: string;
  /** How the value was written; drives the input widget and re-encoding. */
  kind: PropertyKind;
  /** Byte offsets of the whole `key: value` line (excludes the line ending). */
  start: number;
  end: number;
  /** Byte offsets of the value span — edits replace exactly `[valueStart, valueEnd)`. */
  valueStart: number;
  valueEnd: number;
  /** Trailing `# comment` (including the `#`), preserved verbatim. */
  comment?: string;
  /** Server-owned key (`updated`): shown but never editable. */
  readOnly: boolean;
  /** True when the row can be edited as a scalar (block/nested values cannot). */
  editable: boolean;
  /** Quote style the value was written with, so edits keep it. */
  quote: '"' | "'" | null;
  /** The exact source line bytes (no line ending). */
  raw: string;
}

export type PropertyEntry =
  | { kind: "property"; row: PropertyRow }
  | { kind: "raw"; text: string; start: number; end: number };

export interface ParsedProperties {
  hasFrontmatter: boolean;
  /** Offset where the frontmatter body begins (after the opening `---` line). */
  bodyStart: number;
  /** Offset where the frontmatter body ends (the closing `---` line start). */
  bodyEnd: number;
  entries: PropertyEntry[];
  /** Only the property entries, in source order. */
  rows: PropertyRow[];
}

/** Server-owned properties: visible, never editable in the UI. */
export const READ_ONLY_PROPERTIES: ReadonlySet<string> = new Set(["updated"]);

/** Top-level property keys we are willing to edit (`review-after` style allowed). */
export const PROPERTY_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function isReadOnlyProperty(key: string): boolean {
  return READ_ONLY_PROPERTIES.has(key.trim().toLowerCase());
}

const OPEN = /^(?:\uFEFF)?---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_RE = /^([^:\s#][^:#]*?)[ \t]*:(.*)$/;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parse the leading frontmatter block into ordered, offset-carrying rows. */
export function parseProperties(source: string): ParsedProperties {
  const open = OPEN.exec(source);
  if (!open)
    return {
      hasFrontmatter: false,
      bodyStart: 0,
      bodyEnd: 0,
      entries: [],
      rows: [],
    };
  const bodyStart = open[0].length;
  let bodyEnd = source.length;
  for (let offset = bodyStart; offset <= source.length; ) {
    const nl = source.indexOf("\n", offset);
    const lineEnd = nl < 0 ? source.length : nl;
    const line = source.slice(offset, lineEnd).replace(/\r$/, "");
    if (CLOSE.test(line)) {
      bodyEnd = offset;
      break;
    }
    if (nl < 0) break;
    offset = nl + 1;
  }

  const body = source.slice(bodyStart, bodyEnd);
  const lines = body.split("\n");
  const entries: PropertyEntry[] = [];
  const rows: PropertyRow[] = [];
  let offset = bodyStart;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = offset + line.length;
    const text = line.replace(/\r$/, "");
    const next = lines[i + 1];
    const row = parseRow(text, offset, lineEnd, next);
    if (row) {
      entries.push({ kind: "property", row });
      rows.push(row);
    } else {
      entries.push({ kind: "raw", text: line, start: offset, end: lineEnd });
    }
    offset = lineEnd + 1;
  }
  return { hasFrontmatter: true, bodyStart, bodyEnd, entries, rows };
}

function parseRow(
  text: string,
  start: number,
  end: number,
  nextLine: string | undefined,
): PropertyRow | null {
  if (!text.trim()) return null;
  if (/^[ \t]/.test(text)) return null; // nested / continuation line
  if (/^#/.test(text)) return null; // comment line
  const m = KEY_RE.exec(text);
  if (!m) return null;
  const key = m[1].trim();
  if (!key || !PROPERTY_KEY_RE.test(key)) return null;

  const colon = text.indexOf(":");
  const after = colon + 1;
  const lead = /^[ \t]*/.exec(text.slice(after))![0].length;
  const valueStart = start + after + lead;
  const remainder = text.slice(after + lead);
  const commentAt = findComment(remainder);
  const valueText = commentAt < 0 ? remainder : remainder.slice(0, commentAt);
  const trimmed = valueText.replace(/[ \t]+$/, "");
  const valueEnd = valueStart + trimmed.length;

  const quote: '"' | "'" | null = /^"(?:[^"\\]|\\.)*"$/.test(trimmed)
    ? '"'
    : /^'(?:[^']|'')*'$/.test(trimmed)
      ? "'"
      : null;
  const value =
    quote === '"'
      ? trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : quote === "'"
        ? trimmed.slice(1, -1).replace(/''/g, "'")
        : trimmed;

  let kind = kindOf(trimmed, quote);
  // An empty scalar followed by an indented line is a nested map/sequence
  // header — leave the block intact rather than overwriting its first line.
  if (kind === "empty" && nextLine !== undefined && /^[ \t]/.test(nextLine))
    kind = "raw";

  return {
    key,
    value,
    kind,
    start,
    end,
    valueStart,
    valueEnd,
    comment:
      commentAt < 0
        ? undefined
        : remainder.slice(commentAt).replace(/[ \t]+$/, ""),
    readOnly: isReadOnlyProperty(key),
    editable: !isReadOnlyProperty(key) && kind !== "raw",
    quote,
    raw: text,
  };
}

/** Index of a YAML inline comment (`#` outside quotes, preceded by space). */
function findComment(text: string): number {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") i++;
        else quote = null;
      } else if (quote === '"' && ch === "\\") i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /[ \t]/.test(text[i - 1]))) return i;
  }
  return -1;
}

function kindOf(raw: string, quote: '"' | "'" | null): PropertyKind {
  if (!raw) return "empty";
  if (quote) return "string";
  if (/^[|>][+-]?\d*$/.test(raw)) return "raw"; // block scalar
  if (raw.startsWith("[")) return "list";
  if (raw.startsWith("{")) return "object";
  if (/^(true|false)$/i.test(raw)) return "boolean";
  if (NUMBER_RE.test(raw)) return "number";
  return "string";
}

function needsQuote(s: string): boolean {
  if (s === "") return true;
  if (/^(true|false|null|yes|no|on|off|~|nil)$/i.test(s)) return true;
  if (NUMBER_RE.test(s)) return true;
  if (/[:#\-?[\]{}&*!|>'"%@`]/.test(s)) return true;
  if (/^\s|\s$/.test(s)) return true;
  return false;
}

/** Re-encode an edited value, preserving the row's original scalar style. */
export function encodePropertyValue(value: string, row: PropertyRow): string {
  const v = value ?? "";
  if (row.quote === '"')
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (row.quote === "'") return `'${v.replace(/'/g, "''")}'`;
  if (row.kind === "number" && NUMBER_RE.test(v)) return v;
  if (row.kind === "boolean" && /^(true|false)$/i.test(v))
    return v.toLowerCase();
  if (row.kind === "list" || row.kind === "object") return v;
  return needsQuote(v) ? JSON.stringify(v) : v;
}

/**
 * Set one top-level property, splicing only that value span. Returns the source
 * unchanged when the value is identical (byte-identical no-op) and refuses to
 * touch server-owned keys or block/nested values.
 */
export function setPropertyValue(
  source: string,
  key: string,
  value: string,
): string {
  const k = key.trim();
  if (!PROPERTY_KEY_RE.test(k) || isReadOnlyProperty(k)) return source;
  const parsed = parseProperties(source);
  const row = parsed.rows.find((r) => r.key === k);
  if (row) {
    if (row.kind === "raw") return source;
    // Semantic no-op: the decoded value is unchanged, so re-encoding it (which
    // may add quotes) must not rewrite the source.
    if (value === row.value) return source;
    const encoded = encodePropertyValue(value, row);
    if (source.slice(row.valueStart, row.valueEnd) === encoded) return source;
    return (
      source.slice(0, row.valueStart) + encoded + source.slice(row.valueEnd)
    );
  }
  if (!parsed.hasFrontmatter) {
    const body = source.replace(/^\uFEFF/, "");
    return `---\n${k}: ${value}\n---\n\n${body}`;
  }
  const bodyLength = parsed.bodyEnd - parsed.bodyStart;
  const endsWithNewline =
    bodyLength > 0 && source[parsed.bodyEnd - 1] === "\n";
  const insert =
    bodyLength === 0 || endsWithNewline ? `${k}: ${value}\n` : `\n${k}: ${value}\n`;
  return (
    source.slice(0, parsed.bodyEnd) + insert + source.slice(parsed.bodyEnd)
  );
}

/** Remove a top-level property line, preserving every other byte. */
export function removeProperty(source: string, key: string): string {
  const k = key.trim();
  if (!PROPERTY_KEY_RE.test(k) || isReadOnlyProperty(k)) return source;
  const row = parseProperties(source).rows.find((r) => r.key === k);
  if (!row) return source;
  let cut = row.end;
  if (source[cut] === "\r") cut++;
  if (source[cut] === "\n") cut++;
  return source.slice(0, row.start) + source.slice(cut);
}

/**
 * Rebuild the frontmatter body from the parsed entries. Because every entry
 * carries its exact source bytes, `serializeProperties(parseProperties(x))`
 * equals the body of `x` byte-for-byte.
 */
export function serializeProperties(parsed: ParsedProperties): string {
  return parsed.entries
    .map((e) => (e.kind === "property" ? e.row.raw : e.text))
    .join("\n");
}
