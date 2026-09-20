import { describe, expect, it } from "vitest";
import fs from "node:fs";

const docView = fs.readFileSync(
  new URL("../src/client/components/DocView.tsx", import.meta.url),
  "utf8",
);
const editingHelp = fs.readFileSync(
  new URL("../src/client/components/EditingHelp.tsx", import.meta.url),
  "utf8",
);

describe("Editing help box (S5-2)", () => {
  it("sits between File info and Backlinks and only renders for editors", () => {
    const fileInfo = docView.indexOf("File info");
    const backlinks = docView.indexOf("Backlinks");
    const help = docView.indexOf("{canEdit && <EditingHelp />}");
    expect(fileInfo).toBeGreaterThanOrEqual(0);
    expect(backlinks).toBeGreaterThan(fileInfo);
    expect(help).toBeGreaterThan(fileInfo);
    expect(help).toBeLessThan(backlinks);
  });

  it("documents markdown formatting, obsidian syntax, and autocomplete", () => {
    for (const token of [
      "Formatting",
      "Obsidian syntax",
      "Autocomplete",
      "Wikilinks",
      "Callouts",
      "Esc",
      "TARGET: document",
    ]) {
      expect(editingHelp).toContain(token);
    }
  });

  it("explains agent masking, external execution, review staging, and explicit save", () => {
    for (const token of [
      "Public masking",
      "External execution",
      "Save to persist",
      "> [!agent]",
      "[!agent-review]",
      "never executes instructions",
      "Accept"
    ]) {
      expect(editingHelp).toContain(token);
    }
  });

  it("is collapsed by default", () => {
    expect(editingHelp).toContain("useState(false)");
    expect(editingHelp).toMatch(/aria-expanded=\{open\}/);
  });
});
