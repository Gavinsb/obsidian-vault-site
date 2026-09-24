/**
 * S8-4 / S8-11 — line-level change detection behind the narrowed Save gate.
 */
import { describe, expect, it } from "vitest";
import {
  changedRanges,
  spanIntersectsAny,
  rangesIntersect,
} from "../src/shared/changed-ranges.js";

describe("changedRanges", () => {
  it("returns nothing for identical input", () => {
    expect(changedRanges("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("returns the whole document when it was previously empty", () => {
    expect(changedRanges("", "a\n")).toEqual([{ start: 0, end: 2 }]);
  });

  it("reports only the edited line span", () => {
    const before = "one\ntwo\nthree\nfour\n";
    const after = "one\ntwo EDITED\nthree\nfour\n";
    const spans = changedRanges(before, after);
    expect(spans).toHaveLength(1);
    expect(after.slice(spans[0].start, spans[0].end)).toBe("two EDITED\n");
  });

  it("does not flag untouched agent-block lines when a later paragraph changes", () => {
    const before = [
      "intro",
      "> [!agent] STATUS: new ID: ABC123 TARGET: document",
      "> do the thing",
      "",
      "tail",
      "",
    ].join("\n");
    const after = before.replace("tail", "tail changed");
    const spans = changedRanges(before, after);
    expect(spans).toHaveLength(1);
    expect(after.slice(spans[0].start, spans[0].end)).toBe("tail changed\n");
    // The agent block lines are untouched, so a finding there is not enforced.
    expect(
      spanIntersectsAny({ start: 0, end: 20 }, spans),
    ).toBe(false);
  });

  it("handles insertions and deletions", () => {
    const spans = changedRanges("a\nc\n", "a\nb\nc\n");
    expect(spans.some((s) => "a\nb\nc\n".slice(s.start, s.end) === "b\n")).toBe(true);
  });
});

describe("spanIntersectsAny / rangesIntersect", () => {
  it("treats touching edges as non-overlapping", () => {
    expect(spanIntersectsAny({ start: 0, end: 5 }, [{ start: 5, end: 10 }])).toBe(false);
    expect(rangesIntersect({ start: 0, end: 5 }, { start: 5, end: 10 })).toBe(false);
  });

  it("detects a real overlap", () => {
    expect(spanIntersectsAny({ start: 4, end: 9 }, [{ start: 0, end: 5 }])).toBe(true);
    expect(rangesIntersect({ start: 4, end: 9 }, { start: 0, end: 5 })).toBe(true);
  });
});
