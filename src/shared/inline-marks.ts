/**
 * S7-10 — inline marks (bubble toolbar).
 *
 * Every mark is a text-range splice around the current selection: the source
 * around the span survives byte-identically, and applying the same mark twice
 * unwraps it (toggle). Deliberately string-only — the client applies the
 * result in a single CM6 transaction.
 */
export type InlineMark =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "wikilink"
  | "highlight"
  | "comment";

export interface InlineMarkSpec {
  id: InlineMark;
  label: string;
  /** Keyboard/ARIA name — the acronym-free description of the mark. */
  aria: string;
  open: string;
  close: string;
  /** True when the mark needs an extra value (a link URL) from the user. */
  needsValue?: boolean;
}

/** Toolbar order, exactly the set the spec lists (§4.1). */
export const INLINE_MARKS: readonly InlineMarkSpec[] = Object.freeze([
  { id: "bold", label: "B", aria: "Bold", open: "**", close: "**" },
  { id: "italic", label: "I", aria: "Italic", open: "*", close: "*" },
  { id: "strike", label: "S", aria: "Strikethrough", open: "~~", close: "~~" },
  { id: "code", label: "‹›", aria: "Inline code", open: "`", close: "`" },
  { id: "link", label: "🔗", aria: "Link", open: "[", close: "](url)", needsValue: true },
  { id: "wikilink", label: "[[", aria: "Wikilink", open: "[[", close: "]]" },
  { id: "highlight", label: "==", aria: "Highlight", open: "==", close: "==" },
  { id: "comment", label: "%%", aria: "Comment", open: "%%", close: "%%" },
]);

const SPEC_BY_ID: ReadonlyMap<InlineMark, InlineMarkSpec> = new Map(
  INLINE_MARKS.map((spec) => [spec.id, spec]),
);

export interface TextSelection {
  anchor: number;
  head: number;
}

export interface InlineMarkResult {
  source: string;
  anchor: number;
  head: number;
  /** Splice in the original document: replace [from, to) with `insert`. */
  from: number;
  to: number;
  insert: string;
  /** True when the mark was removed rather than added. */
  removed: boolean;
}

function ordered(selection: TextSelection): { from: number; to: number } {
  return selection.anchor <= selection.head
    ? { from: selection.anchor, to: selection.head }
    : { from: selection.head, to: selection.anchor };
}

/**
 * Apply (or toggle) `mark` over `selection`.
 *
 * - Empty selection: insert the delimiters and place the caret between them.
 * - Already wrapped: unwrap, selecting the inner text again (toggle-off).
 * - Link with empty text: `[text](url)` using the supplied value.
 */
export function applyInlineMark(
  source: string,
  selection: TextSelection,
  mark: InlineMark,
  value?: string,
): InlineMarkResult | null {
  const spec = SPEC_BY_ID.get(mark);
  if (!spec) return null;
  const { from, to } = ordered(selection);
  if (from < 0 || to > source.length) return null;
  const selected = source.slice(from, to);

  if (mark === "link") {
    const url = (value ?? "").trim();
    if (!url) return null;
    const open = "[";
    const close = `](${url})`;
    const text = selected || "text";
    const next = source.slice(0, from) + open + text + close + source.slice(to);
    return {
      source: next,
      anchor: from + open.length,
      head: from + open.length + text.length,
      from,
      to,
      insert: open + text + close,
      removed: false,
    };
  }

  if (mark === "wikilink") {
    const text = selected || "";
    const insert = `[[${text}]]`;
    const next = source.slice(0, from) + insert + source.slice(to);
    return {
      source: next,
      anchor: from + 2,
      head: from + 2 + text.length,
      from,
      to,
      insert,
      removed: false,
    };
  }

  const before = source.slice(Math.max(0, from - spec.open.length), from);
  const after = source.slice(to, to + spec.close.length);
  if (before === spec.open && after === spec.close) {
    // Toggle off: drop the delimiters, keep the inner text selected.
    const spliceFrom = from - spec.open.length;
    const spliceTo = to + spec.close.length;
    const next = source.slice(0, spliceFrom) + selected + source.slice(spliceTo);
    return {
      source: next,
      anchor: spliceFrom,
      head: spliceFrom + selected.length,
      from: spliceFrom,
      to: spliceTo,
      insert: selected,
      removed: true,
    };
  }

  const insert = spec.open + selected + spec.close;
  const next = source.slice(0, from) + insert + source.slice(to);
  const innerStart = from + spec.open.length;
  return {
    source: next,
    anchor: innerStart,
    head: innerStart + selected.length,
    from,
    to,
    insert,
    removed: false,
  };
}
