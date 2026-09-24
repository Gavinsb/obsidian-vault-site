import { describe, it, expect } from "vitest";
import fs from "node:fs";
const source = fs.readFileSync(
  new URL("../src/client/components/DocView.tsx", import.meta.url),
  "utf8",
);
describe("S4 editor integration", () => {
  it("has no auto-save timer/debounce path", () => {
    expect(source).not.toContain("debounceAutoSave");
    expect(source).toMatch(/onChange=\{\(e\) => onInput\(/);
    expect(source).toMatch(/const dirty = draft !== baseline/);
  });
  it("writes only from explicit Save/confirmed overwrite controls", () => {
    expect(source).toMatch(/onClick=\{\(\) => void onSave\(\)\}/);
    expect(source).toContain("Confirm overwrite with mine");
  });
  it("blocks duplicate or unresolved-conflict saves", () => {
    expect(source).toMatch(
      /if \(saving \|\| !dirty \|\| \(!explicitOverwrite && !!conflict\)\) return/,
    );
    // S7-7 adds the edit-scoped validator gate to the same control.
    expect(source).toMatch(
      /disabled=\{saving \|\| !dirty \|\| !baseEtag \|\| !!conflict \|\| saveBlocked\}/,
    );
  });
  it("requires confirmation before replacing a draft with the external version", () => {
    expect(source).toContain(
      "Discard your draft and load the external version?",
    );
    expect(source).toContain("Discard and load");
  });
  it("preserves drafts for 401 and 412 responses", () => {
    expect(source).toMatch(/e\.status === 412/);
    expect(source).toMatch(/e\.status === 401/);
    expect(source).toContain("Your draft is preserved");
  });
  it("keeps review accept/reject draft-only", () => {
    expect(source).toContain("setDraft(acceptAgentReview");
    expect(source).toContain("setDraft(rejectAgentReview");
    expect(source).not.toMatch(/acceptAgentReview[^;]*api\.saveDoc/);
  });
  it("guards unload while dirty", () =>
    expect(source).toMatch(/window\.addEventListener\(["']beforeunload["']/));
  it("uses sequence IDs to ignore stale suggestions", () => {
    expect(source).toMatch(/const id = \+\+seq\.current/);
    expect(source).toMatch(/id !== seq\.current/);
  });
});
