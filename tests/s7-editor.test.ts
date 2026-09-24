// @vitest-environment happy-dom
/**
 * S7-5 — CM6 editor core.
 *
 * Two halves:
 *   - DOM: mount the real `Editor` (happy-dom + React) and prove the raw
 *     markdown lands in `.cm-content`, that edits flow out through
 *     `onChange`, that `readOnly` blocks typing, and that a changed
 *     `documentId` remounts with a fresh document (and a fresh undo stack).
 *   - Pure: the completion source built on the unified `/api/completions`
 *     contract — trigger resolution, ranking passthrough and insertion shape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  Editor,
  createCompletionSource,
  resolveCompletionTrigger,
  type CompletionApi,
  type EditorProps,
} from "../src/client/components/Editor.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { host: HTMLElement; root: Root }[] = [];

function mount(props: EditorProps) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Editor, props)));
  mounted.push({ host, root });
  const rerender = (next: EditorProps) =>
    act(() => root.render(createElement(Editor, next)));
  const content = () => host.querySelector<HTMLElement>(".cm-content");
  const view = () => {
    const dom = content();
    return dom ? EditorView.findFromDOM(dom) : null;
  };
  return { host, rerender, content, view };
}

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

describe("S7-5 Editor (CM6 core)", () => {
  it("renders the raw markdown inside .cm-content", () => {
    const value = [
      "---",
      "title: Alpha",
      "---",
      "",
      "# Alpha",
      "",
      "Hello raw markdown world and [[Beta Note]].",
      "",
    ].join("\n");
    const { content, view } = mount({ value, onChange: vi.fn() });
    const dom = content();
    expect(dom).not.toBeNull();
    expect(dom?.textContent).toContain("Hello raw markdown world");
    // The document, not a rendering of it, is the editor's source of truth.
    expect(view()?.state.doc.toString()).toBe(value);
  });

  it("carries the host's className onto the editor frame", () => {
    const { host } = mount({
      value: "body",
      onChange: vi.fn(),
      className: "editor-pane full",
    });
    expect(host.querySelector(".editor-wrap.editor-pane.full")).not.toBeNull();
  });

  it("fires onChange with the new markdown after an edit", () => {
    const onChange = vi.fn();
    const { view } = mount({ value: "Hello world", onChange });
    const cm = view();
    expect(cm).not.toBeNull();
    act(() => {
      cm?.dispatch({ changes: { from: 5, insert: "," } });
    });
    expect(onChange).toHaveBeenLastCalledWith("Hello, world");
  });

  it("blocks typing when readOnly", () => {
    const onChange = vi.fn();
    const { content, view } = mount({ value: "Hello world", onChange, readOnly: true });
    const dom = content();
    const cm = view();
    expect(cm?.state.readOnly).toBe(true);
    expect(dom?.isContentEditable).toBe(false);
    // A DOM-level input attempt must not reach the document or the host.
    act(() => {
      dom?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(cm?.state.doc.toString()).toBe("Hello world");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the same document when only the value prop changes", () => {
    const onChange = vi.fn();
    const { view, rerender } = mount({
      value: "one",
      documentId: "note.md",
      onChange,
    });
    const before = view();
    rerender({ value: "one two", documentId: "note.md", onChange });
    expect(view()).toBe(before);
    expect(view()?.state.doc.toString()).toBe("one two");
  });

  it("remounts with the new source when documentId changes", () => {
    const onChange = vi.fn();
    const { content, view, rerender } = mount({
      value: "First note body",
      documentId: "first.md",
      onChange,
    });
    const before = view();
    rerender({
      value: "Second note body",
      documentId: "second.md",
      onChange,
    });
    const after = view();
    expect(after).not.toBe(before);
    expect(after?.state.doc.toString()).toBe("Second note body");
    expect(content()?.textContent).toContain("Second note body");
    // No undo bleed from the previous note.
    expect(after && undo(after)).toBe(false);
    expect(after?.state.doc.toString()).toBe("Second note body");
  });
});

const markdownState = (doc: string) =>
  EditorState.create({ doc, extensions: [markdown()] });

const contextAtEnd = (doc: string) => {
  const state = markdownState(doc);
  return new CompletionContext(state, state.doc.length, false);
};

const fakeApi = (
  results: { value: string; detail?: string; score: number }[],
) =>
  ({
    completions: vi.fn(async () => ({ results })),
  }) satisfies CompletionApi;

describe("S7-5 completion source", () => {
  it("resolves today's triggers plus headings, block refs and callouts", () => {
    const kindAt = (doc: string) => {
      const state = markdownState(doc);
      return resolveCompletionTrigger(state, state.doc.length);
    };
    expect(kindAt("See [[Bet")).toMatchObject({ kind: "note", query: "Bet" });
    expect(kindAt("text #beta")).toMatchObject({ kind: "tag", query: "beta" });
    expect(kindAt("See [[Alpha Note#Over")).toMatchObject({
      kind: "heading",
      query: "Over",
      note: "Alpha Note",
    });
    expect(kindAt("See [[Alpha Note#^blo")).toMatchObject({
      kind: "blockref",
      query: "blo",
      note: "Alpha Note",
    });
    expect(kindAt("> [!warn")).toMatchObject({
      kind: "callout",
      query: "warn",
    });
    // Same-note heading reference keeps the current document as the target.
    expect(kindAt("See [[#Over")).toMatchObject({
      kind: "heading",
      query: "Over",
      note: "",
    });
  });

  it("suppresses every trigger inside fenced and inline code", () => {
    const fenced = markdownState("```\n[[Bet");
    expect(resolveCompletionTrigger(fenced, fenced.doc.length)).toBeNull();
    const inline = markdownState("`[[Bet");
    expect(resolveCompletionTrigger(inline, inline.doc.length)).toBeNull();
    const calloutInFence = markdownState("```\n> [!warn");
    expect(
      resolveCompletionTrigger(calloutInFence, calloutInFence.doc.length),
    ).toBeNull();
  });

  it("returns the server's ranked values and preserves insertion shape", async () => {
    const api = fakeApi([
      { value: "Beta Note", detail: "", score: 60 },
      { value: "Beta Two", detail: "notes", score: 30 },
    ]);
    const source = createCompletionSource({
      api,
      path: "Alpha Note.md",
      debounceMs: 0,
    });
    const doc = "See [[Bet";
    const result = await source(contextAtEnd(doc));
    expect(api.completions).toHaveBeenCalledWith("note", "Bet", undefined, 8);
    expect(result?.filter).toBe(false);
    expect(result?.from).toBe(doc.indexOf("[["));
    expect(result?.to).toBe(doc.length);
    // Server order is kept as-is (no client re-sort).
    expect(result?.options.map((o) => o.label)).toEqual([
      "Beta Note",
      "Beta Two",
    ]);
    expect(result?.options[0].apply).toBe("[[Beta Note]]");
  });

  it("targets the note being referenced for heading and block-ref kinds", async () => {
    const api = fakeApi([{ value: "Overview", score: 8 }]);
    const source = createCompletionSource({
      api,
      path: "Current Note.md",
      debounceMs: 0,
    });
    const doc = "See [[Alpha Note#Over";
    const result = await source(contextAtEnd(doc));
    expect(api.completions).toHaveBeenCalledWith(
      "heading",
      "Over",
      "Alpha Note.md",
      8,
    );
    expect(result?.options[0].apply).toBe("[[Alpha Note#Overview]]");
    // The whole `[[Note#query` span is replaced — the prefix is never doubled.
    expect(result?.from).toBe(doc.indexOf("[["));
    expect(result?.to).toBe(doc.length);

    const blocks = fakeApi([{ value: "alpha-block", score: 8 }]);
    const blockSource = createCompletionSource({ api: blocks, debounceMs: 0 });
    const blockDoc = "See [[Alpha Note#^alph";
    const blockResult = await blockSource(contextAtEnd(blockDoc));
    expect(blocks.completions).toHaveBeenCalledWith(
      "blockref",
      "alph",
      "Alpha Note.md",
      8,
    );
    expect(blockResult?.options[0].apply).toBe("[[Alpha Note#^alpha-block]]");
  });

  it("inserts tags and callout types without rewriting surrounding text", async () => {
    const tags = fakeApi([{ value: "beta-tag", score: 6 }]);
    const tagSource = createCompletionSource({ api: tags, debounceMs: 0 });
    const tagDoc = "some text #beta";
    const tagResult = await tagSource(contextAtEnd(tagDoc));
    expect(tags.completions).toHaveBeenCalledWith("tag", "beta", undefined, 8);
    expect(tagResult?.options[0].apply).toBe("#beta-tag");

    const callouts = fakeApi([{ value: "warning", score: 7 }]);
    const calloutSource = createCompletionSource({
      api: callouts,
      debounceMs: 0,
    });
    const calloutDoc = "> [!warn";
    const calloutResult = await calloutSource(contextAtEnd(calloutDoc));
    expect(callouts.completions).toHaveBeenCalledWith(
      "callout",
      "warn",
      undefined,
      8,
    );
    expect(calloutResult?.options[0].apply).toBe("warning");
  });

  it("stays silent in code and on a failed lookup", async () => {
    const api = fakeApi([{ value: "Beta Note", score: 1 }]);
    const source = createCompletionSource({ api, debounceMs: 0 });
    const fenced = "```\n[[Bet";
    expect(await source(contextAtEnd(fenced))).toBeNull();
    expect(api.completions).not.toHaveBeenCalled();

    const failing = createCompletionSource({
      api: {
        completions: vi.fn(async () => {
          throw new Error("offline");
        }),
      },
      debounceMs: 0,
    });
    await expect(failing(contextAtEnd("See [[Bet"))).resolves.toBeNull();
  });

  it("drops a stale response from a superseded request", async () => {
    vi.useFakeTimers();
    try {
      const pending: Array<(value: {
        results: { value: string; score: number }[];
      }) => void> = [];
      const api: CompletionApi = {
        completions: vi.fn(
          () =>
            new Promise<{ results: { value: string; score: number }[] }>(
              (resolve) => {
                pending.push(resolve);
              },
            ),
        ),
      };
      const source = createCompletionSource({ api, debounceMs: 200 });
      const ctx = contextAtEnd("See [[Bet");
      const first = source(ctx);
      const second = source(ctx);
      // Only the newest request survives the debounce window.
      await vi.advanceTimersByTimeAsync(200);
      await expect(first).resolves.toBeNull();
      expect(pending.length).toBe(1);
      pending[0]({ results: [{ value: "Beta Note", score: 1 }] });
      expect((await second)?.options.map((o) => o.label)).toEqual([
        "Beta Note",
      ]);
      expect(api.completions).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
