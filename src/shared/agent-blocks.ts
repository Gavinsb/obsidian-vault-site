export type AgentBlockType = "agent" | "agent-review";

export interface AgentBlock {
  type: AgentBlockType;
  header: string;
  metadata: Record<string, string>;
  content: string;
  start: number;
  end: number;
  id?: string;
  target?: string;
}

const HEADER = /^>\s*\[!(agent|agent-review)\][+-]?\s*(.*)$/i;
const QUOTED = /^> ?(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/** Parse complete agent callouts by line offsets, ignoring fenced examples. */
export function parseAgentBlocks(source: string): AgentBlock[] {
  const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
  const out: AgentBlock[] = [];
  let offset = 0;
  let fence: string | null = null;
  for (let i = 0; i < lines.length; ) {
    const raw = lines[i];
    const text = raw.replace(/\r?\n$/, "");
    const fm = FENCE.exec(text);
    if (fm) {
      fence = fence ? (text.trim().startsWith(fence) ? null : fence) : fm[1];
      i++;
      offset += raw.length;
      continue;
    }
    const hm = !fence ? HEADER.exec(text) : null;
    if (!hm) {
      i++;
      offset += raw.length;
      continue;
    }
    const start = offset;
    const collected: string[] = [];
    const header = hm[2].trim();
    let end = start;
    let first = true;
    while (i < lines.length) {
      const current = lines[i];
      const line = current.replace(/\r?\n$/, "");
      const qm = QUOTED.exec(line);
      if (!qm) break;
      if (!first) collected.push(qm[1]);
      first = false;
      end += current.length;
      offset += current.length;
      i++;
    }
    const metadata: Record<string, string> = {};
    for (const m of header.matchAll(
      /\b(ID|STATUS|TARGET):\s*("[^"]*"|'[^']*'|\S+)/gi,
    )) {
      metadata[m[1].toLowerCase()] = m[2].replace(/^['"]|['"]$/g, "");
    }
    out.push({
      type: hm[1].toLowerCase() as AgentBlockType,
      header,
      metadata,
      content: collected.join("\n"),
      start,
      end,
      id: metadata.id,
      target: metadata.target,
    });
  }
  return out;
}

export function maskAgentBlocks(source: string): string {
  const blocks = parseAgentBlocks(source);
  let result = source;
  for (const block of [...blocks].reverse())
    result = result.slice(0, block.start) + result.slice(block.end);
  return result;
}

/**
 * Ordered render segments for a body: plain text chunks and agent blocks,
 * with start/end blocks sharing an `id` grouped into a `pair` segment whose
 * `inner` holds everything between them (the encapsulated section).
 * First occurrence of an id = start; last occurrence = end; middle or
 * unpaired occurrences render as standalone cards.
 */
export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "agent"; block: AgentBlock; role: "standalone" }
  | {
      kind: "pair";
      id: string;
      start: AgentBlock;
      end: AgentBlock;
      inner: BodySegment[];
    };

export function segmentBodyByAgentBlocks(body: string): BodySegment[] {
  const blocks = parseAgentBlocks(body);
  const firstIdx = new Map<string, number>();
  const lastIdx = new Map<string, number>();
  blocks.forEach((b, i) => {
    if (!b.id) return;
    if (!firstIdx.has(b.id)) firstIdx.set(b.id, i);
    lastIdx.set(b.id, i);
  });

  const out: BodySegment[] = [];
  const stack: Array<{ id: string; start: AgentBlock; inner: BodySegment[] }> =
    [];
  let cursor = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const target = stack.length ? stack[stack.length - 1].inner : out;
    target.push({ kind: "text", text });
  };

  blocks.forEach((b, i) => {
    if (b.start > cursor) pushText(body.slice(cursor, b.start));
    cursor = b.end;
    const isStart = !!b.id && firstIdx.get(b.id) === i;
    const isEnd = !!b.id && lastIdx.get(b.id) === i;
    if (isStart && !isEnd) {
      stack.push({ id: b.id!, start: b, inner: [] });
      return;
    }
    if (isEnd) {
      const idx = [...stack].reverse().findIndex((p) => p.id === b.id);
      if (idx !== -1) {
        const pi = stack.length - 1 - idx;
        const pair = stack.splice(pi, 1)[0];
        const seg: BodySegment = {
          kind: "pair",
          id: pair.id,
          start: pair.start,
          end: b,
          inner: pair.inner,
        };
        const target = stack.length ? stack[stack.length - 1].inner : out;
        target.push(seg);
        return;
      }
    }
    const target = stack.length ? stack[stack.length - 1].inner : out;
    target.push({ kind: "agent", block: b, role: "standalone" });
  });

  if (cursor < body.length) pushText(body.slice(cursor));
  while (stack.length) {
    const pair = stack.pop()!;
    const target = stack.length ? stack[stack.length - 1].inner : out;
    target.push({ kind: "agent", block: pair.start, role: "standalone" });
    target.push(...pair.inner);
  }
  return out;
}

function findReview(source: string, id: string): AgentBlock {
  const matches = parseAgentBlocks(source).filter(
    (b) => b.type === "agent-review" && b.id === id,
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length ? "duplicate_review_id" : "review_not_found",
    );
  return matches[0];
}

/** Draft-only transform: unwrap the selected proposal as ordinary Markdown. */
export function acceptAgentReview(source: string, id: string): string {
  const b = findReview(source, id);
  return (
    source.slice(0, b.start) +
    b.content +
    (b.content && !b.content.endsWith("\n") ? "\n" : "") +
    source.slice(b.end)
  );
}

/** Draft-only transform: remove only the selected staged proposal. */
export function rejectAgentReview(source: string, id: string): string {
  const b = findReview(source, id);
  return source.slice(0, b.start) + source.slice(b.end);
}
