/**
 * S7-6 — span-precise agent block splices.
 *
 * Every helper rewrites exactly one task's metadata (and, where the console
 * edits it, one review body) by source range, using the offsets
 * `parseAgentBlocks()` already produces. Nothing else in the document is
 * touched: an untouched legacy header elsewhere survives byte-identical
 * (LOCKED, Q7 — canonicalisation is edit-scoped, so opening a note to fix an
 * unrelated typo never rewrites agent metadata).
 *
 * The header helpers re-serialise **only** the edited header through
 * `formatAgentHeader()` (canonical `status → ID → TARGET`, lowercase keys,
 * original value case preserved). Header edits keep the original body bytes
 * verbatim; body edits keep the original header bytes verbatim.
 *
 * All functions are pure: they return a new source string and never mutate
 * the input. Offsets are always recomputed from the live source, so a stale
 * block object from an earlier render can never corrupt the file.
 */
import {
  canTransition,
  canonicaliseStatus,
  formatAgentHeader,
  ID_RE,
  parseAgentHeader,
  type AgentHeaderType,
} from "./agent-status.js";
import {
  parseAgentBlocks,
  type AgentBlock,
  type AgentBlockType,
} from "./agent-blocks.js";

/** A block reference: a task ID (`ABC123`) or a block's source `start` offset. */
export type BlockRef = string | number;

export interface SourceRange {
  start: number;
  end: number;
}

export interface SpliceEdit {
  start: number;
  end: number;
  text: string;
}

export const REVIEWER_FEEDBACK_HEADING = "**Reviewer feedback**";

/** Structural shape of one task: its parent, its review and every block sharing the ID. */
export interface AgentTaskBlocks {
  id?: string;
  parent?: AgentBlock;
  review?: AgentBlock;
  blocks: AgentBlock[];
}

function parse(source: string): AgentBlock[] {
  return parseAgentBlocks(source);
}

/**
 * Resolve a task from a block reference. With an ID, every block sharing that
 * ID is returned (a parent/review pair shares one ID); with a numeric start
 * offset, the matching block plus whichever blocks share its ID.
 */
export function resolveAgentTask(source: string, ref: BlockRef): AgentTaskBlocks {
  const blocks = parse(source);
  const group =
    typeof ref === "number"
      ? (() => {
          const block = blocks.find((candidate) => candidate.start === ref);
          if (!block) throw new Error("agent_block_not_found");
          return block.id ? blocks.filter((candidate) => candidate.id === block.id) : [block];
        })()
      : blocks.filter((candidate) => candidate.id === ref);
  if (group.length === 0) throw new Error("agent_block_not_found");
  return {
    id: group[0].id,
    parent: group.find((block) => block.type === "agent"),
    review: group.find((block) => block.type === "agent-review"),
    blocks: group,
  };
}

function requireParent(task: AgentTaskBlocks): AgentBlock {
  if (!task.parent) throw new Error("agent_parent_block_not_found");
  return task.parent;
}

function requireReview(task: AgentTaskBlocks): AgentBlock {
  if (!task.review) throw new Error("agent_review_block_not_found");
  return task.review;
}

/** The header line span (including its newline) of a parsed block. */
function headerSpan(source: string, block: AgentBlock): { start: number; end: number; eol: string } {
  const start = block.start;
  const newline = source.indexOf("\n", start);
  const end = newline === -1 || newline >= block.end ? block.end : newline + 1;
  const raw = source.slice(start, end);
  const eol = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
  return { start, end, eol };
}

/** The body span of a parsed block (everything after the header line). */
function bodySpan(source: string, block: AgentBlock): { start: number; end: number; eol: string; trailing: boolean } {
  const header = headerSpan(source, block);
  const raw = source.slice(header.end, block.end);
  const eol = raw.includes("\r\n") ? "\r\n" : header.eol || "\n";
  return { start: header.end, end: block.end, eol, trailing: raw.endsWith("\n") };
}

/**
 * Re-serialise a body as quoted lines. Every line — including blank lines —
 * keeps its `> ` prefix (a blank line is a bare `>`); enabling or disabling
 * the prefix is not a user option.
 */
function serialiseBody(content: string, eol: string, trailing: boolean): string {
  if (!content) return "";
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const quoted = lines.map((line) => (line.length ? `> ${line}` : ">")).join(eol);
  return trailing ? quoted + eol : quoted;
}

/**
 * Canonicalise the header of one block, preserving every other field and any
 * trailing prose the parser could not account for as metadata.
 */
function headerRewrite(
  source: string,
  block: AgentBlock,
  patch: { type?: AgentHeaderType; status?: string; id?: string; target?: string },
): SpliceEdit {
  const span = headerSpan(source, block);
  const parsed = parseAgentHeader(source.slice(span.start, span.end));
  const type = patch.type ?? parsed?.type ?? (block.type as AgentBlockType);
  const status = patch.status !== undefined ? patch.status : parsed?.status;
  const id = patch.id !== undefined ? patch.id : parsed?.id;
  const target = patch.target !== undefined ? patch.target : parsed?.target;
  const line = formatAgentHeader(type, { status, id, target }, parsed?.fold ?? "");
  const remainder = parsed?.remainder ? ` ${parsed.remainder}` : "";
  return { start: span.start, end: span.end, text: line + remainder + span.eol };
}

function bodyRewrite(source: string, block: AgentBlock, content: string): SpliceEdit {
  const span = bodySpan(source, block);
  return { start: span.start, end: span.end, text: serialiseBody(content, span.eol, span.trailing) };
}

/**
 * Apply edits right-to-left so every offset keeps referring to the original
 * source; unrelated bytes are copied through untouched.
 */
function applyEdits(source: string, edits: SpliceEdit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, edit) => acc.slice(0, edit.start) + edit.text + acc.slice(edit.end), source);
}

/** Set the parent `[!agent]` status. Only canonical statuses are accepted. */
export function setStatus(source: string, ref: BlockRef, status: string): string {
  if (!canonicaliseStatus(status)) throw new Error(`invalid_agent_status:${status}`);
  const parent = requireParent(resolveAgentTask(source, ref));
  return applyEdits(source, [headerRewrite(source, parent, { status })]);
}

/** Set the parent `TARGET:` token. `document` is the suggested value. */
export function setTarget(source: string, ref: BlockRef, target: string): string {
  const parent = requireParent(resolveAgentTask(source, ref));
  return applyEdits(source, [headerRewrite(source, parent, { target })]);
}

/**
 * Set the task ID, mirroring it onto every block that shares the ID (the
 * `[!agent-review]` mirror ID is rewritten with its parent).
 */
export function setId(source: string, ref: BlockRef, id: string): string {
  if (!ID_RE.test(id)) throw new Error(`invalid_agent_id:${id}`);
  const task = resolveAgentTask(source, ref);
  return applyEdits(source, task.blocks.map((block) => headerRewrite(source, block, { id })));
}

/** Point a parent and a specific review block at one shared ID (pairing picker). */
export function setPairId(source: string, parentRef: BlockRef, reviewRef: BlockRef, id?: string): string {
  const parent = requireParent(resolveAgentTask(source, parentRef));
  const review = requireReview(resolveAgentTask(source, reviewRef));
  const shared = id ?? parent.id ?? review.id;
  if (!shared || !ID_RE.test(shared)) throw new Error(`invalid_agent_id:${shared ?? ""}`);
  return applyEdits(source, [
    headerRewrite(source, parent, { id: shared }),
    headerRewrite(source, review, { id: shared }),
  ]);
}

/**
 * Toggle a block between `[!agent]` and `[!agent-review]` with structural
 * repair: a task keeps exactly one parent and one review, so flipping one
 * side of an existing pair flips the other side too (R3/R4).
 */
export function setType(source: string, ref: BlockRef, type: AgentBlockType): string {
  const task = resolveAgentTask(source, ref);
  const block = typeof ref === "number" ? task.blocks.find((candidate) => candidate.start === ref) : task.parent ?? task.blocks[0];
  if (!block) throw new Error("agent_block_not_found");
  if (block.type === type) return source;
  const partner = task.blocks.find((candidate) => candidate.start !== block.start);
  const edits: SpliceEdit[] = [headerRewrite(source, block, { type })];
  if (partner) {
    // The partner takes the complementary type, so the pair stays valid.
    const complement: AgentBlockType = type === "agent" ? "agent-review" : "agent";
    if (partner.type !== complement) edits.push(headerRewrite(source, partner, { type: complement }));
  }
  return applyEdits(source, edits);
}

/** Replace the quoted body of a review block; the header stays byte-identical. */
export function setReviewBody(source: string, ref: BlockRef, body: string): string {
  const review = requireReview(resolveAgentTask(source, ref));
  return applyEdits(source, [bodyRewrite(source, review, body)]);
}

/** Replace the quoted body of any block (parent instruction or review). */
export function setBlockBody(source: string, ref: BlockRef, body: string): string {
  const task = resolveAgentTask(source, ref);
  const block = typeof ref === "number" ? task.blocks.find((candidate) => candidate.start === ref) : task.parent ?? task.review;
  if (!block) throw new Error("agent_block_not_found");
  return applyEdits(source, [bodyRewrite(source, block, body)]);
}

/** The body of the parseable `**Reviewer feedback**` section, or null. */
export function reviewerFeedback(source: string, ref: BlockRef): string | null {
  let review: AgentBlock;
  try {
    review = requireReview(resolveAgentTask(source, ref));
  } catch {
    return null;
  }
  return sectionBody(review.content, "reviewer feedback");
}

function sectionBody(content: string, title: string): string | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line.trim().toLowerCase() === `**${title.toLowerCase()}**`);
  if (index < 0) return null;
  const body: string[] = [];
  for (let i = index + 1; i < lines.length; i++) {
    if (/^\s*\*\*[^*]+\*\*\s*$/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim() || null;
}

/** True when the task's review block carries a non-empty `**Reviewer feedback**` section. */
export function hasReviewerFeedback(source: string, ref: BlockRef): boolean {
  return reviewerFeedback(source, ref) !== null;
}

/** Insert or replace the labelled reviewer-feedback section inside the review body. */
export function ensureReviewerFeedback(source: string, ref: BlockRef, feedback: string): string {
  const review = requireReview(resolveAgentTask(source, ref));
  const content = upsertReviewerFeedback(review.content, feedback);
  return applyEdits(source, [bodyRewrite(source, review, content)]);
}

/** Pure content transform behind `ensureReviewerFeedback()` (exported for the console). */
export function upsertReviewerFeedback(content: string, feedback: string): string {
  const text = feedback.replace(/\r\n/g, "\n").trim();
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line.trim().toLowerCase() === REVIEWER_FEEDBACK_HEADING.toLowerCase());
  if (index < 0) {
    const head = content.trim() ? [...lines, ""] : [];
    return [...head, REVIEWER_FEEDBACK_HEADING, ...(text ? text.split("\n") : [])].join("\n").trim();
  }
  let end = lines.length;
  for (let i = index + 1; i < lines.length; i++) {
    if (/^\s*\*\*[^*]+\*\*\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, index + 1), ...(text ? text.split("\n") : []), ...lines.slice(end)].join("\n");
}

export interface HaltCallout {
  id: string;
  range: SourceRange;
  lines: string[];
  reason?: string;
  resolution?: string;
}

/**
 * Read a task-linked `> [!error] Agent Halt <ID>` callout. Halt content is
 * produced by the sweep and is displayed read-only by the console.
 */
export function parseHaltCallout(source: string, id: string): HaltCallout | null {
  const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const text = raw.replace(/\r?\n$/, "");
    const match = /^>\s*\[!error\][+-]?\s*Agent Halt\s+([A-Za-z0-9]{6})\s*$/i.exec(text);
    if (match && match[1].toUpperCase() === id.toUpperCase()) {
      const collected = [text];
      let end = offset + raw.length;
      for (let next = index + 1; next < lines.length; next++) {
        const nextRaw = lines[next];
        const nextText = nextRaw.replace(/\r?\n$/, "");
        if (!/^> ?/.test(nextText)) break;
        collected.push(nextText);
        end += nextRaw.length;
      }
      const reason = collected.map((line) => /^>\s*Reason:\s*(.*)$/i.exec(line)?.[1]).find(Boolean);
      const resolution = collected.map((line) => /^>\s*Required resolution:\s*(.*)$/i.exec(line)?.[1]).find(Boolean);
      return { id: match[1], range: { start: offset, end }, lines: collected, reason, resolution };
    }
    offset += raw.length;
  }
  return null;
}

/**
 * Insert the standard `[!error] Agent Halt <ID>` scaffold below the task.
 *
 * Halt content normally comes from the sweep; this helper exists only for the
 * console's explicit "insert halt scaffold" affordance after a human typed a
 * reason, and never runs on its own.
 */
export function insertHaltScaffold(
  source: string,
  ref: BlockRef,
  reason: string,
  resolution: string,
): string {
  const task = resolveAgentTask(source, ref);
  const id = task.id ?? (typeof ref === "string" ? ref : undefined);
  if (!id || !ID_RE.test(id)) throw new Error(`invalid_agent_id:${id ?? ""}`);
  const anchor = task.review ?? requireParent(task);
  const at = anchor.end;
  const before = source.slice(0, at);
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const block = [
    `> [!error] Agent Halt ${id}`,
    `> Reason: ${reason || "[specific safety or integrity problem]"}`,
    `> Required resolution: ${resolution || "[what must be clarified or corrected]"}`,
    "",
  ].join(eol);
  const text = (before.endsWith("\n") ? "" : eol) + eol + block;
  return source.slice(0, at) + text + source.slice(at);
}

/**
 * Propose the corrective status after a halt (typically `HRR`).
 *
 * The callout itself is sweep-owned and stays read-only; only the parent's
 * `status:` token changes, and only for a task that is actually `halted`.
 */
export function resolveHalt(source: string, ref: BlockRef, status = "HRR"): string {
  const parent = requireParent(resolveAgentTask(source, ref));
  const current = canonicaliseStatus(parent.metadata?.status ?? "");
  if (current !== "halted") throw new Error("agent_task_not_halted");
  const proposed = canonicaliseStatus(status);
  if (!proposed) throw new Error(`invalid_agent_status:${status}`);
  const legal = canTransition("halted", proposed);
  if (!legal.ok) throw new Error(`illegal_agent_transition:${legal.reason}`);
  return applyEdits(source, [headerRewrite(source, parent, { status: proposed })]);
}
