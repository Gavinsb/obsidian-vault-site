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
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-s6-"));
  await fs.writeFile(
    path.join(dir, "A.md"),
    "# A\n\nPublic\n\n> [!agent] ID: a-1 TARGET: document\n> secret instruction\n\n> [!agent] ID: a-1\n> end marker\n\n> [!agent-review] ID: r1 STATUS: ready\n> secret proposal\n",
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
describe("S6 agent read projection (?agents=1)", () => {
  it("anonymous ?agents=1 stays masked with the public cache", async () => {
    const d = await call("/docs/A.md?agents=1");
    expect(d.res.status).toBe(200);
    expect(d.body.content).toContain("Public");
    expect(d.body.content).not.toMatch(/secret|\[!agent/);
    expect(d.res.headers.get("cache-control")).toBe("public, max-age=30");
    expect(d.res.headers.get("vary")).toBeNull();
  });
  it("signed-in ?agents=1 returns unmasked content with a private cache", async () => {
    const login = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "Very-strong-password-1",
      }),
    });
    expect(login.res.status).toBe(200);
    cookie = login.res.headers.get("set-cookie")!.split(";")[0];
    const d = await call("/docs/A.md?agents=1");
    expect(d.res.status).toBe(200);
    expect(d.body.content).toContain("secret instruction");
    expect(d.body.content).toContain("[!agent]");
    expect(d.body.content).toContain("secret proposal");
    expect(d.res.headers.get("cache-control")).toBe(
      "private, no-store, no-transform",
    );
    expect(d.res.headers.get("vary")).toBe("Cookie");
  });
  it("signed-in read without ?agents=1 still receives the masked view", async () => {
    const login = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "Very-strong-password-1",
      }),
    });
    cookie = login.res.headers.get("set-cookie")!.split(";")[0];
    const d = await call("/docs/A.md");
    expect(d.res.status).toBe(200);
    expect(d.body.content).not.toMatch(/secret|\[!agent/);
    expect(d.res.headers.get("cache-control")).toBe("public, max-age=30");
  });
  it("raw markdown and protected source remain gated", async () => {
    const raw = await call("/raw/A.md?agents=1");
    expect(raw.res.status).toBe(404);
    const src = await call("/docs/A.md/source?agents=1");
    expect(src.res.status).toBe(401);
  });
});