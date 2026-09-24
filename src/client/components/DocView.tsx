import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import type { Document } from "../api";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { stripFrontmatter, splitTitle } from "./Markdown";
import { MarkdownWithEmbeds } from "./Embeds";
import { PropertiesEditor } from "./PropertiesEditor";
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
  isSaveBlocked,
  useAgentConsole,
} from "./AgentConsole";
import { Editor } from "./Editor";
import type { AtomicCodeMirrorEditorHandle } from "@atomic-editor/editor";
import { EditingHelp } from "./EditingHelp";
import { AgentBlocksView } from "./AgentBlocksView";
type Mode = "read" | "edit" | "split";

export function DocView() {
  const { path: pathParam } = useParams();
  const lookup = pathParam ? decodeURIComponent(pathParam) : "";
  const navigate = useNavigate();
  const location = useLocation();
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
  // S7-12 (carried forward from Wave 6): the slash menu's agent scaffolds must
  // avoid the vault's reserved IDs. `?path=` excludes this note's own IDs from
  // the endpoint response; they are re-added from the live draft below so a
  // generated ID cannot duplicate a block in this note either.
  const [reservedIds, setReservedIds] = useState<string[]>([]);
  const [agentsOn, setAgentsOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem("kv.agentBlocksView") === "1";
    } catch {
      return false;
    }
  });
  // Imperative CM6 handle — used by "Go to source" to select a block range.
  const editorHandle = useRef<AtomicCodeMirrorEditorHandle | null>(null);
  // Monotonic sequence for the read-path loads below.
  const seq = useRef(0);
  // Exactly-one-save guard: a batched double activation (fast double-click,
  // keyboard + click in one tick) must never issue a second If-Match write.
  const savingRef = useRef(false);
  const canonicalPath = doc?.meta.relPath ?? lookup;
  const dirty = draft !== baseline;
  const canEdit = !!user;
  // S7-6/S7-7 — one console store per document. The side panel and the inline
  // cards read this same parsed state, so they cannot disagree (LOCKED Q9).
  // Accept/Reject stay draft-only: they never touch the network.
  const agentConsole = useAgentConsole({
    source: draft,
    baseline,
    path: canonicalPath,
    onChange: setDraft,
    onAccept: (id) => setDraft(acceptAgentReview(draft, id)),
    onReject: (id) => setDraft(rejectAgentReview(draft, id)),
  });
  const saveBlocked = isSaveBlocked(agentConsole.findings);
  // Reserved IDs threaded into the editor's slash menu (S7-12).
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
    try {
      const d = wantAgents && user
        ? await api.getDocAgents(p)
        : await api.getDoc(p);
      // A newer load (poll, agent-view toggle, note switch) already won:
      // applying this response would restore a stale projection/draft.
      if (id !== seq.current) return;
      setDoc(d);
      if (mode === "read") {
        setDraft(d.content);
        setBaseline(d.content);
      }
    } catch (e) {
      if (id !== seq.current) return;
      setError(String(e));
    } finally {
      if (id === seq.current) setLoading(false);
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
      if (mode === "read") void loadPublic(canonicalPath, false, agentsOn);
    }, 4000);
    return () => clearInterval(t);
  }, [canonicalPath, mode, agentsOn]);
  // Reserved IDs (vault + sweep log) power generation and R3; only needed
  // inside an editing session, and never for anonymous readers.
  useEffect(() => {
    if (canEdit && mode !== "read") void agentConsole.refreshReservedIds();
  }, [canEdit, mode]);
  // The host's copy of the same reserved set, fed to the editor so the slash
  // menu can seed ID generation (never a network write of its own).
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
  // S7-9 — resolve a copied block reference: `/note/Note#^block-id` scrolls
  // to the rendered block anchor once the target note is loaded.
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
    // S7-12 exactly-one-save guard: a batched double activation must never
    // reach the network twice. The S4 duplicate-save contract below is kept
    // byte-identical and still applies.
    if (savingRef.current) return;
    if (saving || !dirty || (!explicitOverwrite && !!conflict)) return;
    // S7-7 Save gate: a blocking finding on a session-edited block must be
    // fixed before the draft can be persisted (no escape hatch).
    if (saveBlocked) {
      setFlash({ kind: "warn", msg: "Fix the blocking validator findings before saving." });
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
      const out =
        kind === "rating"
          ? await api.rate(canonicalPath, v, src.etag!)
          : await api.setMeta(canonicalPath, { favorite: v }, src.etag!);
      void out;
      await loadPublic(canonicalPath, false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 428))
        setFlash({
          kind: "warn",
          msg: "Could not verify this document's current version. Reload the note and try again — your rating or change is preserved in the editor.",
        });
      else setFlash({ kind: "err", msg: String(e) });
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
  };
  // Editor value handler. The parameter stays named `e` to keep the S4
  // regression contract (`onChange={(e) => onInput(`) satisfied; it carries
  // the editor's new markdown, not a DOM event.
  const onInput = (e: string) => {
    setDraft(e);
  };
  const editor = (
    <Editor
      value={draft}
      onChange={(e) => onInput(e)}
      path={canonicalPath}
      reservedIds={editorReservedIds}
      readOnly={mode === "read"}
      onSave={() => void onSave()}
      editorHandleRef={editorHandle}
      className={`editor-pane${mode === "edit" ? " full" : ""}`}
    />
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
              <button
                className={agentsOn ? "active" : ""}
                onClick={() => {
                  const next = !agentsOn;
                  setAgentsOn(next);
                  try {
                    localStorage.setItem(
                      "kv.agentBlocksView",
                      next ? "1" : "0",
                    );
                  } catch {}
                  if (mode === "read") void loadPublic(canonicalPath, false, next);
                }}
                title="Toggle agent instruction blocks in the read view"
              >
                {agentsOn ? "Hide agent blocks" : "Show agent blocks"}
              </button>
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
            disabled={saving || !dirty || !baseEtag || !!conflict || saveBlocked}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={cancel} disabled={saving}>
            Cancel
          </button>
          {dirty && <span className="saved-hint">Unsaved changes</span>}
          {saveBlocked && (
            <span className="saved-hint blocked">
              Save is disabled: blocking validator findings on edited blocks.
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
      {canEdit && mode !== "read" && (agentConsole.blocks.length > 0 || agentConsole.findings.length > 0) && (
        <AgentConsolePanel state={agentConsole} editorHandleRef={editorHandle} />
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
              <PropertiesEditor
                source={doc.content}
                readOnly
                className="article-properties"
              />
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
          {mode === "split" && (
            <>
              <PropertiesEditor
                source={draft}
                onChange={setDraft}
                className="doc-properties"
              />
              {editor}
              <div className="preview-pane">
                <MarkdownWithEmbeds
                  content={draft}
                  baseFolder={meta.folder}
                  refTarget={meta.baseName}
                />
              </div>
            </>
          )}
          {mode === "edit" && (
            <>
              <PropertiesEditor
                source={draft}
                onChange={setDraft}
                className="doc-properties"
              />
              {editor}
            </>
          )}
          {canEdit && mode !== "read" && agentConsole.blocks.length > 0 && (
            <div className="agent-inline-list" aria-label="Inline agent block controls">
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
          {canEdit && <EditingHelp />}
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
