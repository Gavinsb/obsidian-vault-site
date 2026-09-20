export interface AutocompleteTrigger {
  kind: "wikilink" | "tag";
  query: string;
  replaceStart: number;
  replaceEnd: number;
}

function maskedByCode(source: string, cursor: number): boolean {
  const before = source.slice(0, cursor);
  const lines = before.split(/\r?\n/);
  let fence: string | null = null;
  for (const line of lines.slice(0, -1)) {
    const m = /^\s*(```|~~~)/.exec(line);
    if (m)
      fence = fence ? (line.trim().startsWith(fence) ? null : fence) : m[1];
  }
  if (fence) return true;
  const current = lines.at(-1) ?? "";
  let inline = false;
  for (let i = 0; i < current.length; i++)
    if (current[i] === "`" && current[i - 1] !== "\\") inline = !inline;
  return inline;
}

export function findAutocompleteTrigger(
  source: string,
  cursor: number,
): AutocompleteTrigger | null {
  if (cursor < 0 || cursor > source.length || maskedByCode(source, cursor))
    return null;
  const lineStart = Math.max(source.lastIndexOf("\n", cursor - 1) + 1, 0);
  const line = source.slice(lineStart, cursor);
  const open = line.lastIndexOf("[[");
  const close = line.lastIndexOf("]]");
  if (open > close) {
    const query = line.slice(open + 2);
    if (!query.includes("[") && !query.includes("\n")) {
      return {
        kind: "wikilink",
        query,
        replaceStart: lineStart + open,
        replaceEnd: cursor,
      };
    }
  }
  const tag = /(^|[\s(])#([\p{L}\p{N}_/-]*)$/u.exec(line);
  if (tag) {
    const hashAt = line.length - tag[2].length - 1;
    return {
      kind: "tag",
      query: tag[2],
      replaceStart: lineStart + hashAt,
      replaceEnd: cursor,
    };
  }
  return null;
}

export function applyAutocomplete(
  source: string,
  trigger: AutocompleteTrigger,
  value: string,
): { source: string; cursor: number } {
  const insertion =
    trigger.kind === "wikilink"
      ? `[[${value.replace(/\.md$/i, "")}]]`
      : `#${value.replace(/^#/, "")}`;
  const next =
    source.slice(0, trigger.replaceStart) +
    insertion +
    source.slice(trigger.replaceEnd);
  return { source: next, cursor: trigger.replaceStart + insertion.length };
}

export interface TagInfo {
  tag: string;
  count: number;
  parent?: string;
}
export type TagSort = "count" | "alpha";
export function sortTags(tags: TagInfo[], by: TagSort): TagInfo[] {
  return [...tags].sort((a, b) =>
    by === "count"
      ? b.count - a.count ||
        a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }) ||
        a.tag.localeCompare(b.tag)
      : a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }) ||
        a.tag.localeCompare(b.tag),
  );
}
export function stableTagHue(tag: string): number {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return h % 360;
}
