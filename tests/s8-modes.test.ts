/**
 * S8-1 / S8-2 / S8-3 / S8-5 / S8-6 / S8-7 / S8-8 / S8-10 / S8-12 / S8-14 —
 * the mode matrix and the header layout contract, asserted against source the
 * way the rest of this project's UI tests do.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const docView = readFileSync(
  new URL("../src/client/components/DocView.tsx", import.meta.url),
  "utf8",
);
const rawEditor = readFileSync(
  new URL("../src/client/components/RawEditor.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/client/styles.css", import.meta.url),
  "utf8",
);

describe("S8 mode matrix (Read / Edit / Raw)", () => {
  it("drops Split entirely", () => {
    expect(docView).toContain('type Mode = "read" | "edit" | "raw"');
    expect(docView).not.toMatch(/mode === "split"/);
    expect(docView).not.toContain("Split");
    expect(styles).not.toContain(".doc-body.split");
  });

  it("renders the three mode buttons only for signed-in editors", () => {
    expect(docView).toMatch(/\{canEdit && \(\s*<div className="mode-toggle"/);
    for (const label of ["Read", "Edit", "Raw"]) {
      expect(docView).toContain(`>\n                ${label}\n              </button>`);
    }
    expect(docView).toContain('void enter("raw")');
  });

  it("uses RawEditor for Raw and never shows Properties or the console there", () => {
    expect(docView).toContain('import { RawEditor } from "./RawEditor";');
    expect(docView).toMatch(/mode === "raw" && \(\s*<RawEditor/);
    // Properties + agent console are Edit-only.
    expect(docView).toMatch(/mode === "edit" && \(\s*<>\s*\{hasProperties/);
    expect(docView).toMatch(/mode === "edit" &&\s*\(agentConsole\.blocks\.length > 0/);
  });

  it("keeps the raw pane plain (no live preview, no Atomic editor)", () => {
    expect(rawEditor).not.toContain("@atomic-editor/editor");
    expect(rawEditor).not.toContain("inlinePreview");
    expect(rawEditor).toContain('from "@codemirror/lang-markdown"');
    expect(rawEditor).toContain("lineNumbers()");
    expect(rawEditor).toContain('"Mod-s"');
  });
});

describe("S8 header layout", () => {
  it("keeps the toolbar sticky and flattens the stacked bars", () => {
    expect(styles).toMatch(/\.doc-toolbar\s*\{[^}]*position:\s*sticky/);
    // The old standalone rating bar is gone from the doc view.
    expect(docView).not.toContain("doc-rating-bar");
  });

  it("gates rating and favourite to read mode (S8-3)", () => {
    expect(docView).toMatch(/canEdit && mode === "read" && \(\s*<div className="toolbar-rating">/);
    expect(docView).toContain("Remove favourite");
    // The mutation helpers are only reachable from the read-mode controls.
    expect(docView).toContain('void mutate("rating", v)');
    expect(docView).toContain('void mutate("favorite", !meta.favorite)');
  });

  it("moves secondary actions into the admins-aware overflow (S8-7)", () => {
    expect(docView).toContain('aria-label="More actions"');
    expect(docView).toContain("isAdmin && mode === \"read\" && (");
    expect(docView).toContain("Hide agent blocks");
    expect(docView).toContain("Delete note");
    // Delete keeps the confirm-panel flow rather than swapping buttons in place.
    expect(docView).toContain("Delete this note permanently?");
  });

  it("shows the note title beside the breadcrumbs while editing (S8-12)", () => {
    expect(docView).toMatch(/mode !== "read" && \(\s*<span className="toolbar-title"/);
  });

  it("guards Delete against a dirty draft (S8-12)", () => {
    expect(docView).toContain("Your unsaved changes will be discarded.");
  });

  it("keeps the read article free of the duplicated cards (S8-6)", () => {
    const article = docView.slice(
      docView.indexOf('className="article"'),
      docView.indexOf("{mode === \"edit\" && ("),
    );
    expect(article).not.toContain("File info");
    expect(article).not.toContain("PropertiesEditor");
  });

  it("collapses the Properties panel while editing (S8-10)", () => {
    expect(docView).toContain('className="collapsible doc-properties-collapse"');
  });

  it("shows Editing help only while editing (S8-14)", () => {
    expect(docView).toMatch(/canEdit && mode !== "read" && \(\s*<EditingHelp mode=\{mode\} \/>/);
  });
});

describe("S8 mutation safety (S8-4)", () => {
  it("invalidates an in-flight read poll when the source loads", () => {
    expect(docView).toContain("pollGuard.current += 1");
    expect(docView).toContain("guard !== pollGuard.current");
  });
});
