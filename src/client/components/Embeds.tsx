/**
 * S7-9 — note transclusion (`![[Note]]`) for the read and preview surfaces.
 *
 * Embeds are split out of the markdown *before* rendering and each one is
 * resolved through the masked `GET /api/note-preview` endpoint, so a
 * transcluded note can never expose agent blocks to an anonymous reader.
 * Depth is one: embedded content renders through `Markdown`, which degrades a
 * nested embed to a wikilink rather than recursing.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { parseWikiLinks } from "../../shared/wiki";
import { api, type NotePreview } from "../api";
import { Markdown, encPath } from "./Markdown";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export type EmbedSegment =
  | { kind: "text"; text: string }
  | {
      kind: "note";
      target: string;
      heading?: string;
      block?: string;
      alias?: string;
    };

/** Split content into plain-text chunks and note-embed segments (code-aware). */
export function splitNoteEmbeds(content: string): EmbedSegment[] {
  const spans = parseWikiLinks(content, { includeEmbeds: true }).filter(
    (s) => s.raw.startsWith("![") && !IMAGE_RE.test(s.target),
  );
  if (spans.length === 0) return [{ kind: "text", text: content }];
  const out: EmbedSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor)
      out.push({ kind: "text", text: content.slice(cursor, span.start) });
    out.push({
      kind: "note",
      target: span.target,
      heading: span.heading,
      block: span.block,
      alias: span.alias,
    });
    cursor = span.end;
  }
  if (cursor < content.length)
    out.push({ kind: "text", text: content.slice(cursor) });
  return out;
}

/** The slice of `api` a note embed needs (injectable for tests). */
export interface PreviewApi {
  notePreview(target: string): Promise<NotePreview>;
}

export function NoteEmbed({
  target,
  alias,
  heading,
  block,
  baseFolder,
  preview,
}: {
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
  baseFolder?: string;
  preview?: PreviewApi;
}) {
  const fetcher = preview ?? api;
  const [state, setState] = useState<{
    status: "loading" | "ready" | "missing";
    data?: NotePreview;
  }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetcher
      .notePreview(target)
      .then((p) => {
        if (cancelled) return;
        setState(
          p.resolved && p.content !== undefined
            ? { status: "ready", data: p }
            : { status: "missing" },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [target, fetcher]);

  const label = alias || target;
  const suffix = block ? `#^${block}` : heading ? `#${heading}` : "";
  return (
    <section
      className="embed-note"
      data-embed-target={target}
      data-embed-block={block}
    >
      <div className="embed-note-head">
        <span className="embed-note-badge">Embed</span>
        <Link to={`/note/${encPath(target)}`} className="embed-note-link">
          {label}
          {suffix}
        </Link>
      </div>
      {state.status === "ready" ? (
        <div className="embed-note-body">
          <Markdown
            content={state.data!.content ?? ""}
            baseFolder={state.data!.folder ?? baseFolder}
            refTarget={state.data!.title ?? target}
          />
        </div>
      ) : (
        <div
          className={`embed-note-body embed-note-${state.status === "loading" ? "loading" : "missing"}`}
        >
          {state.status === "loading"
            ? "Loading embed…"
            : `Embed not available: ${label}`}
        </div>
      )}
    </section>
  );
}

/**
 * Renders markdown with note transclusion. Used by the read view and the split
 * preview; `Markdown` remains the safe rendered form for everything else.
 */
export function MarkdownWithEmbeds({
  content,
  baseFolder,
  refTarget,
  preview,
}: {
  content: string;
  baseFolder?: string;
  refTarget?: string;
  preview?: PreviewApi;
}) {
  const segments = useMemo(() => splitNoteEmbeds(content), [content]);
  return (
    <div className="markdown-with-embeds">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <Markdown
            key={i}
            content={seg.text}
            baseFolder={baseFolder}
            refTarget={refTarget}
          />
        ) : (
          <NoteEmbed
            key={i}
            target={seg.target}
            alias={seg.alias}
            heading={seg.heading}
            block={seg.block}
            baseFolder={baseFolder}
            preview={preview}
          />
        ),
      )}
    </div>
  );
}
