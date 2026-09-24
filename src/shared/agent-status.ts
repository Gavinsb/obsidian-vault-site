/** Shared, pure contracts for agent task headers, statuses and IDs. */

export const AGENT_STATUSES = [
  "new", "HRR", "apply", "rejected", "finished", "cancelled", "halted",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const TERMINAL: readonly AgentStatus[] = ["finished", "cancelled"];
export const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set(TERMINAL);

export const TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> = {
  new: ["HRR", "apply"],
  HRR: ["apply", "rejected", "cancelled"],
  rejected: ["HRR"],
  apply: ["finished"],
  finished: [],
  cancelled: [],
  halted: ["new", "HRR", "cancelled"],
};
export const AGENT_STATUS_TRANSITIONS = TRANSITIONS;

export const LEGACY_STATUS_MAP: Readonly<Record<string, AgentStatus>> = Object.freeze({
  pending: "new",
  "Pending Human Approval": "HRR",
  "Human Approved": "apply",
});

export interface TransitionResult { ok: boolean; reason: string; }

/**
 * Legal human/console transitions. `finished` is reachable from `apply` in the
 * table but is never offered by the console (Q3 — sweep-only). Any status may
 * additionally enter `halted` on a safety/integrity failure (spec §7.3).
 */
export function canTransition(from: AgentStatus, to: AgentStatus): TransitionResult {
  if (from === to) return { ok: true, reason: "Status is unchanged." };
  if (to === "halted") return { ok: true, reason: "A safety or integrity failure may halt a task from any status." };
  if (TRANSITIONS[from].includes(to)) {
    if (from === "apply" && to === "finished") return { ok: true, reason: "The OpenClaw sweep may mark an applied task finished." };
    return { ok: true, reason: `Legal transition: ${from} → ${to}.` };
  }
  if (to === "finished") return { ok: false, reason: "finished is sweep-only and may follow apply only." };
  if (TERMINAL_STATUSES.has(from)) return { ok: false, reason: `${from} is terminal; only a safety or integrity halt is permitted.` };
  return { ok: false, reason: `The transition ${from} → ${to} is not part of the agent workflow.` };
}

/** Strict: exact spelling and case; migration belongs to LEGACY_STATUS_MAP. */
export function canonicaliseStatus(value: string): AgentStatus | null {
  return (AGENT_STATUSES as readonly string[]).includes(value) ? value as AgentStatus : null;
}

/**
 * Human-readable legend for the seven canonical statuses. Defined once here so
 * the read-view pill, the console dropdown, panel rows and inline cards all
 * describe a status the same way (spec §10, "define once, consume everywhere").
 */
export const STATUS_LEGEND: Readonly<Record<AgentStatus, string>> = Object.freeze({
  new: "Awaiting processing.",
  HRR: "Human Review Required — the proposal is waiting for a human decision.",
  apply: "Authorised for application by the external OpenClaw sweep. The site executes nothing.",
  rejected: "Awaiting revision on reviewer feedback.",
  finished: "Successfully applied. Set by the OpenClaw sweep only.",
  cancelled: "Abandoned; the proposal was not applied.",
  halted: "Safety or integrity failure; needs a human.",
});

/** Legend lookup for an unknown/legacy status value. */
export function statusLegend(status: string | undefined | null): string {
  const canonical = status ? canonicaliseStatus(status) : null;
  if (canonical) return STATUS_LEGEND[canonical];
  return status
    ? `${status} is not one of the seven canonical agent statuses (${AGENT_STATUSES.join(", ")}).`
    : `No agent status is set. Canonical statuses: ${AGENT_STATUSES.join(", ")}.`;
}

export type AgentHeaderType = "agent" | "agent-review";
export interface ParsedAgentHeader {
  type: AgentHeaderType;
  fold: "" | "+" | "-";
  status?: string;
  id?: string;
  target?: string;
  remainder: string;
}

const HEADER_RE = /^>\s*\[!(agent|agent-review)\]([+-]?)\s*(.*)$/i;
const FIELD_RE = /(?:^|\s)(status|id|target)\s*:\s*/gi;

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === "\"" || first === "'") && value.at(-1) === first) return value.slice(1, -1);
  }
  return value;
}

/** Parse a complete callout header. Field names and callout type are case-insensitive. */
export function parseAgentHeader(line: string): ParsedAgentHeader | null {
  const match = HEADER_RE.exec(line.replace(/\r?\n$/, ""));
  if (!match) return null;
  const tail = match[3];
  const parsed: ParsedAgentHeader = { type: match[1].toLowerCase() as AgentHeaderType, fold: match[2] as ParsedAgentHeader["fold"], remainder: tail };
  const fields = [...tail.matchAll(FIELD_RE)];
  const consumed: Array<[number, number]> = [];
  fields.forEach((field, index) => {
    const key = field[1].toLowerCase() as "status" | "id" | "target";
    const start = (field.index ?? 0) + field[0].length;
    const end = index + 1 < fields.length ? (fields[index + 1].index ?? tail.length) : tail.length;
    parsed[key] = unquote(tail.slice(start, end).trim());
    consumed.push([field.index ?? 0, end]);
  });
  let remainder = tail;
  for (const [start, end] of consumed.reverse()) remainder = remainder.slice(0, start) + remainder.slice(end);
  parsed.remainder = remainder.trim();
  return parsed;
}

export interface AgentHeaderValues { status?: string; id?: string; target?: string; }

function serialiseValue(value: string): string {
  if (!/\s/.test(value) && value.length > 0) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Canonical writer for a block that the user actually edited. Values retain case/content. */
export function formatAgentHeader(type: AgentHeaderType, values: AgentHeaderValues, fold: ParsedAgentHeader["fold"] = ""): string {
  const fields: string[] = [];
  if (type === "agent" && values.status !== undefined) fields.push(`status:${serialiseValue(values.status)}`);
  if (values.id !== undefined) fields.push(`id: ${serialiseValue(values.id)}`);
  if (type === "agent" && values.target !== undefined) fields.push(`target: ${serialiseValue(values.target)}`);
  return `> [!${type}]${fold}${fields.length ? " " + fields.join(" ") : ""}`;
}

export function canonicaliseAgentHeader(line: string): string | null {
  const parsed = parseAgentHeader(line);
  return parsed ? formatAgentHeader(parsed.type, parsed, parsed.fold) : null;
}

export const ID_RE = /^[A-Za-z0-9]{6}$/;
export const AGENT_ID_PATTERN = ID_RE;
export function isValidAgentId(value: string): boolean { return ID_RE.test(value); }
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateAgentId(reservedIds: Iterable<string>, random: () => number = Math.random): string {
  const reserved = new Set(reservedIds);
  for (let attempt = 0; attempt < 10_000; attempt++) {
    let id = "";
    for (let i = 0; i < 6; i++) {
      const sample = random();
      const index = Math.max(0, Math.min(ID_ALPHABET.length - 1, Math.floor(sample * ID_ALPHABET.length)));
      id += ID_ALPHABET[index];
    }
    if (!reserved.has(id)) return id;
  }
  throw new Error("Unable to generate a unique agent ID after 10000 attempts.");
}

// Stable aliases for consumers that prefer shorter names.
export const STATUSES = AGENT_STATUSES;
export const STATUS_TRANSITIONS = TRANSITIONS;
export const LEGACY_STATUS_MIGRATIONS = LEGACY_STATUS_MAP;
export const validateAgentId = isValidAgentId;
export const generateId = generateAgentId;
