import {
  canTransition,
  canonicaliseStatus,
  formatAgentHeader,
  isValidAgentId,
  LEGACY_STATUS_MAP,
  parseAgentHeader,
  type AgentStatus,
} from "./agent-status.js";

export type FindingSeverity = "error" | "warning" | "info";
export interface SourceRange { start: number; end: number; }
export interface FindingFix { label: string; apply(source: string): string; }
export interface Finding {
  severity: FindingSeverity;
  displaySeverity: FindingSeverity;
  rule: `R${number}`;
  blockId?: string;
  range: SourceRange;
  message: string;
  fix?: FindingFix;
  blocking: boolean;
  advisory: boolean;
}

export interface AgentValidationContext {
  reservedIds?: Iterable<string>;
  blockIds?: Iterable<string>;
  targets?: Iterable<string>;
  editedBlockIds?: Iterable<string>;
  editedIds?: Iterable<string>;
  editedRanges?: readonly SourceRange[];
  changedRanges?: readonly SourceRange[];
  previousSource?: string;
  previousStatus?: AgentStatus | Record<string, string> | ReadonlyMap<string, string>;
}

interface Line { raw: string; text: string; start: number; end: number; }
interface ScannedBlock {
  type: "agent" | "agent-review";
  start: number;
  end: number;
  headerStart: number;
  headerEnd: number;
  headerLine: string;
  fold: "" | "+" | "-";
  metadata: Record<string, string>;
  content: string;
  raw: string;
}

const HEADER = /^>\s*\[!(agent|agent-review)\]([+-]?)\s*(.*)$/i;
const MALFORMED_AGENT = /^\s*>\s*\[!agent(?:-review)?/i;
const QUOTED = /^> ?(.*)$/;

function linesOf(source: string): Line[] {
  const rawLines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
  let offset = 0;
  return rawLines.map((raw) => {
    const line = { raw, text: raw.replace(/\r?\n$/, ""), start: offset, end: offset + raw.length };
    offset += raw.length;
    return line;
  });
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed[0] === "\"" && trimmed.at(-1) === "\"") || (trimmed[0] === "'" && trimmed.at(-1) === "'"))) return trimmed.slice(1, -1);
  return trimmed;
}

/** Fields end at the next known key, so legacy multi-word values remain intact. */
function parseMetadata(tail: string): Record<string, string> {
  const fields = [...tail.matchAll(/(?:^|\s)(status|id|target)\s*:\s*/gi)];
  const out: Record<string, string> = {};
  fields.forEach((field, index) => {
    const start = (field.index ?? 0) + field[0].length;
    const end = index + 1 < fields.length ? (fields[index + 1].index ?? tail.length) : tail.length;
    out[field[1].toLowerCase()] = stripQuotes(tail.slice(start, end));
  });
  return out;
}

function scan(source: string): { blocks: ScannedBlock[]; malformed: SourceRange[]; errors: Array<{ id: string; range: SourceRange }> } {
  const lines = linesOf(source);
  const blocks: ScannedBlock[] = [];
  const malformed: SourceRange[] = [];
  const errors: Array<{ id: string; range: SourceRange }> = [];
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = null;
      i++;
      continue;
    }
    if (fence) { i++; continue; }
    const header = HEADER.exec(line.text);
    if (!header) {
      if (MALFORMED_AGENT.test(line.text)) malformed.push({ start: line.start, end: line.end });
      const error = /^>\s*\[!error\][+-]?\s*Agent Halt\s+([A-Za-z0-9]{6})\s*$/i.exec(line.text);
      if (error) {
        let end = line.end;
        let j = i + 1;
        while (j < lines.length && QUOTED.test(lines[j].text)) { end = lines[j].end; j++; }
        errors.push({ id: error[1], range: { start: line.start, end } });
      }
      i++;
      continue;
    }
    const body: string[] = [];
    let end = line.end;
    let j = i + 1;
    while (j < lines.length) {
      const quoted = QUOTED.exec(lines[j].text);
      if (!quoted) break;
      body.push(quoted[1]);
      end = lines[j].end;
      j++;
    }
    const tail = header[3].trim();
    blocks.push({
      type: header[1].toLowerCase() as ScannedBlock["type"],
      start: line.start, end, headerStart: line.start, headerEnd: line.end,
      headerLine: line.text, fold: header[2] as ScannedBlock["fold"],
      metadata: parseMetadata(tail), content: body.join("\n"), raw: source.slice(line.start, end),
    });
    if (j < lines.length && lines[j].text !== "" && !/^\s*$/.test(lines[j].text) && !/^>\s*\[!/.test(lines[j].text)) {
      malformed.push({ start: lines[j].start, end: lines[j].end });
    }
    i = j;
  }
  return { blocks, malformed, errors };
}

function intersects(a: SourceRange, b: SourceRange): boolean { return a.start < b.end && b.start < a.end; }
function setOf(values?: Iterable<string>): Set<string> { return new Set(values ?? []); }

function replaceFix(label: string, range: SourceRange, replacement: string): FindingFix {
  return { label, apply(source) { return source.slice(0, range.start) + replacement + source.slice(range.end); } };
}

function headerReplacement(block: ScannedBlock, values: { status?: string; id?: string; target?: string }): string {
  const newline = block.raw.slice(block.headerLine.length).match(/^(\r?\n)/)?.[1] ?? "";
  return formatAgentHeader(block.type, values, block.fold) + newline;
}

function statusFromPrevious(ctx: AgentValidationContext, id: string | undefined, soleParent: boolean): string | undefined {
  const previous = ctx.previousStatus;
  if (!previous) return undefined;
  if (typeof previous === "string") return soleParent ? previous : undefined;
  const map = previous as ReadonlyMap<string, string>;
  if (typeof map.get === "function") return id ? map.get(id) : undefined;
  return id ? (previous as Record<string, string>)[id] : undefined;
}

function sectionBody(content: string, title: string): string | null {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().toLowerCase() === `**${title.toLowerCase()}**`);
  if (index < 0) return null;
  const body: string[] = [];
  for (let i = index + 1; i < lines.length; i++) {
    if (/^\s*\*\*[^*]+\*\*\s*$/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

function markerInfo(content: string): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const normalized = line.replace(/<!--|-->/g, "").trim();
    if (/^(?:BEGIN|START)[ _:-]*(?:PROPOSAL|PROPOSED CONTENT)$|^(?:PROPOSAL|PROPOSED CONTENT)[ _:-]*(?:BEGIN|START)$/i.test(normalized)) starts.push(index);
    if (/^(?:END|STOP)[ _:-]*(?:PROPOSAL|PROPOSED CONTENT)$|^(?:PROPOSAL|PROPOSED CONTENT)[ _:-]*(?:END|STOP)$/i.test(normalized)) ends.push(index);
  });
  return { starts, ends };
}

export function validateAgentBlocks(source: string, ctx: AgentValidationContext = {}): Finding[] {
  const findings: Finding[] = [];
  const scanned = scan(source);
  const blocks = scanned.blocks;
  const parents = blocks.filter((block) => block.type === "agent");
  const reviews = blocks.filter((block) => block.type === "agent-review");
  const editedIds = new Set([...setOf(ctx.editedBlockIds), ...setOf(ctx.editedIds)]);
  const editedRanges = [...(ctx.editedRanges ?? []), ...(ctx.changedRanges ?? [])];
  const previous = ctx.previousSource !== undefined ? scan(ctx.previousSource).blocks : null;
  const hasExplicitEditScope = ctx.previousSource !== undefined || editedIds.size > 0 || editedRanges.length > 0;

  const isEdited = (range: SourceRange, id?: string, block?: ScannedBlock): boolean => {
    if (id && editedIds.has(id)) return true;
    if (editedRanges.some((candidate) => intersects(range, candidate))) return true;
    if (ctx.previousSource !== undefined && block) {
      const old = previous?.find((candidate) => candidate.type === block.type && candidate.metadata.id === id);
      return !old || old.raw !== block.raw;
    }
    if (ctx.previousSource !== undefined && !block) return ctx.previousSource.slice(range.start, range.end) !== source.slice(range.start, range.end);
    return !hasExplicitEditScope;
  };

  const emit = (severity: FindingSeverity, rule: `R${number}`, range: SourceRange, message: string, block?: ScannedBlock, fix?: FindingFix, forcedId?: string) => {
    const blockId = forcedId ?? (block?.metadata.id || undefined);
    const blocking = severity === "error" && isEdited(range, blockId, block);
    findings.push({ severity, displaySeverity: severity === "error" && !blocking ? "warning" : severity, rule, blockId, range, message, fix, blocking, advisory: severity === "error" && !blocking });
  };

  // R1 — malformed headers and quote-prefix breaks. Fenced/nested documentation never reaches scan().
  for (const range of scanned.malformed) {
    emit("error", "R1", range, "Agent callouts need a well-formed header and every body line must retain its > prefix.", undefined, undefined);
  }

  // R2 — IDs on every parent and review.
  for (const block of blocks) {
    const id = block.metadata.id;
    if (!id) emit("error", "R2", { start: block.headerStart, end: block.headerEnd }, "Agent block is missing its ID field.", block);
    else if (!isValidAgentId(id)) emit("error", "R2", { start: block.headerStart, end: block.headerEnd }, `Agent ID ${id} must be exactly six alphanumeric characters.`, block);
  }

  // R3 — a parent/review pair may share an ID; external reservations or repeated same-kind blocks may not.
  const reserved = setOf(ctx.reservedIds);
  const byId = new Map<string, ScannedBlock[]>();
  for (const block of blocks) if (block.metadata.id) byId.set(block.metadata.id, [...(byId.get(block.metadata.id) ?? []), block]);
  for (const [id, group] of byId) {
    const parentCount = group.filter((block) => block.type === "agent").length;
    const reviewCount = group.filter((block) => block.type === "agent-review").length;
    if (reserved.has(id) || parentCount > 1 || reviewCount > 1) {
      const block = group[0];
      emit("error", "R3", { start: block.headerStart, end: block.headerEnd }, `Agent ID ${id} is already reserved or reused by a different task.`, block);
    }
  }

  // R4 — exactly one review, directly after its parent (whitespace between callouts is allowed).
  // A task still at `new` (or legacy `pending`) has not been worked yet, so it carries no review block.
  for (const parent of parents) {
    const id = parent.metadata.id;
    if (!id) continue;
    const matches = reviews.filter((review) => review.metadata.id === id);
    const rawStatus = parent.metadata.status;
    const effective = rawStatus ? canonicaliseStatus(rawStatus) ?? LEGACY_STATUS_MAP[rawStatus] : null;
    if (matches.length === 0 && effective === "new") continue;
    if (matches.length !== 1) {
      emit("error", "R4", { start: parent.headerStart, end: parent.headerEnd }, `Task ${id} must have exactly one agent-review block; found ${matches.length}.`, parent);
    } else if (source.slice(parent.end, matches[0].start).trim() !== "") {
      emit("error", "R4", { start: matches[0].headerStart, end: matches[0].headerEnd }, `Review ${id} must sit immediately below its parent.`, matches[0]);
    }
  }
  for (const review of reviews) {
    const id = review.metadata.id;
    if (id && !parents.some((parent) => parent.metadata.id === id)) emit("error", "R4", { start: review.headerStart, end: review.headerEnd }, `Review ${id} has no matching parent task.`, review);
  }

  // R5 — exact, case-sensitive parent status vocabulary.
  for (const parent of parents) {
    const status = parent.metadata.status;
    if (!status || !canonicaliseStatus(status)) emit("error", "R5", { start: parent.headerStart, end: parent.headerEnd }, status && /^\d+$/.test(status) ? "A state number is not an agent task status or ID." : `Unknown or missing agent status${status ? `: ${status}` : ""}.`, parent);
  }

  // R6/R7 — parent authority and safe legacy migration.
  for (const review of reviews) {
    const legacy = review.metadata.status;
    if (!legacy) continue;
    const replacement = headerReplacement(review, { id: review.metadata.id });
    const fix = replaceFix("Remove review status", { start: review.headerStart, end: review.headerEnd }, replacement);
    emit("warning", "R6", { start: review.headerStart, end: review.headerEnd }, "Status belongs on the parent agent block, not the review.", review, fix);
    emit("warning", "R7", { start: review.headerStart, end: review.headerEnd }, "Remove the legacy status field from this review block.", review, fix);
  }
  for (const parent of parents) {
    const current = parent.metadata.status;
    let migrated = current ? LEGACY_STATUS_MAP[current] : undefined;
    if (current?.toLowerCase() === "processed") {
      const review = reviews.find((candidate) => candidate.metadata.id === parent.metadata.id);
      if (review?.metadata.status === "Pending Human Approval") migrated = "HRR";
    }
    if (migrated) {
      const replacement = headerReplacement(parent, { status: migrated, id: parent.metadata.id, target: parent.metadata.target });
      emit("warning", "R7", { start: parent.headerStart, end: parent.headerEnd }, `Migrate legacy status ${current} to ${migrated}.`, parent, replaceFix(`Set status:${migrated}`, { start: parent.headerStart, end: parent.headerEnd }, replacement));
    }
  }

  // R8 — compare with the baseline source or explicit previous-status map.
  const oldParents = previous?.filter((block) => block.type === "agent") ?? [];
  for (const parent of parents) {
    const status = canonicaliseStatus(parent.metadata.status ?? "");
    if (!status) continue;
    const id = parent.metadata.id;
    const oldFromSource = id ? oldParents.find((block) => block.metadata.id === id)?.metadata.status : undefined;
    const old = oldFromSource ?? statusFromPrevious(ctx, id, parents.length === 1);
    const oldStatus = old ? canonicaliseStatus(old) : null;
    if (oldStatus) {
      const result = canTransition(oldStatus, status);
      if (!result.ok) emit("warning", "R8", { start: parent.headerStart, end: parent.headerEnd }, result.reason, parent);
    }
  }

  // R9 — targets resolve against context and anchors present in this note.
  const knownTargets = new Set([...setOf(ctx.blockIds), ...setOf(ctx.targets)]);
  for (const match of source.matchAll(/\^([A-Za-z0-9_-]+)\s*$/gm)) knownTargets.add(match[1]);
  for (const parent of parents) {
    const target = parent.metadata.target;
    if (!target) {
      const replacement = headerReplacement(parent, { status: parent.metadata.status, id: parent.metadata.id, target: "document" });
      emit("warning", "R9", { start: parent.headerStart, end: parent.headerEnd }, "TARGET is required and cannot be empty.", parent, replaceFix("Set target: document", { start: parent.headerStart, end: parent.headerEnd }, replacement));
    } else if (target !== "document" && !knownTargets.has(target) && !knownTargets.has(target.replace(/^\^/, ""))) {
      emit("warning", "R9", { start: parent.headerStart, end: parent.headerEnd }, `TARGET ${target} does not resolve to a block in this note.`, parent);
    }
  }

  // R10 — proposal delimiters/payload, REPLACE baseline, and rejected feedback.
  for (const review of reviews) {
    const looksLikeProposal = /\*\*Proposal\*\*|\b(?:APPEND|REPLACE|INSERT)\b/i.test(review.content);
    if (looksLikeProposal) {
      const markers = markerInfo(review.content);
      let valid = markers.starts.length === 1 && markers.ends.length === 1 && markers.starts[0] < markers.ends[0];
      if (valid) {
        const lines = review.content.split(/\r?\n/);
        valid = lines.slice(markers.starts[0] + 1, markers.ends[0]).join("\n").trim().length > 0;
      }
      if (!valid) emit("warning", "R10", { start: review.start, end: review.end }, "Proposal content markers must be present, balanced, ordered, and contain a payload.", review);
      if (/\bREPLACE\b/i.test(review.content) && !/\*\*(?:Baseline|Original|Existing excerpt)\*\*/i.test(review.content)) emit("warning", "R10", { start: review.start, end: review.end }, "A REPLACE proposal needs a labelled baseline excerpt.", review);
    }
  }
  for (const parent of parents) {
    if (parent.metadata.status !== "rejected") continue;
    const review = reviews.find((candidate) => candidate.metadata.id === parent.metadata.id);
    if (!review || !sectionBody(review.content, "Reviewer feedback")) emit("warning", "R10", { start: parent.headerStart, end: parent.headerEnd }, "A rejected task requires a non-empty **Reviewer feedback** section in its review block.", parent);
  }

  // R11 — informational safety-gate heuristics only; this validator never decides safety.
  for (const parent of parents) {
    const text = parent.content;
    const reasons: string[] = [];
    if (/\b(?:delete|remove|rewrite)\b.{0,40}\b(?:frontmatter|global tags?)\b/i.test(text)) reasons.push("frontmatter/global-tag deletion");
    if (/\b(?:ignore (?:all |the )?(?:previous|above) instructions|system prompt|prompt injection)\b/i.test(text)) reasons.push("injection-like phrasing");
    if (/\b(?:the above|the below|somewhere|appropriate section|as needed)\b/i.test(text)) reasons.push("ambiguous target boundaries");
    if (reasons.length) emit("info", "R11", { start: parent.start, end: parent.end }, `This will likely be halted by the sweep: ${reasons.join(", ")}.`, parent);
  }

  // R12 — report whether the magic phrase is active or inert; never treat examples as authority.
  for (const block of blocks) {
    if (!/PERFORM AUTOMATICALLY/i.test(block.content)) continue;
    const lines = block.content.split(/\r?\n/);
    let fenced = false;
    let active = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (!fenced && block.type === "agent" && /^\s*(?:\*\*)?PERFORM AUTOMATICALLY(?:\*\*)?\s*$/i.test(line) && !/^\s*>/.test(line)) active = true;
    }
    emit("info", "R12", { start: block.start, end: block.end }, active ? "PERFORM AUTOMATICALLY is recognised as a block-body directive." : "PERFORM AUTOMATICALLY is inert here (review, quote, fence, proposal, or prose).", block);
  }

  // R13 is implemented structurally: top-level fences and nested quoted documentation are absent from blocks.

  // R14 — orphan error callouts and terminal leftovers.
  for (const error of scanned.errors) {
    if (!parents.some((parent) => parent.metadata.id === error.id)) emit("warning", "R14", error.range, `Agent halt ${error.id} has no matching task.`, undefined, undefined, error.id);
  }
  for (const parent of parents) {
    if (parent.metadata.status === "finished") emit("warning", "R14", { start: parent.start, end: parent.end }, "A finished task still retains its agent callout and should be cleaned up.", parent);
    if (parent.metadata.status === "cancelled" && (/\*\*(?:Proposal|Evidence|Reviewer feedback)\*\*/i.test(parent.content) || reviews.some((review) => review.metadata.id === parent.metadata.id))) emit("warning", "R14", { start: parent.start, end: parent.end }, "A cancelled task retains proposal/review annotations.", parent);
  }

  // R15 — terminal tasks must not retain review bodies or annotations.
  for (const parent of parents) {
    if (parent.metadata.status !== "finished" && parent.metadata.status !== "cancelled") continue;
    const review = reviews.find((candidate) => candidate.metadata.id === parent.metadata.id);
    if ((review && review.content.trim()) || /\*\*(?:Proposal|Evidence|Reviewer feedback)\*\*/i.test(parent.content)) emit("warning", "R15", review ? { start: review.start, end: review.end } : { start: parent.start, end: parent.end }, `${parent.metadata.status} tasks must not retain a review body or workflow annotations.`, parent);
  }

  return findings.sort((a, b) => a.range.start - b.range.start || Number(a.rule.slice(1)) - Number(b.rule.slice(1)));
}
