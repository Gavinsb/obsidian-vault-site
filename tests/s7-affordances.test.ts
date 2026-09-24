// @vitest-environment happy-dom
/**
 * S7-10 — block affordances and slash menu.
 *
 * Halves:
 *   - model: the exact scaffold table, slash-trigger resolution and filtering
 *     (the menu is a text-substitution registry, so every entry is asserted
 *     byte-for-byte);
 *   - UI: the CM6 gutter/drag handle, the bubble toolbar's accessibility and
 *     dismissal, the slash menu's overlap with the shared CommandPalette
 *     keyboard contract, and the gutter-not-shifting invariant.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  SCAFFOLDS,
  SCAFFOLD_CATEGORIES,
  SLASH_CARET,
  filterScaffolds,
  insertScaffold,
  resolveSlashTrigger,
  scaffoldInsertion,
  scaffoldText,
} from "../src/shared/slash-menu.js";
import { formatAgentHeader } from "../src/shared/agent-status.js";
import { INLINE_MARKS } from "../src/shared/inline-marks.js";
import {
  activeSlash,
  slashClose,
  slashMenuExtension,
  slashMove,
  slashSelect,
} from "../src/client/components/slash-menu.js";
import {
  blockAffordances,
  gutterSpecs,
} from "../src/client/components/block-affordances.js";
import { insertBlockBelow } from "../src/client/components/editor-actions.js";
import { BlockToolbar } from "../src/client/components/BlockToolbar.js";
import { SlashMenu } from "../src/client/components/SlashMenu.js";
import { paletteKeyIntent } from "../src/client/components/CommandPalette.js";
import { Editor, type EditorProps } from "../src/client/components/Editor.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { host: HTMLElement; root: Root }[] = [];
const views: { host: HTMLElement; view: EditorView }[] = [];

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  for (const { host, view } of views.splice(0)) {
    view.destroy();
    host.remove();
  }
});

function mountNode(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push({ host, root });
  return { host, root };
}

function mountEditor(props: EditorProps) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Editor, props)));
  mounted.push({ host, root });
  return host;
}

/** A real CM6 view with our extensions and a doc-change counter. */
function makeView(doc: string, extra: Extension[] = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const stats = { docChanges: 0, transactions: 0 };
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown(),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          stats.docChanges++;
          stats.transactions += update.transactions.length;
        }),
        ...extra,
      ],
    }),
  });
  views.push({ host, view });
  return {
    host,
    view,
    stats,
    reset: () => {
      stats.docChanges = 0;
      stats.transactions = 0;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Slash menu model                                                    *
 * ------------------------------------------------------------------ */

const SPEC = { agentId: "ABC123", target: "document" };

describe("S7-10 slash menu scaffolds", () => {
  it("covers every category the spec names", () => {
    const categories = new Set(SCAFFOLDS.map((scaffold) => scaffold.category));
    expect([...categories].sort()).toEqual([...SCAFFOLD_CATEGORIES].sort());
    expect(SCAFFOLD_CATEGORIES).toEqual([
      "CommonMark",
      "Callout",
      "Embed",
      "Properties",
      "Tag",
      "Task",
      "Mermaid",
      "Agent",
    ]);
  });

  it("emits the exact scaffold text for each entry", () => {
    expect(scaffoldText("text")).toBe("");
    expect(scaffoldText("h1")).toBe("# ");
    expect(scaffoldText("h2")).toBe("## ");
    expect(scaffoldText("h3")).toBe("### ");
    expect(scaffoldText("bulleted")).toBe("- ");
    expect(scaffoldText("numbered")).toBe("1. ");
    expect(scaffoldText("quote")).toBe("> ");
    expect(scaffoldText("code")).toBe("```\n" + SLASH_CARET + "\n```");
    expect(scaffoldText("divider")).toBe("---\n");
    expect(scaffoldText("callout")).toBe("> [!note] " + SLASH_CARET);
    expect(scaffoldText("embed-note")).toBe("![[" + SLASH_CARET + "]]");
    expect(scaffoldText("embed-block")).toBe("![[#^" + SLASH_CARET + "]]");
    expect(scaffoldText("properties")).toBe("---\n" + SLASH_CARET + "\n---\n");
    expect(scaffoldText("tag")).toBe("#" + SLASH_CARET);
    expect(scaffoldText("task")).toBe("- [ ] " + SLASH_CARET);
    expect(scaffoldText("mermaid")).toBe(
      "```mermaid\nflowchart TD\n  " + SLASH_CARET + "A --> B\n```",
    );
    expect(scaffoldText("nope")).toBeNull();
  });

  it("builds agent scaffolds from the canonical header writer", () => {
    expect(scaffoldText("agent-instruction", SPEC)).toBe(
      `${formatAgentHeader("agent", { status: "new", id: "ABC123", target: "document" })}\n> ${SLASH_CARET}`,
    );
    expect(scaffoldText("agent-review", SPEC)).toBe(
      `${formatAgentHeader("agent-review", { id: "ABC123" })}\n> ${SLASH_CARET}`,
    );
    // Default target and a generated ID keep the scaffold valid on its own.
    const automatic = scaffoldText("agent-instruction")!;
    expect(automatic).toMatch(
      /^> \[!agent\] status:new id: [A-Za-z0-9]{6} target: document\n> /,
    );
  });

  it("resolves a caret offset for every scaffold and inserts only the token", () => {
    for (const scaffold of SCAFFOLDS) {
      const insertion = scaffoldInsertion(scaffold.id, SPEC);
      expect(insertion, scaffold.id).not.toBeNull();
      expect(insertion!.text).not.toContain(SLASH_CARET);
      expect(insertion!.caretOffset).toBeGreaterThanOrEqual(0);
      expect(insertion!.caretOffset).toBeLessThanOrEqual(insertion!.text.length);
    }
    const source = "before\n/h1\nafter\n";
    const result = insertScaffold(source, 7, 10, "h1")!;
    expect(result.source).toBe("before\n# \nafter\n");
    expect(result.cursor).toBe(9);
    // Only the `/h1` token changed: everything around it is byte-identical.
    expect(result.source.slice(0, 7)).toBe(source.slice(0, 7));
    expect(result.source.slice(-6)).toBe(source.slice(-6));
  });

  it("resolves `/` only at the start of an empty block and never inside code", () => {
    expect(resolveSlashTrigger("/head", 5)).toEqual({ from: 0, to: 5, query: "head" });
    expect(resolveSlashTrigger("  /", 3)).toEqual({ from: 2, to: 3, query: "" });
    expect(resolveSlashTrigger("hello /head", 11)).toBeNull();
    expect(resolveSlashTrigger("```\n/head", 9)).toBeNull();
    expect(resolveSlashTrigger("a/b", 3)).toBeNull();
  });

  it("ranks prefix matches first and returns nothing for an unmatched query", () => {
    expect(filterScaffolds("head").map((s) => s.id)).toEqual(["h1", "h2", "h3"]);
    expect(filterScaffolds("").length).toBe(SCAFFOLDS.length);
    expect(filterScaffolds("zzzz")).toEqual([]);
    expect(filterScaffolds("mermaid")[0].id).toBe("mermaid");
  });
});

/* ------------------------------------------------------------------ *
 * Gutter / drag handle                                                *
 * ------------------------------------------------------------------ */

const GUTTER_DOC = [
  "---",
  "title: Alpha",
  "---",
  "",
  "# Heading",
  "",
  "A paragraph.",
  "",
  "- item one",
  "- item two",
  "",
  "> [!note] Callout",
  "> body",
  "",
].join("\n");

describe("S7-10 hover gutter", () => {
  it("puts one gutter entry on each outermost block", () => {
    const state = EditorState.create({ doc: GUTTER_DOC });
    const specs = gutterSpecs(state);
    expect(specs.map((spec) => spec.type)).toEqual([
      "frontmatter",
      "heading",
      "paragraph",
      "list",
      "callout",
    ]);
    // Nested list items never get their own gutter icon.
    expect(specs.some((spec) => spec.type === "listItem")).toBe(false);
  });

  it("renders `+` and a drag handle in the reserved margin, without touching text", () => {
    const { host, view } = makeView(GUTTER_DOC, [blockAffordances()]);

    const gutters = host.querySelectorAll(".cm-block-gutter");
    expect(gutters.length).toBeGreaterThan(0);
    const first = gutters[0] as HTMLElement;
    const plus = first.querySelector(".cm-block-plus");
    const drag = first.querySelector(".cm-block-drag");
    expect(plus?.getAttribute("aria-label")).toBe("Insert block below");
    expect(plus?.textContent).toBe("+");
    expect(drag?.getAttribute("aria-label")).toBe("Drag to move block");
    expect(drag?.getAttribute("draggable")).toBe("true");
    // Painted as decorations only — the document is untouched.
    expect(view.state.doc.toString()).toBe(GUTTER_DOC);
  });

  it("keeps the gutter out of the text flow (no shift on hover)", () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "src/client/styles.css"),
      "utf8",
    );
    // Absolute positioning inside a reserved left margin is what guarantees
    // the text does not reflow when the gutter appears.
    expect(css).toMatch(/--gutter-reserve:\s*\d+px/);
    expect(css).toMatch(/\.cm-block-gutter\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(
      /\.editor-wrap \.cm-content\s*\{[^}]*padding-left:\s*var\(--gutter-reserve\)/s,
    );
    expect(css).toMatch(/\.editor-wrap \.cm-line\s*\{[^}]*position:\s*relative/s);
    // The icons are revealed on hover, not always shown (so no layout cost).
    expect(css).toMatch(/\.cm-line:hover \.cm-block-gutter/);

    // And the mounted editor never changes its source because of the gutter.
    const host = mountEditor({ value: GUTTER_DOC, onChange: vi.fn() });
    const dom = host.querySelector<HTMLElement>(".cm-content");
    const view = dom ? EditorView.findFromDOM(dom) : null;
    expect(view?.state.doc.toString()).toBe(GUTTER_DOC);
    expect(host.querySelector(".cm-block-gutter")).not.toBeNull();
  });

  it("inserts a block below from `+` in one transaction and undoes exactly", () => {
    const { host, view, stats, reset } = makeView(GUTTER_DOC, [
      blockAffordances({ onInsertBelow: (v, block) => insertBlockBelow(v, block) }),
    ]);
    reset();
    const plus = host.querySelector(".cm-block-plus") as HTMLButtonElement;
    act(() => plus.click());
    expect(stats.docChanges).toBe(1);
    expect(stats.transactions).toBe(1);
    expect(view.state.doc.toString()).not.toBe(GUTTER_DOC);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(GUTTER_DOC);
  });
});

/* ------------------------------------------------------------------ *
 * Bubble toolbar                                                      *
 * ------------------------------------------------------------------ */

describe("S7-10 bubble toolbar", () => {
  it("exposes the eight spec'd marks with accessible labels", () => {
    const { host } = mountNode(
      createElement(BlockToolbar, {
        top: 0,
        left: 0,
        hasSelection: true,
        onCommand: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    const toolbar = host.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute("aria-label")).toBe("Inline formatting");
    const buttons = [...host.querySelectorAll(".block-toolbar-btn")].map((b) =>
      b.getAttribute("data-mark"),
    );
    expect(buttons).toEqual(INLINE_MARKS.map((mark) => mark.id));
    expect(INLINE_MARKS.map((mark) => mark.id)).toEqual([
      "bold",
      "italic",
      "strike",
      "code",
      "link",
      "wikilink",
      "highlight",
      "comment",
    ]);
    expect(
      host.querySelector('[data-mark="highlight"]')?.getAttribute("aria-label"),
    ).toBe("Highlight");
  });

  it("reports the clicked mark and disables link without a selection", () => {
    const onCommand = vi.fn();
    const { host } = mountNode(
      createElement(BlockToolbar, {
        top: 0,
        left: 0,
        hasSelection: false,
        onCommand,
        onClose: vi.fn(),
      }),
    );
    const link = host.querySelector<HTMLButtonElement>('[data-mark="link"]')!;
    expect(link.disabled).toBe(true);
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-mark="bold"]')!.click();
    });
    expect(onCommand).toHaveBeenCalledWith("bold");
  });

  it("collects a URL for the link mark", () => {
    const onCommand = vi.fn();
    const { host } = mountNode(
      createElement(BlockToolbar, {
        top: 0,
        left: 0,
        hasSelection: true,
        onCommand,
        onClose: vi.fn(),
      }),
    );
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-mark="link"]')!.click();
    });
    const input = host.querySelector<HTMLInputElement>(".block-toolbar-input")!;
    expect(input.getAttribute("aria-label")).toBe("Link URL");
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(input, "https://example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onCommand).toHaveBeenCalledWith("link", "https://example.com");
  });

  it("dismisses on Escape and on click-away", () => {
    const onClose = vi.fn();
    const { host } = mountNode(
      createElement(BlockToolbar, {
        top: 0,
        left: 0,
        hasSelection: true,
        onCommand: vi.fn(),
        onClose,
      }),
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      (host.querySelector('[role="toolbar"]') as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------------ *
 * Slash menu UI + keyboard contract                                   *
 * ------------------------------------------------------------------ */

describe("S7-10 slash menu", () => {
  it("reuses the CommandPalette keyboard contract", () => {
    expect(paletteKeyIntent("ArrowDown", { count: 5, selected: 0 })).toEqual({
      type: "move",
      selected: 1,
    });
    expect(paletteKeyIntent("ArrowUp", { count: 5, selected: 0 })).toEqual({
      type: "move",
      selected: 0,
    });
    expect(paletteKeyIntent("Enter", { count: 5, selected: 3 })).toEqual({
      type: "select",
      selected: 3,
    });
    expect(paletteKeyIntent("Tab", { count: 5, selected: 3 })).toEqual({
      type: "select",
      selected: 3,
    });
    expect(paletteKeyIntent("Escape", { count: 5, selected: 3 })).toEqual({
      type: "close",
    });
    expect(paletteKeyIntent("x", { count: 5, selected: 3 })).toEqual({ type: "none" });
    expect(paletteKeyIntent("Enter", { count: 0, selected: 0 })).toEqual({ type: "close" });
  });

  it("renders filtered options as a listbox", () => {
    const onSelect = vi.fn();
    const items = filterScaffolds("head");
    const { host } = mountNode(
      createElement(SlashMenu, {
        items,
        selected: 1,
        query: "head",
        top: 0,
        left: 0,
        onSelect,
      }),
    );
    const listbox = host.querySelector('[role="listbox"]');
    expect(listbox?.getAttribute("aria-label")).toBe("Insert block");
    const options = [...host.querySelectorAll('[role="option"]')];
    expect(options.length).toBe(items.length);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    act(() => {
      (options[2] as HTMLElement).click();
    });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("shows an empty state rather than closing", () => {
    const { host } = mountNode(
      createElement(SlashMenu, {
        items: [],
        selected: 0,
        query: "zzz",
        top: 0,
        left: 0,
        onSelect: vi.fn(),
      }),
    );
    expect(host.querySelector(".slash-menu-empty")?.textContent).toBe("No matches");
  });

  it("opens on `/`, filters, and accepts a scaffold in one transaction", () => {
    const original = "Text\n\n/head";
    const { view, stats, reset } = makeView(original, [
      slashMenuExtension(),
      blockAffordances(),
    ]);

    // A caret move into the `/head` line opens the menu (no doc change).
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const open = activeSlash(view);
    expect(open).not.toBeNull();
    expect(open?.query).toBe("head");
    expect(filterScaffolds(open!.query).map((s) => s.id)).toEqual(["h1", "h2", "h3"]);

    // Movement uses the shared contract and stays inside the list.
    expect(slashMove(view, 1)).toBe(true);
    expect(activeSlash(view)?.selected).toBe(1);
    expect(slashMove(view, 5)).toBe(true);
    expect(activeSlash(view)?.selected).toBe(2);

    reset();
    expect(slashSelect(view, 0)).toBe(true);
    expect(view.state.doc.toString()).toBe("Text\n\n# ");
    expect(activeSlash(view)).toBeNull();
    // Exactly one CM6 transaction: no partial save is possible.
    expect(stats.docChanges).toBe(1);
    expect(stats.transactions).toBe(1);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
  });

  it("closes on Escape without changing the document", () => {
    const original = "/";
    const { view, contentDOM } = (() => {
      const made = makeView(original, [slashMenuExtension()]);
      return { ...made, contentDOM: made.view.contentDOM };
    })();
    view.dispatch({ selection: { anchor: 1 } });
    expect(activeSlash(view)).not.toBeNull();
    const before = view.state.doc.toString();
    contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(activeSlash(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(before);
    // The exported command is the same path the keymap takes.
    expect(slashClose(view)).toBe(false);
  });
});
