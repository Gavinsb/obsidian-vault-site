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
import { idsFromSweepLog, idsFromNote } from "../src/server/agent-ids.js";

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
async function login() {
  const l = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "Very-strong-password-1" }),
  });
  cookie = l.res.headers.get("set-cookie")!.split(";")[0];
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-ids-"));
  await fs.writeFile(
    path.join(dir, "A.md"),
    "# A\n\n> [!agent] status:new ID: ABC123 TARGET: document\n> secret instruction\n\n> [!agent-review] ID: ABC123\n> secret proposal\n",
  );
  await fs.writeFile(
    path.join(dir, "Agent_Sweep_Log.md"),
    "# Agent Sweep Log\n\n- Staged a change (ID: ZAHCV0)\n- Later merged (Originating ID: ZAHCV0)\n",
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
describe("S7 vault-wide reserved agent IDs", () => {
  it("extracts IDs from notes and the sweep log without matching prose", () => {
    expect(idsFromNote("> [!agent] status:new ID: ABC123 TARGET: document\n> x\n")).toEqual(["ABC123"]);
    expect(idsFromSweepLog("- staged (ID: ZAHCV0)\n- merged (Originating ID: ZAHCV0)\n- no id here\n")).toEqual(["ZAHCV0"]);
  });
  it("rejects anonymous callers", async () => {
    const r = await call("/agent/ids");
    expect(r.res.status).toBe(401);
  });
  it("returns the vault-wide reserved set to a signed-in caller, IDs only", async () => {
    await login();
    const r = await call("/agent/ids");
    expect(r.res.status).toBe(200);
    expect(r.body.ids).toContain("ABC123");
    expect(r.body.ids).toContain("ZAHCV0");
    expect(r.res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(r.body)).not.toMatch(/secret|\[!agent/);
  });
});
