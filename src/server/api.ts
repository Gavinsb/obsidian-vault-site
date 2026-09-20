/** Public read API plus authenticated, origin-checked mutation API. */
import {
  Router,
  json,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { VaultService } from "./vault-service.js";
import type { AppConfig } from "../shared/config.js";
import { searchIndex, type SearchFilters } from "./search.js";
import { buildFullGraph, buildSubgraph, type GraphFilters } from "./graph.js";
import { computeHealth } from "./health.js";
import { UnsafePathError, toRelPath } from "../shared/path-utils.js";
import {
  setFrontmatterField,
  parseFrontmatter,
  removeFrontmatterField,
  toStringArray,
  coerceRating,
} from "../shared/frontmatter.js";
import { buildKnowledgeMap } from "./knowledge-map.js";
import { maskAgentBlocks } from "../shared/agent-blocks.js";
import {
  conditionalSave,
  etagFor,
  injectUpdated,
  parseIfMatch,
} from "./write-pipeline.js";
import { AuthError, type AuthService } from "./auth.js";

export function createApi(
  service: VaultService,
  config: AppConfig,
  auth: AuthService,
): Router {
  const r = Router();
  r.use(json({ limit: "20mb", type: "application/json" }));
  r.use(auth.middleware);
  r.use(auth.originGuard);
  const contents = new Map<string, string>();
  const requireJson = (req: Request, res: Response, next: NextFunction) =>
    req.is("application/json")
      ? next()
      : res.status(415).json({ error: "application_json_required" });
  const user = [auth.requireUser, requireJson];
  const admin = [auth.requireAdmin, requireJson];

  r.get("/config", (_req, res) =>
    res.json({
      siteName: config.siteName,
      theme: config.theme,
      ratingScale: config.ratingScale,
      vaultName: service.provider.name,
    }),
  );
  r.get("/vault/overview", async (_req, res) => {
    const { path: _path, ...safe } = await service.overview();
    res.json(safe);
  });
  r.get("/vault/stats", async (_req, res) =>
    res.json(await service.getStats()),
  );
  r.get("/vault/sync", (_req, res) =>
    res.json(
      (service as any).syncState ?? { state: "synced", pendingFiles: 0 },
    ),
  );
  r.post("/vault/reindex", ...admin, async (_req, res) => {
    const count = await service.reconcile();
    res.json({ ok: true, count, indexedAt: service.index.indexedAt });
  });

  r.post("/auth/login", requireJson, async (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (typeof username !== "string" || typeof password !== "string")
        return res.status(400).json({ error: "credentials_required" });
      const out = await auth.login(username, password, req.ip ?? "unknown");
      res.setHeader("Set-Cookie", auth.cookie(out.token));
      res.json({ authenticated: true, user: out.user });
    } catch (e) {
      handleError(res, e);
    }
  });
  r.post("/auth/logout", ...user, async (req, res) => {
    await auth.logout(req.auth!.sessionId);
    res.setHeader("Set-Cookie", auth.clearCookie());
    res.json({ ok: true });
  });
  r.get("/auth/session", (req, res) =>
    res.json(
      req.auth
        ? {
            authenticated: true,
            user: {
              id: req.auth.user.id,
              username: req.auth.user.username,
              role: req.auth.user.role,
            },
          }
        : { authenticated: false },
    ),
  );
  r.get("/admin/users", auth.requireAdmin, (_req, res) =>
    res.json(auth.listUsers()),
  );
  r.post("/admin/users", ...admin, async (req, res) => {
    try {
      const u = await auth.createUser(
        req.body?.username,
        req.body?.password,
        req.body?.role,
      );
      res.status(201).json(u);
    } catch (e) {
      handleError(res, e);
    }
  });
  r.put("/admin/users/:id/password", ...admin, async (req, res) => {
    try {
      await auth.resetPassword(req.params.id, req.body?.password);
      res.json({ ok: true });
    } catch (e) {
      handleError(res, e);
    }
  });
  r.put("/admin/users/:id/status", ...admin, async (req, res) => {
    try {
      if (typeof req.body?.active !== "boolean")
        return res.status(422).json({ error: "active_boolean_required" });
      await auth.setStatus(req.params.id, req.body.active);
      res.json({ ok: true });
    } catch (e) {
      handleError(res, e);
    }
  });
  r.put("/admin/users/:id/role", ...admin, async (req, res) => {
    try {
      if (!["admin", "user"].includes(req.body?.role))
        return res.status(422).json({ error: "invalid_role" });
      await auth.setRole(req.params.id, req.body.role);
      res.json({ ok: true });
    } catch (e) {
      handleError(res, e);
    }
  });

  r.get("/docs", async (_req, res) => res.json(await service.listDocuments()));
  r.post("/docs", ...user, async (req, res) => {
    const { relPath, content } = req.body ?? {};
    if (typeof relPath !== "string" || typeof content !== "string")
      return res.status(400).json({ error: "relPath_and_content_required" });
    try {
      const result = await service.createDocument(
        relPath,
        injectUpdated(content),
      );
      if (!result.ok) return res.status(409).json({ error: "exists" });
      res.status(201).json(result);
    } catch (e) {
      handleError(res, e);
    }
  });
  r.post("/docs/move", ...user, async (req, res) => {
    const { from, to } = req.body ?? {};
    if (typeof from !== "string" || typeof to !== "string")
      return res.status(400).json({ error: "from_and_to_required" });
    try {
      res.json(await service.moveDocument(from, to));
    } catch (e) {
      handleError(res, e);
    }
  });
  const relOf = (req: Request) =>
    decodeURIComponent((req.params as Record<string, string>)[0] || "");

  // Protected raw source must precede public wildcard route.
  r.get("/docs/*/source", auth.requireUser, async (req, res) => {
    const rel = relOf(req).replace(/\/source$/, "");
    const doc = await resolveDoc(service, rel);
    if (!doc) return res.status(404).json({ error: "not_found" });
    const tag = etagFor(doc.meta.mtimeMs, doc.meta.contentHash);
    res.setHeader("ETag", tag);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    res.json(doc);
  });
  const precondition = (req: Request, res: Response): string | undefined => {
    if (!req.get("if-match")) {
      res.status(428).json({ error: "precondition_required" });
      return undefined;
    }
    const tag = parseIfMatch(req.get("if-match"));
    if (!tag) {
      res.status(400).json({ error: "invalid_if_match" });
      return undefined;
    }
    return tag;
  };
  const savePrepared = async (
    req: Request,
    res: Response,
    rel: string,
    content: string,
  ) => {
    const tag = precondition(req, res);
    if (tag === undefined) return;
    const out = await conditionalSave(service, rel, content, tag);
    if (out.status === 404) return res.status(404).json({ error: "not_found" });
    if (out.status === 412) {
      res.setHeader("ETag", out.currentEtag);
      return res
        .status(412)
        .json({
          error: "precondition_failed",
          message: "The file changed after editing began.",
          currentEtag: out.currentEtag,
          currentMtimeMs: out.currentMtimeMs,
        });
    }
    res.setHeader("ETag", out.etag);
    res.json({ ok: true, meta: (await service.getDocument(rel))?.meta });
  };

  r.put("/docs/*/rating", ...user, async (req, res) => {
    const rel = relOf(req).replace(/\/rating$/, "");
    const full = await service.provider.readDocument(rel);
    if (!full) return res.status(404).json({ error: "not_found" });
    const rating = coerceRating(req.body?.rating, config.ratingScale);
    if (rating === undefined)
      return res.status(400).json({ error: "invalid_rating" });
    await savePrepared(
      req,
      res,
      rel,
      setFrontmatterField(full.content, "rating", rating),
    );
  });
  r.put("/docs/*/meta", ...user, async (req, res) => {
    const rel = relOf(req).replace(/\/meta$/, "");
    const full = await service.provider.readDocument(rel);
    if (!full) return res.status(404).json({ error: "not_found" });
    let content = full.content;
    const allowed = new Set([
      "status",
      "favorite",
      "reviewed",
      "review-after",
      "importance",
      "confidence",
    ]);
    for (const key of Object.keys(req.body ?? {})) {
      if (!allowed.has(key)) continue;
      const v = req.body[key];
      content =
        v === null || v === ""
          ? removeFrontmatterField(content, key)
          : setFrontmatterField(content, key, v);
    }
    await savePrepared(req, res, rel, content);
  });
  r.put("/docs/*", ...user, async (req, res) => {
    const rel = relOf(req);
    if (typeof req.body?.content !== "string")
      return res.status(400).json({ error: "content_required" });
    try {
      await savePrepared(req, res, rel, req.body.content);
    } catch (e) {
      handleError(res, e);
    }
  });
  r.delete("/docs/*", ...user, async (req, res) => {
    const rel = relOf(req);
    const tag = precondition(req, res);
    if (tag === undefined) return;
    const current = await service.provider.readDocument(rel);
    if (!current) return res.status(404).json({ error: "not_found" });
    const currentTag = etagFor(current.meta.mtimeMs, current.meta.contentHash);
    if (tag !== currentTag) {
      res.setHeader("ETag", currentTag);
      return res
        .status(412)
        .json({
          error: "precondition_failed",
          currentEtag: currentTag,
          currentMtimeMs: current.meta.mtimeMs,
        });
    }
    res.json(await service.deleteDocument(rel));
  });
  r.get("/docs/*", async (req, res) => {
    let doc = await resolveDoc(service, relOf(req));
    if (!doc) return res.status(404).json({ error: "not_found" });
    const content = maskAgentBlocks(doc.content);
    contents.set(doc.meta.relPath, content);
    const publicMeta =
      service.index.notes.get(doc.meta.relPath)?.meta ?? doc.meta;
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ ...doc, meta: publicMeta, content });
  });

  r.get("/search", (req, res) => {
    const query = String(req.query.q ?? "");
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
    res.json({
      query,
      results: searchIndex(service.index, query, filters, {
        contents,
        limit: Math.min(100, num(req.query.limit) ?? 100),
      }),
    });
  });
  r.get("/graph", (req, res) => {
    const f: GraphFilters = {
      ratingMin: num(req.query.ratingMin),
      ratingMax: num(req.query.ratingMax),
      minConnections: num(req.query.minConnections),
      tags: list(req.query.tags),
      folders: list(req.query.folders),
    };
    res.json(buildFullGraph(service.index, f));
  });
  r.get("/graph/*/subgraph", (req, res) =>
    res.json(
      buildSubgraph(service.index, relOf(req), num(req.query.depth) ?? 1),
    ),
  );
  r.get("/knowledge-map", (_req, res) =>
    res.json(
      buildKnowledgeMap(service.index, { ratingScale: config.ratingScale }),
    ),
  );
  r.get("/tags", (_req, res) => {
    const out = [] as { tag: string; count: number; parent?: string }[];
    for (const [tag, set] of service.index.tagIndex) {
      const slash = tag.lastIndexOf("/");
      out.push({
        tag,
        count: set.size,
        parent: slash < 0 ? undefined : tag.slice(0, slash),
      });
    }
    out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    res.json(out);
  });
  r.get("/tags/*", async (req, res) => {
    const paths = service.index.tagIndex.get(relOf(req)) ?? new Set();
    const docs = await service.listDocuments();
    res.json(
      [...paths].map((p) => docs.find((d) => d.relPath === p)).filter(Boolean),
    );
  });
  r.get("/folders", (_req, res) => {
    const out = [...service.index.folderIndex].map(([folder, set]) => ({
      folder,
      count: set.size,
    }));
    out.sort((a, b) => a.folder.localeCompare(b.folder));
    res.json(out);
  });
  r.get("/health", (_req, res) =>
    res.json({ issues: computeHealth(service.index) }),
  );
  r.get("/recent", async (req, res) => {
    const docs = await service.listDocuments();
    docs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json(docs.slice(0, num(req.query.limit) ?? 50));
  });
  r.get("/changes", (_req, res) =>
    res.json({ buckets: service.history.buckets() }),
  );
  r.get("/activity", async (_req, res) => {
    const docs = await service.listDocuments(),
      now = Date.now();
    res.json({
      pagesChangedToday: docs.filter(
        (d) => d.mtimeMs >= new Date().setHours(0, 0, 0, 0),
      ).length,
      pagesChangedThisWeek: docs.filter((d) => d.mtimeMs >= now - 604800000)
        .length,
      newPages: 0,
      recentlyAddedLinks: service.index.notes.size,
      lastChanges: service.history.all().slice(0, 20),
    });
  });
  r.get("/timeline", async (_req, res) => {
    const docs = await service.listDocuments();
    res.json(
      docs
        .map((d) => ({
          date: new Date(d.mtimeMs).toISOString().slice(0, 10),
          title: d.title,
          relPath: d.relPath,
          type: "modified",
          tags: d.tags,
          rating: d.rating,
        }))
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
        ),
    );
  });
  r.get("/raw/*", async (req, res) => {
    const rel = relOf(req);
    // Raw markdown is an authenticated source projection; exposing it here
    // would bypass public agent-block masking.
    if (/\.md$/i.test(rel)) return res.status(404).json({ error: "not_found" });
    return sendRaw(service, rel, res);
  });
  r.get("/attachment/*", async (req, res) => {
    try {
      const abs = await service.provider.resolveAttachment(relOf(req));
      if (!abs) return res.status(404).json({ error: "not_found" });
      await sendRaw(service, toRelPath(service.provider.root, abs), res);
    } catch {
      return res.status(404).json({ error: "not_found" });
    }
  });
  return r;
}
async function resolveDoc(service: VaultService, rel: string) {
  let doc = await service.getDocument(rel);
  if (!doc) {
    const hits = service.index.resolveTarget(rel);
    if (hits.size) doc = await service.getDocument([...hits][0]);
  }
  return doc;
}
async function sendRaw(service: VaultService, rel: string, res: Response) {
  try {
    const b = await service.provider.readRaw(rel);
    if (!b) return res.status(404).json({ error: "not_found" });
    res.type(contentTypeFor(rel)).send(b);
  } catch {
    return res.status(404).json({ error: "not_found" });
  }
}
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) =>
  typeof v === "string" && v !== "" && !Number.isNaN(Number(v))
    ? Number(v)
    : undefined;
const bool = (v: unknown) =>
  v === "true" || v === "1"
    ? true
    : v === "false" || v === "0"
      ? false
      : undefined;
const list = (v: unknown) =>
  typeof v === "string" && v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
function contentTypeFor(rel: string) {
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        pdf: "application/pdf",
        md: "text/markdown",
      } as Record<string, string>
    )[rel.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"
  );
}
function handleError(res: Response, e: unknown) {
  if (e instanceof AuthError)
    return res.status(e.status).json({ error: e.message });
  if (e instanceof UnsafePathError)
    return res.status(400).json({ error: "unsafe_path" });
  console.error("API request failed");
  return res.status(500).json({ error: "server_error" });
}
export { parseFrontmatter, toStringArray };
export type { Request };
