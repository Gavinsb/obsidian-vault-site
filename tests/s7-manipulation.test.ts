// @vitest-environment happy-dom
/**
 * S7-11 — block manipulation.
 *
 * Halves:
 *   - the pure planners: reorder / nest / delete / duplicate / turn-into are
 *     text-range splices over `detectBlocks` ranges, with byte-identical
 *     surroundings and only before/after/nest drop zones (no two columns);
 *   - the live editor: every action is exactly one CM6 transaction whose
 *     native undo restores the exact source (no partial save).
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { detectBlocks, type BlockRange } from "../src/shared/block-detect.js";
import {
  DROP_ZONES,
  applyChanges,
  blocksInRange,
  dropZoneAt,
  outermostBlocks,
  planDeleteBlocks,
  planDuplicateBlocks,
  planInsertBelow,
  planReorder,
  planTurnIntoBlocks,
  selectionSpan,
  turnIntoBlockText,
} from "../src/shared/block-manipulation.js";
import {
  applyInlineMarkToView,
  bulkDeleteBlocks,
  bulkDuplicateBlocks,
  deleteBlocks,
  duplicateBlocks,
  moveBlocks,
  runBlockChanges,
  snapSelectionToBlocks,
  turnIntoBlocks,
} from "../src/client/components/editor-actions.js";
import {
  blockAffordances,
  setBlockDrag,
  setDropTarget,
} from "../src/client/components/block-affordances.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const views: { host: HTMLElement; view: EditorView }[] = [];

afterEach(() => {
  for (const { host, view } of views.splice(0)) {
    view.destroy();
    host.remove();
  }
});

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

const DOC = [
  "---",
  "title: Alpha",
  "---",
  "",
  "# Heading",
  "",
  "Para one",
  "",
  "- item one",
  "  - nested child",
  "- item two",
  "",
  "> [!note] Callout",
  "> body",
  "",
  "Tail paragraph",
  "",
].join("\n");

const blocks = () => detectBlocks(DOC);
const outer = () => outermostBlocks(blocks());
const byType = (type: BlockRange["type"], index = 0) =>
  outer().filter((block) => block.type === type)[index];

const TEXT = {
  frontmatter: DOC.slice(0, DOC.indexOf("# Heading")),
  heading: "# Heading\n",
  paragraph: "Para one\n",
  list: "- item one\n  - nested child\n- item two\n",
  callout: "> [!note] Callout\n> body\n",
  tail: "Tail paragraph\n",
};

describe("S7-11 block math", () => {
  it("treats only the outermost blocks as manipulable units", () => {
    const types = outer().map((block) => block.type);
    expect(types).toEqual([
      "frontmatter",
      "heading",
      "paragraph",
      "list",
      "callout",
      "paragraph",
    ]);
    // Nested list items are children of the list, never separate drag targets.
    expect(outer().some((block) => block.type === "listItem")).toBe(false);
  });

  it("snaps a multi-block selection to whole block boundaries", () => {
    const para = byType("paragraph");
    const list = byType("list");
    const touched = blocksInRange(blocks(), para.start + 2, list.end - 3);
    expect(touched.map((block) => block.type)).toEqual(["paragraph", "list"]);
    expect(selectionSpan(blocks(), para.start + 2, list.end - 3)).toEqual({
      anchor: para.start,
      head: list.end,
    });
  });

  it("only ever offers before / after / nest drop zones", () => {
    expect(DROP_ZONES).toEqual(["before", "after", "nest"]);
    expect(DROP_ZONES.join(",")).not.toMatch(/left|right|column/);
    const para = byType("paragraph");
    const start = dropZoneAt(DOC, para.start, blocks());
    const middle = dropZoneAt(DOC, para.start + 4, blocks());
    const end = dropZoneAt(DOC, para.start + para.end - para.start - 1, blocks());
    expect(start?.zone).toBe("before");
    expect(middle?.zone).toBe("nest");
    expect(end?.zone).toBe("after");
  });
});

describe("S7-11 splices leave untouched surroundings byte-identical", () => {
  it("reorders a block without touching any other block", () => {
    const para = byType("paragraph");
    const list = byType("list");
    const callout = byType("callout");
    const before = applyChanges(DOC, planReorder(DOC, [list], para, "before")).source;
    // Exactly: the frontmatter + heading, then the list (with its blank line),
    // then the paragraph, then the untouched callout + tail.
    expect(before).toBe(
      DOC.slice(0, para.start) +
        TEXT.list +
        "\n" +
        TEXT.paragraph +
        "\n" +
        DOC.slice(callout.start),
    );
    expect(before.endsWith(TEXT.callout + "\n" + TEXT.tail)).toBe(true);
    expect(before.indexOf(TEXT.list)).toBeLessThan(before.indexOf(TEXT.paragraph));
  });

  it("moves a block after a target", () => {
    const para = byType("paragraph");
    const list = byType("list");
    const callout = byType("callout");
    const after = applyChanges(DOC, planReorder(DOC, [para], list, "after")).source;
    // `after` and `before` produce the same well-formed order here.
    expect(after).toBe(
      DOC.slice(0, para.start) +
        TEXT.list +
        "\n" +
        TEXT.paragraph +
        "\n" +
        DOC.slice(callout.start),
    );
    expect(after.startsWith(TEXT.frontmatter + TEXT.heading + "\n")).toBe(true);
    expect(after.endsWith(TEXT.callout + "\n" + TEXT.tail)).toBe(true);
    expect(after.indexOf(TEXT.list)).toBeLessThan(after.indexOf(TEXT.paragraph));
  });

  it("nests a dropped block under its target by indenting every line", () => {
    const para = byType("paragraph");
    const list = byType("list");
    const nested = applyChanges(DOC, planReorder(DOC, [para], list, "nest")).source;
    expect(nested).toContain("- item one\n  Para one\n  - nested child\n- item two");
    expect(nested.startsWith(TEXT.frontmatter + TEXT.heading + "\n")).toBe(true);
    expect(nested.endsWith(TEXT.callout + "\n" + TEXT.tail)).toBe(true);
    // Nesting is indentation, not a two-column layout.
    expect(nested).not.toMatch(/\|.*\|\n.*\|/);
  });

  it("deletes and duplicates exactly the selected blocks", () => {
    const heading = byType("heading");
    const deleted = applyChanges(DOC, planDeleteBlocks([heading])).source;
    expect(deleted).not.toContain("# Heading");
    expect(deleted.startsWith(TEXT.frontmatter)).toBe(true);
    expect(deleted.endsWith(TEXT.tail)).toBe(true);

    const duplicated = applyChanges(DOC, planDuplicateBlocks(DOC, [heading])).source;
    expect(duplicated.startsWith(TEXT.frontmatter + TEXT.heading + TEXT.heading + "\n")).toBe(true);
    expect(duplicated.endsWith(TEXT.tail)).toBe(true);
  });

  it("inserts a block below without rewriting the block", () => {
    const para = byType("paragraph");
    const inserted = applyChanges(DOC, planInsertBelow(para, "\n")).source;
    expect(inserted).toBe(DOC.slice(0, para.end) + "\n" + DOC.slice(para.end));
  });
});

describe("S7-11 turn-into is a text substitution", () => {
  it("rewrites markers, never a schema", () => {
    expect(turnIntoBlockText("- item", "todo")).toBe("- [ ] item");
    expect(turnIntoBlockText("- [ ] item", "callout")).toBe("> [!note] item");
    expect(turnIntoBlockText("> [!note] item", "h2")).toBe("## item");
    expect(turnIntoBlockText("## item", "paragraph")).toBe("item");
    expect(turnIntoBlockText("plain", "quote")).toBe("> plain");
    expect(turnIntoBlockText("plain", "agent", { agentId: "ABC123", target: "document" })).toBe(
      "> [!agent] status:new id: ABC123 target: document\n> plain",
    );
    expect(turnIntoBlockText("one\ntwo", "code")).toBe("```\none\ntwo\n```");
    // Sibling items are rewritten together; nested children keep their shape.
    expect(turnIntoBlockText("- a\n  - child\n- b\n", "numbered")).toBe(
      "1. a\n  - child\n2. b\n",
    );
  });

  it("turning a block in a real document touches only that block", () => {
    const heading = byType("heading");
    const changed = applyChanges(DOC, planTurnIntoBlocks(DOC, [heading], "h2")).source;
    expect(changed).toBe(
      DOC.slice(0, heading.start) + "## Heading\n" + DOC.slice(heading.end),
    );
    expect(changed.startsWith(TEXT.frontmatter)).toBe(true);
    expect(changed.endsWith(TEXT.tail)).toBe(true);
  });
});

describe("S7-11 editor actions (one transaction, native undo)", () => {
  it("reorders with one transaction and restores the exact source on undo", () => {
    const { view, stats, reset } = makeView(DOC, [blockAffordances()]);
    const para = byType("paragraph");
    const list = byType("list");
    reset();
    expect(moveBlocks(view, [list], para, "before")).toBe(true);
    expect(stats.docChanges).toBe(1);
    expect(stats.transactions).toBe(1);
    expect(view.state.doc.toString().indexOf(TEXT.list)).toBeLessThan(
      view.state.doc.toString().indexOf(TEXT.paragraph),
    );
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("supports a nested drag with undo fidelity", () => {
    const { view, stats, reset } = makeView(DOC, [blockAffordances()]);
    const para = byType("paragraph");
    const list = byType("list");
    reset();
    expect(moveBlocks(view, [para], list, "nest")).toBe(true);
    expect(stats.docChanges).toBe(1);
    expect(view.state.doc.toString()).toContain("- item one\n  Para one\n  - nested child\n- item two");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("deletes and duplicates in one transaction each, undoing exactly", () => {
    const { view, stats, reset } = makeView(DOC, [blockAffordances()]);
    const heading = byType("heading");

    reset();
    expect(deleteBlocks(view, [heading])).toBe(true);
    expect(stats.transactions).toBe(1);
    expect(view.state.doc.toString()).not.toContain("# Heading");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC);

    reset();
    expect(duplicateBlocks(view, [heading])).toBe(true);
    expect(stats.transactions).toBe(1);
    expect(view.state.doc.toString().split("# Heading").length - 1).toBe(2);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("bulk-deletes a contiguous multi-block selection", () => {
    const { view, stats, reset } = makeView(DOC, [blockAffordances()]);
    const para = byType("paragraph");
    const list = byType("list");
    view.dispatch({ selection: { anchor: para.start + 1, head: list.end - 1 } });
    reset();
    expect(bulkDeleteBlocks(view)).toBe(true);
    expect(stats.transactions).toBe(1);
    const next = view.state.doc.toString();
    expect(next.startsWith(TEXT.frontmatter + TEXT.heading + "\n")).toBe(true);
    expect(next).not.toContain(TEXT.paragraph);
    expect(next).not.toContain(TEXT.list);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("snaps a raw selection to block boundaries without changing bytes", () => {
    const { view, stats } = makeView(DOC, [blockAffordances()]);
    const para = byType("paragraph");
    const list = byType("list");
    view.dispatch({ selection: { anchor: para.start + 2, head: list.end - 2 } });
    expect(snapSelectionToBlocks(view)).toBe(true);
    const main = view.state.selection.main;
    expect(main.from).toBe(para.start);
    expect(main.to).toBe(list.end);
    expect(stats.docChanges).toBe(0);
  });

  it("turn-into replaces only the block, in one transaction", () => {
    const { view, stats, reset } = makeView(DOC, [blockAffordances()]);
    const heading = byType("heading");
    reset();
    expect(turnIntoBlocks(view, [heading], "h3")).toBe(true);
    expect(stats.transactions).toBe(1);
    expect(view.state.doc.toString()).toBe(
      DOC.slice(0, heading.start) + "### Heading\n" + DOC.slice(heading.end),
    );
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("applies an inline mark to the selection in one transaction", () => {
    const { view, stats, reset } = makeView("Bold me here\n", [blockAffordances()]);
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    reset();
    expect(applyInlineMarkToView(view, "bold")).toBe(true);
    expect(stats.transactions).toBe(1);
    expect(view.state.doc.toString()).toBe("**Bold** me here\n");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Bold me here\n");
  });

  it("clears drag state without a document change when a drop is rejected", () => {
    const { view, stats } = makeView(DOC, [blockAffordances()]);
    const para = byType("paragraph");
    view.dispatch({ effects: setBlockDrag.of(para) });
    view.dispatch({ effects: setDropTarget.of(null) });
    expect(stats.docChanges).toBe(0);
  });
});

describe("S7-11 drop feedback styling", () => {
  it("paints a ghost on the dragged block and a drop line at the boundary", () => {
    const { host, view } = makeView(DOC, [blockAffordances()]);
    const para = byType("paragraph");
    view.dispatch({ effects: setBlockDrag.of(para) });
    expect(host.querySelector(".cm-block-ghost")).not.toBeNull();
    view.dispatch({ effects: setDropTarget.of({ block: para, zone: "before" }) });
    expect(host.querySelector(".cm-block-drop-line")).not.toBeNull();
    expect(host.querySelector(".cm-block-drop-line.zone-before")).not.toBeNull();
    view.dispatch({ effects: setBlockDrag.of(null) });
    expect(host.querySelector(".cm-block-ghost")).toBeNull();
  });

  it("styles the ghost at 40% opacity and the drop line with the accent", () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "src/client/styles.css"),
      "utf8",
    );
    expect(css).toMatch(/\.cm-block-ghost\s*\{\s*opacity:\s*0\.4\s*;?\s*\}/);
    expect(css).toMatch(/\.cm-block-drop-line\s*\{[^}]*var\(--accent\)/s);
    expect(css).toMatch(/\.cm-block-drop-line\.zone-nest/);
    // No two-column drop output anywhere in the stylesheet.
    expect(css).not.toMatch(/\.cm-block-drop-line[^}]*grid-template-columns/s);
  });

  it("keeps every structural action on one write path (no partial save)", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/client/components/editor-actions.ts"),
      "utf8",
    );
    // Structural edits mutate the local document only; they never talk to the
    // server, so a drag can never trigger a partial save.
    expect(source).not.toMatch(/\bfetch\(|saveDoc|api\./);
    // Every structural action funnels through the single-dispatch helper; the
    // only other dispatches are the selection snap and the inline-mark splice.
    expect(source.match(/view\.dispatch\(/g)?.length).toBe(3);
  });
});

describe("S7-11 no-op guards", () => {
  it("ignores a drop onto the block's own span", () => {
    const list = byType("list");
    expect(planReorder(DOC, [list], list, "before")).toEqual([]);
    expect(planReorder(DOC, [list], list, "after")).toEqual([]);
    expect(planReorder(DOC, [list], list, "nest")).toEqual([]);
  });

  it("refuses non-contiguous selections", () => {
    const para = byType("paragraph");
    const callout = byType("callout");
    // Out of document order (overlapping a later block first) is rejected.
    expect(planReorder(DOC, [callout, para], byType("heading"), "before")).toEqual([]);
    expect(planDeleteBlocks([callout, para])).toEqual([]);
    expect(planDuplicateBlocks(DOC, [callout, para])).toEqual([]);
    // A real (snapped) range selection is contiguous and accepted.
    const touched = blocksInRange(blocks(), para.start + 2, callout.end - 2);
    expect(touched.map((block) => block.type)).toEqual(["paragraph", "list", "callout"]);
    expect(planDeleteBlocks(touched).length).toBe(1);
  });

  it("runBlockChanges is a no-op for an empty plan", () => {
    const { view, stats } = makeView(DOC, [blockAffordances()]);
    expect(runBlockChanges(view, [])).toBe(false);
    expect(stats.docChanges).toBe(0);
  });
});
