/**
 * Express API. Stateless over VaultService; all mutations go through the
 * service so the index/history stay consistent and writes stay safe.
 */
import { Router, json, type Request, type Response } from 'express';
import type { VaultService } from './vault-service.js';
import type { AppConfig } from '../shared/config.js';
import { searchIndex, type SearchFilters } from './search.js';
import { buildFullGraph, buildSubgraph, type GraphFilters } from './graph.js';
import { computeHealth } from './health.js';
import { UnsafePathError } from '../shared/path-utils.js';
import { setFrontmatterField, parseFrontmatter, removeFrontmatterField, toStringArray, coerceRating } from '../shared/frontmatter.js';
import { sha256 } from './obsidian-filesystem-provider.js';
import { buildKnowledgeMap } from './knowledge-map.js';

export function createApi(service: VaultService, config: AppConfig): Router {
  const r = Router();
  r.use(json({ limit: '20mb' }));

  const contents = new Map<string, string>();
  // Keep a content cache for search — refreshed on demand. Not authoritative.

  // ----- Config / vault meta -----
  r.get('/config', (_req, res) => {
    res.json({
      siteName: config.siteName,
      theme: config.theme,
      ratingScale: config.ratingScale,
      vaultName: service.provider.name,
      vaultPath: service.provider.root,
      excludedFolders: config.excludedFolders,
      attachmentFolders: config.attachmentFolders,
    });
  });

  r.get('/vault/overview', async (_req, res) => {
    res.json(await service.overview());
  });

  r.get('/vault/stats', async (_req, res) => {
    res.json(await service.getStats());
  });

  r.get('/vault/sync', async (_req, res) => {
    res.json((service as any).syncState ?? { state: 'synced', pendingFiles: 0 });
  });

  r.post('/vault/reindex', async (_req, res) => {
    const count = await service.reconcile();
    res.json({ ok: true, count, indexedAt: service.index.indexedAt });
  });

  // ----- Documents -----
  r.get('/docs', async (_req, res) => {
    res.json(await service.listDocuments());
  });

  // ----- Create / move (specific routes first, before the generic wildcard) -----
  r.post('/docs', async (req, res) => {
    const { relPath, content } = req.body ?? {};
    if (typeof relPath !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'relPath and content required' });
    }
    try {
      const result = await service.createDocument(relPath, content);
      if (!result.ok) return res.status(409).json({ error: 'exists', result });
      res.status(201).json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  r.post('/docs/move', async (req, res) => {
    const { from, to } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string') {
      return res.status(400).json({ error: 'from and to required' });
    }
    try {
      const result = await service.moveDocument(from, to);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Decode a `*`-wildcard param. Express 4 leaves %xx escapes (incl. %2F)
   *  encoded in wildcard captures; decoding once is safe & idempotent. */
  const relOf = (req: Request) =>
    decodeURIComponent((req.params as Record<string, string>)[0] || '');
  const docRel = (req: Request) => relOf(req);

  r.get('/docs/*', async (req, res) => {
    const rel = docRel(req);
    let doc = await service.getDocument(rel);
    // Fall back to title/alias resolution so wiki links ([[Page Name]]) and
    // bare markdown links resolve to the real note even in subfolders.
    if (!doc) {
      const hits = service.index.resolveTarget(rel);
      if (hits.size) doc = await service.getDocument([...hits][0]);
    }
    if (!doc) return res.status(404).json({ error: 'not found' });
    contents.set(doc.meta.relPath, doc.content);
    res.json(doc);
  });

  // ----- Ratings (persist into source frontmatter) -----
  r.put('/docs/*/rating', async (req, res) => {
    const rel = docRel(req);
    const rating = req.body?.rating;
    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'rating required' });
    }
    try {
      const full = await service.provider.readDocument(rel);
      if (!full) return res.status(404).json({ error: 'not found' });
      const scale = config.ratingScale;
      const coerced = coerceRating(rating, scale);
      if (coerced === undefined) return res.status(400).json({ error: 'invalid rating' });
      const updated = setFrontmatterField(full.content, 'rating', coerced);
      const result = await service.saveDocument(rel, updated, sha256(full.content));
      if (!result.ok) return res.status(409).json({ error: 'conflict', conflict: result.conflict });
      res.json({ ok: true, rating: coerced });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ----- Metadata fields (status, favorite, reviewed, ...) -----
  r.put('/docs/*/meta', async (req, res) => {
    const rel = docRel(req);
    const body: Record<string, unknown> = req.body ?? {};
    try {
      const full = await service.provider.readDocument(rel);
      if (!full) return res.status(404).json({ error: 'not found' });
      let content = full.content;
      const allowed = new Set(['status', 'favorite', 'reviewed', 'review-after', 'importance', 'confidence']);
      for (const key of Object.keys(body)) {
        if (!allowed.has(key)) continue;
        const val = body[key];
        if (val === null || val === '') content = removeFrontmatterField(content, key);
        else content = setFrontmatterField(content, key, val);
      }
      const result = await service.saveDocument(rel, content, sha256(full.content));
      if (!result.ok) return res.status(409).json({ error: 'conflict', conflict: result.conflict });
      const doc = await service.getDocument(rel);
      res.json({ ok: true, meta: doc?.meta });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ----- Save (safe write with conflict detection) -----
  r.put('/docs/*', async (req, res) => {
    const rel = docRel(req);
    const { content, expectedHash } = req.body ?? {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    try {
      const result = await service.saveDocument(rel, content, expectedHash ?? null);
      if (!result.ok && result.conflicted) {
        return res.status(409).json({
          error: 'conflict',
          conflict: result.conflict,
        });
      }
      if (!result.ok) return res.status(500).json({ error: 'save failed' });
      contents.set(rel, content);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  r.delete('/docs/*', async (req, res) => {
    const rel = docRel(req);
    try {
      const result = await service.deleteDocument(rel);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ----- Search -----
  r.get('/search', async (req, res) => {
    const query = String(req.query.q ?? '');
    const filters: SearchFilters = {
      tag: str(req.query.tag),
      folder: str(req.query.folder),
      ratingMin: num(req.query.ratingMin),
      ratingMax: num(req.query.ratingMax),
      rated: bool(req.query.rated),
      unrated: bool(req.query.unrated),
      hasLinks: bool(req.query.hasLinks),
      noLinks: bool(req.query.noLinks),
      createdAfter: str(req.query.createdAfter),
      createdBefore: str(req.query.createdBefore),
      modifiedAfter: str(req.query.modifiedAfter),
      modifiedBefore: str(req.query.modifiedBefore),
    };
    const results = searchIndex(service.index, query, filters, { contents, limit: 100 });
    res.json({ query, results });
  });

  // ----- Graph -----
  r.get('/graph', (req, res) => {
    const filters: GraphFilters = {
      ratingMin: num(req.query.ratingMin),
      ratingMax: num(req.query.ratingMax),
      minConnections: num(req.query.minConnections),
      tags: list(req.query.tags),
      folders: list(req.query.folders),
    };
    res.json(buildFullGraph(service.index, filters));
  });

  r.get('/graph/*/subgraph', (req, res) => {
    const rel = relOf(req);
    const depth = num(req.query.depth) ?? 1;
    res.json(buildSubgraph(service.index, rel, depth));
  });

  // ----- Knowledge Map (pure, read-only scoring over the derived index) -----
  r.get('/knowledge-map', (_req, res) => {
    res.json(buildKnowledgeMap(service.index, { ratingScale: config.ratingScale }));
  });

  // ----- Tags -----
  r.get('/tags', (_req, res) => {
    const out: { tag: string; count: number; parent?: string }[] = [];
    for (const [tag, setP] of service.index.tagIndex) {
      const slash = tag.lastIndexOf('/');
      out.push({ tag, count: setP.size, parent: slash === -1 ? undefined : tag.slice(0, slash) });
    }
    out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    res.json(out);
  });

  r.get('/tags/*', async (req, res) => {
    const tag = relOf(req);
    const paths = service.index.tagIndex.get(tag) ?? new Set();
    const docSummaries = await service.listDocuments();
    res.json([...paths].map((p) => docSummaries.find((d) => d.relPath === p)).filter(Boolean));
  });

  // ----- Folders -----
  r.get('/folders', (_req, res) => {
    const out: { folder: string; count: number }[] = [];
    for (const [folder, setP] of service.index.folderIndex) {
      out.push({ folder, count: setP.size });
    }
    out.sort((a, b) => a.folder.localeCompare(b.folder));
    res.json(out);
  });

  // ----- Health -----
  r.get('/health', (_req, res) => {
    res.json({ issues: computeHealth(service.index) });
  });

  // ----- Recent / changed -----
  r.get('/recent', async (req, res) => {
    const limit = num(req.query.limit) ?? 50;
    const docs = await service.listDocuments();
    docs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json(docs.slice(0, limit));
  });

  r.get('/changes', (_req, res) => {
    res.json({ buckets: service.history.buckets() });
  });

  r.get('/activity', async (req, res) => {
    const docs = await service.listDocuments();
    const now = Date.now();
    const day = 86400000;
    const today = docs.filter((d) => d.mtimeMs >= new Date().setHours(0, 0, 0, 0));
    const thisWeek = docs.filter((d) => d.mtimeMs >= now - 7 * day);
    const addedLinks = service.index.notes.size;
    res.json({
      pagesChangedToday: today.length,
      pagesChangedThisWeek: thisWeek.length,
      newPages: 0,
      recentlyAddedLinks: addedLinks,
      lastChanges: service.history.all().slice(0, 20),
    });
  });

  // ----- Timeline -----
  r.get('/timeline', async (_req, res) => {
    const docs = await service.listDocuments();
    const entries = docs
      .map((d) => ({
        date: new Date(d.mtimeMs).toISOString().slice(0, 10),
        title: d.title,
        relPath: d.relPath,
        type: 'modified' as const,
        tags: d.tags,
        rating: d.rating,
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    res.json(entries);
  });

  // ----- Raw attachment / asset serving -----
  r.get('/raw/*', async (req, res) => {
    const rel = relOf(req);
    try {
      const buf = await service.provider.readRaw(rel);
      if (!buf) return res.status(404).json({ error: 'not found' });
      res.setHeader('Content-Type', contentTypeFor(rel));
      res.send(buf);
    } catch {
      res.status(404).json({ error: 'not found' });
    }
  });

  return r;
}

// ----- helpers -----
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}
function bool(v: unknown): boolean | undefined {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}
function list(v: unknown): string[] | undefined {
  if (typeof v === 'string' && v) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
}

function contentTypeFor(rel: string): string {
  const ext = rel.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
    mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
    md: 'text/markdown',
  };
  return map[ext] ?? 'application/octet-stream';
}

function handleError(res: Response, err: unknown) {
  if (err instanceof UnsafePathError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'server error' });
}

export { parseFrontmatter, toStringArray };
export type { Request };