import { describe, it, expect } from "vitest";
import {
  parseAgentBlocks,
  maskAgentBlocks,
  acceptAgentReview,
  rejectAgentReview,
  segmentBodyByAgentBlocks,
} from "../src/shared/agent-blocks.js";
describe("agent blocks", () => {
  const src =
    "Before\r\n\r\n> [!agent] TARGET: document\r\n> secret instruction\r\n>\r\n> more\r\n\r\nMiddle\r\n> [!agent-review] ID: r-1 STATUS: ready\r\n> Proposed **safe** content.\r\n\r\nAfter\r\n";
  it("parses line-aware blocks and offsets without consuming surrounding paragraphs", () => {
    const b = parseAgentBlocks(src);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({
      type: "agent",
      target: "document",
      content: "secret instruction\n\nmore",
    });
    expect(src.slice(b[1].start, b[1].end)).toContain("Proposed");
    expect(src.slice(b[1].end)).toContain("After");
  });
  it("ignores fenced examples", () =>
    expect(
      parseAgentBlocks(
        "```md\n> [!agent] TARGET: document\n> do not run\n```\n",
      ),
    ).toHaveLength(0));
  it("masks instructions and reviews while preserving surrounding markdown", () => {
    const m = maskAgentBlocks(src);
    expect(m).toContain("Before");
    expect(m).toContain("Middle");
    expect(m).toContain("After");
    expect(m).not.toMatch(/secret|Proposed|agent/);
  });
  it("accepts only selected review as ordinary markdown", () => {
    const out = acceptAgentReview(src, "r-1");
    expect(out).toContain("Proposed **safe** content.");
    expect(out).not.toContain("[!agent-review]");
    expect(out).toContain("[!agent]");
  });
  it("rejects only selected review", () => {
    const out = rejectAgentReview(src, "r-1");
    expect(out).not.toContain("Proposed");
    expect(out).toContain("secret instruction");
  });
  it("fails closed for missing or duplicate IDs", () => {
    expect(() => acceptAgentReview(src, "missing")).toThrow("review_not_found");
    expect(() => rejectAgentReview(src + src, "r-1")).toThrow(
      "duplicate_review_id",
    );
  });
});

describe("segmentBodyByAgentBlocks (S6-1)", () => {
  const body =
    "Intro\n\n> [!agent] ID: a-1\n> start secret\n\nMiddle\n\n> [!agent] ID: a-1\n> end secret\n\nOutro\n";
  it("splits plain text from agent blocks and pairs by id", () => {
    const segs = segmentBodyByAgentBlocks(body);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ kind: "text", text: "Intro\n\n" });
    expect(segs[1]).toMatchObject({
      kind: "pair",
      id: "a-1",
      start: { id: "a-1" },
      end: { id: "a-1" },
    });
    if (segs[1].kind === "pair")
      expect(segs[1].inner[0]).toMatchObject({
        kind: "text",
        text: expect.stringContaining("Middle"),
      });
    expect(segs[2]).toEqual({ kind: "text", text: "\nOutro\n" });
  });
  it("keeps unpaired blocks as standalone card segments", () => {
    const segs = segmentBodyByAgentBlocks(
      "Before\n\n> [!agent] TARGET: document\n> solo\n\nAfter\n",
    );
    expect(segs).toHaveLength(3);
    expect(segs[1]).toMatchObject({
      kind: "agent",
      role: "standalone",
      block: { target: "document" },
    });
  });
  it("ignores fenced examples and nests pairs", () => {
    const src =
      "> [!agent] ID: outer\n> start\n\n```md\n> [!agent] ID: fake\n> not real\n```\n\n> [!agent] ID: inner\n> inner start\n\nDeep\n\n> [!agent] ID: inner\n> inner end\n\n> [!agent] ID: outer\n> end\n";
    const segs = segmentBodyByAgentBlocks(src);
    expect(segs).toHaveLength(1);
    const outer = segs[0];
    expect(outer.kind).toBe("pair");
    if (outer.kind !== "pair") return;
    const inner = outer.inner.find((s) => s.kind === "pair");
    expect(inner).toMatchObject({ kind: "pair", id: "inner" });
    // The fenced example stays as literal text, never becomes a card segment.
    const fenced = outer.inner.find(
      (s) => s.kind === "text" && s.text.includes("not real"),
    );
    expect(fenced).toBeTruthy();
    const cardSegs = outer.inner.filter((s) => s.kind === "agent");
    expect(cardSegs.some((s) => JSON.stringify(s).includes("fake"))).toBe(
      false,
    );
    expect(outer.inner.some((s) => s.kind === "text")).toBe(true);
  });
  it("renders a plain body as one text segment", () => {
    expect(segmentBodyByAgentBlocks("# Just prose\n\nNo blocks\n")).toEqual([
      { kind: "text", text: "# Just prose\n\nNo blocks\n" },
    ]);
  });
  it("flushes unclosed starts as standalone cards", () => {
    const segs = segmentBodyByAgentBlocks(
      "> [!agent] ID: orphan\n> dangling\n\nTail\n",
    );
    expect(segs[0]).toMatchObject({ kind: "agent", role: "standalone" });
    expect(segs[1]).toEqual({ kind: "text", text: "\nTail\n" });
  });
});
