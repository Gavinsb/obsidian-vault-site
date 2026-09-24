// @vitest-environment happy-dom
/**
 * S7-12 — save, concurrency, masking and safety integration.
 *
 * This suite is deliberately *end-to-end within the process*: it boots the real
 * Express router (`createApi`) against a real temporary vault, mounts the real
 * `DocView` (router + auth + CM6 editor + agent console) in happy-dom, and
 * drives it through `fetch`. That is the only way to prove the three claims the
 * wave exists for:
 *
 *   1. every structural/status/content change mutates the LOCAL DRAFT only —
 *      no network write happens until explicit Save;
 *   2. explicit Save issues EXACTLY ONE If-Match request and receives exactly
 *      one fresh ETag (no double-save, no extra writes);
 *   3. a concurrent Obsidian change produces 412, preserves the draft and uses
 *      the existing conflict UI (never a silent overwrite);
 *   4. UI state never enters Markdown — selection, gutter, toolbar and popover
 *      chrome are decorations, never source bytes;
 *   5. the completion, ID and preview/transclusion endpoints never hand an
 *      anonymous caller agent text, proposals, reviewer feedback or agent IDs,
 *      and the If-Match contract (428 missing / 400 malformed+wildcard / 412
 *      stale) is unchanged.
 *
 * It also covers the Wave 6 carried-forward fix: the slash menu's agent
 * scaffolds now seed ID generation with the host's reserved IDs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ObsidianFileSystemVaultProvider } from "../src/server/obsidian-filesystem-provider.js";
import { VaultService } from "../src/server/vault-service.js";
import { AuthStore } from "../src/server/auth-store.js";
import { AuthService } from "../src/server/auth.js";
import { createApi } from "../src/server/api.js";
import { AuthProvider } from "../src/client/auth.js";
import { DocView } from "../src/client/components/DocView.js";
import { Editor, type EditorProps } from "../src/client/components/Editor.js";
import { activeSlash, slashSelect } from "../src/client/components/slash-menu.js";
import { blockAffordances } from "../src/client/components/block-affordances.js";
import {
  SLASH_CARET,
  filterScaffolds,
  scaffoldText,
} from "../src/shared/slash-menu.js";
import { formatAgentHeader, generateAgentId } from "../src/shared/agent-status.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ *
 * Fixtures                                                            *
 * ------------------------------------------------------------------ */

/**
 * A note with everything an anonymous caller must never see inside the agent
 * blocks (instruction prose, a heading that would otherwise be a completion,
 * a proposal, and the agent IDs), plus public content the endpoints must keep
 * returning.
 */
const NOTE = [
  "---",
  "title: Alpha",
  "tags: [alpha]",
  "---",
  "",
  "# Alpha",
  "",
  "Public paragraph.",
  "",
  "> [!agent] status:new id: ABC123 target: document",
  "> secret instruction body",
  "> # SecretHeading",
  "",
  "> [!agent-review] id: ABC123",
  "> **Proposal**",
  "> secret proposal body",
  "",
  "## Visible Heading",
  "",
  "Visible paragraph.",
  "",
  "Block anchor here ^visible-block",
  "",
].join("\n");

let dir: string;
let svc: VaultService;
let server: Server;
let base: string;
let cookie = "";
let writes: WriteCall[];
let responses: ResponseLog[];

interface MiniResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<any>;
}

/**
 * A tiny Node HTTP client standing in for `fetch`.
 *
 * happy-dom's `fetch` implements the browser Same-Origin policy *and* strips
 * forbidden request headers (including `Cookie`), so it cannot talk to the
 * in-process test server as an authenticated client. This shim speaks plain
 * `node:http` and exposes just the surface `src/client/api.ts` uses.
 */
function nodeFetch(url: string, init: any = {}): Promise<MiniResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: String(init.method ?? "GET"),
        headers: { ...((init.headers as Record<string, string>) ?? {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? "",
            headers: {
              get: (name: string) => {
                const value = res.headers[name.toLowerCase()];
                return Array.isArray(value) ? value.join(", ") : value ?? null;
              },
            },
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(String(init.body));
    req.end();
  });
}

interface WriteCall {
  method: string;
  url: string;
  ifMatch: string | null;
  etag: string | null;
  body: string;
}
interface ResponseLog {
  method: string;
  url: string;
  status: number;
  etag: string | null;
}

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

/**
 * Route the app's relative `/api/...` fetches to the live test server and count
 * every mutation. Non-GET traffic is recorded *before* the response so a
 * double-save would be visible even if a later assertion throws.
 */
function installFetchStub() {
  const stub = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const full = /^https?:/i.test(url) ? url : base + url.replace(/^\/api/, "");
    const headers: Record<string, string> = { ...(init?.headers ?? {}) };
    if (cookie) headers.Cookie = cookie;
    const method = String(init?.method ?? "GET").toUpperCase();
    const entry: WriteCall | null =
      method === "GET"
        ? null
        : {
            method,
            url,
            ifMatch: headers["If-Match"] ?? null,
            etag: null,
            body: String(init?.body ?? ""),
          };
    if (entry) writes.push(entry);
    const res = await nodeFetch(full, { ...init, headers });
    const etag = res.headers.get("etag");
    if (entry) entry.etag = etag;
    responses.push({ method, url, status: res.status, etag });
    return res;
  };
  (globalThis as any).fetch = stub;
  (globalThis as any).window.fetch = stub;
}

/** Direct call to the test server (bypasses the counting stub). */
async function call(url: string, init: RequestInit = {}, withCookie = true) {
  const res = await nodeFetch(base + url, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string>) ?? {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(withCookie && cookie ? { Cookie: cookie } : {}),
    },
  });
  let body: any = {};
  try {
    body = await res.json();
  } catch {}
  return { res, body };
}
const anon = (url: string) => call(url, {}, false);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-s7i-"));
  await fs.writeFile(path.join(dir, "A.md"), NOTE);
  await fs.writeFile(path.join(dir, "B.md"), "# Beta\n\nSee [[Alpha]].\n");
  const provider = new ObsidianFileSystemVaultProvider(dir, {
    watch: false,
    excludedFolders: [".data"],
  });
  svc = new VaultService(provider, cfg());
  await svc.start();
  const store = new AuthStore(cfg().dataDir, crypto.randomBytes(32));
  await store.init();
  const auth = new AuthService(store, { sessionSecret: "z".repeat(32) });
  await auth.bootstrap("admin", "Very-strong-password-1");
  const app = express();
  app.use("/api", createApi(svc, cfg(), auth));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}/api`;

  cookie = "";
  const login = await nodeFetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Very-strong-password-1" }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  writes = [];
  responses = [];
  installFetchStub();
});

afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  await new Promise<void>((r) => server.close(() => r()));
  await svc.close();
  await fs.rm(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * Mounting helpers                                                    *
 * ------------------------------------------------------------------ */

const mounted: { host: HTMLElement; root: Root }[] = [];

function mount(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ host, root });
  return host;
}

/** Let pending fetches/effects settle inside `act`. */
async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Poll until a condition holds (deterministic alternative to a fixed sleep). */
async function waitFor(predicate: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await settle(20);
  }
}

function mountEditor(props: EditorProps) {
  return mount(createElement(Editor, props));
}

function mountDocView() {
  return mount(
    createElement(
      MemoryRouter,
      { initialEntries: ["/note/A.md"] },
      createElement(
        AuthProvider,
        null,
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/note/:path",
            element: createElement(DocView),
          }),
        ),
      ),
    ),
  );
}

function viewOf(host: HTMLElement): EditorView | null {
  const dom = host.querySelector<HTMLElement>(".cm-content");
  return dom ? EditorView.findFromDOM(dom) : null;
}

function clickByText(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labelled "${label}"`);
  act(() => button.click());
}

const changeSelect = (select: HTMLSelectElement, value: string) => {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

/** Enter edit mode on the mounted DocView and return the live editor view. */
async function enterEdit(host: HTMLElement) {
  clickByText(host, "Edit");
  await settle();
  const view = viewOf(host);
  if (!view) throw new Error("editor did not mount");
  return view;
}

/* ------------------------------------------------------------------ *
 * 1–3. Draft-only edits, exactly-one-save, 412 concurrency            *
 * ------------------------------------------------------------------ */

describe("S7-12 save machine", () => {
  it("keeps every structural/status change in the draft, then saves exactly once", async () => {
    const host = mountDocView();
    await settle();
    expect(host.querySelector(".mode-toggle")).not.toBeNull();

    // Entering edit mode is a read (source + reserved IDs), never a write.
    const view = await enterEdit(host);
    expect(writes).toEqual([]);
    const before = view.state.doc.toString();
    expect(before).toContain("status:new");
    const baseEtag = responses.filter((r) => r.url.endsWith("/source")).at(-1)!.etag;
    expect(baseEtag).toMatch(/^"[0-9a-f]+-[0-9a-f]{16}"$/);

    // (1a) A status change is a LOCAL DRAFT mutation only.
    const select = host.querySelector<HTMLSelectElement>(
      ".agent-console .agent-status-select",
    )!;
    expect(select.value).toBe("new");
    changeSelect(select, "HRR");
    expect(writes).toEqual([]);
    const afterStatus = view.state.doc.toString();
    expect(afterStatus).toContain("status:HRR");
    expect(afterStatus).not.toBe(before);

    // (1b) A structural change (slash scaffold) is draft-only too.
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "\n/head" },
        selection: { anchor: view.state.doc.length + 5 },
      });
    });
    expect(activeSlash(view)).not.toBeNull();
    const headingIndex = filterScaffolds("head").findIndex((s) => s.id === "h1");
    act(() => {
      slashSelect(view, headingIndex);
    });
    expect(writes).toEqual([]);
    const afterStructural = view.state.doc.toString();
    expect(afterStructural).toContain("# ");
    expect(afterStructural).not.toBe(afterStatus);

    // (2) Explicit Save → exactly one If-Match PUT and one fresh ETag.
    clickByText(host, "Save");
    await waitFor(() => writes.length === 1 && writes[0].etag !== null);
    expect(writes.length).toBe(1);
    expect(writes[0].method).toBe("PUT");
    expect(writes[0].url).toBe("/api/docs/A.md");
    expect(writes[0].ifMatch).toBe(baseEtag);
    expect(writes[0].etag).toMatch(/^"[0-9a-f]+-[0-9a-f]{16}"$/);
    expect(writes[0].etag).not.toBe(baseEtag);
    // The saved file carries the draft — and no ephemeral UI marker.
    const saved = await fs.readFile(path.join(dir, "A.md"), "utf8");
    expect(saved).toContain("status:HRR");
    expect(saved).toContain("# ");
    expect(saved).not.toMatch(/\u0000|cm-block|editor-wrap|data-block-start/);

    // Nothing dirty any more: another Save writes nothing (no double-save).
    clickByText(host, "Save");
    await settle();
    expect(writes.length).toBe(1);
  });

  it("collapses a batched double activation into one write", async () => {
    const host = mountDocView();
    await settle();
    const view = await enterEdit(host);
    const select = host.querySelector<HTMLSelectElement>(
      ".agent-console .agent-status-select",
    )!;
    changeSelect(select, "HRR");
    expect(view.state.doc.toString()).toContain("status:HRR");

    // Two activations inside one batch (fast double-click, or keyboard+click in
    // the same tick) must still issue a single If-Match request.
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Save",
    )!;
    act(() => {
      save.click();
      save.click();
    });
    await settle(40);
    expect(writes.length).toBe(1);
  });

  it("turns a concurrent Obsidian change into 412, preserving the draft", async () => {
    const host = mountDocView();
    await settle();
    const view = await enterEdit(host);

    const select = host.querySelector<HTMLSelectElement>(
      ".agent-console .agent-status-select",
    )!;
    changeSelect(select, "HRR");
    await settle();

    // Obsidian writes the same note on disk while the draft is open.
    await fs.appendFile(path.join(dir, "A.md"), "\nExternal Obsidian line.\n");

    clickByText(host, "Save");
    await settle(40);
    expect(writes.length).toBe(1);
    expect(responses.at(-1)).toMatchObject({ method: "PUT", status: 412 });

    // The existing conflict UI is what appears, and the draft survives.
    expect(host.querySelector(".conflict-banner")).not.toBeNull();
    expect(host.textContent).toContain("Conflict detected.");
    expect(host.textContent).toContain("Your draft is preserved.");
    expect(view.state.doc.toString()).toContain("status:HRR");

    // The external bytes were never overwritten.
    const onDisk = await fs.readFile(path.join(dir, "A.md"), "utf8");
    expect(onDisk).toContain("External Obsidian line.");
    expect(onDisk).not.toContain("status:HRR");
  });
});

/* ------------------------------------------------------------------ *
 * 4. UI state never enters Markdown                                   *
 * ------------------------------------------------------------------ */

describe("S7-12 UI state never enters Markdown", () => {
  it("keeps selection, gutter, toolbar and popover chrome out of the source", () => {
    const original = [
      "# Alpha",
      "",
      "Paragraph with **bold** text.",
      "",
      "- one",
      "- two",
      "",
    ].join("\n");
    const onChange = vi.fn();
    const host = mountEditor({ value: original, onChange, path: "A.md" });
    const view = viewOf(host)!;
    expect(view.state.doc.toString()).toBe(original);

    // Selection state (and the bubble toolbar it reveals) is UI-only.
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 7 } });
    });
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(view.state.doc.toString()).toBe(original);

    // The hover gutter is painted as decorations in the reserved margin.
    expect(host.querySelectorAll(".cm-block-gutter").length).toBeGreaterThan(0);
    expect(host.querySelector(".cm-block-plus")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(original);

    // Opening the slash popover changes no bytes beyond the typed token.
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "/h1" },
        selection: { anchor: view.state.doc.length + 3 },
      });
    });
    expect(host.querySelector(".slash-menu")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(`${original}/h1`);

    // Accepting a scaffold writes content only — never the caret marker.
    const index = filterScaffolds("h1").findIndex((scaffold) => scaffold.id === "h1");
    expect(index).toBe(0);
    act(() => {
      slashSelect(view, index);
    });
    const after = view.state.doc.toString();
    expect(after).toBe(`${original}# `);
    expect(after).not.toContain(SLASH_CARET);
    expect(host.querySelector(".slash-menu")).toBeNull();

    // No payload the editor ever emitted carried ephemeral UI markers.
    for (const call_ of onChange.mock.calls) {
      expect(String(call_[0])).not.toMatch(
        /\u0000|cm-block|cm-widget|cm-line|editor-wrap|data-block-start|aria-/,
      );
    }
    expect(after).not.toMatch(/\u0000|cm-block|cm-widget|editor-wrap/);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Endpoint safety: completions, IDs, preview, If-Match contract    *
 * ------------------------------------------------------------------ */

describe("S7-12 endpoint masking", () => {
  it("never hands an anonymous caller agent text, proposals or IDs", async () => {
    const heading = await anon(
      `/completions?kind=heading&q=&path=${encodeURIComponent("A.md")}`,
    );
    expect(heading.res.status).toBe(200);
    const headingJson = JSON.stringify(heading.body);
    expect(headingJson).toContain("Visible Heading");
    expect(headingJson).not.toMatch(/secret|SecretHeading|ABC123|\[!agent/);

    const refs = await anon(
      `/completions?kind=blockref&q=&path=${encodeURIComponent("A.md")}`,
    );
    expect(refs.res.status).toBe(200);
    expect(JSON.stringify(refs.body)).toContain("visible-block");
    expect(JSON.stringify(refs.body)).not.toMatch(/secret|ABC123/);

    const notes = await anon("/completions?kind=note&q=Alpha");
    expect(notes.res.status).toBe(200);
    expect(JSON.stringify(notes.body)).not.toMatch(/secret|ABC123/);

    const callouts = await anon("/completions?kind=callout&q=");
    expect(callouts.res.status).toBe(200);
    expect(JSON.stringify(callouts.body)).not.toMatch(/secret|ABC123/);

    // The reserved-ID index is session-gated: no anonymous ID set at all.
    const ids = await anon("/agent/ids");
    expect(ids.res.status).toBe(401);
    expect(JSON.stringify(ids.body)).not.toMatch(/ABC123/);

    // Preview/transclusion is masked exactly like a public document read.
    const preview = await anon(
      `/note-preview?target=${encodeURIComponent("A.md")}`,
    );
    expect(preview.res.status).toBe(200);
    expect(preview.body.resolved).toBe(true);
    expect(preview.body.content).toContain("Visible paragraph");
    expect(JSON.stringify(preview.body)).not.toMatch(/secret|ABC123|\[!agent/);
    expect(preview.res.headers.get("cache-control")).toBe("public, max-age=30");

    // A signed-in caller may still get the unmasked source projection.
    const source = await call("/docs/A.md/source");
    expect(source.res.status).toBe(200);
    expect(source.body.content).toContain("secret instruction body");
  });

  it("keeps the If-Match contract: 428 missing, 400 malformed/wildcard, 412 stale", async () => {
    const src = await call("/docs/A.md/source");
    const etag = src.res.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]{16}"$/);

    const put = (ifMatch?: string) =>
      call("/docs/A.md", {
        method: "PUT",
        headers: ifMatch ? { "If-Match": ifMatch } : {},
        body: JSON.stringify({ content: "x" }),
      });

    expect((await put()).res.status).toBe(428);
    expect((await put("*")).res.status).toBe(400);
    expect((await put("W/*")).res.status).toBe(400);
    expect((await put('""')).res.status).toBe(400);
    expect((await put('"not-an-etag"')).res.status).toBe(400);
    expect((await put("abc")).res.status).toBe(400);
    // Nothing above reached the file.
    expect(await fs.readFile(path.join(dir, "A.md"), "utf8")).toBe(NOTE);

    // A concurrent external change makes the loaded ETag stale.
    await fs.appendFile(path.join(dir, "A.md"), "\nexternal\n");
    const stale = await put(etag);
    expect(stale.res.status).toBe(412);
    expect(stale.body.currentEtag).toMatch(/^"[0-9a-f]+-[0-9a-f]{16}"$/);
    expect(await fs.readFile(path.join(dir, "A.md"), "utf8")).toContain("external");

    // The current ETag still saves, and the response carries a fresh one.
    const fresh = (await call("/docs/A.md/source")).res.headers.get("etag")!;
    const ok = await put(fresh);
    expect(ok.res.status).toBe(200);
    const next = ok.res.headers.get("etag");
    expect(next).toMatch(/^"[0-9a-f]+-[0-9a-f]{16}"$/);
    expect(next).not.toBe(fresh);
  });
});

/* ------------------------------------------------------------------ *
 * Carried-forward fix: reserved IDs seed the slash agent scaffolds    *
 * ------------------------------------------------------------------ */

describe("S7-12 carried-forward: slash agent IDs avoid the reserved set", () => {
  /** `Math.random` stub: six calls producing `first`, then `rest` forever. */
  const fixed = (first: number, rest: number) => {
    let calls = 0;
    return () => (calls++ < 6 ? first : rest);
  };
  const withRandom = <T,>(random: () => number, fn: () => T): T => {
    const spy = vi.spyOn(Math, "random").mockImplementation(random);
    try {
      return fn();
    } finally {
      spy.mockRestore();
    }
  };

  it("seeds generation with the reserved IDs, changing only the seed", () => {
    // 0 → 'A' (index 0), 0.5 → 'S' (index 18) in the ID alphabet.
    expect(withRandom(fixed(0, 0.5), () => generateAgentId([]))).toBe("AAAAAA");
    expect(withRandom(fixed(0, 0.5), () => generateAgentId(["AAAAAA"]))).toBe("SSSSSS");

    const instruction = withRandom(fixed(0, 0.5), () =>
      scaffoldText("agent-instruction", {
        reservedIds: ["AAAAAA"],
        target: "document",
      }),
    )!;
    // Byte-exact shape for the ID it produced — only the seed changed.
    expect(instruction).toBe(
      `${formatAgentHeader("agent", { status: "new", id: "SSSSSS", target: "document" })}\n> ${SLASH_CARET}`,
    );
    expect(instruction).not.toContain("AAAAAA");

    const review = withRandom(fixed(0, 0.5), () =>
      scaffoldText("agent-review", { reservedIds: ["AAAAAA"] }),
    )!;
    expect(review).toBe(
      `${formatAgentHeader("agent-review", { id: "SSSSSS" })}\n> ${SLASH_CARET}`,
    );
  });

  it("threads the reserved IDs from the host through the editor into the slash menu", () => {
    const host = mountEditor({
      value: "Text\n\n/agent",
      onChange: vi.fn(),
      path: "A.md",
      reservedIds: ["AAAAAA"],
    });
    const view = viewOf(host)!;
    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    expect(activeSlash(view)).not.toBeNull();

    const index = filterScaffolds("agent").findIndex(
      (scaffold) => scaffold.id === "agent-instruction",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    withRandom(fixed(0, 0.5), () => {
      act(() => {
        slashSelect(view, index);
      });
    });

    const doc = view.state.doc.toString();
    expect(doc).toContain("id: SSSSSS");
    expect(doc).not.toContain("AAAAAA");
  });
});

/* ------------------------------------------------------------------ *
 * Pure guard: the gutter/toolbar extensions never dispatch doc changes *
 * ------------------------------------------------------------------ */

describe("S7-12 affordance extensions are view-level only", () => {
  it("builds decorations without touching the document", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const stats = { docChanges: 0 };
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "---\ntitle: A\n---\n\n# H\n\nBody\n",
        extensions: [
          history(),
          markdown(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) stats.docChanges++;
          }),
          // The same view-level extensions the Editor mounts (S7-10/S7-11).
          blockAffordances(),
        ],
      }),
    });
    try {
      expect(stats.docChanges).toBe(0);
      expect(view.state.doc.toString()).toBe("---\ntitle: A\n---\n\n# H\n\nBody\n");
      expect(host.querySelectorAll(".cm-block-gutter").length).toBeGreaterThan(0);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
