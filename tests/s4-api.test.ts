import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ObsidianFileSystemVaultProvider } from "../src/server/obsidian-filesystem-provider.js";
import { VaultService } from "../src/server/vault-service.js";
import { AuthStore } from "../src/server/auth-store.js";
import { AuthService } from "../src/server/auth.js";
import { createApi } from "../src/server/api.js";
let dir: string,
  svc: VaultService,
  server: Server,
  base: string,
  cookie: string;
const cfg = () => ({
  vaultPath: dir,
  dataDir: path.join(dir, ".data"),
  indexLocation: path.join(dir, ".data/index"),
  backupDir: path.join(dir, ".data/backups"),
  siteName: "test",
  theme: "system" as const,
  ratingScale: 5,
  excludedFolders: [".data"],
  excludedFiles: [],
  attachmentFolders: [],
  gitIntegration: "off" as const,
  fileWatching: false,
  backupBeforeDestructive: true,
  server: { host: "127.0.0.1", port: 0 },
});
async function call(url: string, init: RequestInit = {}) {
  const res = await fetch(base + url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  let body: any = {};
  try {
    body = await res.json();
  } catch {}
  return { res, body };
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-api-"));
  await fs.writeFile(
    path.join(dir, "A.md"),
    "# A\n\nPublic\n\n> [!agent] TARGET: document\n> secret prompt #private-agent-tag\n\n> [!agent-review] ID: r1 STATUS: ready\n> secret proposal\n",
  );
  const p = new ObsidianFileSystemVaultProvider(dir, {
    watch: false,
    excludedFolders: [".data"],
  });
  svc = new VaultService(p, cfg());
  await svc.start();
  const st = new AuthStore(cfg().dataDir, crypto.randomBytes(32));
  await st.init();
  const auth = new AuthService(st, { sessionSecret: "z".repeat(32) });
  await auth.bootstrap("admin", "Very-strong-password-1");
  const app = express();
  app.use("/api", createApi(svc, cfg(), auth));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw Error();
  base = `http://127.0.0.1:${a.port}/api`;
  cookie = "";
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await svc.close();
  await fs.rm(dir, { recursive: true, force: true });
});
describe("S4 HTTP security and integrity", () => {
  it("keeps public reads open, masks agent blocks, and redacts paths", async () => {
    const d = await call("/docs/A.md");
    expect(d.res.status).toBe(200);
    expect(d.body.content).toContain("Public");
    expect(d.body.content).not.toMatch(/secret|\[!agent/);
    expect(d.body.meta.tags).not.toContain("private-agent-tag");
    const c = await call("/config");
    expect(c.body).not.toHaveProperty("vaultPath");
    const o = await call("/vault/overview");
    expect(o.body).not.toHaveProperty("path");
    const raw = await call("/raw/A.md");
    expect(raw.res.status).toBe(404);
  });
  it("returns 401 for every anonymous mutation category", async () => {
    for (const [x, i] of [
      ["/docs/A.md", { method: "PUT", body: '{"content":"x"}' }],
      ["/docs", { method: "POST", body: '{"relPath":"B.md","content":"x"}' }],
      ["/docs/move", { method: "POST", body: '{"from":"A.md","to":"B.md"}' }],
      ["/docs/A.md", { method: "DELETE", body: "{}" }],
      ["/docs/A.md/rating", { method: "PUT", body: '{"rating":2}' }],
      ["/vault/reindex", { method: "POST", body: "{}" }],
    ] as const)
      expect((await call(x, i)).res.status).toBe(401);
    expect(await fs.readFile(path.join(dir, "A.md"), "utf8")).toContain(
      "Public",
    );
  });
  it("sets HttpOnly cookie, exposes exact protected source and enforces 428/412", async () => {
    const login = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "Very-strong-password-1",
      }),
    });
    expect(login.res.status).toBe(200);
    const set = login.res.headers.get("set-cookie")!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    cookie = set.split(";")[0];
    const reindex = await call("/vault/reindex", {
      method: "POST",
      body: "{}",
    });
    expect(reindex.res.status).toBe(200);
    const src = await call("/docs/A.md/source");
    expect(src.body.content).toContain("secret prompt");
    const etag = src.res.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect(
      (await call("/docs/A.md", { method: "PUT", body: '{"content":"mine"}' }))
        .res.status,
    ).toBe(428);
    await fs.writeFile(path.join(dir, "A.md"), "external");
    const stale = await call("/docs/A.md", {
      method: "PUT",
      headers: { "If-Match": etag },
      body: '{"content":"mine"}',
    });
    expect(stale.res.status).toBe(412);
    expect(await fs.readFile(path.join(dir, "A.md"), "utf8")).toBe("external");
  });
  it("successful authenticated save injects updated and returns a new ETag", async () => {
    const l = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "Very-strong-password-1",
      }),
    });
    cookie = l.res.headers.get("set-cookie")!.split(";")[0];
    const src = await call("/docs/A.md/source");
    const saved = await call("/docs/A.md", {
      method: "PUT",
      headers: { "If-Match": src.res.headers.get("etag")! },
      body: JSON.stringify({ content: "---\nupdated: forged\n---\nChanged" }),
    });
    expect(saved.res.status).toBe(200);
    expect(saved.res.headers.get("etag")).not.toBe(src.res.headers.get("etag"));
    const disk = await fs.readFile(path.join(dir, "A.md"), "utf8");
    expect(disk).toMatch(/updated: \"20\d\d-/);
    expect(disk).not.toContain("forged");
  });
});
