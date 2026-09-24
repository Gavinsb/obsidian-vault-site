/**
 * S7-6 / S7-7 — Agent Block Console.
 *
 * A structured editor that sits beside (and inside) the agent blocks of a
 * note: legal-transition status control, ID generation/mirroring, type
 * toggle, TARGET completion, pairing, quoted-body editing, reviewer feedback,
 * draft-only accept/reject, go-to-source, copy actions, audit reference and a
 * read-only halt display.
 *
 * Hard rules this file implements:
 *   - it is not a second source of truth: every control is a pure span splice
 *     from `agent-splice.ts` into the caller's draft (`state.source`);
 *   - the console never offers `finished` (sweep-only) and never auto-advances;
 *   - Accept/Reject stay draft-only (`acceptAgentReview`/`rejectAgentReview`
 *     are injected by the host and never touch the network);
 *   - the side panel and the inline cards read the **same** store object, so
 *     they cannot disagree (spec §7.7, Q9);
 *   - Save is blocked only by findings the validator marked `blocking` — i.e.
 *     errors on blocks edited in this session (Q5).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { AtomicCodeMirrorEditorHandle } from "@atomic-editor/editor";
import {
  parseAgentBlocks,
  type AgentBlock,
  type AgentBlockType,
} from "../../shared/agent-blocks";
import {
  AGENT_STATUSES,
  canTransition,
  canonicaliseStatus,
  generateId,
  ID_RE,
  STATUS_LEGEND,
  statusLegend,
  type AgentStatus,
} from "../../shared/agent-status";
import {
  ensureReviewerFeedback,
  hasReviewerFeedback,
  insertHaltScaffold,
  parseHaltCallout,
  resolveHalt,
  setBlockBody,
  setId,
  setPairId,
  setReviewBody,
  setStatus,
  setTarget,
  setType,
  type BlockRef,
  type SourceRange,
} from "../../shared/agent-splice";
import { validateAgentBlocks, type Finding } from "../../shared/agent-validation";
import { selectRange } from "./Editor";
import { api } from "../api";

/** The slice of `api` the console uses (injectable for tests). */
export interface AgentConsoleApi {
  agentIds(): Promise<{ ids: string[] }>;
  completions(
    kind: "note" | "tag" | "heading" | "blockref" | "callout",
    q: string,
    path?: string,
    limit?: number,
  ): Promise<{ results: { value: string; detail?: string; score: number }[] }>;
}

export interface Notice {
  kind: "ok" | "warn" | "err" | "info";
  msg: string;
}

/** One task: a parent, its review, or a standalone block with no usable ID. */
export interface AgentTask {
  key: string;
  id?: string;
  parent?: AgentBlock;
  review?: AgentBlock;
  blocks: AgentBlock[];
}

/**
 * The shared console store. `DocView` creates exactly one per document and
 * hands it to both placements.
 */
export interface AgentConsoleStore {
  source: string;
  baseline: string;
  path?: string;
  blocks: AgentBlock[];
  tasks: AgentTask[];
  findings: Finding[];
  blocking: Finding[];
  editedIds: readonly string[];
  reservedIds: readonly string[];
  externalReservedIds: readonly string[];
  busy: boolean;
  notice: Notice | null;
  /** Injected client surface (agentIds + unified completions). */
  client: AgentConsoleApi;
  setNotice(next: Notice | null): void;
  onAccept?(id: string): void;
  onReject?(id: string): void;
  /** Commit a spliced source as the new draft (never a network write). */
  replaceSource(next: string, editedId?: string): boolean;
  run(edit: (source: string) => string, options?: { editedId?: string; ok?: string; fail?: string }): boolean;
  generateIdFor(ref: BlockRef, options?: { fallbackId?: string }): Promise<string | null>;
  refreshReservedIds(): Promise<void>;
}

export interface UseAgentConsoleOptions {
  source: string;
  baseline?: string;
  path?: string;
  onChange(next: string): void;
  api?: AgentConsoleApi;
  /** Host-owned draft transforms (draft-only, never network writes). */
  onAccept?(id: string): void;
  onReject?(id: string): void;
}

/**
 * Exact Save gate (S7-7, LOCKED Q5).
 *
 * Save is disabled **iff** the validator produced at least one blocking
 * finding — which it only does for an error on a block edited in this
 * session. Untouched legacy errors arrive as `advisory`/amber findings and
 * never block.
 */
export function isSaveBlocked(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.blocking);
}

export function buildAgentTasks(blocks: readonly AgentBlock[]): AgentTask[] {
  const groups = new Map<string, AgentTask>();
  const standalone: AgentTask[] = [];
  blocks.forEach((block) => {
    if (!block.id) {
      standalone.push({ key: `block-${block.start}`, blocks: [block] });
      return;
    }
    const existing = groups.get(block.id);
    if (existing) {
      existing.blocks.push(block);
      if (block.type === "agent" && !existing.parent) existing.parent = block;
      if (block.type === "agent-review" && !existing.review) existing.review = block;
      return;
    }
    groups.set(block.id, {
      key: `task-${block.id}`,
      id: block.id,
      parent: block.type === "agent" ? block : undefined,
      review: block.type === "agent-review" ? block : undefined,
      blocks: [block],
    });
  });
  return [...groups.values(), ...standalone];
}

export function useAgentConsole(options: UseAgentConsoleOptions): AgentConsoleStore {
  const { source, baseline = "", path, onChange } = options;
  const client = options.api ?? api;
  const [editedIds, setEditedIds] = useState<string[]>([]);
  const [reservedIds, setReservedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  // The edit scope is per document and per saved revision: once the draft is
  // saved, previously-blocking errors are the baseline again (advisory).
  useEffect(() => {
    setEditedIds([]);
  }, [path, baseline]);

  const blocks = useMemo(() => parseAgentBlocks(source), [source]);
  const tasks = useMemo(() => buildAgentTasks(blocks), [blocks]);
  const ownIds = useMemo(() => new Set(blocks.map((block) => block.id).filter((id): id is string => !!id)), [blocks]);
  // The reserved-ID endpoint merges this note's own IDs with the vault and the
  // sweep log, so only the external reservations can be R3 collisions.
  const externalReservedIds = useMemo(
    () => reservedIds.filter((id) => !ownIds.has(id)),
    [reservedIds, ownIds],
  );

  const findings = useMemo(
    () => validateAgentBlocks(source, {
      reservedIds: externalReservedIds,
      editedBlockIds: editedIds,
      previousSource: baseline,
    }),
    [source, externalReservedIds, editedIds, baseline],
  );
  const blocking = useMemo(() => findings.filter((finding) => finding.blocking), [findings]);

  const replaceSource = useCallback(
    (next: string, editedId?: string): boolean => {
      if (next === source) return false;
      onChange(next);
      if (editedId) setEditedIds((prev) => (prev.includes(editedId) ? prev : [...prev, editedId]));
      return true;
    },
    [onChange, source],
  );

  const run = useCallback(
    (edit: (current: string) => string, options_: { editedId?: string; ok?: string; fail?: string } = {}): boolean => {
      try {
        const next = edit(source);
        const changed = replaceSource(next, options_.editedId);
        if (changed && options_.ok) setNotice({ kind: "ok", msg: options_.ok });
        return changed;
      } catch (error) {
        setNotice({ kind: "err", msg: `${options_.fail ?? "Could not update the agent block"}: ${(error as Error).message}` });
        return false;
      }
    },
    [source, replaceSource],
  );

  const refreshReservedIds = useCallback(async () => {
    try {
      const out = await client.agentIds();
      setReservedIds(out.ids ?? []);
    } catch {
      // Offline or signed out: generation still avoids in-document IDs.
    }
  }, [client]);

  const generateIdFor = useCallback(
    async (ref: BlockRef, options_: { fallbackId?: string } = {}): Promise<string | null> => {
      setBusy(true);
      try {
        let reserved = reservedIds;
        if (!reserved.length) {
          try {
            const out = await client.agentIds();
            reserved = out.ids ?? [];
            setReservedIds(reserved);
          } catch {
            reserved = [];
          }
        }
        const id = generateId([...reserved, ...ownIds]);
        replaceSource(setId(source, ref, id), id);
        setNotice({ kind: "ok", msg: `Generated ID ${id}` });
        return id;
      } catch (error) {
        setNotice({ kind: "err", msg: `Could not generate an ID: ${(error as Error).message}` });
        void options_.fallbackId;
        return null;
      } finally {
        setBusy(false);
      }
    },
    [client, reservedIds, ownIds, source, replaceSource],
  );

  return {
    source,
    baseline,
    path,
    blocks,
    tasks,
    findings,
    blocking,
    editedIds,
    reservedIds,
    externalReservedIds,
    busy,
    notice,
    client,
    setNotice,
    onAccept: options.onAccept,
    onReject: options.onReject,
    replaceSource,
    run,
    generateIdFor,
    refreshReservedIds,
  };
}

/* ------------------------------------------------------------------ *
 * Findings panel                                                      *
 * ------------------------------------------------------------------ */

function jumpToSource(
  handle: MutableRefObject<AtomicCodeMirrorEditorHandle | null> | undefined,
  range: SourceRange,
): boolean {
  return selectRange(handle?.current ?? null, range.start, range.end);
}

function FindingsPanel({
  state,
  editorHandleRef,
}: {
  state: AgentConsoleStore;
  editorHandleRef?: MutableRefObject<AtomicCodeMirrorEditorHandle | null>;
}) {
  const { findings } = state;
  if (!findings.length) return null;
  return (
    <div className="agent-findings" role="list" aria-label="Validator findings">
      {findings.map((finding, index) => {
        const fix = finding.fix;
        return (
          <div
            key={`${finding.rule}-${finding.range.start}-${index}`}
            role="listitem"
            className={`agent-finding sev-${finding.displaySeverity}${finding.blocking ? " blocking" : ""}${finding.advisory ? " advisory" : ""}`}
          >
            <button
              type="button"
              className="agent-finding-jump"
              onClick={() => jumpToSource(editorHandleRef, finding.range)}
              title={`Jump to source ${finding.range.start}–${finding.range.end}`}
            >
              <span className="agent-finding-rule">{finding.rule}</span>
              <span className="agent-finding-message">{finding.message}</span>
            </button>
            {finding.blocking && (
              <span className="agent-finding-tag blocking" title="Blocking: fix this before saving.">
                blocks save
              </span>
            )}
            {finding.advisory && (
              <span className="agent-finding-tag" title="Pre-existing finding: advisory only, it never blocks Save.">
                pre-existing — advisory
              </span>
            )}
            {fix && (
              <button
                type="button"
                className="agent-finding-fix"
                onClick={() => state.replaceSource(fix.apply(state.source), finding.blockId)}
              >
                Fix: {fix.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Status control                                                      *
 * ------------------------------------------------------------------ */

/**
 * All seven statuses are listed; only legal transitions are enabled.
 * `finished` is never enabled (Q3) and explains why. `rejected` needs a
 * parseable **Reviewer feedback** section first; `halted` needs a reason.
 */
export function statusOptionState(
  current: AgentStatus | null,
  next: AgentStatus,
  options: { feedbackReady?: boolean; haltReason?: string } = {},
): { disabled: boolean; title: string } {
  const feedbackReady = options.feedbackReady ?? true;
  const haltReason = (options.haltReason ?? "").trim();
  if (next === "finished") {
    return { disabled: true, title: "Set by the OpenClaw sweep once an `apply` has actually been applied." };
  }
  let title: string;
  let enabled: boolean;
  if (current) {
    const transition = canTransition(current, next);
    enabled = transition.ok;
    title = transition.reason;
  } else if (next === "new") {
    enabled = true;
    title = "Migrate the legacy or missing status to the canonical new.";
  } else {
    enabled = false;
    title = "Set a canonical status (new) before any other transition.";
  }
  if (enabled && next === "rejected" && !feedbackReady) {
    return { disabled: true, title: "Reviewer feedback is required before a task may be set to rejected." };
  }
  if (enabled && next === "halted" && !haltReason) {
    return { disabled: true, title: "A halt needs a reason before the status can be set." };
  }
  if (enabled && next === "apply") {
    title = "Authorises the external OpenClaw sweep to apply this proposal. The site does not execute anything.";
  }
  return { disabled: !enabled, title };
}

function StatusSelect({
  state,
  block,
  compact = false,
  haltReason = "",
  onHalt,
}: {
  state: AgentConsoleStore;
  block: AgentBlock;
  compact?: boolean;
  haltReason?: string;
  onHalt?(reason: string): void;
}) {
  const current = canonicaliseStatus(block.metadata?.status ?? "");
  const ref: BlockRef = block.id ?? block.start;
  const feedbackReady = block.id ? hasReviewerFeedback(state.source, block.id) : false;
  const options = AGENT_STATUSES.map((status) => ({
    status,
    ...statusOptionState(current, status, { feedbackReady, haltReason }),
  }));
  const activeTitle = current
    ? STATUS_LEGEND[current]
    : statusLegend(block.metadata?.status);

  return (
    <select
      className={`agent-status-select${compact ? " compact" : ""}`}
      aria-label={`Status for ${block.id ?? `block at ${block.start}`}`}
      value={current ?? ""}
      title={activeTitle}
      data-status={current ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        if (!next || !canonicaliseStatus(next)) return;
        if (next === "halted") {
          onHalt?.(haltReason);
          return;
        }
        state.run((src) => setStatus(src, ref, next), { editedId: block.id, fail: `Could not set status ${next}` });
      }}
    >
      {!current && <option value="">—</option>}
      {options.map((option) => (
        <option key={option.status} value={option.status} disabled={option.disabled} title={option.title}>
          {option.status}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ *
 * Full task controls (side panel)                                     *
 * ------------------------------------------------------------------ */

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="agent-copy"
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? `${label} ✓` : label}
    </button>
  );
}

function HaltPanel({ state, task }: { state: AgentConsoleStore; task: AgentTask }) {
  const parent = task.parent;
  const id = task.id;
  if (!parent || !id) return null;
  const halt = parseHaltCallout(state.source, id);
  if (!halt) return null;
  return (
    <div className="agent-halt" data-halt-id={id}>
      <div className="agent-halt-head">
        <strong>Halted</strong>
        <span className="agent-halt-note">Halt details are written by the sweep and shown read-only.</span>
      </div>
      <pre className="agent-halt-text">{halt.lines.join("\n")}</pre>
      <button
        type="button"
        className="agent-halt-resolve"
        onClick={() =>
          state.run((src) => resolveHalt(src, id), {
            editedId: id,
            ok: "Halt resolved: the status proposal is in the draft; nothing is applied until you Save.",
            fail: "Could not propose a halt resolution",
          })
        }
      >
        Resolve halt → HRR
      </button>
    </div>
  );
}

function AgentTaskControls({
  state,
  task,
  editorHandleRef,
}: {
  state: AgentConsoleStore;
  task: AgentTask;
  editorHandleRef?: MutableRefObject<AtomicCodeMirrorEditorHandle | null>;
}) {
  const parent = task.parent;
  const review = task.review;
  const ref: BlockRef = task.id ?? parent?.start ?? task.blocks[0].start;

  const [idDraft, setIdDraft] = useState(task.id ?? "");
  useEffect(() => {
    setIdDraft(task.id ?? "");
  }, [task.id]);
  const [targetDraft, setTargetDraft] = useState(parent?.target ?? "document");
  useEffect(() => {
    setTargetDraft(parent?.target ?? "document");
  }, [parent?.target]);
  const [bodyDraft, setBodyDraft] = useState(review?.content ?? "");
  useEffect(() => {
    setBodyDraft(review?.content ?? "");
  }, [review?.content, review?.start]);
  const [instructionDraft, setInstructionDraft] = useState(parent?.content ?? "");
  useEffect(() => {
    setInstructionDraft(parent?.content ?? "");
  }, [parent?.content, parent?.start]);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [haltReason, setHaltReason] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const targetQuery = useRef<number>(0);

  const idValid = ID_RE.test(idDraft);
  const feedbackReady = !!task.id && hasReviewerFeedback(state.source, task.id);
  const pairingCandidates = state.blocks.filter(
    (block) => block.type === "agent-review" && block.id !== task.id,
  );
  const proposalMarkers = !!review && /(?:BEGIN|START|END|STOP)[ _:-]*(?:PROPOSAL|PROPOSED CONTENT)|\*\*Proposal\*\*/i.test(review.content);

  // TARGET suggestions: block ids found in this note (unified completion
  // endpoint, "blockref"). Debounced and sequence-guarded; a failure is silent.
  const loadTargets = useCallback(
    async (query: string) => {
      const id = ++targetQuery.current;
      try {
        const out = await state.client.completions("blockref", query, state.path, 8);
        if (id !== targetQuery.current) return;
        setTargets((out.results ?? []).map((result) => result.value));
      } catch {
        if (id === targetQuery.current) setTargets([]);
      }
    },
    [state.client, state.path],
  );
  useEffect(() => {
    const handle = setTimeout(() => void loadTargets(""), 200);
    return () => clearTimeout(handle);
  }, [loadTargets]);

  return (
    <div className="agent-controls">
      <label className="agent-field">
        <span>Type</span>
        <span className="agent-type-toggle">
          {(["agent", "agent-review"] as AgentBlockType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={task.blocks[0].type === type ? "active" : ""}
              onClick={() =>
                state.run((src) => setType(src, ref, type), {
                  editedId: task.id,
                  fail: `Could not switch the block to ${type}`,
                })
              }
            >
              {type}
            </button>
          ))}
        </span>
      </label>

      <label className="agent-field">
        <span>ID</span>
        <input
          className={`agent-id-input${idValid ? "" : " invalid"}`}
          value={idDraft}
          aria-label="Agent ID"
          onChange={(event) => setIdDraft(event.target.value.toUpperCase())}
          onBlur={() => {
            if (idDraft === (task.id ?? "")) return;
            if (!idValid) {
              state.setNotice({ kind: "err", msg: "Agent IDs are exactly six alphanumeric characters." });
              return;
            }
            state.run((src) => setId(src, ref, idDraft), {
              editedId: idDraft,
              ok: `ID updated to ${idDraft}`,
              fail: "Could not update the ID",
            });
          }}
        />
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void state.generateIdFor(ref, { fallbackId: task.id })}
        >
          Generate
        </button>
      </label>

      {parent && (
        <label className="agent-field">
          <span>TARGET</span>
          <input
            className="agent-target-input"
            value={targetDraft}
            aria-label="Agent target"
            list={`agent-targets-${task.key}`}
            onChange={(event) => {
              setTargetDraft(event.target.value);
              void loadTargets(event.target.value);
            }}
            onBlur={() => {
              if (targetDraft === (parent.target ?? "")) return;
              state.run((src) => setTarget(src, ref, targetDraft), {
                editedId: task.id,
                ok: `TARGET set to ${targetDraft || "(empty)"}`,
                fail: "Could not update TARGET",
              });
            }}
          />
          <datalist id={`agent-targets-${task.key}`}>
            <option value="document" />
            {targets.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
      )}

      {task.id && pairingCandidates.length > 0 && (
        <label className="agent-field">
          <span>Pairing</span>
          <select
            className="agent-pair-select"
            aria-label="Pair with review block"
            defaultValue=""
            onChange={(event) => {
              const start = Number(event.target.value);
              const candidate = pairingCandidates.find((block) => block.start === start);
              if (!candidate) return;
              state.run(
                (src) => setPairId(src, ref, candidate.start, task.id ?? candidate.id),
                { editedId: task.id, ok: "Paired with review block", fail: "Could not pair the review block" },
              );
            }}
          >
            <option value="">Pair with review block…</option>
            {pairingCandidates.map((block) => (
              <option key={block.start} value={block.start}>
                {`${block.id ?? "no ID"} @${block.start}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {parent && (
        <label className="agent-field">
          <span>Status</span>
          <StatusSelect state={state} block={parent} haltReason={haltReason} onHalt={(reason) => {
            if (!reason.trim()) return;
            state.run((src) => setStatus(src, ref, "halted"), {
              editedId: task.id,
              ok: "Task halted in the draft. Nothing is applied until you Save.",
              fail: "Could not set status halted",
            });
          }} />
        </label>
      )}

      <label className="agent-field">
        <span>Halt reason</span>
        <input
          className="agent-halt-reason"
          value={haltReason}
          aria-label="Halt reason"
          onChange={(event) => setHaltReason(event.target.value)}
        />
        <button
          type="button"
          disabled={!haltReason.trim()}
          onClick={() =>
            state.run(
              (src) => insertHaltScaffold(src, ref, haltReason.trim(), "Correct the flagged item, then set the status back to HRR."),
              { editedId: task.id, ok: "Halt scaffold inserted below the task", fail: "Could not insert the halt scaffold" },
            )
          }
        >
          Insert halt scaffold
        </button>
      </label>

      <div className="agent-body">
        <span className="agent-field-label">Instruction body</span>
        {parent ? (
          <>
            <textarea
              className="agent-body-input"
              aria-label="Instruction body"
              value={instructionDraft}
              onChange={(event) => setInstructionDraft(event.target.value)}
            />
            <button
              type="button"
              onClick={() =>
                state.run((src) => setBlockBody(src, parent.start, instructionDraft), {
                  editedId: task.id,
                  ok: "Instruction body updated in the draft",
                  fail: "Could not update the instruction body",
                })
              }
            >
              Apply instruction
            </button>
            <button type="button" onClick={() => jumpToSource(editorHandleRef, parent)}>
              Go to source
            </button>
          </>
        ) : (
          <span className="agent-hint">No parent instruction block.</span>
        )}
      </div>

      {review && (
        <div className="agent-body">
          <span className="agent-field-label">Review body</span>
          <textarea
            className="agent-body-input"
            aria-label="Review body"
            value={bodyDraft}
            onChange={(event) => setBodyDraft(event.target.value)}
          />
          <button
            type="button"
            onClick={() =>
              state.run((src) => setReviewBody(src, ref, bodyDraft), {
                editedId: task.id,
                ok: "Review body updated in the draft",
                fail: "Could not update the review body",
              })
            }
          >
            Apply review body
          </button>
          {proposalMarkers && <span className="agent-hint">Proposal markers detected.</span>}
        </div>
      )}

      {review && (
        <div className="agent-feedback">
          <span className="agent-field-label">Reviewer feedback</span>
          {feedbackReady ? (
            <span className="agent-hint ok">Feedback present.</span>
          ) : (
            <span className="agent-hint warn">
              Required before the task may be set to rejected.
            </span>
          )}
          <textarea
            className="agent-feedback-input"
            aria-label="Reviewer feedback"
            value={feedbackDraft}
            onChange={(event) => setFeedbackDraft(event.target.value)}
          />
          <button
            type="button"
            disabled={!feedbackDraft.trim()}
            onClick={() =>
              state.run((src) => ensureReviewerFeedback(src, ref, feedbackDraft), {
                editedId: task.id,
                ok: "Reviewer feedback saved into the labelled section",
                fail: "Could not save reviewer feedback",
              })
            }
          >
            Save feedback
          </button>
          {!feedbackReady && review.content.trim() && (
            <button
              type="button"
              onClick={() =>
                state.run((src) => ensureReviewerFeedback(src, ref, review.content), {
                  editedId: task.id,
                  ok: "Moved the review prose into **Reviewer feedback**",
                  fail: "Could not move the review prose",
                })
              }
            >
              Move prose into Reviewer feedback
            </button>
          )}
        </div>
      )}

      <HaltPanel state={state} task={task} />

      <div className="agent-actions">
        {review && task.id && (
          <>
            <button type="button" onClick={() => state.onAccept?.(task.id!)}>
              {proposalMarkers ? "Materialise into draft" : "Accept into draft"}
            </button>
            {confirmReject ? (
              <>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    state.onReject?.(task.id!);
                    setConfirmReject(false);
                  }}
                >
                  Confirm reject
                </button>
                <button type="button" onClick={() => setConfirmReject(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger"
                disabled={!feedbackReady}
                title={
                  feedbackReady
                    ? "Remove the staged review from the draft (draft-only)."
                    : "Reviewer feedback is required before rejecting."
                }
                onClick={() => setConfirmReject(true)}
              >
                Reject…
              </button>
            )}
          </>
        )}
        <button type="button" onClick={() => jumpToSource(editorHandleRef, review ?? parent ?? task.blocks[0])}>
          Go to source
        </button>
        <CopyButton
          label="Copy block"
          text={state.source.slice(task.blocks[0].start, task.blocks[task.blocks.length - 1].end)}
        />
        {task.id && <CopyButton label="Copy ID" text={task.id} />}
        {task.id && (
          <a
            className="agent-audit"
            href={`/note/${encodeURIComponent("Agent_Sweep_Log.md")}`}
            title={`Look up ${task.id} in the sweep log`}
          >
            Audit: Agent_Sweep_Log.md
          </a>
        )}
      </div>
    </div>
  );
}

function statusSummary(block?: AgentBlock, fallback?: string): string {
  if (!block) return fallback ?? "";
  const status = canonicaliseStatus(block.metadata?.status ?? "");
  return status ?? block.metadata?.status ?? "—";
}

/* ------------------------------------------------------------------ *
 * Placements                                                          *
 * ------------------------------------------------------------------ */

export interface AgentConsolePanelProps {
  state: AgentConsoleStore;
  editorHandleRef?: MutableRefObject<AtomicCodeMirrorEditorHandle | null>;
  heading?: string;
}

/** Side panel: every task in the note, each row expanding into the controls. */
export function AgentConsolePanel({
  state,
  editorHandleRef,
  heading = "Agent Tasks",
}: AgentConsolePanelProps) {
  const parents = state.blocks.filter((block) => block.type === "agent").length;
  const reviews = state.blocks.filter((block) => block.type === "agent-review").length;
  return (
    <section className="card review-panel agent-console">
      <h3>{heading}</h3>
      <p className="agent-console-note">
        {parents} instruction(s), {reviews} review(s). The validator proves structure, identity and
        consistency only — it does not run the safety gate, evaluate evidence or decide approval.
        No model is executed by this site.
      </p>
      {state.notice && (
        <div className={`flash flash-${state.notice.kind} agent-console-notice`}>{state.notice.msg}</div>
      )}
      {state.blocking.length > 0 && (
        <p className="agent-save-blocked" role="status">
          Save is disabled until {state.blocking.length} blocking finding
          {state.blocking.length === 1 ? "" : "s"} on edited blocks {state.blocking.length === 1 ? "is" : "are"} fixed.
        </p>
      )}
      <FindingsPanel state={state} editorHandleRef={editorHandleRef} />
      {state.tasks.length === 0 && <p className="agent-empty">No agent blocks in this note.</p>}
      <div className="agent-task-list">
        {state.tasks.map((task) => (
          <details className="agent-task-row" key={task.key}>
            <summary>
              <span className={`agent-type-badge type-${task.blocks[0].type}`}>
                {task.blocks[0].type}
              </span>
              <code className="agent-id">{task.id ?? "no ID"}</code>
              <span className={`agent-status-pill status-${(canonicaliseStatus(statusSummary(task.parent, "")) ?? "unknown").toLowerCase()}`}>
                {statusSummary(task.parent, "no status")}
              </span>
              <span className="agent-task-summary">{task.parent?.content.split("\n")[0] ?? task.review?.content.split("\n")[0] ?? ""}</span>
            </summary>
            <AgentTaskControls state={state} task={task} editorHandleRef={editorHandleRef} />
          </details>
        ))}
      </div>
    </section>
  );
}

export interface AgentInlineCardProps {
  state: AgentConsoleStore;
  block: AgentBlock;
  editorHandleRef?: MutableRefObject<AtomicCodeMirrorEditorHandle | null>;
}

/** Inline blueprint card with a compact status dropdown (same store). */
export function AgentInlineCard({ state, block, editorHandleRef }: AgentInlineCardProps) {
  const current = canonicaliseStatus(block.metadata?.status ?? "");
  const label = block.type === "agent" ? "Admin Instruction" : "Agent Review";
  return (
    <div
      className={`admin-instruction-block agent-inline-card${current ? ` status-${current.toLowerCase()}` : ""}`}
      data-agent-id={block.id ?? undefined}
      data-block-start={block.start}
    >
      <div className="admin-block-head">
        <span className="admin-badge">
          {label}
          {block.id ? ` #${block.id}` : ""}
        </span>
        {block.target && <span className="admin-target mono">{`TARGET: ${block.target}`}</span>}
        {block.type === "agent" ? (
          <StatusSelect state={state} block={block} compact />
        ) : (
          <span className="agent-status-pill" title={statusLegend(block.metadata?.status)}>
            {block.metadata?.status ?? "review"}
          </span>
        )}
      </div>
      {block.content.trim() && <p className="agent-inline-body">{block.content.trim().split("\n")[0]}</p>}
      <button type="button" onClick={() => jumpToSource(editorHandleRef, block)}>
        Go to source
      </button>
    </div>
  );
}
