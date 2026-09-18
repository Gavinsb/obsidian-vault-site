import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Document } from '../api';
import { api } from '../api';
import { Markdown } from './Markdown';
import { RatingStars } from './RatingStars';
import { Breadcrumbs } from './Breadcrumbs';

type Mode = 'read' | 'edit' | 'split';
type ThemeMode = 'dark' | 'light' | 'system'; // local alias to avoid extra import
import { useTheme } from '../theme';

export function DocView() {
  const { path: pathParam } = useParams();
  const path = pathParam ? decodeURIComponent(pathParam) : '';
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  void setTheme; // theme used elsewhere; keep typing
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('read');
  const [draft, setDraft] = useState('');
  const [baseHash, setBaseHash] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<any>(null);
  const [flash, setFlash] = useState<{ kind: string; msg: string } | null>(null);
  const [showGraph, setShowGraph] = useState(true);
  const [subgraph, setSubgraph] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const timer = useRef<number | null>(null);

  const load = async (p: string, showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const d = await api.getDoc(p);
      setDoc(d);
      setDraft(d.content);
      setBaseHash(computeHash(d.content));
      setConflict(null);
      // Load local subgraph.
      try {
        setSubgraph(await api.subgraph(p, 1));
      } catch {
        setSubgraph({ nodes: [], edges: [] });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (path) {
      setMode('read');
      load(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Poll external changes for the current doc (debounced via server).
  useEffect(() => {
    if (!path) return;
    const t = setInterval(async () => {
      try {
        const fresh = await api.getDoc(path);
        setDoc((prev) => {
          if (prev && fresh && fresh.content !== prev.content && mode === 'read') {
            setBaseHash(computeHash(fresh.content));
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
  }, [path, mode]);

  const computeHash = (c: string) => {
    // Simple FNV-1a; server does real sha256, this is just an edit baseline.
    let h = 0x811c9dc5;
    for (let i = 0; i < c.length; i++) {
      h ^= c.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };

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
      await api.rate(path, v);
      const d = await api.getDoc(path);
      setDoc(d);
      setBaseHash(computeHash(d.content));
      setFlash({ kind: 'ok', msg: `Rated ${v}★ — written to frontmatter` });
    } catch (e) {
      setFlash({ kind: 'err', msg: `Failed to save rating: ${e}` });
    }
  };

  const onToggleFavorite = async () => {
    try {
      await api.setMeta(path, { favorite: meta.favorite ? false : true });
      const d = await api.getDoc(path);
      setDoc(d);
    } catch (e) {
      setFlash({ kind: 'err', msg: String(e) });
    }
  };

  const onSave = async () => {
    if (conflict?.dismissEditor) {
      // User chose to overwrite: expectedHash null.
      await doSave(null);
      return;
    }
    await doSave(baseHash);
  };

  const doSave = async (expectedHash: string | null) => {
    setFlash(null);
    try {
      const res = await api.saveDoc(path, draft, expectedHash ?? '');
      // Conflict detection: if server returned 409 we catch it.
      setSavedAt(new Date());
      const d = await api.getDoc(path);
      setDoc(d);
      setBaseHash(computeHash(d.content));
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
      await api.deleteDoc(path);
      navigate('/');
    } catch (e) {
      setFlash({ kind: 'err', msg: String(e) });
    }
  };

  const conflictActions = {
    reloadExternal: async () => {
      const d = await api.getDoc(path);
      setDoc(d);
      setDraft(d.content);
      setBaseHash(computeHash(d.content));
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
      // Autosave only if not in conflict.
      if (!conflict) onSave();
    }, 1200);
  };

  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <div className="toolbar-left">
          <button onClick={() => navigate(-1)}>← Back</button>
          <Breadcrumbs folder={meta.folder} />
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
          <button onClick={() => setShowGraph((v) => !v)}>Relationships</button>
          <button onClick={onDelete} className="danger">
            Delete
          </button>
        </div>
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
          {mode === 'read' && <Markdown content={doc.content} />}
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
            <h4>Metadata</h4>
            <RatingStars value={meta.rating} scale={5} onChange={onRating} />
            <dl className="meta-list">
              <dt>Status</dt>
              <dd>{meta.status ?? '—'}</dd>
              <dt>Path</dt>
              <dd className="mono">{meta.relPath}</dd>
              <dt>Created</dt>
              <dd>{meta.created ?? fmtDate(meta.ctimeMs)}</dd>
              <dt>Modified</dt>
              <dd>{meta.updated ?? fmtDate(meta.mtimeMs)}</dd>
              <dt>Words</dt>
              <dd>{meta.wordCount}</dd>
              <dt>Tags</dt>
              <dd>
                <div className="tag-list">
                  {meta.tags.map((t) => (
                    <Link key={t} to={`/search?tag=${encodeURIComponent(t)}`} className="tag-chip">
                      #{t}
                    </Link>
                  ))}
                </div>
              </dd>
            </dl>
          </section>

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