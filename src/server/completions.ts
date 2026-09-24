/**
 * S7-3 — server-ranked completions.
 *
 * One endpoint serves every editor completion kind. Note and tag results
 * preserve today's behaviour (title/folder and count-ordered tags); headings,
 * block refs and callout types are derived from a note's MASKED content so an
 * anonymous caller can never receive agent-block text or IDs.
 */
import { maskAgentBlocks } from "../shared/agent-blocks.js";
import { searchIndex } from "./search.js";
import type { VaultService } from "./vault-service.js";

export type CompletionKind = "note" | "tag" | "heading" | "blockref" | "callout";

export interface Completion {
  value: string;
  detail?: string;
  score: number;
}

export const COMPLETION_KINDS: readonly CompletionKind[] = [
  "note",
  "tag",
  "heading",
  "blockref",
  "callout",
];

/** Callout types always offered, including the site's own agent callouts. */
export const BASE_CALLOUTS = [
  "note", "info", "tip", "success", "warning", "danger", "error",
  "question", "quote", "example", "agent", "agent-review",
];

export function isCompletionKind(value: string): value is CompletionKind {
  return (COMPLETION_KINDS as readonly string[]).includes(value);
}

function rank(value: string, query: string): number {
  if (!query) return 1;
  const lower = value.toLowerCase();
  const q = query.toLowerCase();
  if (lower === q) return 100;
  if (lower.startsWith(q)) return 60 - Math.min(20, value.length - q.length);
  const at = lower.indexOf(q);
  if (at >= 0) return 30 - Math.min(20, at);
  return 0;
}

function uniqueSorted(values: Iterable<string>, query: string): string[] {
  const seen = new Set<string>();
  for (const value of values) if (value) seen.add(value);
  return [...seen]
    .map((value) => ({ value, score: rank(value, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .map((item) => item.value);
}

/** Headings and block refs from already-masked markdown. */
export function headingsOf(masked: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of masked.split(/\r?\n/)) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      fence = fence ? (line.trim().startsWith(fence) ? null : fence) : fenceMatch[1];
      continue;
    }
    if (fence) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) out.push(heading[1].trim());
  }
  return out;
}

export function blockRefsOf(masked: string): string[] {
  const out: string[] = [];
  for (const match of masked.matchAll(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/gm)) out.push(match[1]);
  return out;
}

export function calloutTypesOf(masked: string): string[] {
  const out: string[] = [];
  for (const match of masked.matchAll(/^>\s*\[!([A-Za-z-]+)\][+-]?/gm)) out.push(match[1].toLowerCase());
  return out;
}

export interface CompletionRequest {
  kind: CompletionKind;
  query: string;
  path?: string;
  limit?: number;
}

export async function buildCompletions(
  service: VaultService,
  contents: Map<string, string>,
  request: CompletionRequest,
): Promise<Completion[]> {
  const limit = Math.max(1, Math.min(50, request.limit ?? 8));
  const query = request.query.trim();

  if (request.kind === "note") {
    // Preserve today's note ranking exactly by reusing the search index.
    const results = searchIndex(service.index, query, {}, { contents, limit });
    return results.map((r) => ({ value: r.title, detail: r.folder, score: r.score }));
  }

  if (request.kind === "tag") {
    const ranked = [...service.index.tagIndex]
      .map(([tag, set]) => ({ tag, count: set.size, score: rank(tag, query) }))
      .filter((t) => t.score > 0)
      .sort((a, b) => b.score - a.score || b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit);
    return ranked.map((t) => ({ value: t.tag, detail: `${t.count} note${t.count === 1 ? "" : "s"}`, score: t.score }));
  }

  if (request.kind === "callout") {
    const observed: string[] = [...BASE_CALLOUTS];
    for (const note of service.index.notes.values()) {
      try {
        const full = await service.provider.readDocument(note.meta.relPath);
        if (full?.content) observed.push(...calloutTypesOf(maskAgentBlocks(full.content)));
      } catch {
        // Skip notes that vanished mid-scan.
      }
    }
    return uniqueSorted(observed, query).slice(0, limit).map((value, i) => ({ value, score: limit - i }));
  }

  // heading | blockref — derived from one note's masked content.
  const rel = request.path;
  if (!rel) return [];
  const doc = service.index.notes.has(rel) ? rel : null;
  if (!doc) return [];
  let masked: string;
  try {
    const full = await service.provider.readDocument(rel);
    if (!full?.content) return [];
    masked = maskAgentBlocks(full.content);
  } catch {
    return [];
  }
  const values = request.kind === "heading" ? headingsOf(masked) : blockRefsOf(masked);
  return uniqueSorted(values, query)
    .slice(0, limit)
    .map((value, i) => ({ value, score: limit - i }));
}
