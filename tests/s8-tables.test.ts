/**
 * S8-15 / S8-16 / S8-17 / S8-18 / S8-19 — table creation, turn-into and the
 * patched editor widget's local additions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SCAFFOLDS,
  SCAFFOLD_CATEGORIES,
  filterScaffolds,
  scaffoldInsertion,
} from "../src/shared/slash-menu.js";
import {
  TURN_INTO_OPTIONS,
  turnIntoBlockText,
} from "../src/shared/block-manipulation.js";

const widget = readFileSync(
  new URL("../vendor/atomic-editor/dist/table-widget.js", import.meta.url),
  "utf8",
);

describe("S8-15 slash-menu Table scaffold", () => {
  it("registers a Table category and scaffold", () => {
    expect(SCAFFOLD_CATEGORIES).toContain("Table");
    const table = SCAFFOLDS.find((s) => s.id === "table");
    expect(table).toBeDefined();
    expect(table!.category).toBe("Table");
    expect(table!.label).toBe("Table");
  });

  it("inserts a starter table with the caret in the first header cell", () => {
    expect(scaffoldInsertion("table")).toEqual({
      text: "|  |  |\n| --- | --- |\n|  |  |",
      caretOffset: 2,
    });
    expect(filterScaffolds("table")[0].id).toBe("table");
  });
});

describe("S8-16 turn-into Table", () => {
  it("lists Table in the turn-into menu", () => {
    expect(TURN_INTO_OPTIONS.some((o) => o.id === "table")).toBe(true);
  });

  it("builds a starter table from a paragraph", () => {
    expect(turnIntoBlockText("Hello", "table")).toBe(
      "| Hello |  |\n| --- | --- |\n|  |  |",
    );
  });

  it("keeps an existing table unchanged when already a table", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(turnIntoBlockText(table, "table")).toBe(table);
  });

  it("flattens a table back to plain lines for other targets", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    expect(turnIntoBlockText(table, "paragraph")).toBe("A · B\n1 · 2\n");
  });
});

describe("S8-17 / S8-18 / S8-19 local editor patch", () => {
  it("adds visible row/column controls beside the table", () => {
    expect(widget).toContain("cm-atomic-table-tools");
    expect(widget).toContain("Insert row below");
    expect(widget).toContain("Insert column right");
    expect(widget).toContain("Delete row");
    expect(widget).toContain("Delete column");
    // Controls live beside the <table>, never inside it (serializer safety).
    expect(widget).toMatch(/table\.appendChild\(tbody\);\s*\/\/ S8-17/);
  });

  it("routes a plain click inside a cell to the cell's own source", () => {
    expect(widget).toContain("// S8-18 (local patch)");
    expect(widget).toContain("setActiveCell(cell)");
  });

  it("converts the table to a paragraph when the last body row is deleted", () => {
    expect(widget).toContain("S8-19");
    expect(widget).toContain("function convertTableToParagraph(view, wrap)");
    expect(widget).toMatch(/if \(m\.rows\.length <= 1\) \{\s*convertTableToParagraph/);
  });

  it("keeps the last column undeletable", () => {
    expect(widget).toMatch(/if \(col < 0 \|\| m\.header\.length <= 1\)/);
  });
});
