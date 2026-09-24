import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import type { Document } from "../api";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { stripFrontmatter, splitTitle } from "./Markdown";
import { MarkdownWithEmbeds } from "./Embeds";
import { PropertiesEditor } from "./PropertiesEditor";
import { parseProperties } from "../../shared/properties";
import { changedRanges, spanIntersectsAny } from "../../shared/changed-ranges";
import { RatingStars } from "./RatingStars";
import { Breadcrumbs } from "./Breadcrumbs";
import {
  acceptAgentReview,
  parseAgentBlocks,
  rejectAgentReview,
} from "../../shared/agent-blocks";
import {
  AgentConsolePanel,
  AgentInlineCard,
  useAgentConsole,
} from "./AgentConsole";
import { Editor } from "./Editor";
import { RawEditor } from "./RawEditor";
import type { AtomicCodeMirrorEditorHandle } from "@atomic-editor/editor";
import { EditingHelp } from "./EditingHelp";
import { AgentBlocksView } from "./AgentBlocksView";

/**
 * S8-1/S8-2 — Read · Edit · Raw.
 *
 * The old two-pane view is gone: the properties block and the editor shared the
 * grid row and pushed the preview below it. Raw covers the "just show me the
 * source" case without a second live pane.
 */
type Mode = "read" | "edit" | "raw";

export function DocView() {
  const { path: pathParam } = useParams();
  const lookup = pathParam ? decodeURIComponent(pathParam) : "";
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const canEdit = !!user;
  const isAdmin = user?.role === "admin";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [reservedIds, setReservedIds] = useState<string[]>([]);
  const [agentsOn, setAgentsOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem("kv.agentBlocksView") === "1";
    } catch {
      return false;
    }
  });
  const editorHandle = useRef<AtomicCodeMirrorEditorHandle | null>(null);
  const seq = useRef(0);
  // S8-4 — entering an editing mode invalidates any in-flight read poll.
  const pollGuard = useRef(0);
  const savingRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canonicalPath = doc?.meta.relPath ?? lookup;
  const dirty = draft !== baseline;
  const hasProperties = useMemo(
    () => parseProperties(doc?.content ?? "").rows.length > 0,
    [doc?.content],
  );
  const agentConsole = useAgentConsole({
    source: draft,
    baseline,
    path: canonicalPath,
    onChange: setDraft,
    onAccept: (id) => setDraft(acceptAgentReview(draft, id)),
    onReject: (id) => setDraft(rejectAgentReview(draft, id)),
  });
  // S8-11 — a blocking finding only blocks Save when it sits inside what this
  // draft actually changed. Findings elsewhere are advisory.
  const changed = useMemo(
    () => changedRanges(baseline, draft),
    [baseline, draft],
  );
  const blockingFindings = useMemo(
    () => agentConsole.findings.filter((finding) => finding.blocking),
    [agentConsole.findings],
  );
  const enforcedFindings = useMemo(
    () => blockingFindings.filter((f) => spanIntersectsAny(f.range, changed)),
    [blockingFindings, changed],
  );
  const advisoryBlocking = blockingFindings.length - enforcedFindings.length;
  const saveBlocked = enforcedFindings.length > 0;
  const showOverride = !saveBlocked && advisoryBlocking > 0;
  const draftIds = useMemo(
    () =>
      parseAgentBlocks(draft)
        .map((block) => block.id)
        .filter((id): id is string => !!id),
    [draft],
  );
  const editorReservedIds = useMemo(
    () => [...reservedIds, ...draftIds],
    [reservedIds, draftIds],
  );
  const loadPublic = async (p: string, spin = true, wantAgents = agentsOn) => {
    if (spin) setLoading(true);
    setError(null);
    const id = ++seq.current;
    const guard = pollGuard.current;
    try {
      const d =
        wantAgents && user ? await api.getDocAgents(p) : await api.getDoc(p);
      if (id !== seq.current || guard !== pollGuard.current) return;
      setDoc(d);
      if (mode === "read") {
        setDraft(d.content);
        setBaseline(d.content);
      }
    } catch (e) {
      if (id !== seq.current || guard !== pollGuard.current) return;
      setError(String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };
  // S8-4 — loading the source also invalidates any in-flight read poll so a
  // late response can never overwrite the fresh draft with the masked view.
  const loadSource = async () => {
    pollGuard.current += 1;
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
      if (mode === "read") void loadPublic(canonicalPath, false, agentsOn);
    }, 4000);
    return () => clearInterval(t);
  }, [canonicalPath, mode, agentsOn]);
  useEffect(() => {
    if (canEdit && mode !== "read") void agentConsole.refreshReservedIds();
  }, [canEdit, mode]);
  useEffect(() => {
    if (!canEdit || mode === "read" || !canonicalPath) return;
    let alive = true;
    void api
      .agentIds(canonicalPath)
      .then((out) => {
        if (alive) setReservedIds(out.ids ?? []);
      })
      .catch(() => {
        if (alive) setReservedIds([]);
      });
    return () => {
      alive = false;
    };
  }, [canEdit, mode, canonicalPath]);
  useEffect(() => {
    if (mode !== "read") return;
    const raw = location.hash.replace(/^#/, "");
    if (!raw.startsWith("^")) return;
    const id = raw.slice(1);
    if (!/^[A-Za-z0-9-]+$/.test(id)) return;
    const el = document.querySelector(`[data-block-id="${id}"]`);
    el?.scrollIntoView?.({ block: "center" });
  }, [location.hash, doc, mode]);
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
  // Overflow menu: close on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target))
        return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
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
  const leave = () => {
    pollGuard.current += 1;
    setMode("read");
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
    if (savingRef.current) return;
    if (saving || !dirty || (!explicitOverwrite && !!conflict)) return;
    if (saveBlocked) {
      setFlash({
        kind: "warn",
        msg: "Fix the blocking validator findings in the blocks you changed before saving.",
      });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFlash(null);
    try {
      const out = await api.saveDoc(canonicalPath, draft, etag);
      setBaseEtag(out.etag ?? "");
      await refreshAfter();
      setSavedAt(new Date());
      setConflict(null);
      setConfirmOverwrite(false);
      setFlash({
        kind: "ok",
        msg: showOverride
          ? `Saved. ${advisoryBlocking} blocking finding${advisoryBlocking === 1 ? "" : "s"} outside your changes were ignored.`
          : "Saved",
      });
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
      else if (e instanceof ApiError && (e.status === 400 || e.status === 428))
        setFlash({
          kind: "warn",
          msg: "Could not verify this document's current version. Reload the note and try again — your draft is preserved.",
        });
      else setFlash({ kind: "err", msg: String(e) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const mutate = async (kind: "rating" | "favorite", v: any) => {
    try {
      const src = await api.getSource(canonicalPath);
      if (kind === "rating") await api.rate(canonicalPath, v, src.etag!);
      else await api.setMeta(canonicalPath, { favorite: v }, src.etag!);
      await loadPublic(canonicalPath, false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 428))
        setFlash({
          kind: "warn",
          msg: "Could not verify this document's current version. Reload the note and try again.",
        });
      else setFlash({ kind: "err", msg: String(e) });
    }
  };
  const cancel = () => {
    if (dirty) {
      setConfirmCancel(true);
      return;
    }
    leave();
  };
  const discard = () => {
    setDraft(baseline);
    setConfirmCancel(false);
    leave();
  };
  const onInput = (e: string) => {
    setDraft(e);
  };
  const readBody = stripFrontmatter(doc.content),
    { title, rest } = splitTitle(readBody);
  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <div className="toolbar-left">
          <button className="back-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <Breadcrumbs folder={meta.folder} current={meta.title} />
          {mode !== "read" && (
            <span className="toolbar-title" title={meta.title}>
              {meta.title}
            </span>
          )}
        </div>
        <div className="toolbar-right">
          {canEdit && (
            <div className="mode-toggle" role="group" aria-label="View mode">
              <button
                className={mode === "read" ? "active" : ""}
                onClick={() => (mode === "read" ? null : cancel())}
              >
                Read
              </button>
              <button
                className={mode === "edit" ? "active" : ""}
                onClick={() => void enter("edit")}
              >
                Edit
              </button>
              <button
                className={mode === "raw" ? "active" : ""}
                onClick={() => void enter("raw")}
              >
                Raw
              </button>
            </div>
          )}
          {canEdit && mode === "read" && (
            <div className="toolbar-rating">
              <RatingStars
                value={meta.rating}
                scale={5}
                onChange={(v) => void mutate("rating", v)}
                size={20}
              />
              <button
                className="fav-btn"
                onClick={() => void mutate("favorite", !meta.favorite)}
                title={meta.favorite ? "Remove favourite" : "Add favourite"}
              >
                {meta.favorite ? "★ Favourite" : "☆ Favourite"}
              </button>
            </div>
          )}
          {canEdit && mode !== "read" && (
            <>
              <button
                className={`primary${showOverride && isAdmin ? " override" : ""}`}
                onClick={() => void onSave()}
                disabled={
                  saving || !dirty || !baseEtag || !!conflict || saveBlocked
                }
                title={
                  showOverride && isAdmin
                    ? `${advisoryBlocking} blocking finding(s) sit outside your changes`
                    : undefined
                }
              >
                {saving
                  ? "Saving…"
                  : showOverride && isAdmin
                    ? `Save anyway (${advisoryBlocking})`
                    : "Save"}
              </button>
              <button onClick={cancel} disabled={saving}>
                Cancel
              </button>
            </>
          )}
          {canEdit && (
            <div className="doc-menu-wrap" ref={menuRef}>
              <button
                className="doc-menu-btn"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="More actions"
                onClick={() => setMenuOpen((v) => !v)}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="doc-menu" role="menu">
                  {isAdmin && mode === "read" && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        const next = !agentsOn;
                        setAgentsOn(next);
                        try {
                          localStorage.setItem(
                            "kv.agentBlocksView",
                            next ? "1" : "0",
                          );
                        } catch {}
                        setMenuOpen(false);
                        void loadPublic(canonicalPath, false, next);
                      }}
                    >
                      {agentsOn ? "Hide agent blocks" : "Show agent blocks"}
                    </button>
                  )}
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                  >
                    Delete note
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {mode !== "read" && (
        <div className="editor-bar">
          {dirty && <span className="saved-hint">Unsaved changes</span>}
          {saveBlocked && (
            <span className="saved-hint blocked">
              Save is disabled: blocking validator findings in the blocks you
              changed.
            </span>
          )}
          {showOverride && (
            <span className="saved-hint advisory">
              {advisoryBlocking} blocking finding
              {advisoryBlocking === 1 ? "" : "s"} outside your changes
              {isAdmin ? " — “Save anyway” will ignore them." : "."}
            </span>
          )}
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
      {confirmDelete && (
        <div className="confirm-panel">
          Delete this note permanently?
          {dirty && (
            <span className="saved-hint warn">
              Your unsaved changes will be discarded.
            </span>
          )}
          <button
            className="danger"
            onClick={async () => {
              try {
                const src = await api.getSource(canonicalPath);
                await api.deleteDoc(canonicalPath, src.etag!);
                setConfirmDelete(false);
                navigate("/");
              } catch (e) {
                setConfirmDelete(false);
                setFlash({ kind: "err", msg: String(e) });
              }
            }}
          >
            Confirm delete
          </button>
          <button onClick={() => setConfirmDelete(false)}>Cancel</button>
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
      {canEdit &&
        mode === "edit" &&
        (agentConsole.blocks.length > 0 || agentConsole.findings.length > 0) && (
          <AgentConsolePanel state={agentConsole} editorHandleRef={editorHandle} />
        )}
      <div className="doc-body">
        <div className="doc-main">
          {mode === "read" && (
            <article className="article">
              <h1 className="article-title">{title || meta.title}</h1>
              {canEdit && agentsOn ? (
                <AgentBlocksView content={rest} baseFolder={meta.folder} />
              ) : (
                <MarkdownWithEmbeds
                  content={rest}
                  baseFolder={meta.folder}
                  refTarget={meta.baseName}
                />
              )}
            </article>
          )}
          {mode === "edit" && (
            <>
              {hasProperties && (
                <details className="collapsible doc-properties-collapse">
                  <summary>Properties</summary>
                  <PropertiesEditor
                    source={draft}
                    onChange={setDraft}
                    hideHead
                    className="doc-properties"
                  />
                </details>
              )}
              <Editor
                value={draft}
                onChange={(e) => onInput(e)}
                path={canonicalPath}
                reservedIds={editorReservedIds}
                readOnly={false}
                onSave={() => void onSave()}
                editorHandleRef={editorHandle}
                className="editor-pane full"
              />
            </>
          )}
          {mode === "raw" && (
            <RawEditor
              value={draft}
              onChange={setDraft}
              path={canonicalPath}
              onSave={() => void onSave()}
              className="editor-pane full"
            />
          )}
          {canEdit && mode === "edit" && agentConsole.blocks.length > 0 && (
            <div
              className="agent-inline-list"
              aria-label="Inline agent block controls"
            >
              {agentConsole.blocks.map((block, i) => (
                <AgentInlineCard
                  key={`${block.start}-${i}`}
                  state={agentConsole}
                  block={block}
                  editorHandleRef={editorHandle}
                />
              ))}
            </div>
          )}
        </div>
        <aside className="doc-context">
          <section className="context-block">
            <h4>File info</h4>
            <Meta meta={meta} />
          </section>
          {hasProperties && (
            <section className="context-block" aria-label="Note properties">
              <PropertiesEditor source={doc.content} readOnly />
            </section>
          )}
          {canEdit && mode !== "read" && (
            <EditingHelp mode={mode} />
          )}
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
