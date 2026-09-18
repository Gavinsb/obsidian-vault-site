/**
 * Graph model over the index. Nodes are notes; edges are resolved wiki links.
 * Supports hop-limited neighbourhood expansion, filters, and connectivity stats.
 */
import type { KnowledgeIndex } from './indexer.js';

export interface GraphNode {
  id: string; // relPath
  title: string;
  folder: string;
  tags: string[];
  rating?: number;
  linkCount: number;
  mtimeMs: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphFilters {
  tags?: string[];
  folders?: string[];
  ratingMin?: number;
  ratingMax?: number;
  minConnections?: number;
  modifiedAfter?: number;
}

export function buildFullGraph(index: KnowledgeIndex, filters: GraphFilters = {}): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  const includeNode = (relPath: string): boolean => {
    const n = index.notes.get(relPath);
    if (!n) return false;
    const m = n.meta;
    if (filters.tags?.length && !(m.tags ?? []).some((t) => filters.tags!.includes(t))) return false;
    if (filters.folders?.length && !filters.folders.includes(m.folder)) return false;
    if (filters.ratingMin !== undefined && (m.rating === undefined || m.rating < filters.ratingMin)) return false;
    if (filters.ratingMax !== undefined && (m.rating === undefined || m.rating > filters.ratingMax)) return false;
    if (filters.modifiedAfter !== undefined && m.mtimeMs < filters.modifiedAfter) return false;
    return true;
  };

  for (const n of index.notes.values()) {
    if (!includeNode(n.meta.relPath)) continue;
    const neighbours = index.neighboursOf(n.meta.relPath);
    if (filters.minConnections !== undefined && neighbours.size < filters.minConnections) continue;
    nodes.push({
      id: n.meta.relPath,
      title: n.meta.title,
      folder: n.meta.folder,
      tags: n.meta.tags ?? [],
      rating: n.meta.rating,
      linkCount: neighbours.size,
      mtimeMs: n.meta.mtimeMs,
    });
  }

  const nodeSet = new Set(nodes.map((n) => n.id));
  for (const a of nodeSet) {
    for (const b of index.neighboursOf(a)) {
      if (!nodeSet.has(b)) continue;
      const key = a < b ? `${a}||${b}` : `${b}||${a}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ source: a, target: b });
    }
  }

  return { nodes, edges };
}

/** Hop-limited local subgraph around a seed note. */
export function buildSubgraph(
  index: KnowledgeIndex,
  seed: string,
  depth: number,
  includeIncoming = true
): GraphData {
  const seen = new Set<string>([seed]);
  const frontier = new Set<string>([seed]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const relPath of frontier) {
      const note = index.notes.get(relPath);
      if (!note) continue;
      const add = new Set<string>();
      for (const t of note.outgoingTargets) {
        for (const hit of index.resolveTarget(t)) add.add(hit);
      }
      if (includeIncoming) for (const b of index.backlinksOf(relPath)) add.add(b);
      for (const x of add) {
        if (x !== relPath && !seen.has(x)) {
          seen.add(x);
          next.add(x);
        }
      }
    }
    frontier.clear();
    for (const n of next) frontier.add(n);
  }

  const nodes: GraphNode[] = [];
  for (const relPath of seen) {
    const n = index.notes.get(relPath);
    if (!n) continue;
    nodes.push({
      id: relPath,
      title: n.meta.title,
      folder: n.meta.folder,
      tags: n.meta.tags ?? [],
      rating: n.meta.rating,
      linkCount: index.neighboursOf(relPath).size,
      mtimeMs: n.meta.mtimeMs,
    });
  }

  const nodeSet = seen;
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  for (const src of nodeSet) {
    const note = index.notes.get(src);
    if (!note) continue;
    for (const t of note.outgoingTargets) {
      for (const dst of index.resolveTarget(t)) {
        if (!nodeSet.has(dst)) continue;
        const key = src < dst ? `${src}||${dst}` : `${dst}||${src}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({ source: src, target: dst });
      }
    }
  }
  return { nodes, edges };
}