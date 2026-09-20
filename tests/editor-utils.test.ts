import { describe, it, expect } from "vitest";
import {
  findAutocompleteTrigger,
  applyAutocomplete,
  sortTags,
  stableTagHue,
} from "../src/shared/editor-utils.js";
describe("raw Markdown autocomplete", () => {
  it("detects open wikilink range", () =>
    expect(findAutocompleteTrigger("See [[abi", 9)).toEqual({
      kind: "wikilink",
      query: "abi",
      replaceStart: 4,
      replaceEnd: 9,
    }));
  it("ignores closed links and inline/fenced code", () => {
    expect(findAutocompleteTrigger("[[done]]", 8)).toBeNull();
    expect(findAutocompleteTrigger("`[[no", 5)).toBeNull();
    expect(findAutocompleteTrigger("```\n[[no", 9)).toBeNull();
  });
  it("detects plausible tags but not hashes inside words", () => {
    expect(findAutocompleteTrigger("hello #hum", 10)).toMatchObject({
      kind: "tag",
      query: "hum",
    });
    expect(findAutocompleteTrigger("word#hum", 8)).toBeNull();
  });
  it("inserts safe raw source and cursor", () =>
    expect(
      applyAutocomplete(
        "See [[abi now",
        { kind: "wikilink", query: "abi", replaceStart: 4, replaceEnd: 9 },
        "Abilene Paradox.md",
      ),
    ).toEqual({ source: "See [[Abilene Paradox]] now", cursor: 23 }));
});
describe("tag directory utilities", () => {
  const t = [
    { tag: "beta", count: 2 },
    { tag: "Alpha", count: 2 },
    { tag: "zeta", count: 4 },
  ];
  it("sorts count with alphabetical ties", () =>
    expect(sortTags(t, "count").map((x) => x.tag)).toEqual([
      "zeta",
      "Alpha",
      "beta",
    ]));
  it("sorts A-Z deterministically", () =>
    expect(sortTags(t, "alpha").map((x) => x.tag)).toEqual([
      "Alpha",
      "beta",
      "zeta",
    ]));
  it("maps colors stably", () =>
    expect(stableTagHue("human-factors")).toBe(stableTagHue("human-factors")));
});
