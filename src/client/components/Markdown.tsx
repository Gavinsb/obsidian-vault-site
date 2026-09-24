import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import { formatBlockRef } from '../../shared/block-refs';

marked.setOptions({ gfm: true, breaks: true });

/** Encode a vault-relative path while keeping `/` separators literal. */
export const encPath = (p: string) =>
  p.split('/').map((seg) => encodeURIComponent(seg)).join('/');

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|data:|javascript:|\/\/|#)/i.test(href);
}

/** Resolve a note-relative image path against the note's folder (vault-relative). */
function resolveRelPath(baseFolder: string, src: string): string {
  const decoded = decodeURIComponent(src);
  const parts = baseFolder ? baseFolder.split('/').filter(Boolean) : [];
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

const FM_RE = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Remove a leading YAML frontmatter block (never render it as article text). */
export function stripFrontmatter(text: string): string {
  const m = FM_RE.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Split the first `# Title` heading from the rest of a body. */
export function splitTitle(body: string): { title: string; rest: string } {
  const m = /^#\s+(.+?)[ \t]*$/m.exec(body);
  if (!m) return { title: '', rest: body };
  const title = m[1].trim();
  const rest = body.slice(m.index + m[0].length).replace(/^\r?\n/, '');
  return { title, rest };
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** `![[image.png|300]]` → a width in pixels; anything else is alt text. */
function embedWidth(alias: string | undefined): string | undefined {
  if (!alias) return undefined;
  const m = /^(\d+)(?:x(\d+))?$/.exec(alias.trim());
  return m ? m[1] : undefined;
}

/**
 * Renders Markdown + Obsidian wiki-links/callouts/images into safe HTML.
 * Unsupported Obsidian syntax is left untouched (source integrity) and simply
 * shown as text. Note embeds (`![[Note]]`) are transcluded by
 * `MarkdownWithEmbeds`; here they degrade to a wikilink so the safe rendered
 * form never loses the reference.
 */
export function Markdown({
  content,
  baseFolder,
  refTarget,
}: {
  content: string;
  baseFolder?: string;
  /** Current note name — the target used when copying a block reference. */
  refTarget?: string;
}) {
  const navigate = useNavigate();
  const html = useMemo(() => renderMarkdown(content, baseFolder), [content, baseFolder]);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;

    // 0) Block anchors copy a resolvable `[[Note#^block-id]]` reference.
    const anchor = el.closest('.block-anchor') as HTMLElement | null;
    if (anchor) {
      e.preventDefault();
      const id = anchor.getAttribute('data-block-id');
      if (id) void navigator.clipboard?.writeText(formatBlockRef(refTarget ?? '', id));
      return;
    }

    const a = el.closest('a') as HTMLAnchorElement | null;
    if (!a) return;

    // 1) Wiki links carry the raw target (resolved server-side by title/alias).
    const wikilink = a.getAttribute('data-wikilink');
    if (wikilink) {
      e.preventDefault();
      const block = a.getAttribute('data-wikilink-block');
      navigate(`/note/${encPath(wikilink)}${block ? `#^${block}` : ''}`);
      return;
    }

    // 2) Internal markdown links (relative .md targets) navigate too.
    const href = a.getAttribute('href') || '';
    if (href && !isExternalHref(href)) {
      e.preventDefault();
      const target = href.replace(/^\.\//, '');
      navigate(`/note/${encPath(decodeURIComponent(target))}`);
    }
    // External links and anchors fall through to the browser.
  };

  return (
    <div
      className="markdown-body"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Renders wiki links as anchors with a data attribute the click handler reads.
export function renderMarkdown(content: string, baseFolder = ''): string {
  // 0) Strip frontmatter so YAML never leaks into the rendered article.
  content = stripFrontmatter(content);

  // 1) Extract fenced code blocks so we never transform inside them.
  const codeBlocks: string[] = [];
  content = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, (m) => {
    codeBlocks.push(m);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  // 2) Callouts: > [!note] title → styled blockquote (Obsidian blockquote-ish).
  content = content.replace(/^>\s*\[!(\w+)\][+-]?\s*(.*)$/gm, (m, type, title) => {
    const t = (title || type).trim();
    return `<aside class="callout callout-${(type ?? 'note').toLowerCase()}"><div class="callout-title">${escapeHtml(t)}</div>`;
  });

  // 3) Wiki links → anchors (store the RAW target, not pre-encoded);
  //    embeds (![[image.png]]) → <img> resolved against the attachment endpoint.
  content = content.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (_m, bang, inner) => {
    let target = inner;
    let alias: string | undefined;
    const pipe = inner.indexOf('|');
    if (pipe !== -1) {
      alias = inner.slice(pipe + 1).trim();
      target = inner.slice(0, pipe);
    }
    let block: string | undefined;
    const hash = target.indexOf('#');
    if (hash !== -1) {
      const after = target.slice(hash + 1);
      target = target.slice(0, hash);
      // `[[Note#^block-id]]` keeps a resolvable block reference.
      if (after.startsWith('^')) block = after.slice(1).trim();
    }
    const clean = target.trim();

    // Embed of an image/attachment → render an <img>, not a link.
    if (bang === '!' && IMAGE_RE.test(clean)) {
      const src = `/api/attachment/${encodeURIComponent(clean)}`;
      const width = embedWidth(alias);
      const alt = escapeHtml(width ? clean : (alias ?? clean));
      const widthAttr = width ? ` width="${width}"` : '';
      return `<img src="${src}" alt="${alt}" class="embed-image" loading="lazy"${widthAttr} />`;
    }

    const label = escapeHtml(alias ?? clean);
    const blockAttr = block ? ` data-wikilink-block="${escapeHtml(block)}"` : '';
    return `<a href="#/" data-wikilink="${escapeHtml(clean)}"${blockAttr} class="wikilink">${label}</a>`;
  });

  // 3b) Standard markdown images ![alt](path) → resolve relative to the note
  //     folder and serve through /api/raw (matches how the Abilene note links
  //     its infographic, unlike the `![[...]]` embed handled above).
  content = content.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    if (isExternalHref(src)) return _m; // leave http/data/anchor images alone
    const resolved = resolveRelPath(baseFolder, src);
    const enc = resolved.split('/').map(encodeURIComponent).join('/');
    return `<img src="/api/raw/${enc}" alt="${escapeHtml(alt)}" class="embed-image" loading="lazy" />`;
  });

  // 3c) Block anchors: a line-trailing `^block-id` becomes a copyable target.
  //     Code was extracted above, and wikilinks were rewritten in step 3, so
  //     only genuine anchors remain.
  content = content.replace(
    /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/gm,
    (_m, lead, id) =>
      `${lead}<span class="block-anchor" id="^${id}" data-block-id="${id}" role="button" tabindex="0" title="Copy block reference ^${id}">^${id}</span>`,
  );

  // 4) Restore code blocks.
  content = content.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)]);

  let html;
  try {
    html = marked.parse(content, { async: false }) as string;
  } catch {
    html = escapeHtml(content);
  }
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-wikilink', 'data-wikilink-block', 'data-block-id'],
    ADD_TAGS: ['aside'],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
