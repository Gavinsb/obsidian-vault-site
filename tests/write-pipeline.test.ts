import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ObsidianFileSystemVaultProvider } from "../src/server/obsidian-filesystem-provider.js";
import { VaultService } from "../src/server/vault-service.js";
import {
  conditionalSave,
  etagFor,
  injectUpdated,
  parseIfMatch,
} from "../src/server/write-pipeline.js";
let dir: string, svc: VaultService;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-write-"));
  await fs.writeFile(
    path.join(dir, "A.md"),
    "---\n# comment\ntags: [one, two]\nunknown: keep\nupdated: client-value\n---\nBody bytes\n",
  );
  const p = new ObsidianFileSystemVaultProvider(dir, { watch: false });
  svc = new VaultService(p, {
    dataDir: path.join(dir, ".data"),
    indexLocation: "",
    backupDir: path.join(dir, ".data/backups"),
    fileWatching: false,
    backupBeforeDestructive: true,
    ratingScale: 5,
    excludedFolders: [".data"],
    excludedFiles: [],
    attachmentFolders: [],
    siteName: "x",
    theme: "system",
    gitIntegration: "off",
    vaultPath: dir,
    server: { host: "127.0.0.1", port: 0 },
  });
  await svc.start();
});
afterEach(async () => {
  await svc.close();
  await fs.rm(dir, { recursive: true, force: true });
});
describe("ETag write pipeline", () => {
  it("emits and parses a strong quoted mtime/hash ETag", async () => {
    const d = await svc.provider.readDocument("A.md");
    const e = etagFor(d!.meta.mtimeMs, d!.meta.contentHash);
    expect(e).toMatch(/^"[0-9a-f]+-[0-9a-f]{16}"$/);
    expect(parseIfMatch(e)).toBe(e);
    expect(parseIfMatch(undefined)).toBeNull();
  });
  it("injects server UTC updated while preserving unrelated bytes/order/body", () => {
    const now = new Date("2026-09-20T01:02:03.004Z");
    const out = injectUpdated(
      "---\n# c\ntags: [a, b]\nupdated: forged\nunknown: x\n---\nBody\n",
      now,
    );
    expect(out).toBe(
      '---\n# c\ntags: [a, b]\nupdated: \"2026-09-20T01:02:03.004Z\"\nunknown: x\n---\nBody\n',
    );
  });
  it("saves matching precondition and rejects stale/external edits", async () => {
    const d = await svc.provider.readDocument("A.md");
    const etag = etagFor(d!.meta.mtimeMs, d!.meta.contentHash);
    const ok = await conditionalSave(
      svc,
      "A.md",
      d!.content.replace("Body bytes", "Mine"),
      etag,
      new Date("2026-09-20T00:00:00Z"),
    );
    expect(ok.status).toBe(200);
    const text = await fs.readFile(path.join(dir, "A.md"), "utf8");
    expect(text).toContain('updated: \"2026-09-20T00:00:00.000Z\"');
    await fs.writeFile(path.join(dir, "A.md"), text + "external\n");
    const stale = await conditionalSave(svc, "A.md", "overwrite", etag);
    expect(stale.status).toBe(412);
    expect(await fs.readFile(path.join(dir, "A.md"), "utf8")).toContain(
      "external",
    );
  });
  it("serializes same-baseline app writes so only one succeeds", async () => {
    const d = await svc.provider.readDocument("A.md");
    const e = etagFor(d!.meta.mtimeMs, d!.meta.contentHash);
    const out = await Promise.all([
      conditionalSave(svc, "A.md", "first", e),
      conditionalSave(svc, "A.md", "second", e),
    ]);
    expect(out.map((x) => x.status).sort()).toEqual([200, 412]);
  });
});
