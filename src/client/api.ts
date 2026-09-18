/** Thin typed wrapper around the microsite API. */
import type {
  Document,
  VaultOverview,
  IndexStats,
  VaultDocSummary,
  HealthIssue,
  DocMeta,
  LinkRef,
  KnowledgeMapResponse,
  KnowledgeMapItem,
  KnowledgeLens,
} from '../shared/types';

export type {
  Document,
  VaultOverview,
  IndexStats,
  VaultDocSummary,
  HealthIssue,
  DocMeta,
  LinkRef,
  KnowledgeMapResponse,
  KnowledgeMapItem,
  KnowledgeLens,
};

export interface SearchHit {
  relPath: string;
  title: string;
  folder: string;
  snippet: string;
  score: number;
  tags: string[];
  rating?: number;
  mtimeMs: number;
  matchedField: string;
}

export interface GraphData {
  nodes: {
    id: string;
    title: string;
    folder: string;
    tags: string[];
    rating?: number;
    linkCount: number;
    mtimeMs: number;
  }[];
  edges: { source: string; target: string }[];
}

export interface ChangesBuckets {
  today: ChangeEntry[];
  yesterday: ChangeEntry[];
  thisWeek: ChangeEntry[];
  older: ChangeEntry[];
}
export interface ChangeEntry {
  seq: number;
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  relPath: string;
  atMs: number;
  rating?: number;
  tags: string[];
  title?: string;
}

export interface AppConfig {
  siteName: string;
  theme: string;
  ratingScale: number;
  vaultName: string;
  vaultPath: string;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error ?? detail;
    } catch {
      /* ignore */
    }
    const err = new Error(detail) as Error & { status: number; conflict?: unknown };
    err.status = res.status;
    if (res.status === 409) err.conflict = detail;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => req<AppConfig>('/api/config'),
  overview: () => req<VaultOverview>('/api/vault/overview'),
  stats: () => req<IndexStats>('/api/vault/stats'),
  reindex: () => req<{ ok: boolean; count: number }>('/api/vault/reindex', { method: 'POST' }),
  docs: () => req<VaultDocSummary[]>('/api/docs'),
  getDoc: (p: string) => req<Document>(`/api/docs/${encodeURIComponent(p)}`),
  saveDoc: (p: string, content: string, expectedHash: string) =>
    req<{ ok: boolean; conflict?: unknown }>(`/api/docs/${encodeURIComponent(p)}`, {
      method: 'PUT',
      body: JSON.stringify({ content, expectedHash }),
    }),
  createDoc: (relPath: string, content: string) =>
    req<{ ok: boolean }>('/api/docs', { method: 'POST', body: JSON.stringify({ relPath, content }) }),
  moveDoc: (from: string, to: string) =>
    req<{ ok: boolean }>('/api/docs/move', { method: 'POST', body: JSON.stringify({ from, to }) }),
  deleteDoc: (p: string) => req<{ ok: boolean }>(`/api/docs/${encodeURIComponent(p)}`, { method: 'DELETE' }),
  rate: (p: string, rating: number) =>
    req<{ ok: boolean; rating: number }>(`/api/docs/${encodeURIComponent(p)}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ rating }),
    }),
  setMeta: (p: string, patch: Record<string, unknown>) =>
    req<{ ok: boolean; meta?: unknown }>(`/api/docs/${encodeURIComponent(p)}/meta`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  search: (q: string, filters: Record<string, unknown> = {}) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    return req<{ query: string; results: SearchHit[] }>(`/api/search?${sp.toString()}`);
  },
  graph: (filters: Record<string, unknown> = {}) => {
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    return req<GraphData>(`/api/graph?${sp.toString()}`);
  },
  subgraph: (p: string, depth: number) =>
    req<GraphData>(`/api/graph/${encodeURIComponent(p)}/subgraph?depth=${depth}`),
  knowledgeMap: () => req<KnowledgeMapResponse>('/api/knowledge-map'),
  tags: () =>
    req<{ tag: string; count: number; parent?: string }[]>('/api/tags'),
  tagDocs: (tag: string) => req<VaultDocSummary[]>(`/api/tags/${encodeURIComponent(tag)}`),
  folders: () => req<{ folder: string; count: number }[]>('/api/folders'),
  health: () => req<{ issues: HealthIssue[] }>('/api/health'),
  recent: (limit = 50) => req<VaultDocSummary[]>(`/api/recent?limit=${limit}`),
  changes: () => req<{ buckets: ChangesBuckets }>('/api/changes'),
  activity: () =>
    req<{
      pagesChangedToday: number;
      pagesChangedThisWeek: number;
      lastChanges: ChangeEntry[];
    }>('/api/activity'),
  timeline: () =>
    req<
      { date: string; title: string; relPath: string; type: string; tags: string[]; rating?: number }[]
    >('/api/timeline'),
};