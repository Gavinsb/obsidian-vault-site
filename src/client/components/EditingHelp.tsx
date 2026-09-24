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
 * In-product reference for signed-in editors. Summarises the WYSIWYG surface,
 * the block commands, the autocomplete and slash menus, structured content,
 * and how agent blocks work. Collapsed by default and placed between File info
 * and Backlinks.
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

          <Section title="The editor &amp; block commands">
            <ul className="edit-help-list">
              <li>
                <strong>Live Markdown:</strong> the editor is a CodeMirror 6
                WYSIWYG surface that renders Markdown as you type — headings,
                emphasis, lists, quotes, links, tags, highlights and comments.
                The raw delimiters reappear when the caret enters them, so you
                can always edit the source.
              </li>
              <li>
                <strong>Markdown is the file:</strong> what you see is the
                plain text that gets saved. A note you do not change is written
                back byte-for-byte, including syntax the editor does not render.
                Mermaid stays fenced source — there is no live diagram view.
              </li>
              <li>
                <strong>Slash menu:</strong> type <code>/</code> at the start of
                an empty block for a filterable insert menu (<code>↑</code>/
                <code>↓</code> to move, <code>Enter</code>/<code>Tab</code> to
                insert, <code>Esc</code> to dismiss). It offers CommonMark
                blocks (text, headings 1–3, bulleted/numbered list, quote, code
                block, divider), Callout, Embed note, Embed block, Properties,
                Tag, Task, Mermaid, and Agent instruction/review.
              </li>
              <li>
                <strong>Selection toolbar:</strong> select text for a floating
                toolbar with bold, italic, strikethrough, inline code, link,
                wikilink, highlight and comment. <code>Esc</code> or a click
                elsewhere dismisses it.
              </li>
              <li>
                <strong>Block gutter:</strong> every block shows a{" "}
                <code>+</code> (insert below) and a drag handle in the reserved
                left margin — the gutter never shifts your text. Drag to
                reorder; drop <em>before</em>, <em>after</em> or <em>nest</em>{" "}
                (there are no side-by-side drop zones).
              </li>
              <li>
                <strong>Multiple blocks:</strong> block operations act on whole
                blocks — a contiguous selection snaps to block boundaries, so an
                action never splits a block in half. Every block change is a
                single step, so <code>Ctrl/Cmd+Z</code> restores the exact
                previous source.
              </li>
            </ul>
          </Section>

          <Section title="Autocomplete">
            <ul className="edit-help-list">
              <li>
                <strong>Wikilinks:</strong> type <code>[[</code> and keep
                typing; matching note titles appear anchored at the caret.
                Choose one (or press <code>Enter</code>) to insert{" "}
                <code>[[Note Name]]</code>.
              </li>
              <li>
                <strong>Tags:</strong> type <code>#</code> after a space or{" "}
                <code>(</code> and matching existing tags appear with their note
                counts. Inserting adds <code>#tag</code>; a brand-new tag is
                valid too and becomes indexed after you save.
              </li>
              <li>
                <strong>Headings, block refs &amp; callouts:</strong>{" "}
                <code>[[Note#</code> suggests that note's headings,{" "}
                <code>[[Note#^</code> suggests its block ids, and{" "}
                <code>&gt; [!</code> suggests callout types.
              </li>
              <li>
                <strong>Keys:</strong> <code>↑</code>/<code>↓</code> move,{" "}
                <code>Enter</code> accepts, <code>Esc</code> dismisses, and{" "}
                <code>Ctrl/Cmd+Space</code> re-opens the list.
              </li>
              <li>
                <strong>Suppressed inside code:</strong> completion does not
                fire inside inline <code>`code`</code> or fenced code blocks.
              </li>
            </ul>
          </Section>

          <Section title="Properties">
            <ul className="edit-help-list">
              <li>
                The Properties panel edits the YAML frontmatter as key/value
                rows. Key order, quoting style, comments and every untouched
                byte are preserved; an edit rewrites only that one value.
              </li>
              <li>
                <strong>Server-owned <code>updated</code>:</strong> the{" "}
                <code>updated</code> field is shown but never editable — the
                server sets it on every successful save.
              </li>
            </ul>
          </Section>

          <Section title="Embeds &amp; block refs">
            <ul className="edit-help-list">
              <li>
                <strong>Note embed:</strong> <code>![[Note]]</code> transcludes
                another note inline (one level deep).
              </li>
              <li>
                <strong>Image embed:</strong> <code>![[image.png|300]]</code>{" "}
                renders the image at that width.
              </li>
              <li>
                <strong>Block refs:</strong> a trailing <code>^id</code> anchors
                a block, and <code>[[Note#^id]]</code> links to it.
              </li>
              <li>
                <strong>Masked previews:</strong> embeds and previews load
                through the public preview endpoint, which masks agent blocks —
                anonymous readers never see them.
              </li>
            </ul>
          </Section>

          <Section title="Agent blocks &amp; console">
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
                <strong>Agent Block Console:</strong> in Edit/Split mode an
                Agent Tasks side panel lists every block, and each block also
                gets an inline card — both drive one shared state. It shows the
                status dropdown, ID, TARGET, pairing, and the instruction/review
                bodies.
              </li>
              <li>
                <strong>Status transitions:</strong> the dropdown lists all
                seven statuses but enables only legal moves.{" "}
                <code>finished</code> is sweep-only and always disabled; setting{" "}
                <code>rejected</code> requires a{" "}
                <strong>Reviewer feedback</strong> section first.
              </li>
              <li>
                <strong>ID &amp; review ID:</strong> generate or edit the
                six-character ID; editing it rewrites the mirrored ID on the
                review block too.
              </li>
              <li>
                <strong>Findings panel:</strong> lists validator findings with
                click-to-jump. <em>Accept</em>/<em>Reject</em> convert or remove
                the staged review in your draft only.
              </li>
              <li>
                <strong>Save gate:</strong> Save is blocked only by errors on
                blocks you edited in this session. Pre-existing legacy findings
                are advisory and never block Save.
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
                Edit mode never auto-saves: click <strong>Save</strong> (or{" "}
                <code>Ctrl/Cmd+S</code>).
              </li>
              <li>
                Properties, block moves and console changes are all just draft
                edits — one Save writes them all in a single request.
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
