import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders Markdown + Obsidian wiki-links/callouts/images into safe HTML.
 * Unsupported Obsidian syntax is left untouched (source integrity) and simply
 * shown as text.
 */
export function Markdown({ content }: { content: string }) {
  const navigate = useNavigate();
  const html = useMemo(() => renderMarkdown(content), [content]);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a[data-wikilink]') as HTMLAnchorElement | null;
    if (target) {
      e.preventDefault();
      const path = target.getAttribute('data-wikilink');
      if (path) navigate(`/note/${encodeURIComponent(path)}`);
    }
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
function renderMarkdown(content: string): string {
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

  // 3) Wiki links → anchors.
  content = content.replace(/!?\[\[([^][\n]+?)\]\]/g, (_m, inner) => {
    let target = inner;
    let alias: string | undefined;
    const pipe = inner.indexOf('|');
    if (pipe !== -1) {
      alias = inner.slice(pipe + 1).trim();
      target = inner.slice(0, pipe);
    }
    const hash = target.indexOf('#');
    if (hash !== -1) target = target.slice(0, hash);
    const label = escapeHtml(alias ?? target);
    const path = encodeURIComponent(target.trim());
    return `<a href="#/" data-wikilink="${path}" class="wikilink">${label}</a>`;
  });

  // 4) Restore code blocks.
  content = content.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)]);

  let html;
  try {
    html = marked.parse(content, { async: false }) as string;
  } catch {
    html = escapeHtml(content);
  }
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-wikilink'],
    ADD_TAGS: ['aside'],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}