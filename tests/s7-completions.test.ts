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
import { blockRefsOf, calloutTypesOf, headingsOf } from "../src/server/completions.js";

let dir: string,
  svc: VaultService,
  server: Server,
  base: string;
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
async function call(url: string) {
  const res = await fetch(base + url);
  let body: any = {};
  try {
    body = await res.json();
  } catch {}
  return { res, body };
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-comp-"));
  await fs.writeFile(
    path.join(dir, "Alpha Note.md"),
    "# Alpha Note\n\n## Overview\n\nSome text ^alpha-block\n\n> [!warning] Careful\n> body\n\n> [!agent] status:new ID: ABC123 TARGET: document\n> secret instruction ^secret-block\n",
  );
  await fs.writeFile(
    path.join(dir, "Beta Note.md"),
    "# Beta Note\n\n#beta-tag\n\n## Overview\n",
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
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await svc.close();
  await fs.rm(dir, { recursive: true, force: true });
});
describe("S7-3 completions", () => {
  it("extracts headings and block refs, ignoring fences", () => {
    expect(headingsOf("# One\n\ntext\n\n```\n# Not A Heading\n```\n\n## Two\n")).toEqual(["One", "Two"]);
    expect(blockRefsOf("text ^alpha-block\nmore ^beta\n")).toEqual(["alpha-block", "beta"]);
    expect(calloutTypesOf("> [!warning] Careful\n> [!note]\n")).toEqual(["warning", "note"]);
  });

  it("ranks notes by title with folder detail", async () => {
    const r = await call("/completions?kind=note&q=Alpha");
    expect(r.res.status).toBe(200);
    expect(r.body.results[0]).toMatchObject({ value: "Alpha Note", detail: "" });
  });

  it("ranks tags by count and query", async () => {
    const r = await call("/completions?kind=tag&q=beta");
    expect(r.body.results.map((x: any) => x.value)).toContain("beta-tag");
  });

  it("serves headings and block refs from masked note content only", async () => {
    const h = await call("/completions?kind=heading&q=&path=" + encodeURIComponent("Alpha Note.md"));
    expect(h.body.results.map((x: any) => x.value)).toEqual(["Alpha Note", "Overview"]);
    const b = await call("/completions?kind=blockref&q=&path=" + encodeURIComponent("Alpha Note.md"));
    const refs = b.body.results.map((x: any) => x.value);
    expect(refs).toContain("alpha-block");
    // Agent-block content (and its block id) must never leak.
    expect(refs).not.toContain("secret-block");
    expect(JSON.stringify(h.body) + JSON.stringify(b.body)).not.toMatch(/secret|ABC123/);
  });

  it("offers base and observed callout types, never agent content", async () => {
    const r = await call("/completions?kind=callout&q=warn");
    expect(r.body.results.map((x: any) => x.value)).toContain("warning");
    const all = await call("/completions?kind=callout&q=");
    expect(all.body.results.map((x: any) => x.value)).toContain("agent");
    expect(JSON.stringify(all.body)).not.toMatch(/secret|ABC123/);
  });

  it("rejects an unknown kind", async () => {
    const r = await call("/completions?kind=bogus&q=x");
    expect(r.res.status).toBe(400);
  });
});
