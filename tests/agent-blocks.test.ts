import { describe, it, expect } from "vitest";
import {
  parseAgentBlocks,
  maskAgentBlocks,
  acceptAgentReview,
  rejectAgentReview,
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
