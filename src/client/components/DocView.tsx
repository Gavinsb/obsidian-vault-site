import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import type { Document, SearchHit } from "../api";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { Markdown, stripFrontmatter, splitTitle } from "./Markdown";
import { RatingStars } from "./RatingStars";
import { Breadcrumbs } from "./Breadcrumbs";
import {
  acceptAgentReview,
  parseAgentBlocks,
  rejectAgentReview,
} from "../../shared/agent-blocks";
import {
  applyAutocomplete,
  findAutocompleteTrigger,
  type AutocompleteTrigger,
} from "../../shared/editor-utils";
type Mode = "read" | "edit" | "split";

export function DocView() {
  const { path: pathParam } = useParams();
  const lookup = pathParam ? decodeURIComponent(pathParam) : "";
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("read");
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [baseEtag, setBaseEtag] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<any>(null);
  const [flash, setFlash] = useState<{ kind: string; msg: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmExternal, setConfirmExternal] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<AutocompleteTrigger | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{ value: string; detail: string }>
  >([]);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const seq = useRef(0);
  const tagsCache = useRef<Array<{ tag: string; count: number }> | null>(null);
  const canonicalPath = doc?.meta.relPath ?? lookup;
  const dirty = draft !== baseline;
  const reviews = parseAgentBlocks(draft);
  const canEdit = !!user;
  const loadPublic = async (p: string, spin = true) => {
    if (spin) setLoading(true);
    setError(null);
    try {
      const d = await api.getDoc(p);
      setDoc(d);
      if (mode === "read") {
        setDraft(d.content);
        setBaseline(d.content);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const loadSource = async () => {
    const out = await api.getSource(canonicalPath);
    setDoc(out.data);
    setDraft(out.data.content);
    setBaseline(out.data.content);
    setBaseEtag(out.etag ?? "");
    setConflict(null);
    return out;
  };
  useEffect(() => {
    if (lookup) {
      setMode("read");
      void loadPublic(lookup);
    }
  }, [lookup]);
  useEffect(() => {
    if (!canonicalPath) return;
    const t = setInterval(() => {
      if (mode === "read") void loadPublic(canonicalPath, false);
    }, 4000);
    return () => clearInterval(t);
  }, [canonicalPath, mode]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  useEffect(() => {
    if (!trigger) {
      setSuggestions([]);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        if (trigger.kind === "wikilink") {
          const r = await api.search(trigger.query);
          if (id !== seq.current) return;
          setSuggestions(
            r.results
              .slice(0, 8)
              .map((x: SearchHit) => ({ value: x.title, detail: x.folder })),
          );
        } else {
          const all = tagsCache.current ?? (await api.tags());
          tagsCache.current = all;
          if (id !== seq.current) return;
          setSuggestions(
            all
              .filter((x) =>
                x.tag.toLowerCase().includes(trigger.query.toLowerCase()),
              )
              .slice(0, 8)
              .map((x) => ({
                value: x.tag,
                detail: `${x.count} note${x.count === 1 ? "" : "s"}`,
              })),
          );
        }
      } catch {
        if (id === seq.current) setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [trigger?.kind, trigger?.query]);
  if (loading && !doc)
    return (
      <div className="view">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
      </div>
    );
  if (error && !doc)
    return (
      <div className="view">
        <div className="card error-card not-found">
          <h2>Document not found</h2>
          <p>{error}</p>
          <button className="primary" onClick={() => navigate("/")}>
            ← Back to home
          </button>
        </div>
      </div>
    );
  if (!doc) return null;
  const meta = doc.meta;
  const enter = async (next: Mode) => {
    if (!user) {
      setFlash({ kind: "warn", msg: "Sign in to edit." });
      return;
    }
    try {
      if (mode === "read") await loadSource();
      setMode(next);
    } catch (e) {
      setFlash({ kind: "err", msg: String(e) });
    }
  };
  const refreshAfter = async () => {
    const out = await api.getSource(canonicalPath);
    setDoc(out.data);
    setDraft(out.data.content);
    setBaseline(out.data.content);
    setBaseEtag(out.etag ?? "");
    return out;
  };
  const onSave = async (etag = baseEtag, explicitOverwrite = false) => {
    if (saving || !dirty || (!explicitOverwrite && !!conflict)) return;
    setSaving(true);
    setFlash(null);
    try {
      const out = await api.saveDoc(canonicalPath, draft, etag);
      setBaseEtag(out.etag ?? "");
      await refreshAfter();
      tagsCache.current = null;
      setSavedAt(new Date());
      setConflict(null);
      setConfirmOverwrite(false);
      setFlash({ kind: "ok", msg: "Saved" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        setConflict(e.body);
        setFlash({
          kind: "warn",
          msg: "The file changed externally. Your draft is preserved.",
        });
      } else if (e instanceof ApiError && e.status === 401)
        setFlash({
          kind: "warn",
          msg: "Sign in again to save. Your draft is preserved.",
        });
      else setFlash({ kind: "err", msg: String(e) });
    } finally {
      setSaving(false);
    }
  };
  const mutate = async (kind: "rating" | "favorite", v: any) => {
    try {
      const src = await api.getSource(canonicalPath);
      const out =
        kind === "rating"
          ? await api.rate(canonicalPath, v, src.etag!)
          : await api.setMeta(canonicalPath, { favorite: v }, src.etag!);
      void out;
      await loadPublic(canonicalPath, false);
    } catch (e) {
      setFlash({ kind: "err", msg: String(e) });
    }
  };
  const cancel = () => {
    if (dirty) {
      setConfirmCancel(true);
      return;
    }
    setMode("read");
  };
  const discard = () => {
    setDraft(baseline);
    setMode("read");
    setConfirmCancel(false);
    setTrigger(null);
  };
  const onInput = (value: string, cursor: number) => {
    setDraft(value);
    setTrigger(findAutocompleteTrigger(value, cursor));
  };
  const choose = (value: string) => {
    if (!trigger) return;
    const out = applyAutocomplete(draft, trigger, value);
    setDraft(out.source);
    setTrigger(null);
    setSuggestions([]);
    requestAnimationFrame(() => {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(out.cursor, out.cursor);
    });
  };
  const editor = (
    <div className="editor-wrap">
      <textarea
        ref={textRef}
        className={`editor-pane${mode === "edit" ? " full" : ""}`}
        value={draft}
        onChange={(e) => onInput(e.target.value, e.target.selectionStart)}
        onClick={(e) =>
          setTrigger(
            findAutocompleteTrigger(draft, e.currentTarget.selectionStart),
          )
        }
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTrigger(null);
            setSuggestions([]);
          }
        }}
      />
      {trigger && suggestions.length > 0 && (
        <div className="autocomplete-panel">
          {suggestions.map((s) => (
            <button
              key={s.value}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s.value);
              }}
            >
              <strong>
                {trigger.kind === "tag" ? "#" : ""}
                {s.value}
              </strong>
              <span>{s.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const readBody = stripFrontmatter(doc.content),
    { title, rest } = splitTitle(readBody);
  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <div className="toolbar-left">
          <button onClick={() => navigate(-1)}>← Back</button>
          <Breadcrumbs folder={meta.folder} current={meta.title} />
        </div>
        <div className="toolbar-right">
          <div className="mode-toggle">
            <button
              className={mode === "read" ? "active" : ""}
              onClick={() => (mode === "read" ? null : cancel())}
            >
              Read
            </button>
            {canEdit && (
              <>
                <button
                  className={mode === "split" ? "active" : ""}
                  onClick={() => void enter("split")}
                >
                  Split
                </button>
                <button
                  className={mode === "edit" ? "active" : ""}
                  onClick={() => void enter("edit")}
                >
                  Edit
                </button>
              </>
            )}
          </div>
          {canEdit && (
            <>
              <button onClick={() => void mutate("favorite", !meta.favorite)}>
                {meta.favorite ? "★ Favorited" : "☆ Favorite"}
              </button>
              {confirmDelete ? (
                <>
                  <button
                    className="danger"
                    onClick={async () => {
                      const src = await api.getSource(canonicalPath);
                      await api.deleteDoc(canonicalPath, src.etag!);
                      navigate("/");
                    }}
                  >
                    Confirm delete
                  </button>
                  <button onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="doc-rating-bar">
          <span className="rating-label">Rate this page</span>
          <RatingStars
            value={meta.rating}
            scale={5}
            onChange={(v) => void mutate("rating", v)}
            size={22}
          />
        </div>
      )}
      {mode !== "read" && (
        <div className="editor-bar">
          <button
            className="primary"
            onClick={() => void onSave()}
            disabled={saving || !dirty || !baseEtag || !!conflict}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={cancel} disabled={saving}>
            Cancel
          </button>
          {dirty && <span className="saved-hint">Unsaved changes</span>}
          {savedAt && (
            <span className="saved-hint">
              Last saved {savedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
      {confirmCancel && (
        <div className="confirm-panel">
          Discard unsaved changes?
          <button className="danger" onClick={discard}>
            Discard
          </button>
          <button onClick={() => setConfirmCancel(false)}>Keep editing</button>
        </div>
      )}
      {flash && <div className={`flash flash-${flash.kind}`}>{flash.msg}</div>}
      {conflict && (
        <div className="conflict-banner">
          <strong>Conflict detected.</strong>
          <button onClick={() => setConfirmExternal(true)}>
            Load external version
          </button>
          <button
            onClick={() =>
              setFlash({
                kind: "info",
                msg: "Your draft remains in the editor; load the external version in another tab to review differences.",
              })
            }
          >
            Review differences
          </button>
          {confirmOverwrite ? (
            <>
              <button
                className="danger"
                disabled={saving}
                onClick={async () => {
                  const latest = await api.getSource(canonicalPath);
                  await onSave(latest.etag!, true);
                }}
              >
                Confirm overwrite with mine
              </button>
              <button onClick={() => setConfirmOverwrite(false)}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmOverwrite(true)}>
              Overwrite with mine
            </button>
          )}
        </div>
      )}
      {confirmExternal && (
        <div className="confirm-panel">
          Discard your draft and load the external version?
          <button
            className="danger"
            onClick={async () => {
              await refreshAfter();
              setConflict(null);
              setConfirmExternal(false);
            }}
          >
            Discard and load
          </button>
          <button onClick={() => setConfirmExternal(false)}>
            Keep editing
          </button>
        </div>
      )}
      {mode !== "read" && reviews.length > 0 && (
        <section className="card review-panel">
          <h3>Agent staging</h3>
          <p>
            {reviews.filter((x) => x.type === "agent").length} instruction(s),{" "}
            {reviews.filter((x) => x.type === "agent-review").length} review(s).
            No model is executed by this site.
          </p>
          {reviews.map((b, i) => (
            <div className="review-row" key={`${b.start}-${i}`}>
              <code>
                {b.type} {b.id ?? b.target ?? `@${b.start}`}
              </code>
              <button
                onClick={() => {
                  textRef.current?.focus();
                  textRef.current?.setSelectionRange(b.start, b.end);
                }}
              >
                Go to source
              </button>
              {b.type === "agent-review" && b.id && (
                <>
                  <button
                    onClick={() => setDraft(acceptAgentReview(draft, b.id!))}
                  >
                    Accept into draft
                  </button>
                  <button className="danger" onClick={() => setRejectId(b.id!)}>
                    Reject…
                  </button>
                  {rejectId === b.id && (
                    <button
                      className="danger"
                      onClick={() => {
                        setDraft(rejectAgentReview(draft, b.id!));
                        setRejectId(null);
                      }}
                    >
                      Confirm reject
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </section>
      )}
      <div className={`doc-body${mode === "split" ? " split" : ""}`}>
        <div className="doc-main">
          {mode === "read" && (
            <article className="article">
              <h1 className="article-title">{title || meta.title}</h1>
              <details className="collapsible article-meta">
                <summary>File info</summary>
                <Meta meta={meta} />
              </details>
              <Markdown content={rest} baseFolder={meta.folder} />
            </article>
          )}
          {mode === "split" && (
            <>
              {editor}
              <div className="preview-pane">
                <Markdown content={draft} baseFolder={meta.folder} />
              </div>
            </>
          )}
          {mode === "edit" && editor}
        </div>
        <aside className="doc-context">
          <section className="context-block">
            <h4>File info</h4>
            <Meta meta={meta} />
          </section>
          <section className="context-block">
            <h4>Backlinks ({doc.backlinks.length})</h4>
            <ul className="link-list">
              {doc.backlinks.map((b) => (
                <li key={b.sourceRelPath}>
                  <Link to={`/note/${encodeURIComponent(b.sourceRelPath)}`}>
                    {b.sourceTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
function Meta({ meta }: { meta: Document["meta"] }) {
  return (
    <>
      <dl className="meta-list">
        <dt>Status</dt>
        <dd>{meta.status ?? "—"}</dd>
        <dt>Path</dt>
        <dd className="mono">{meta.relPath}</dd>
        <dt>Modified</dt>
        <dd>
          {meta.updated ?? new Date(meta.mtimeMs).toISOString().slice(0, 10)}
        </dd>
        <dt>Words</dt>
        <dd>{meta.wordCount}</dd>
      </dl>
      {meta.tags.length > 0 && (
        <div className="meta-tags">
          {meta.tags.map((t) => (
            <Link
              key={t}
              to={`/search?tag=${encodeURIComponent(t)}`}
              className="tag-chip"
            >
              #{t}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
