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
} from "../shared/types";

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
  type: "created" | "modified" | "deleted" | "renamed";
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
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: any,
  ) {
    super(message);
  }
}
async function response<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; etag: string | null }> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  let body: any = {};
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok)
    throw new ApiError(
      body?.message ?? body?.error ?? res.statusText,
      res.status,
      body,
    );
  return { data: body as T, etag: res.headers.get("etag") };
}
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  return (await response<T>(url, init)).data;
}
export interface SessionUser {
  id: string;
  username: string;
  role: "admin" | "user";
}
export interface AdminUser extends SessionUser {
  active: boolean;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string;
}
export const api = {
  config: () => req<AppConfig>("/api/config"),
  overview: () => req<VaultOverview>("/api/vault/overview"),
  stats: () => req<IndexStats>("/api/vault/stats"),
  reindex: () =>
    req<{ ok: boolean; count: number }>("/api/vault/reindex", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  docs: () => req<VaultDocSummary[]>("/api/docs"),
  getDoc: (p: string) => req<Document>(`/api/docs/${encodeURIComponent(p)}`),
  getDocAgents: (p: string) =>
    req<Document>(`/api/docs/${encodeURIComponent(p)}?agents=1`),
  agentIds: () => req<{ ids: string[] }>("/api/agent/ids"),
  completions: (
    kind: "note" | "tag" | "heading" | "blockref" | "callout",
    q: string,
    path?: string,
    limit = 8,
  ) =>
    req<{
      kind: string;
      query: string;
      results: { value: string; detail?: string; score: number }[];
    }>(
      `/api/completions?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}&limit=${limit}` +
        (path ? `&path=${encodeURIComponent(path)}` : ""),
    ),
  getSource: (p: string) =>
    response<Document>(`/api/docs/${encodeURIComponent(p)}/source`),
  saveDoc: (p: string, content: string, etag: string) =>
    response<{ ok: boolean; meta?: unknown }>(
      `/api/docs/${encodeURIComponent(p)}`,
      {
        method: "PUT",
        headers: { "If-Match": etag },
        body: JSON.stringify({ content }),
      },
    ),
  createDoc: (relPath: string, content: string) =>
    req<{ ok: boolean }>("/api/docs", {
      method: "POST",
      body: JSON.stringify({ relPath, content }),
    }),
  moveDoc: (from: string, to: string) =>
    req<{ ok: boolean }>("/api/docs/move", {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  deleteDoc: (p: string, etag: string) =>
    req<{ ok: boolean }>(`/api/docs/${encodeURIComponent(p)}`, {
      method: "DELETE",
      headers: { "If-Match": etag },
      body: JSON.stringify({}),
    }),
  rate: (p: string, rating: number, etag: string) =>
    response<{ ok: boolean; meta?: unknown }>(
      `/api/docs/${encodeURIComponent(p)}/rating`,
      {
        method: "PUT",
        headers: { "If-Match": etag },
        body: JSON.stringify({ rating }),
      },
    ),
  setMeta: (p: string, patch: Record<string, unknown>, etag: string) =>
    response<{ ok: boolean; meta?: unknown }>(
      `/api/docs/${encodeURIComponent(p)}/meta`,
      {
        method: "PUT",
        headers: { "If-Match": etag },
        body: JSON.stringify(patch),
      },
    ),
  search: (q: string, filters: Record<string, unknown> = {}) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    });
    return req<{ query: string; results: SearchHit[] }>(
      `/api/search?${sp.toString()}`,
    );
  },
  graph: (filters: Record<string, unknown> = {}) => {
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    });
    return req<GraphData>(`/api/graph?${sp.toString()}`);
  },
  subgraph: (p: string, depth: number) =>
    req<GraphData>(
      `/api/graph/${encodeURIComponent(p)}/subgraph?depth=${depth}`,
    ),
  knowledgeMap: () => req<KnowledgeMapResponse>("/api/knowledge-map"),
  tags: () =>
    req<{ tag: string; count: number; parent?: string }[]>("/api/tags"),
  tagDocs: (tag: string) =>
    req<VaultDocSummary[]>(`/api/tags/${encodeURIComponent(tag)}`),
  folders: () => req<{ folder: string; count: number }[]>("/api/folders"),
  health: () => req<{ issues: HealthIssue[] }>("/api/health"),
  recent: (limit = 50) => req<VaultDocSummary[]>(`/api/recent?limit=${limit}`),
  changes: () => req<{ buckets: ChangesBuckets }>("/api/changes"),
  activity: () =>
    req<{
      pagesChangedToday: number;
      pagesChangedThisWeek: number;
      lastChanges: ChangeEntry[];
    }>("/api/activity"),
  timeline: () =>
    req<
      {
        date: string;
        title: string;
        relPath: string;
        type: string;
        tags: string[];
        rating?: number;
      }[]
    >("/api/timeline"),
  session: () =>
    req<{ authenticated: boolean; user?: SessionUser }>("/api/auth/session"),
  login: (username: string, password: string) =>
    req<{ authenticated: true; user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    req<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  users: () => req<AdminUser[]>("/api/admin/users"),
  createUser: (
    username: string,
    password: string,
    role: "admin" | "user" = "user",
  ) =>
    req<AdminUser>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    }),
  resetPassword: (id: string, password: string) =>
    req<{ ok: boolean }>(`/api/admin/users/${id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),
  setUserStatus: (id: string, active: boolean) =>
    req<{ ok: boolean }>(`/api/admin/users/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    }),
  setUserRole: (id: string, role: "admin" | "user") =>
    req<{ ok: boolean }>(`/api/admin/users/${id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    }),
};
