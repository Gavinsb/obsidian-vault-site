/**
 * Full-vault search over the in-memory index. Scored token matching across
 * title, aliases, tags, frontmatter, and body text, with the ranking favouring
 * title/alias/tag hits, then body hits. Filters narrow by tag, folder,
 * rating, date ranges, and link state.
 */
import type { IndexedNote, KnowledgeIndex } from './indexer.js';
import { normalizeTarget } from './indexer.js';

export interface SearchFilters {
  tag?: string;
  folder?: string;
  ratingMin?: number;
  ratingMax?: number;
  rated?: boolean;
  unrated?: boolean;
  hasLinks?: boolean;
  noLinks?: boolean;
  createdAfter?: string; // ISO date
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface SearchResult {
  relPath: string;
  title: string;
  folder: string;
  snippet: string;
  score: number;
  tags: string[];
  rating?: number;
  mtimeMs: number;
  matchedField: 'title' | 'alias' | 'tag' | 'frontmatter' | 'body' | 'filename';
}

const STOP = new Set([
  'the', 'and', 'for', 'are', 'was', 'with', 'this', 'that', 'from', 'have',
  'has', 'had', 'not', 'but', 'you', 'your', 'they', 'them', 'our', 'all',
  'can', 'will', 'would', 'there', 'their', 'what', 'which', 'when', 'where',
  'how', 'why', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'or', 'as', 'at',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function searchIndex(
  index: KnowledgeIndex,
  query: string,
  filters: SearchFilters = {},
  opts: { contents: Map<string, string>; limit?: number } = { contents: new Map() }
): SearchResult[] {
  const tokens = tokenize(query);
  const results: SearchResult[] = [];
  const limit = opts.limit ?? 100;

  for (const note of index.notes.values()) {
    const m = note.meta;
    if (!passesFilters(note, index, filters)) continue;
    if (tokens.length === 0) {
      // Empty query just returns filtered notes.
      results.push(buildResult(note, '', 'body', 0, opts.contents.get(m.relPath) ?? ''));
      continue;
    }

    const body = opts.contents.get(m.relPath) ?? '';
    const bodyTokens = tokenize(body);

    let score = 0;
    let bestField: SearchResult['matchedField'] = 'body';
    let matchedAny = false;

    // Exact-ish title match (whole query).
    const titleLow = m.title.toLowerCase();
    const baseLow = m.baseName.toLowerCase();
    if (titleLow === query.toLowerCase() || baseLow === query.toLowerCase()) {
      bestField = 'title';
      score = 1000;
      matchedAny = true;
    }

    for (const t of tokens) {
      if (titleLow.includes(t)) {
        score += 60;
        bestField = 'title';
        matchedAny = true;
      }
      if (baseLow.includes(t)) {
        score += 70;
        bestField = 'filename';
        matchedAny = true;
      }
      for (const a of m.aliases ?? []) {
        if (a.toLowerCase().includes(t)) {
          score += 55;
          bestField = 'alias';
          matchedAny = true;
        }
      }
      for (const tag of m.tags ?? []) {
        if (tag.toLowerCase().includes(t)) {
          score += 50;
          bestField = 'tag';
          matchedAny = true;
        }
      }
      const fmText = JSON.stringify(m.frontmatter ?? {}).toLowerCase();
      if (fmText.includes(t)) {
        score += 20;
        bestField = 'frontmatter';
        matchedAny = true;
      }
      const count = bodyTokens.filter((bt) => bt === t).length;
      if (count) {
        score += Math.min(30, 5 + count * 4);
        matchedAny = true;
      }
    }

    if (!matchedAny) continue;
    results.push(buildResult(note, query, bestField, score, body));
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function passesFilters(note: IndexedNote, index: KnowledgeIndex, f: SearchFilters): boolean {
  const m = note.meta;
  if (f.tag && !(m.tags ?? []).includes(f.tag)) return false;
  if (f.folder && m.folder !== f.folder) return false;
  if (f.ratingMin !== undefined && (m.rating === undefined || m.rating < f.ratingMin)) return false;
  if (f.ratingMax !== undefined && (m.rating === undefined || m.rating > f.ratingMax)) return false;
  if (f.rated && m.rating === undefined) return false;
  if (f.unrated && m.rating !== undefined) return false;
  const hasLinks = note.outgoing.length > 0;
  if (f.hasLinks && !hasLinks) return false;
  if (f.noLinks && hasLinks) return false;
  // Note: filters use string date prefixes for simplicity (YYYY-MM-DD).
  if (f.createdAfter && (!m.ctimeMs || m.ctimeMs < new Date(f.createdAfter).getTime())) {
    if (!m.created || m.created < f.createdAfter) return false;
  }
  if (f.createdBefore && (!m.ctimeMs || m.ctimeMs > new Date(f.createdBefore).getTime())) {
    if (!m.created || m.created > f.createdBefore) return false;
  }
  if (f.modifiedAfter && m.mtimeMs < new Date(f.modifiedAfter).getTime()) return false;
  if (f.modifiedBefore && m.mtimeMs > new Date(f.modifiedBefore).getTime()) return false;
  void index;
  return true;
}

function buildResult(
  note: IndexedNote,
  query: string,
  field: SearchResult['matchedField'],
  score: number,
  body: string
): SearchResult {
  const m = note.meta;
  const tokens = tokenize(query);
  let snippet = '';
  if (tokens.length && body) {
    const idx = findSnippetIndex(body, tokens);
    const start = Math.max(0, idx - 60);
    snippet =
      (start > 0 ? '…' : '') +
      body.slice(start, idx + 140).replace(/\s+/g, ' ').trim() +
      (start + 200 < body.length ? '…' : '');
  } else {
    snippet = body.replace(/\s+/g, ' ').slice(0, 160).trim();
    if (body.length > 160) snippet += '…';
  }
  void normalizeTarget;
  return {
    relPath: m.relPath,
    title: m.title,
    folder: m.folder,
    snippet,
    score,
    tags: m.tags ?? [],
    rating: m.rating,
    mtimeMs: m.mtimeMs,
    matchedField: field,
  };
}

function findSnippetIndex(body: string, tokens: string[]): number {
  let best = 0;
  let bestIdx = -1;
  const low = body.toLowerCase();
  for (const t of tokens) {
    const i = low.indexOf(t);
    if (i !== -1) {
      // Prefer earlier, more central occurrences.
      const centrality = body.length ? 1 - Math.abs(i - body.length / 2) / (body.length / 2) : 0;
      if (bestIdx === -1 || centrality > best) {
        best = centrality;
        bestIdx = i;
      }
    }
  }
  return bestIdx === -1 ? 0 : bestIdx;
}