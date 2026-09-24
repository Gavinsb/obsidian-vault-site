// @vitest-environment happy-dom
/**
 * S7-9 — embeds, block refs and masked preview.
 *
 * Four halves:
 *   - the block-reference contract: anchors are fence-aware, refs format and
 *     parse losslessly, and a copied ref resolves to a real `^block-id`;
 *   - the rendered form: image embeds honour `|width`, note embeds keep a
 *     resolvable reference, and block anchors become copyable targets;
 *   - transclusion: `MarkdownWithEmbeds` resolves `![[Note]]` through the
 *     masked preview API (and never inside code fences);
 *   - the endpoint: anonymous `/api/note-preview` is masked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import express from "express";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  blockRefResolves,
  findBlockAnchors,
  formatBlockRef,
  parseBlockRef,
  resolveBlockRef,
} from "../src/shared/block-refs.js";
import { Markdown, renderMarkdown } from "../src/client/components/Markdown.js";
import {
  MarkdownWithEmbeds,
  splitNoteEmbeds,
  type PreviewApi,
} from "../src/client/components/Embeds.js";
import { ObsidianFileSystemVaultProvider } from "../src/server/obsidian-filesystem-provider.js";
import { VaultService } from "../src/server/vault-service.js";
import { AuthStore } from "../src/server/auth-store.js";
import { AuthService } from "../src/server/auth.js";
import { createApi } from "../src/server/api.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = [
  "# Alpha Note",
  "",
  "Some text ^alpha-block",
  "",
  "```",
  "fenced ^fake-anchor",
  "```",
  "",
  "Another paragraph ^beta-block",
  "",
].join("\n");

describe("S7-9 block references", () => {
  it("finds real anchors and ignores fenced impostors", () => {
    const anchors = findBlockAnchors(SOURCE);
    expect(anchors.map((a) => a.id)).toEqual(["alpha-block", "beta-block"]);
    expect(anchors[0].line).toBe(3);
    expect(SOURCE.slice(anchors[0].start, anchors[0].end)).toBe("^alpha-block");
  });

  it("formats, parses and resolves a copyable reference", () => {
    const link = formatBlockRef("Alpha Note", "alpha-block");
    expect(link).toBe("[[Alpha Note#^alpha-block]]");
    expect(parseBlockRef(link)).toEqual({
      target: "Alpha Note",
      block: "alpha-block",
    });
    expect(parseBlockRef("[[Alpha Note|label]]")).toEqual({
      target: "Alpha Note",
      alias: "label",
    });
    // The copied reference resolves to the real anchor.
    expect(blockRefResolves(SOURCE, link)?.id).toBe("alpha-block");
    expect(resolveBlockRef(SOURCE, "^beta-block")?.line).toBe(9);
    expect(blockRefResolves(SOURCE, "[[Alpha Note#^fake-anchor]]")).toBeNull();
  });
});

describe("S7-9 rendered form", () => {
  it("renders image embeds inline, honouring a width", () => {
    // Inline context keeps the <img> inside a paragraph. (happy-dom's DOMPurify
    // drops a lone root-level element; browsers do not — the pre-existing
    // image path behaves identically, so this is a test-env quirk only.)
    const html = renderMarkdown("Intro ![[pic.png|300]] out\n");
    expect(html).toContain("/api/attachment/pic.png");
    expect(html).toContain('width="300"');
    expect(html).toContain('class="embed-image"');
    const caption = renderMarkdown("Intro ![[pic.png|a caption]] out\n");
    expect(caption).toContain('alt="a caption"');
    expect(caption).not.toContain("width=");
  });

  it("keeps a resolvable reference for note embeds in the safe form", () => {
    const html = renderMarkdown("See ![[Beta Note]] now\n");
    expect(html).toContain('data-wikilink="Beta Note"');
    expect(html).toContain("wikilink");
  });

  it("exposes block anchors as copyable targets and keeps block refs", () => {
    const html = renderMarkdown(SOURCE);
    expect(html).toContain('class="block-anchor"');
    expect(html).toContain('data-block-id="alpha-block"');
    // The fenced impostor is code, not an anchor.
    expect(html).toContain("fenced ^fake-anchor");
    expect(html).not.toContain('data-block-id="fake-anchor"');
    const link = renderMarkdown("See [[Alpha Note#^alpha-block]] now\n");
    expect(link).toContain('data-wikilink="Alpha Note"');
    expect(link).toContain('data-wikilink-block="alpha-block"');
  });

  it("never renders frontmatter as article text", () => {
    const html = renderMarkdown("---\nsecret: value\n---\n\nBody\n");
    expect(html).toContain("Body");
    expect(html).not.toContain("secret: value");
  });
});

/* ------------------------------------------------------------------ *
 * DOM                                                                 *
 * ------------------------------------------------------------------ */

const mounted: { host: HTMLElement; root: Root }[] = [];

function mount(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MemoryRouter, null, node)));
  mounted.push({ host, root });
  return host;
}

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

const previewApi = (payload: Record<string, unknown>): PreviewApi => ({
  notePreview: vi.fn(async () => payload as any),
});

describe("S7-9 transclusion", () => {
  it("splits note embeds out of the content but not out of code fences", () => {
    const segs = splitNoteEmbeds("Intro\n\n![[Beta Note]]\n\nOutro\n");
    expect(segs.map((s) => s.kind)).toEqual(["text", "note", "text"]);
    const fenced = splitNoteEmbeds("```\n![[Beta Note]]\n```\n");
    expect(fenced).toEqual([{ kind: "text", text: "```\n![[Beta Note]]\n```\n" }]);
    // Image embeds stay in the markdown pipeline (rendered as <img>).
    expect(splitNoteEmbeds("![[pic.png|300]]\n")).toEqual([
      { kind: "text", text: "![[pic.png|300]]\n" },
    ]);
  });

  it("transcludes a note through the masked preview API", async () => {
    const api = previewApi({
      target: "Beta Note",
      resolved: true,
      title: "Beta Note",
      folder: "",
      content: "# Beta Note\n\nTranscluded body.\n",
    });
    const host = mount(
      createElement(MarkdownWithEmbeds, {
        content: "Intro\n\n![[Beta Note]]\n\nOutro\n",
        preview: api,
      }),
    );
    await act(async () => {});
    expect(api.notePreview).toHaveBeenCalledWith("Beta Note");
    const embed = host.querySelector('.embed-note[data-embed-target="Beta Note"]');
    expect(embed).not.toBeNull();
    expect(embed!.textContent).toContain("Transcluded body.");
  });

  it("shows a missing state without leaking anything", async () => {
    const api = previewApi({ target: "Gone", resolved: false });
    const host = mount(
      createElement(MarkdownWithEmbeds, {
        content: "![[Gone]]\n",
        preview: api,
      }),
    );
    await act(async () => {});
    expect(host.querySelector(".embed-note-missing")?.textContent).toContain(
      "Embed not available: Gone",
    );
  });

  it("copies a resolvable block reference from a block anchor", () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const host = mount(
      createElement(Markdown, { content: SOURCE, refTarget: "Alpha Note" }),
    );
    const anchor = host.querySelector<HTMLElement>(
      '.block-anchor[data-block-id="alpha-block"]',
    )!;
    act(() => {
      anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith("[[Alpha Note#^alpha-block]]");
    // The copied reference resolves against the note source.
    expect(blockRefResolves(SOURCE, writeText.mock.calls[0][0])?.id).toBe(
      "alpha-block",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Real router — anonymous preview masking                             *
 * ------------------------------------------------------------------ */

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

describe("S7-9 note-preview endpoint", () => {
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (svc) await svc.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("serves a masked preview and resolves by title", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-embed-"));
    await fs.writeFile(
      path.join(dir, "Alpha Note.md"),
      "# Alpha Note\n\nPublic body ^alpha-block\n\n> [!agent] status:new ID: ABC123 TARGET: document\n> secret instruction\n\n> [!agent-review] ID: ABC123\n> secret proposal\n",
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
    // happy-dom enforces same-origin on its fetch; align the test window with
    // the ephemeral server origin so the real-router calls below are allowed.
    (window as unknown as { happyDOM?: { setURL(u: string): void } }).happyDOM?.setURL(
      `http://127.0.0.1:${a.port}/`,
    );

    const preview = await call("/note-preview?target=Alpha%20Note");
    expect(preview.res.status).toBe(200);
    expect(preview.body.resolved).toBe(true);
    expect(preview.body.relPath).toBe("Alpha Note.md");
    expect(preview.body.title).toBe("Alpha Note");
    expect(preview.body.content).toContain("Public body");
    // Anonymous previews never expose agent content or IDs.
    expect(JSON.stringify(preview.body)).not.toMatch(
      /secret|\[!agent|ABC123/,
    );

    const missing = await call("/note-preview?target=Does%20Not%20Exist");
    expect(missing.res.status).toBe(200);
    expect(missing.body.resolved).toBe(false);
    expect(missing.body.content).toBeUndefined();

    const bad = await call("/note-preview");
    expect(bad.res.status).toBe(400);
  });
});
