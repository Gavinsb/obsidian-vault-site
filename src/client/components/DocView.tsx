import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Document } from '../api';
import { api } from '../api';
import { Markdown, stripFrontmatter, splitTitle } from './Markdown';
import { RatingStars } from './RatingStars';
import { Breadcrumbs } from './Breadcrumbs';

type Mode = 'read' | 'edit' | 'split';

export function DocView() {
  const { path: pathParam } = useParams();
  const lookup = pathParam ? decodeURIComponent(pathParam) : '';
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('read');
  const [draft, setDraft] = useState('');
  const [baseHash, setBaseHash] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<any>(null);
  const [flash, setFlash] = useState<{ kind: string; msg: string } | null>(null);
  const timer = useRef<number | null>(null);

  // The URL may contain a title/alias; the canonical path is the resolved note.
  const canonicalPath = doc?.meta.relPath ?? lookup;

  const load = async (p: string, showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const d = await api.getDoc(p);
      setDoc(d);
      setDraft(d.content);
      setBaseHash(d.meta.contentHash); // SHA-256 baseline (matches server)
      setConflict(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (lookup) {
      setMode('read');
      load(lookup);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup]);

  // Poll external changes for the current doc.
  useEffect(() => {
    if (!canonicalPath) return;
    const t = setInterval(async () => {
      try {
        const fresh = await api.getDoc(canonicalPath);
        setDoc((prev) => {
          if (prev && fresh && fresh.content !== prev.content && mode === 'read') {
            setBaseHash(fresh.meta.contentHash);
            setFlash({ kind: 'info', msg: 'Updated from external change' });
          }
          return fresh;
        });
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalPath, mode]);

  if (loading && !doc) {
    return <div className="view loading">Loading document…</div>;
  }
  if (error && !doc) {
    return (
      <div className="view">
        <div className="card error-card">
          <h2>Document not found</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/')}>Back to home</button>
        </div>
      </div>
    );
  }
  if (!doc) return null;

  const meta = doc.meta;
  const onRating = async (v: number) => {
    try {
      await api.rate(canonicalPath, v);
      const d = await api.getDoc(canonicalPath);
      setDoc(d);
      setBaseHash(d.meta.contentHash);
      setFlash({ kind: 'ok', msg: `Rated ${v}★` });
    } catch (e) {
      setFlash({ kind: 'err', msg: `Failed to save rating: ${e}` });
    }
  };

  const onToggleFavorite = async () => {
    try {
      await api.setMeta(canonicalPath, { favorite: meta.favorite ? false : true });
      const d = await api.getDoc(canonicalPath);
      setDoc(d);
      setBaseHash(d.meta.contentHash);
    } catch (e) {
      setFlash({ kind: 'err', msg: String(e) });
    }
  };

  const onSave = async () => {
    if (conflict?.dismissEditor) {
      await doSave(null);
      return;
    }
    await doSave(baseHash);
  };

  const doSave = async (expectedHash: string | null) => {
    setFlash(null);
    try {
      await api.saveDoc(canonicalPath, draft, expectedHash ?? '');
      setSavedAt(new Date());
      const d = await api.getDoc(canonicalPath);
      setDoc(d);
      setBaseHash(d.meta.contentHash);
      setConflict(null);
      setFlash({ kind: 'ok', msg: 'Saved' });
    } catch (e: any) {
      if (e?.status === 409) {
        setConflict({ remote: true });
        setFlash({
          kind: 'warn',
          msg: 'Conflict: the file changed externally while you were editing.',
        });
      } else {
        setFlash({ kind: 'err', msg: String(e?.message ?? e) });
      }
    }
  };

  const onDelete = async () => {
    if (!window.confirm(`Delete ${meta.relPath}? This removes the source file.`)) return;
    try {
      await api.deleteDoc(canonicalPath);
      navigate('/');
    } catch (e) {
      setFlash({ kind: 'err', msg: String(e) });
    }
  };

  const conflictActions = {
    reloadExternal: async () => {
      const d = await api.getDoc(canonicalPath);
      setDoc(d);
      setDraft(d.content);
      setBaseHash(d.meta.contentHash);
      setConflict(null);
      setFlash({ kind: 'info', msg: 'Loaded external version' });
    },
    overwrite: async () => {
      setConflict({ dismissEditor: true });
      onSave();
    },
  };

  const debounceAutoSave = (c: string) => {
    setDraft(c);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!conflict) onSave();
    }, 1200);
  };

  // Read-mode body: title → collapsible metadata → article.
  const readBody = stripFrontmatter(doc.content);
  const { title, rest } = splitTitle(readBody);

  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <div className="toolbar-left">
          <button onClick={() => navigate(-1)}>← Back</button>
          <Breadcrumbs folder={meta.folder} current={meta.title} />
        </div>
        <div className="toolbar-right">
          <div className="mode-toggle">
            <button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>
              Read
            </button>
            <button
              className={mode === 'split' ? 'active' : ''}
              onClick={() => setMode(mode === 'split' ? 'read' : 'split')}
            >
              Split
            </button>
            <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
              Edit
            </button>
          </div>
          <button onClick={onToggleFavorite}>{meta.favorite ? '★ Favorited' : '☆ Favorite'}</button>
          <button onClick={onDelete} className="danger">
            Delete
          </button>
        </div>
      </div>

      <div className="doc-rating-bar">
        <span className="rating-label">Rate this page</span>
        <RatingStars value={meta.rating} scale={5} onChange={onRating} size={22} />
      </div>

      {(mode === 'edit' || mode === 'split') && (
        <div className="editor-bar">
          <button className="primary" onClick={onSave} disabled={!!conflict}>
            Save
          </button>
          <button onClick={() => setMode('read')} disabled={!!conflict}>
            Cancel
          </button>
          {savedAt && <span className="saved-hint">Last saved {savedAt.toLocaleTimeString()}</span>}
        </div>
      )}

      {flash && <div className={`flash flash-${flash.kind}`}>{flash.msg}</div>}
      {conflict && conflict.remote && (
        <div className="conflict-banner">
          <strong>Conflict detected</strong> — this page changed externally while you were editing.
          <button onClick={conflictActions.reloadExternal}>Load external version</button>
          <button onClick={conflictActions.overwrite}>Overwrite with mine</button>
        </div>
      )}

      <div className={`doc-body${mode === 'split' ? ' split' : ''}`}>
        <div className="doc-main">
          {mode === 'read' && (
            <article className="article">
              <h1 className="article-title">{title || meta.title}</h1>
              <details className="collapsible article-meta">
                <summary>File info</summary>
                <dl className="meta-list">
                  <dt>Type</dt>
                  <dd>{String(meta.frontmatter?.type ?? '—')}</dd>
                  <dt>Status</dt>
                  <dd>{meta.status ?? '—'}</dd>
                  <dt>Aliases</dt>
                  <dd>{meta.aliases?.length ? meta.aliases.join(', ') : '—'}</dd>
                  <dt>Created</dt>
                  <dd>{meta.created ?? fmtDate(meta.ctimeMs)}</dd>
                  <dt>Modified</dt>
                  <dd>{meta.updated ?? fmtDate(meta.mtimeMs)}</dd>
                </dl>
                {meta.tags.length > 0 && (
                  <div className="meta-tags">
                    {meta.tags.map((t) => (
                      <Link key={t} to={`/search?tag=${encodeURIComponent(t)}`} className="tag-chip">
                        #{t}
                      </Link>
                    ))}
                  </div>
                )}
              </details>
              <Markdown content={rest} />
            </article>
          )}
          {mode === 'split' && (
            <>
              <textarea
                className="editor-pane"
                value={draft}
                onChange={(e) => debounceAutoSave(e.target.value)}
              />
              <div className="preview-pane">
                <Markdown content={draft} />
              </div>
            </>
          )}
          {mode === 'edit' && (
            <textarea
              className="editor-pane full"
              value={draft}
              onChange={(e) => debounceAutoSave(e.target.value)}
            />
          )}
        </div>

        <aside className="doc-context">
          <section className="context-block">
            <h4>File info</h4>
            <dl className="meta-list">
              <dt>Type</dt>
              <dd>{String(meta.frontmatter?.type ?? '—')}</dd>
              <dt>Status</dt>
              <dd>{meta.status ?? '—'}</dd>
              <dt>Aliases</dt>
              <dd>{meta.aliases?.length ? meta.aliases.join(', ') : '—'}</dd>
              <dt>Path</dt>
              <dd className="mono">{meta.relPath}</dd>
              <dt>Created</dt>
              <dd>{meta.created ?? fmtDate(meta.ctimeMs)}</dd>
              <dt>Modified</dt>
              <dd>{meta.updated ?? fmtDate(meta.mtimeMs)}</dd>
              <dt>Words</dt>
              <dd>{meta.wordCount}</dd>
            </dl>
            {meta.tags.length > 0 && (
              <div className="meta-tags">
                {meta.tags.map((t) => (
                  <Link key={t} to={`/search?tag=${encodeURIComponent(t)}`} className="tag-chip">
                    #{t}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {mode !== 'read' && (
            <section className="context-block markdown-legend">
              <h4>Markdown shortcuts</h4>
              <ul className="legend-list">
                <li><code>**bold**</code> · <code>*italic*</code></li>
                <li><code>## heading</code></li>
                <li><code>[[Page Name]]</code> link</li>
                <li><code>#tag</code> inline tag</li>
                <li><code>- [ ] task</code></li>
                <li><code>&gt; [!note] Title</code> callout</li>
                <li><code>`code`</code> inline code</li>
              </ul>
            </section>
          )}

          <section className="context-block">
            <h4>Backlinks ({doc.backlinks.length})</h4>
            {doc.backlinks.length === 0 ? (
              <p className="muted">No pages link here.</p>
            ) : (
              <ul className="link-list">
                {doc.backlinks.map((b) => (
                  <li key={b.sourceRelPath}>
                    <Link to={`/note/${encodeURIComponent(b.sourceRelPath)}`}>{b.sourceTitle}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="context-block">
            <h4>Outgoing links ({doc.outgoing.length})</h4>
            {doc.outgoing.length === 0 ? (
              <p className="muted">No outgoing links.</p>
            ) : (
              <ul className="link-list">
                {doc.outgoing.map((o, i) => (
                  <li key={i} className={o.resolved ? '' : 'broken'}>
                    {o.resolved ? (
                      <Link to={`/note/${encodeURIComponent(o.targetRelPath!)}`}>
                        {o.alias ?? o.target}
                      </Link>
                    ) : (
                      <span title="Unresolved wiki link">[[{o.target}]]</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function fmtDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}