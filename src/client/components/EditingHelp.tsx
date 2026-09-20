import { useState } from "react";

function Example({ code }: { code: string }) {
  return (
    <pre className="edit-help-example">
      <code>{code}</code>
    </pre>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="edit-help-section">
      <summary>{title}</summary>
      <div className="edit-help-body">{children}</div>
    </details>
  );
}

/**
 * In-product reference for signed-in editors. Summarises the Markdown the
 * editor understands, the autocomplete shortcuts, and how agent blocks work.
 * Collapsed by default and placed between File info and Backlinks.
 */
export function EditingHelp() {
  const [open, setOpen] = useState(false);
  return (
    <section className="context-block edit-help">
      <h4 className="edit-help-heading">
        <button
          className="edit-help-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Editing help
          <span className="edit-help-caret">{open ? "▾" : "▸"}</span>
        </button>
      </h4>
      {open && (
        <div className="edit-help-content">
          <Section title="Formatting">
            <ul className="edit-help-list">
              <li>
                <strong>Headings:</strong> <code># H1</code> down to{" "}
                <code>###### H6</code>.
              </li>
              <li>
                <strong>Emphasis:</strong> <code>**bold**</code>,{" "}
                <code>*italic*</code>, <code>~~strikethrough~~</code>.
              </li>
              <li>
                <strong>Lists:</strong> <code>- item</code> or{" "}
                <code>1. item</code>; task lists with <code>- [ ] todo</code> /{" "}
                <code>- [x] done</code>.
              </li>
              <li>
                <strong>Quotes &amp; rules:</strong> <code>&gt; quote</code> and{" "}
                <code>---</code> for a divider.
              </li>
              <li>
                <strong>Links:</strong>{" "}
                <code>[label](https://example.com)</code> or a note-relative{" "}
                <code>./other-note.md</code>.
              </li>
              <li>
                <strong>Images:</strong> <code>![alt](path/image.png)</code>{" "}
                (resolved relative to this note's folder) or an embed{" "}
                <code>![[image.png]]</code>.
              </li>
              <li>
                <strong>Code:</strong> <code>`inline`</code> and fenced blocks{" "}
                <code>```ts</code> … <code>```</code>.
              </li>
              <li>
                <strong>Tables:</strong> pipes and a header separator row.
              </li>
              <li>
                <strong>Frontmatter:</strong> the YAML block at the very top is
                editable and controls metadata; it is hidden from public
                rendering.
              </li>
            </ul>
          </Section>

          <Section title="Obsidian syntax">
            <ul className="edit-help-list">
              <li>
                <strong>Wikilinks:</strong> <code>[[Note Name]]</code> links to
                a vault note; <code>[[Note|label]]</code> shows a custom label;
                <code>![[image.png]]</code> embeds an attachment.
              </li>
              <li>
                <strong>Callouts:</strong> <code>&gt; [!note] Title</code> with{" "}
                <code>&gt; </code>-quoted body lines renders as a styled
                callout.
              </li>
              <li>
                <strong>Tags:</strong> <code>#tag</code> anywhere and nested{" "}
                <code>#parent/child</code>. Quoted text in fenced code is not a
                tag.
              </li>
            </ul>
          </Section>

          <Section title="Autocomplete">
            <ul className="edit-help-list">
              <li>
                <strong>Wikilinks:</strong> type <code>[[</code> and keep
                typing; a list of matching note titles appears. Click one (or
                press enter on a suggestion) to insert{" "}
                <code>[[Note Name]]</code>.
              </li>
              <li>
                <strong>Tags:</strong> type <code>#</code> after a space or{" "}
                <code>(</code> and matching existing tags appear with their note
                counts. Inserting adds <code>#tag</code>; a brand-new tag is
                valid too and becomes indexed after you save.
              </li>
              <li>
                <strong>Dismiss:</strong> press <code>Esc</code> to close the
                suggestions.
              </li>
              <li>
                <strong>Suppressed inside code:</strong> autocomplete does not
                fire inside inline <code>`code`</code> or fenced code blocks.
              </li>
            </ul>
          </Section>

          <Section title="Agent instructions">
            <p>
              Add an agent instruction block anywhere in the note to request
              research or drafting. The microsite never runs a model itself:
              these blocks are parsed by the site, hidden from public readers,
              and picked up by an external OpenClaw workflow.
            </p>
            <Example
              code={[
                "> [!agent] TARGET: document",
                "> Research the central claim and propose sourced additions.",
              ].join("\n")}
            />
            <p>
              A target can be <code>document</code> or a stable paragraph/block
              identifier.
            </p>
            <ul className="edit-help-list">
              <li>
                <strong>Public masking:</strong> complete <code>[!agent]</code>{" "}
                and <code>[!agent-review]</code> blocks are removed from
                everything public — API, rendered page, search, graph.
              </li>
              <li>
                <strong>External execution:</strong> OpenClaw reads the
                completed instruction, performs the research, and may stage a
                result back into the note as{" "}
                <code>&gt; [!agent-review] ID: … STATUS: ready</code>.
              </li>
              <li>
                <strong>Review in the editor:</strong> when a staged review is
                present, the Agent staging panel appears. <em>Accept</em>{" "}
                converts its proposed content into ordinary Markdown in your
                draft; <em>Reject</em> removes the block from your draft. Both
                only change the draft.
              </li>
              <li>
                <strong>Save to persist:</strong> nothing is written to the
                vault until you click <strong>Save</strong>.
              </li>
              <li>
                <strong>Safety:</strong> the app treats block text as data only;
                it never executes instructions or deletes content automatically.
              </li>
            </ul>
          </Section>

          <Section title="Saving &amp; conflicts">
            <ul className="edit-help-list">
              <li>
                Edit mode never auto-saves: click <strong>Save</strong>.
              </li>
              <li>
                If the note changed elsewhere while you were editing, save fails
                with a conflict prompt so you never silently overwrite — choose{" "}
                <em>Load external version</em>, <em>Review differences</em>, or
                a confirmed <em>Overwrite with mine</em>.
              </li>
              <li>
                On every successful save the server refreshes the note's{" "}
                <code>updated</code> date.
              </li>
            </ul>
          </Section>
        </div>
      )}
    </section>
  );
}
