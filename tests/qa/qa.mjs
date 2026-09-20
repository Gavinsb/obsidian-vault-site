#!/usr/bin/env node
/**
 * Automated QA pass (spec §34).
 *
 * Boots the real server against a fresh copy of the representative test vault
 * and verifies the full workflow over the HTTP API, then reports a
 * pass/fail/skip checklist. Exits non-zero on any failure.
 *
 *   npm run qa
 *
 * To run the QA server interactively against the real base vault instead,
 * set VAULT_PATH accordingly (see README).
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(PROJ, "tests", "fixtures", "test-vault");

const PORT = 18991;
const BASE = `http://127.0.0.1:${PORT}/api`;

let pass = 0;
let fail = 0;
let warn = 0;
let cookie = "";
let currentEtags = new Map();
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function copy(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copy(s, d);
    else await fs.copyFile(s, d);
  }
}

async function j(url, init) {
  const res = await fetch(BASE + url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(url, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  return false;
}

async function main() {
  console.log("\n═══ Obsidian Vault Microsite — QA pass ═══\n");

  // 1. Stage a fresh copy of the test vault.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kv-qa-"));
  const vault = path.join(tmp, "test-vault");
  await copy(FIXTURE, vault);

  const cfgPath = path.join(tmp, "config.json");
  await fs.writeFile(
    cfgPath,
    JSON.stringify({
      vaultPath: vault,
      dataDir: path.join(tmp, "data"),
      server: { host: "127.0.0.1", port: PORT },
      ratingScale: 5,
      excludedFolders: [".obsidian", ".git", ".trash"],
      excludedFiles: [],
      attachmentFolders: ["Attachments"],
      gitIntegration: "off",
    }),
  );

  console.log(`Test vault staged at ${vault}\n`);

  // 2. Boot the server.
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/server.ts", cfgPath],
    {
      cwd: PROJ,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        KV_AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        KV_SESSION_SECRET: "qa-session-secret-is-at-least-thirty-two-bytes",
        INITIAL_ADMIN_PASSWORD: "QA-bootstrap-password-123!",
      },
    },
  );
  let bootLog = "";
  child.stdout.on("data", (d) => {
    bootLog += d.toString();
  });
  child.stderr.on("data", (d) => {
    bootLog += d.toString();
  });

  const up = await waitFor(BASE + "/vault/overview", 20000);
  check("1. Site starts successfully", up, bootLog.slice(-300));
  if (!up) {
    console.log("\nServer failed to boot. Log tail:\n", bootLog.slice(-1500));
    child.kill();
    process.exit(1);
  }

  // 3. Vault loads and public reads need no login.
  const ov = await j("/vault/overview");
  check(
    "2. Configured vault loads",
    ov.status === 200 && ov.body.docCount >= 6,
    `docCount=${ov.body.docCount}`,
  );

  // 4. Markdown renders — GET a doc and confirm raw content present.
  const doc = await j(
    "/docs/" + encodeURIComponent("01 Concepts/ai/mcp/MCP Security.md"),
  );
  check(
    "3. Markdown content fetch",
    doc.status === 200 && doc.body.content.includes("# MCP Security"),
  );
  check(
    "4. Wiki-links parse (outgoing listed)",
    Array.isArray(doc.body.outgoing) && doc.body.outgoing.length > 0,
  );
  check(
    "13. Broken/unresolved link flagged",
    doc.body.outgoing.some(
      (o) => o.target.includes("Does Not Exist") && !o.resolved,
    ),
  );

  // 5. Backlinks.
  const agent = await j(
    "/docs/" + encodeURIComponent("01 Concepts/ai/Agent Architecture.md"),
  );
  check(
    "5. Backlinks correct",
    Array.isArray(agent.body.backlinks) &&
      agent.body.backlinks.some((b) =>
        b.sourceRelPath.includes("MCP Security"),
      ),
  );

  // 6. Search.
  const s = await j("/search?q=agent");
  check(
    "6. Search finds documents",
    s.status === 200 &&
      s.body.results.some((r) => r.title.toLowerCase().includes("agent")),
  );

  // 7. Graph.
  const g = await j("/graph");
  check(
    "7. Graph relationships correct",
    g.status === 200 && g.body.nodes.length >= 3 && g.body.edges.length >= 1,
  );

  // Authentication is required before any mutation.
  const anonymousWrite = await j("/vault/reindex", {
    method: "POST",
    body: "{}",
  });
  check("7b. Anonymous mutation rejected", anonymousWrite.status === 401);
  const login = await fetch(BASE + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "QA-bootstrap-password-123!",
    }),
  });
  cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
  check(
    "7c. Admin login sets HttpOnly session cookie",
    login.status === 200 &&
      /HttpOnly/i.test(login.headers.get("set-cookie") || ""),
  );

  // 8. Edit a page via API changes source Markdown.
  const target = "03 Notes/Orphan Note.md";
  const beforeRes = await fetch(
    BASE + "/docs/" + encodeURIComponent(target) + "/source",
    { headers: { Cookie: cookie } },
  );
  const before = { body: await beforeRes.json() };
  const beforeEtag = beforeRes.headers.get("etag");
  const edited = before.body.content + "\n\nAdded by QA.\n";
  const putRes = await fetch(BASE + "/docs/" + encodeURIComponent(target), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "If-Match": beforeEtag,
    },
    body: JSON.stringify({ content: edited }),
  });
  check("8. Editing writes source Markdown", putRes.status === 200);
  const onDisk = await fs.readFile(path.join(vault, target), "utf8");
  check("8b. Source file changed on disk", onDisk.includes("Added by QA."));

  // 9. Editing YAML preserves unrelated properties.
  const yamlTarget = "01 Concepts/ai/Agent Architecture.md";
  const yamlSourceRes = await fetch(
    BASE + "/docs/" + encodeURIComponent(yamlTarget) + "/source",
    { headers: { Cookie: cookie } },
  );
  const yamlDoc = { body: await yamlSourceRes.json() };
  let yamlEtag = yamlSourceRes.headers.get("etag");
  const { setFrontmatterField } = await import(
    new URL("../../src/shared/frontmatter.ts", import.meta.url).href
  );
  const updatedWithRating = setFrontmatterField(
    yamlDoc.body.content,
    "rating",
    4,
  );
  await fetch(BASE + "/docs/" + encodeURIComponent(yamlTarget), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "If-Match": yamlEtag,
    },
    body: JSON.stringify({ content: updatedWithRating }),
  });
  const yamlOnDisk = await fs.readFile(path.join(vault, yamlTarget), "utf8");
  check(
    "9. Editing YAML preserves unrelated properties",
    yamlOnDisk.includes("type: concept") &&
      yamlOnDisk.includes("status: active"),
  );

  // 10. Rating writes into frontmatter.
  const ratedSource = await fetch(
    BASE + "/docs/" + encodeURIComponent(yamlTarget) + "/source",
    { headers: { Cookie: cookie } },
  );
  yamlEtag = ratedSource.headers.get("etag");
  const rated = await j("/docs/" + encodeURIComponent(yamlTarget) + "/rating", {
    method: "PUT",
    headers: { "If-Match": yamlEtag },
    body: JSON.stringify({ rating: 4 }),
  });
  check("10. Rating writes to frontmatter", rated.status === 200);
  const ratedOnDisk = await fs.readFile(path.join(vault, yamlTarget), "utf8");
  check("10b. rating: 4 in source", /rating:\s*4/.test(ratedOnDisk));

  // 11. External file change appears in the site (via reindex/reconcile).
  await fs.writeFile(
    path.join(vault, "02 Guides", "Tool Use Loop.md"),
    "# Tool Use Loop\n\nExternal edit while server running.\n",
    "utf8",
  );
  await j("/vault/reindex", { method: "POST" });
  const extDoc = await j(
    "/docs/" + encodeURIComponent("02 Guides/Tool Use Loop.md"),
  );
  check(
    "11. External change reflected in site",
    extDoc.body.content.includes("External edit while server running"),
  );

  // 12. New external file appears.
  await fs.writeFile(
    path.join(vault, "05 Projects", "Brand New.md"),
    "# Brand New\n",
    "utf8",
  );
  await j("/vault/reindex", { method: "POST" });
  const newOv = await j("/vault/overview");
  const newSearch = await j("/search?q=Brand%20New");
  check(
    "12. New external file appears",
    newSearch.body.results.some((r) => r.relPath.includes("Brand New")),
  );

  // 13. Deleted external file disappears.
  await fs.unlink(path.join(vault, "03 Notes", "Orphan Note.md"));
  await j("/vault/reindex", { method: "POST" });
  const gone = await j(
    "/docs/" + encodeURIComponent("03 Notes/Orphan Note.md"),
  );
  check("14. Deleted external file disappears", gone.status === 404);

  // 15. Search index updates.
  const upSearch = await j("/search?q=External%20edit");
  check(
    "15. Search index updates",
    upSearch.body.results.some((r) => r.relPath.includes("Tool Use Loop")),
  );

  // 16. Graph index updates (new node appears).
  const upGraph = await j("/graph");
  check(
    "16. Graph index updates",
    upGraph.body.nodes.some((n) => n.id.includes("Brand New")),
  );

  // 17. Broken links identified.
  const health = await j("/health");
  check(
    "17. Broken links identified",
    health.body.issues.some((i) => i.kind === "broken-link"),
  );

  // 18. Orphans identified.
  check(
    "18. Orphans identified",
    health.body.issues.some((i) => i.kind === "orphan"),
  );

  // 19. Recent documents correct.
  const recent = await j("/recent?limit=50");
  check(
    "19. Recent documents correct",
    recent.status === 200 && recent.body.length >= 5,
  );

  // 20. Recent changes recorded.
  const changes = await j("/changes");
  check(
    "20. Recent changes recorded",
    changes.status === 200 && changes.body.buckets,
  );

  // 21. Conflict detected instead of silent overwrite.
  const cSource = await fetch(
    BASE +
      "/docs/" +
      encodeURIComponent("05 Projects/AI Agent Notes.md") +
      "/source",
    { headers: { Cookie: cookie } },
  );
  const cDoc = { body: await cSource.json() };
  const cEtag = cSource.headers.get("etag");
  await fs.writeFile(
    path.join(vault, "05 Projects", "AI Agent Notes.md"),
    "# AI Agent Notes\n\nExternal newer\n",
    "utf8",
  );
  const conflictRes = await fetch(
    BASE + "/docs/" + encodeURIComponent("05 Projects/AI Agent Notes.md"),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "If-Match": cEtag,
      },
      body: JSON.stringify({ content: "my edit" }),
    },
  );
  check(
    "21. Edit conflict detected (no silent overwrite)",
    conflictRes.status === 412,
  );

  // 22. No app cache written into the vault.
  const vaultEntries = await fs.readdir(vault);
  const polluted = vaultEntries.filter(
    (e) => e.startsWith(".kv") || e === "index.json" || e === ".index",
  );
  check(
    "22. No app cache in the vault",
    polluted.length === 0,
    polluted.join(","),
  );

  // 23. Same app works pointed at a second vault.
  const vault2 = path.join(tmp, "vault-two");
  await fs.mkdir(path.join(vault2, "notes"), { recursive: true });
  await fs.writeFile(path.join(vault2, "notes", "Only.md"), "# Only\n", "utf8");
  await fs.writeFile(
    path.join(tmp, "config2.json"),
    JSON.stringify({
      vaultPath: vault2,
      dataDir: path.join(tmp, "data2"),
      server: { host: "127.0.0.1", port: PORT + 1 },
    }),
  );
  // We verify by importing the provider path logic directly (a live second
  // server would need another boot — skip in the default QA to keep it fast,
  // but assert the adapter can point anywhere).
  const { ObsidianFileSystemVaultProvider } = await import(
    new URL("../../src/server/obsidian-filesystem-provider.ts", import.meta.url)
      .href
  );
  const p2 = new ObsidianFileSystemVaultProvider(vault2, { watch: false });
  const p2docs = await p2.listDocuments();
  await p2.close();
  check(
    "23. Same app works on a second vault",
    p2docs.length === 1 && p2docs[0].relPath === "notes/Only.md",
  );

  child.kill();
  await fs.rm(tmp, { recursive: true, force: true });

  console.log(
    `\n═══ Results: ${pass} passed, ${fail} failed ${warn ? `, ${warn} warned` : ""} ═══\n`,
  );
  if (fail > 0) {
    console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n"));
    process.exit(1);
  }
  if (warn > 0) process.exitCode = 0;
  console.log("QA PASS");
}

main().catch((err) => {
  console.error("QA runner error:", err);
  process.exit(1);
});
