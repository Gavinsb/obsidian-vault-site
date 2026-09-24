import { describe, expect, it } from "vitest";

import { parseAgentBlocks } from "../src/shared/agent-blocks";
import {
  detectBlocks,
  type BlockRange,
} from "../src/shared/block-detect";

function slices(source: string, ranges: BlockRange[]) {
  return ranges.map((range) => source.slice(range.start, range.end));
}

describe("detectBlocks", () => {
  it("returns nested list containers and multiline items in source order", () => {
    const source =
      "- outer line\n  continuation\n  - nested one\n    nested continuation\n  - [ ] nested task\n- sibling\n";
    const blocks = detectBlocks(source);

    expect(blocks.map(({ type, nesting }) => [type, nesting])).toEqual([
      ["list", 0],
      ["listItem", 1],
      ["list", 2],
      ["listItem", 3],
      ["task", 3],
      ["listItem", 1],
    ]);
    expect(slices(source, blocks)).toEqual([
      source,
      "- outer line\n  continuation\n  - nested one\n    nested continuation\n  - [ ] nested task\n",
      "- nested one\n    nested continuation\n  - [ ] nested task\n",
      "- nested one\n    nested continuation\n",
      "- [ ] nested task\n",
      "- sibling\n",
    ]);
  });

  it("keeps a quote with a nested list as a hierarchy", () => {
    const source = "> prose\n> - first\n>   - nested\n";
    const blocks = detectBlocks(source);

    expect(blocks.map(({ type, nesting }) => [type, nesting])).toEqual([
      ["quote", 0],
      ["paragraph", 1],
      ["list", 1],
      ["listItem", 2],
      ["list", 3],
      ["listItem", 4],
    ]);
    expect(source.slice(blocks[0].start, blocks[0].end)).toBe(source);
  });

  it("recognises fences and never promotes fenced callout impostors", () => {
    const source =
      "before\n\n~~~md\n> [!agent] status:new ID: FAKE12\n> no task\n> [!note] no callout\n~~~\n\nafter\n";
    const blocks = detectBlocks(source);

    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "fence",
      "paragraph",
    ]);
    expect(blocks.filter((block) => block.type === "agent")).toHaveLength(0);
    expect(blocks.filter((block) => block.type === "callout")).toHaveLength(0);
  });

  it("recognises GFM tables as one block", () => {
    const source = "| Name | Value |\n| :--- | ---: |\n| one | two |\n";
    const [table] = detectBlocks(source);
    expect(table).toMatchObject({
      type: "table",
      start: 0,
      end: source.length,
      startLine: 1,
      endLine: 3,
    });
    expect(source.slice(table.start, table.end)).toBe(source);
  });

  it("treats only a leading, closed YAML section as frontmatter", () => {
    const source =
      "---\ntitle: Demo\ntags:\n  - one\n---\n\n# Heading\n\n---\n";
    const blocks = detectBlocks(source);

    expect(blocks.map((block) => block.type)).toEqual([
      "frontmatter",
      "heading",
      "hr",
    ]);
    expect(source.slice(blocks[0].start, blocks[0].end)).toBe(
      "---\ntitle: Demo\ntags:\n  - one\n---\n",
    );
  });

  it("classifies ordinary callouts and preserves their nested blocks", () => {
    const source = "> [!warning]- Careful\n> text\n> - item\n";
    const blocks = detectBlocks(source);

    expect(blocks.map(({ type, nesting }) => [type, nesting])).toEqual([
      ["callout", 0],
      ["paragraph", 1],
      ["list", 1],
      ["listItem", 2],
    ]);
    expect(source.slice(blocks[0].start, blocks[0].end)).toBe(source);
  });

  it("uses parseAgentBlocks spans for agent and review callouts", () => {
    const source = [
      "> [!agent] status:new ID: A1B2C3 TARGET: document",
      "> instruction",
      "",
      "> [!agent-review] ID: A1B2C3",
      "> proposal",
      "",
    ].join("\n");
    const parsed = parseAgentBlocks(source);
    const agents = detectBlocks(source).filter(
      (block) => block.type === "agent",
    );

    expect(agents).toHaveLength(2);
    expect(agents.map(({ start, end }) => ({ start, end }))).toEqual(
      parsed.map(({ start, end }) => ({ start, end })),
    );
    expect(slices(source, agents)).toEqual(
      parsed.map((block) => source.slice(block.start, block.end)),
    );
  });

  it("recognises standalone Obsidian embeds but not inline image text", () => {
    const source =
      "![[Note Name]]\n\n![[image.png|300]] ^hero\n\nBefore ![[inline]] after\n";
    expect(detectBlocks(source).map((block) => block.type)).toEqual([
      "embed",
      "embed",
      "paragraph",
    ]);
  });

  it("preserves CRLF offsets, line endings, and inclusive line numbers", () => {
    const source =
      "# Heading\r\n\r\n- [x] done\r\n  continued\r\n\r\n> [!note] Title\r\n> body\r\n";
    const blocks = detectBlocks(source);
    const top = blocks.filter((block) => block.nesting === 0);

    expect(top.map((block) => block.type)).toEqual([
      "heading",
      "list",
      "callout",
    ]);
    expect(slices(source, top)).toEqual([
      "# Heading\r\n",
      "- [x] done\r\n  continued\r\n",
      "> [!note] Title\r\n> body\r\n",
    ]);
    expect(top.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 1],
      [3, 4],
      [6, 7],
    ]);
  });

  it("has valid ranges and reconstructs every source byte from top-level slices plus gaps", () => {
    const source =
      "---\r\ntitle: Ω\r\n---\r\n\r\nParagraph 😀\r\n\r\n- one\r\n  - two\r\n\r\n~~~\r\n# not heading\r\n~~~\r\n\r\n---\r\n";
    const blocks = detectBlocks(source);

    for (const block of blocks) {
      expect(block.start).toBeGreaterThanOrEqual(0);
      expect(block.end).toBeGreaterThan(block.start);
      expect(block.end).toBeLessThanOrEqual(source.length);
      expect(source.slice(block.start, block.end)).not.toBe("");
      expect(block.startLine).toBeLessThanOrEqual(block.endLine);
    }

    const top = blocks.filter((block) => block.nesting === 0);
    for (let i = 1; i < top.length; i++)
      expect(top[i - 1].end).toBeLessThanOrEqual(top[i].start);
    let cursor = 0;
    let rebuilt = "";
    for (const block of top) {
      rebuilt += source.slice(cursor, block.start);
      rebuilt += source.slice(block.start, block.end);
      cursor = block.end;
    }
    rebuilt += source.slice(cursor);
    expect(rebuilt).toBe(source);
    expect(new TextEncoder().encode(rebuilt)).toEqual(
      new TextEncoder().encode(source),
    );
  });
});
