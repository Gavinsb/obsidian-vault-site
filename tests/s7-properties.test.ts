// @vitest-environment happy-dom
/**
 * S7-8 — Properties / frontmatter editor.
 *
 * Three halves:
 *   - pure contract: ordering, scalar style, comments, offsets and the
 *     byte-identical no-op round-trip;
 *   - splice isolation: a single-field edit changes exactly one value span and
 *     nothing else (nested blocks, comments and other keys survive verbatim);
 *   - the UI + save path: `PropertiesEditor` splices the draft, `updated` is
 *     read-only, and a real router save still reinjects authoritative `updated`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import express from "express";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  PROPERTY_KEY_RE,
  isReadOnlyProperty,
  parseProperties,
  removeProperty,
  serializeProperties,
  setPropertyValue,
} from "../src/shared/properties.js";
import { PropertiesEditor } from "../src/client/components/PropertiesEditor.js";
import { ObsidianFileSystemVaultProvider } from "../src/server/obsidian-filesystem-provider.js";
import { VaultService } from "../src/server/vault-service.js";
import { AuthStore } from "../src/server/auth-store.js";
import { AuthService } from "../src/server/auth.js";
import { createApi } from "../src/server/api.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ *
 * Fixtures                                                            *
 * ------------------------------------------------------------------ */

const DOC = [
  "---",
  "# leading comment",
  "title: Alpha Note",
  "type: concept",
  "status: draft",
  "rating: 4",
  "favorite: false",
  'aliases: ["Alpha", "A"]',
  "tags:",
  "  - one",
  "  - two",
  "review-after: 2026-01-01",
  "note: keep me # inline comment",
  "updated: 1999-01-01T00:00:00.000Z",
  "---",
  "",
  "# Alpha Note",
  "",
  "Body text.",
  "",
].join("\n");

describe("S7-8 properties contract", () => {
  it("parses ordered rows with keys, kinds and offsets", () => {
    const parsed = parseProperties(DOC);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.rows.map((r) => r.key)).toEqual([
      "title",
      "type",
      "status",
      "rating",
      "favorite",
      "aliases",
      "tags",
      "review-after",
      "note",
      "updated",
    ]);
    const byKey = new Map(parsed.rows.map((r) => [r.key, r]));
    expect(byKey.get("title")?.value).toBe("Alpha Note");
    expect(byKey.get("title")?.kind).toBe("string");
    expect(byKey.get("rating")?.kind).toBe("number");
    expect(byKey.get("favorite")?.kind).toBe("boolean");
    expect(byKey.get("aliases")?.kind).toBe("list");
    // A bare `tags:` followed by an indented sequence is a nested block:
    // preserved verbatim, never rewritten as a scalar.
    expect(byKey.get("tags")?.kind).toBe("raw");
    expect(byKey.get("tags")?.editable).toBe(false);
    // Offsets address the exact value span.
    const title = byKey.get("title")!;
    expect(DOC.slice(title.valueStart, title.valueEnd)).toBe("Alpha Note");
    expect(title.start).toBe(DOC.indexOf("title:"));
  });

  it("round-trips untouched frontmatter byte-identically", () => {
    const parsed = parseProperties(DOC);
    const body = DOC.slice(parsed.bodyStart, parsed.bodyEnd);
    expect(serializeProperties(parsed)).toBe(body);
    // Reassembling prefix + body + suffix reproduces the whole document.
    expect(
      DOC.slice(0, parsed.bodyStart) +
        serializeProperties(parsed) +
        DOC.slice(parsed.bodyEnd),
    ).toBe(DOC);
    // Every row's own no-op edit is byte-identical.
    for (const row of parsed.rows) {
      expect(setPropertyValue(DOC, row.key, row.value)).toBe(DOC);
    }
  });

  it("splices only the selected value span", () => {
    const next = setPropertyValue(DOC, "rating", "5");
    expect(next).not.toBe(DOC);
    // Reverting the one field reproduces the original document exactly.
    expect(next.replace("rating: 5", "rating: 4")).toBe(DOC);
    expect(next).toContain("note: keep me # inline comment");
    expect(next).toContain("  - one");
    expect(next).toContain("updated: 1999-01-01T00:00:00.000Z");
    expect(next.slice(next.indexOf("---\n", 4))).toBe(
      DOC.slice(DOC.indexOf("---\n", 4)),
    );
  });

  it("preserves quoting style and inline comments on edit", () => {
    const quoted = '---\ntitle: "Quoted Name"\nnote: keep # why\n---\n\nBody\n';
    const out = setPropertyValue(quoted, "title", "Next");
    expect(out).toContain('title: "Next"');
    expect(out).toContain("note: keep # why");
    const commentEdit = setPropertyValue(DOC, "note", "changed");
    expect(commentEdit).toContain("note: changed # inline comment");
  });

  it("keeps server-owned `updated` visible but never editable", () => {
    expect(isReadOnlyProperty("updated")).toBe(true);
    expect(isReadOnlyProperty("Updated")).toBe(true);
    const parsed = parseProperties(DOC);
    const updated = parsed.rows.find((r) => r.key === "updated")!;
    expect(updated.readOnly).toBe(true);
    expect(updated.editable).toBe(false);
    expect(setPropertyValue(DOC, "updated", "2026-09-24T00:00:00.000Z")).toBe(
      DOC,
    );
    expect(removeProperty(DOC, "updated")).toBe(DOC);
  });

  it("never rewrites nested/block values", () => {
    expect(setPropertyValue(DOC, "tags", "x")).toBe(DOC);
    expect(PROPERTY_KEY_RE.test("review-after")).toBe(true);
    expect(PROPERTY_KEY_RE.test("bad key")).toBe(false);
  });

  it("adds a new property before the closing delimiter, preserving the body", () => {
    const next = setPropertyValue(DOC, "importance", "3");
    expect(next).toContain("importance: 3\n---");
    expect(next.replace("importance: 3\n", "")).toBe(DOC);
  });

  it("creates frontmatter when none exists", () => {
    const next = setPropertyValue("# Title\n\nBody\n", "status", "draft");
    expect(next).toBe("---\nstatus: draft\n---\n\n# Title\n\nBody\n");
  });

  it("removes exactly one property line", () => {
    const next = removeProperty(DOC, "status");
    expect(next).not.toContain("status: draft");
    expect(next).toContain("type: concept");
    expect(DOC.replace("status: draft\n", "")).toBe(next);
  });
});

/* ------------------------------------------------------------------ *
 * Component                                                           *
 * ------------------------------------------------------------------ */

const mounted: { host: HTMLElement; root: Root }[] = [];

function mount(source: string) {
  const onChange = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(createElement(PropertiesEditor, { source, onChange })),
  );
  mounted.push({ host, root });
  return { host, onChange };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

describe("S7-8 PropertiesEditor", () => {
  it("renders every key in order with `updated` read-only", () => {
    const { host } = mount(DOC);
    const keys = [...host.querySelectorAll(".property-key")].map(
      (el) => el.textContent,
    );
    expect(keys).toEqual([
      "title",
      "type",
      "status",
      "rating",
      "favorite",
      "aliases",
      "tags",
      "review-after",
      "note",
      "updated",
    ]);
    expect(host.querySelector('[data-property-input="updated"]')).toBeNull();
    expect(
      host.querySelector('[data-property-key="updated"] .property-badge')
        ?.textContent,
    ).toBe("server-owned");
    // Nested blocks are shown but not editable.
    expect(host.querySelector('[data-property-input="tags"]')).toBeNull();
  });

  it("splices the draft on edit and stays silent on a no-op", () => {
    const { host, onChange } = mount(DOC);
    const input = host.querySelector<HTMLInputElement>(
      '[data-property-input="title"]',
    )!;
    setInputValue(input, "Beta Note");
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as string;
    expect(next).toContain("title: Beta Note");
    expect(next.replace("title: Beta Note", "title: Alpha Note")).toBe(DOC);

    // Typing the same value back is a byte-identical no-op: no draft churn.
    onChange.mockClear();
    setInputValue(input, "Beta Note");
    expect(onChange).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Real router — save reinjects authoritative `updated`                *
 * ------------------------------------------------------------------ */

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

/** Extract the session cookie. happy-dom's Headers filters `set-cookie` from
 * `get()`, so fall back to `getSetCookie()` when available. */
function sessionCookie(res: Response): string {
  const multi = (res.headers as unknown as { getSetCookie?: () => string[] })
    .getSetCookie?.();
  const raw = multi?.[0] ?? res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0];
}

const SAVE_DOC = [
  "---",
  "title: Alpha Note",
  "type: concept",
  "updated: 1999-01-01T00:00:00.000Z",
  "---",
  "",
  "# Alpha Note",
  "",
  "Body.",
  "",
].join("\n");

describe("S7-8 save path", () => {
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (svc) await svc.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("reinjects the authoritative UTC `updated` on save", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-props-"));
    await fs.writeFile(path.join(dir, "Props.md"), SAVE_DOC);
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
    // happy-dom enforces same-origin on its fetch; align the test window with
    // the ephemeral server origin so the real-router calls below are allowed.
    (window as unknown as { happyDOM?: { setURL(u: string): void } }).happyDOM?.setURL(
      `http://127.0.0.1:${a.port}/`,
    );

    const login = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "Very-strong-password-1",
      }),
    });
    expect(login.res.status).toBe(200);
    cookie = sessionCookie(login.res);

    const src = await fetch(base + "/docs/Props.md/source", {
      headers: { Cookie: cookie },
    });
    const etag = src.headers.get("etag")!;
    const original = (await src.json()).content as string;

    // A Properties edit splices the title; the draft still carries a stale
    // `updated`, which the server must replace with its own UTC value.
    const draft = setPropertyValue(original, "title", "Beta Note");
    expect(draft).toContain("updated: 1999-01-01T00:00:00.000Z");
    const put = await call("/docs/Props.md", {
      method: "PUT",
      headers: { "If-Match": etag },
      body: JSON.stringify({ content: draft }),
    });
    expect(put.res.status).toBe(200);

    const onDisk = await fs.readFile(path.join(dir, "Props.md"), "utf8");
    expect(onDisk).toContain("title: Beta Note");
    expect(onDisk).toContain("type: concept");
    expect(onDisk).not.toContain("1999-01-01");
    const updated = (/^updated: (\S+)$/m.exec(onDisk)?.[1] ?? "").replace(
      /^["']|["']$/g,
      "",
    );
    expect(updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.now() - Date.parse(updated))).toBeLessThan(60000);
  });
});
