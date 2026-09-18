/**
 * Disposable in-memory knowledge index, rebuildable entirely from the source
 * Markdown. It is derived state: losing it costs a rescan, never data.
 *
 * Inverted indices let wiki links, backlinks, tags, ratings, and graph edges
 * resolve instantly without re-reading files on every request.
 */
import type { DocMeta, IndexStats } from '../shared/types.js';
import { parseWikiLinks } from '../shared/wiki.js';
import { baseNameOf } from '../shared/path-utils.js';

export interface LinkRef {
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
}

export interface IndexedNote {
  meta: DocMeta;
  outgoing: LinkRef[];
  outgoingTargets: string[];
}

/** Normalize a wiki-link target for resolution (strip heading/block, case-fold). */
export function normalizeTarget(target: string): string {
  return target.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function linksFromContent(content: string): LinkRef[] {
  return parseWikiLinks(content).map((s) => ({
    target: s.target,
    alias: s.alias,
    heading: s.heading,
    block: s.block,
  }));
}

export class KnowledgeIndex {
  /** relPath -> note */
  notes = new Map<string, IndexedNote>();
  /** normalizedTarget -> set of relPaths whose base/title/alias match. */
  targetIndex = new Map<string, Set<string>>();
  /** tag -> set of relPaths */
  tagIndex = new Map<string, Set<string>>();
  /** folder -> set of relPaths */
  folderIndex = new Map<string, Set<string>>();
  /** rating -> set of relPaths */
  ratingIndex = new Map<number, Set<string>>();
  /** normalizedTarget -> set of relPaths that link TO it (incoming). */
  incomingIndex = new Map<string, Set<string>>();
  /** relPath -> set of resolved neighbour relPaths (undirected edges for graph). */
  edges = new Map<string, Set<string>>();

  indexedAt: string | null = null;

  clear() {
    this.notes.clear();
    this.targetIndex.clear();
    this.tagIndex.clear();
    this.folderIndex.clear();
    this.ratingIndex.clear();
    this.incomingIndex.clear();
    this.edges.clear();
    this.indexedAt = null;
  }

  /** Rebuild from scratch via a provider callback that yields meta+content. */
  async rebuild(
    scan: () => Promise<Array<{ meta: DocMeta; content: string }>>
  ): Promise<number> {
    this.clear();
    for (const { meta, content } of await scan()) {
      this.upsertNote(meta, content);
    }
    this.indexedAt = new Date().toISOString();
    return this.notes.size;
  }

  upsertNote(meta: DocMeta, content: string) {
    this.removeNote(meta.relPath);
    const refs = linksFromContent(content);
    const note: IndexedNote = {
      meta,
      outgoing: refs,
      outgoingTargets: refs.map((r) => normalizeTarget(r.target)),
    };
    this.notes.set(meta.relPath, note);

    // Target index (for resolving [[Page]] by base/title/alias).
    const keys = new Set<string>([
      normalizeTarget(meta.baseName),
      normalizeTarget(meta.title),
      ...(meta.aliases ?? []).map(normalizeTarget),
    ]);
    for (const k of keys) if (k) this.addToSet(this.targetIndex, k, meta.relPath);

    for (const t of meta.tags ?? []) this.addToSet(this.tagIndex, t, meta.relPath);
    this.addToSet(this.folderIndex, meta.folder, meta.relPath);
    if (meta.rating !== undefined) this.addToSet(this.ratingIndex, meta.rating, meta.relPath);

    // Incoming bookkeeping.
    for (const t of note.outgoingTargets) {
      this.addToSet(this.incomingIndex, t, meta.relPath);
    }
    // A new title/alias/link can change any note's resolved neighbourhood.
    this.edges.clear();
  }

  /** Recompute links for a note whose content changed, then refresh resolved edges. */
  updateLinks(relPath: string, content: string) {
    const note = this.notes.get(relPath);
    if (!note) return;
    for (const t of note.outgoingTargets) {
      const s = this.incomingIndex.get(t);
      s?.delete(relPath);
      if (s && s.size === 0) this.incomingIndex.delete(t);
    }
    const refs = linksFromContent(content);
    note.outgoing = refs;
    note.outgoingTargets = refs.map((r) => normalizeTarget(r.target));
    for (const t of note.outgoingTargets) this.addToSet(this.incomingIndex, t, relPath);
    // Link edits can change both this note and every linked note's undirected
    // neighbourhood, so invalidate the derived cache globally.
    this.edges.clear();
  }

  removeNote(relPath: string) {
    const note = this.notes.get(relPath);
    this.notes.delete(relPath);
    if (note) {
      for (const t of note.outgoingTargets) {
        const s = this.incomingIndex.get(t);
        s?.delete(relPath);
        if (s && s.size === 0) this.incomingIndex.delete(t);
      }
    }
    const stringMaps: Array<Map<string, Set<string>>> = [
      this.targetIndex,
      this.tagIndex,
      this.folderIndex,
    ];
    for (const map of stringMaps) {
      for (const [k, set] of [...map]) {
        set.delete(relPath);
        if (set.size === 0) map.delete(k);
      }
    }
    for (const [k, set] of [...this.ratingIndex]) {
      set.delete(relPath);
      if (set.size === 0) this.ratingIndex.delete(k);
    }
    // Deleting a target can change resolution and connectivity for any note.
    this.edges.clear();
  }

  /** Resolve a raw wiki target to matching relPaths. */
  resolveTarget(target: string): Set<string> {
    let key = normalizeTarget(target);
    const hit = this.targetIndex.get(key);
    if (hit && hit.size) return hit;
    const bare = baseNameOf(target);
    if (bare && bare !== target) {
      const hit2 = this.targetIndex.get(normalizeTarget(bare));
      if (hit2 && hit2.size) return hit2;
    }
    return new Set();
  }

  /** relPaths whose base/title/alias matches target (helper for incoming). */
  keysForTarget(target: string): Set<string> {
    return this.resolveTarget(target);
  }

  /** Incoming relPaths that point to `relPath` (backlinks). */
  backlinksOf(relPath: string): Set<string> {
    const note = this.notes.get(relPath);
    const out = new Set<string>();
    if (!note) return out;
    const keys = new Set<string>([
      normalizeTarget(note.meta.baseName),
      normalizeTarget(note.meta.title),
      ...(note.meta.aliases ?? []).map(normalizeTarget),
    ]);
    for (const k of keys) {
      const incoming = this.incomingIndex.get(k);
      if (incoming) for (const p of incoming) if (p !== relPath) out.add(p);
    }
    return out;
  }

  /** Resolved undirected neighbours of a note. */
  neighboursOf(relPath: string): Set<string> {
    const cached = this.edges.get(relPath);
    if (cached) return cached;
    const out = new Set<string>();
    const note = this.notes.get(relPath);
    if (note) {
      for (const t of note.outgoingTargets) {
        for (const hit of this.resolveTarget(t)) if (hit !== relPath) out.add(hit);
      }
    }
    for (const b of this.backlinksOf(relPath)) out.add(b);
    this.edges.set(relPath, out);
    return out;
  }

  recomputeEdgesFor(relPath: string) {
    this.edges.delete(relPath);
    // Invalid neighbour caches that may have referenced relPath's links.
    this.neighboursOf(relPath);
  }

  stats(): IndexStats {
    const notes = [...this.notes.values()];
    let linkCount = 0;
    let broken = 0;
    let orphans = 0;
    const tagSet = new Set<string>();
    for (const n of notes) {
      linkCount += n.outgoingTargets.length;
      for (const t of n.meta.tags ?? []) tagSet.add(t);
    }
    for (const n of notes) {
      const resolvedAny = n.outgoingTargets.some((t) => this.resolveTarget(t).size > 0);
      if (!resolvedAny) orphans++;
      for (const t of n.outgoingTargets) {
        if (this.resolveTarget(t).size === 0) broken++;
      }
    }
    const rated = notes.filter((n) => n.meta.rating !== undefined);
    const avg = rated.length
      ? rated.reduce((a, n) => a + (n.meta.rating as number), 0) / rated.length
      : null;
    return {
      noteCount: notes.length,
      linkCount,
      backlinkCount: notes.reduce((a, n) => a + this.backlinksOf(n.meta.relPath).size, 0),
      tagCount: tagSet.size,
      orphanCount: orphans,
      brokenLinkCount: broken,
      unresolvedWikiLinkCount: broken,
      avgRating: avg ? Math.round(avg * 100) / 100 : null,
      ratedCount: rated.length,
      unratedCount: notes.length - rated.length,
      favoriteCount: notes.filter((n) => n.meta.favorite).length,
      totalWords: notes.reduce((a, n) => a + n.meta.wordCount, 0),
    };
  }

  private addToSet<K extends string | number>(map: Map<K, Set<string>>, key: K, value: string) {
    if (typeof key === 'string' && !key) return;
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(value);
  }
}