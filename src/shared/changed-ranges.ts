/**
 * S8-11 — coarse line-level change detection for the narrowed Save gate.
 *
 * Returns the spans of `next` whose lines are not part of the longest common
 * *line* subsequence with `previous` — i.e. "what this draft actually changed".
 * The Save gate then enforces a blocking validator finding only when its source
 * range intersects one of these spans, so an unrelated edit is never blocked by
 * a pre-existing agent-block error elsewhere in the note.
 *
 * Pure and dependency-free. Documents too large for the quadratic walk degrade
 * to "everything changed", which restores the old (stricter) behaviour rather
 * than silently allowing a save.
 */
export interface SourceSpan {
  start: number;
  end: number;
}

interface Line {
  text: string;
  start: number;
  end: number;
}

/** Cap on `lines(previous) × lines(next)` before we give up and match nothing. */
const MAX_PRODUCT = 1_500_000;

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      lines.push({ text: source.slice(start, i + 1), start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < source.length)
    lines.push({ text: source.slice(start), start, end: source.length });
  return lines;
}

/**
 * Spans of `next` whose lines are not shared with `previous`.
 *
 * A whole-document span is returned when either side is too large to diff.
 * Identical inputs yield `[]`.
 */
export function changedRanges(previous: string, next: string): SourceSpan[] {
  if (previous === next) return [];
  if (!previous) return next ? [{ start: 0, end: next.length }] : [];
  if (!next) return [{ start: 0, end: 0 }];

  const a = splitLines(previous);
  const b = splitLines(next);
  if (a.length * b.length > MAX_PRODUCT)
    return [{ start: 0, end: next.length }];

  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const below = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      lcs[row + j] =
        a[i].text === b[j].text
          ? lcs[below + j + 1] + 1
          : Math.max(lcs[below + j], lcs[row + j + 1]);
    }
  }

  // Walk the table, marking which `b` lines belong to the common subsequence.
  const matched = new Uint8Array(m);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      matched[j] = 1;
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const spans: SourceSpan[] = [];
  let open: SourceSpan | null = null;
  for (let k = 0; k < m; k++) {
    if (matched[k]) {
      if (open) {
        spans.push(open);
        open = null;
      }
      continue;
    }
    const line = b[k];
    if (open && open.end === line.start) open.end = line.end;
    else {
      if (open) spans.push(open);
      open = { start: line.start, end: line.end };
    }
  }
  if (open) spans.push(open);
  return spans;
}

/** True when `span` overlaps any of `ranges` (touching edges do not count). */
export function spanIntersectsAny(
  span: SourceSpan,
  ranges: readonly SourceSpan[],
): boolean {
  return ranges.some((range) => span.start < range.end && span.end > range.start);
}

/** True when the two ranges overlap (touching edges do not count). */
export function rangesIntersect(a: SourceSpan, b: SourceSpan): boolean {
  return a.start < b.end && a.end > b.start;
}
