// @vitest-environment happy-dom
/**
 * S7-6 / S7-7 — Agent Block Console.
 *
 * Four halves:
 *   - splice fidelity: every splice operation rewrites exactly one task and
 *     leaves every other byte untouched (an untouched legacy header elsewhere
 *     survives byte-identical);
 *   - the console UI: legal transitions only, `finished` never enabled, the
 *     status gate on `rejected`, and one shared state across the side panel
 *     and the inline cards;
 *   - the exact Save-gate expression: disabled iff a blocking error sits on a
 *     session-edited block;
 *   - edited-vs-legacy validation: legacy findings are amber advisory only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
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
} from "../src/shared/agent-splice.js";
import { validateAgentBlocks } from "../src/shared/agent-validation.js";
import {
  AgentConsolePanel,
  AgentInlineCard,
  isSaveBlocked,
  statusOptionState,
  useAgentConsole,
  type AgentConsoleApi,
} from "../src/client/components/AgentConsole.js";

/* ------------------------------------------------------------------ *
 * Fixtures                                                            *
 * ------------------------------------------------------------------ */

const LEGACY_HEADER = "> [!agent] STATUS: ready ID: LEG001 TARGET: document";
const LEGACY_TASK = `${LEGACY_HEADER}\n> legacy instruction body\n`;

const PAIR = [
  "> [!agent] status:new ID: ABC123 TARGET: document",
  "> Do the thing.",
  "",
  "> [!agent-review] ID: ABC123",
  "> **Proposal**",
  "> proposed body",
  "",
].join("\n");

const PAIR_HEADER = "> [!agent] status:new ID: ABC123 TARGET: document";
const REVIEW_HEADER = "> [!agent-review] ID: ABC123";

const HALTED = [
  "> [!agent] status:halted ID: ABC123 TARGET: document",
  "> Do the thing.",
  "",
  "> [!agent-review] ID: ABC123",
  "> **Proposal**",
  "",
  "> [!error] Agent Halt ABC123",
  "> Reason: unsafe delete request",
  "> Required resolution: clarify scope",
  "",
].join("\n");

/** Two independent tasks in one file (block isolation fixtures). */
const TASK_A = "> [!agent] status:new ID: AAA111 TARGET: document\n> task a body\n";
const TASK_B = "> [!agent] STATUS: pending ID: BBB222 TARGET: document\n> task b body\n";
const TWO_TASKS = `${TASK_A}\n${TASK_B}`;

/** happy-dom rewrites `import.meta.url`, so read fixtures from the repo root. */
const read = (relative: string) => fs.readFileSync(`${process.cwd()}/${relative}`, "utf8");

/* ------------------------------------------------------------------ *
 * 1. Splice fidelity                                                  *
 * ------------------------------------------------------------------ */

describe("S7-6 span splices", () => {
  it("setStatus rewrites only the edited header; an untouched legacy header survives byte-identical", () => {
    const source = `${LEGACY_TASK}\n${PAIR}`;
    const next = setStatus(source, "ABC123", "HRR");
    expect(next).not.toBe(source);
    expect(next.startsWith(LEGACY_TASK)).toBe(true);
    expect(next).toContain("> [!agent] status:HRR id: ABC123 target: document");
    // The review half of the pair is untouched, byte for byte.
    expect(next.slice(next.indexOf(REVIEW_HEADER))).toBe(source.slice(source.indexOf(REVIEW_HEADER)));

    // …and a legacy header *after* the edited block also survives untouched.
    const trailing = setStatus(`${PAIR}\n${LEGACY_TASK}`, "ABC123", "apply");
    expect(trailing.endsWith(LEGACY_TASK)).toBe(true);
  });

  it("setStatus rejects anything outside the canonical status vocabulary", () => {
    expect(() => setStatus(PAIR, "ABC123", "ready")).toThrow(/invalid_agent_status/);
    expect(() => setStatus(PAIR, "ABC123", "hrr")).toThrow(/invalid_agent_status/);
    expect(setStatus(PAIR, "ABC123", "HRR")).toContain("status:HRR");
  });

  it("setType toggles the block and repairs the parent/review pairing", () => {
    const next = setType(PAIR, "ABC123", "agent-review");
    const lines = next.split("\n");
    expect(lines[0]).toBe("> [!agent-review] id: ABC123");
    expect(lines[3]).toBe("> [!agent] id: ABC123");
    // Bodies are untouched by a header-only splice.
    expect(next).toContain("> Do the thing.");
    expect(next).toContain("> **Proposal**\n> proposed body");
    // A no-op toggle returns the source unchanged.
    expect(setType(PAIR, "ABC123", "agent")).toBe(PAIR);
  });

  it("setId mirrors the new ID onto the review block and nothing else", () => {
    const source = `${LEGACY_TASK}\n${PAIR}`;
    const next = setId(source, "ABC123", "ZZZ999");
    expect(next.startsWith(LEGACY_TASK)).toBe(true);
    expect(next).toContain("> [!agent] status:new id: ZZZ999 target: document");
    expect(next).toContain("> [!agent-review] id: ZZZ999");
    expect(next).toContain("> **Proposal**\n> proposed body");
    expect(() => setId(PAIR, "ABC123", "short")).toThrow(/invalid_agent_id/);
  });

  it("setTarget rewrites the parent header and preserves the body bytes", () => {
    const next = setTarget(PAIR, "ABC123", "^anchor-1");
    expect(next.startsWith("> [!agent] status:new id: ABC123 target: ^anchor-1\n")).toBe(true);
    expect(next.slice(next.indexOf("> Do the thing."))).toBe(PAIR.slice(PAIR.indexOf("> Do the thing.")));
  });

  it("setReviewBody re-quotes body lines and leaves the header byte-identical", () => {
    const source = `${LEGACY_TASK}\n${PAIR}`;
    const next = setReviewBody(source, "ABC123", "line one\n\nline three");
    expect(next.startsWith(`${LEGACY_TASK}\n${PAIR_HEADER}\n> Do the thing.\n\n${REVIEW_HEADER}\n`)).toBe(true);
    expect(next).toContain("> line one\n>\n> line three");
    expect(next).not.toContain("> proposed body");
  });

  it("setBlockBody edits the parent instruction body only", () => {
    const next = setBlockBody(PAIR, "ABC123", "rewritten instruction");
    expect(next.startsWith(`${PAIR_HEADER}\n> rewritten instruction\n`)).toBe(true);
    expect(next).toContain("> [!agent-review] ID: ABC123\n> **Proposal**\n> proposed body");
  });

  it("ensureReviewerFeedback appends, replaces and is detectable", () => {
    expect(hasReviewerFeedback(PAIR, "ABC123")).toBe(false);
    const added = ensureReviewerFeedback(PAIR, "ABC123", "Not enough evidence.");
    expect(added).toContain("> **Reviewer feedback**\n> Not enough evidence.");
    expect(hasReviewerFeedback(added, "ABC123")).toBe(true);
    // The parent header and the review header stay byte-identical.
    expect(added.startsWith(`${PAIR_HEADER}\n> Do the thing.\n\n${REVIEW_HEADER}\n`)).toBe(true);

    const replaced = ensureReviewerFeedback(added, "ABC123", "Needs a citation.");
    expect(replaced).toContain("> **Reviewer feedback**\n> Needs a citation.");
    expect(replaced).not.toContain("Not enough evidence.");
    expect(hasReviewerFeedback(replaced, "ABC123")).toBe(true);
  });

  it("resolveHalt proposes the corrective status and never rewrites the halt callout", () => {
    const next = resolveHalt(HALTED, "ABC123");
    expect(next.startsWith("> [!agent] status:HRR id: ABC123 target: document\n")).toBe(true);
    expect(next).toContain("> [!error] Agent Halt ABC123\n> Reason: unsafe delete request\n> Required resolution: clarify scope");
    // Only a genuinely halted task may be resolved; illegal hops throw.
    expect(() => resolveHalt(PAIR, "ABC123")).toThrow(/agent_task_not_halted/);
    expect(() => resolveHalt(HALTED, "ABC123", "finished")).toThrow(/illegal_agent_transition/);
    expect(() => resolveHalt(HALTED, "ABC123", "apply")).toThrow(/illegal_agent_transition/);
  });

  it("parses the sweep-written halt callout read-only", () => {
    const halt = parseHaltCallout(HALTED, "ABC123");
    expect(halt).not.toBeNull();
    expect(halt?.reason).toBe("unsafe delete request");
    expect(halt?.resolution).toBe("clarify scope");
    expect(HALTED.slice(halt!.range.start, halt!.range.end)).toContain("> [!error] Agent Halt ABC123");
    expect(parseHaltCallout(HALTED, "ZZZ999")).toBeNull();
  });

  it("insertHaltScaffold adds the standard callout below the task", () => {
    const next = insertHaltScaffold(PAIR, "ABC123", "needs a human", "clarify the scope");
    expect(next).toContain("> [!error] Agent Halt ABC123");
    expect(next).toContain("> Reason: needs a human");
    expect(next).toContain("> Required resolution: clarify the scope");
    expect(next.startsWith(PAIR)).toBe(true);
    expect(parseHaltCallout(next, "ABC123")?.reason).toBe("needs a human");
  });

  it("setPairId points a parent and a chosen review at one shared ID", () => {
    const source = [
      "> [!agent] status:new ID: AAA111 TARGET: document",
      "> a",
      "",
      "> [!agent-review] ID: BBB222",
      "> b",
      "",
    ].join("\n");
    const next = setPairId(source, "AAA111", "BBB222", "AAA111");
    expect(next).toContain("> [!agent] status:new id: AAA111 target: document");
    expect(next).toContain("> [!agent-review] id: AAA111");
  });

  it("is CRLF-safe and byte-exact outside the edited span", () => {
    const crlf = `${LEGACY_HEADER}\r\n> legacy body\r\n\r\n${PAIR_HEADER}\r\n> Do the thing.\r\n`;
    const next = setStatus(crlf, "ABC123", "HRR");
    expect(next.startsWith(`${LEGACY_HEADER}\r\n> legacy body\r\n\r\n`)).toBe(true);
    expect(next).toContain("> [!agent] status:HRR id: ABC123 target: document\r\n");
    expect(next.endsWith("> Do the thing.\r\n")).toBe(true);
    expect(next.includes("\r\n")).toBe(true);
  });

  it("never crosses block boundaries: editing one task leaves the other byte-identical", () => {
    const next = setStatus(TWO_TASKS, "BBB222", "apply");
    expect(next.startsWith(TASK_A)).toBe(true);
    expect(next).toContain("> [!agent] status:apply id: BBB222 target: document");
    expect(next.endsWith("> task b body\n")).toBe(true);
  });

  it("returns a fresh string for every operation and never mutates the input", () => {
    const source = `${LEGACY_TASK}\n${PAIR}`;
    const snapshot = `${LEGACY_TASK}\n${PAIR}`;
    const operations: Array<[string, string]> = [
      ["setStatus", setStatus(source, "ABC123", "HRR")],
      ["setType", setType(source, "ABC123", "agent-review")],
      ["setId", setId(source, "ABC123", "ZZZ999")],
      ["setTarget", setTarget(source, "ABC123", "document")],
      ["setReviewBody", setReviewBody(source, "ABC123", "new body")],
      ["ensureReviewerFeedback", ensureReviewerFeedback(source, "ABC123", "because")],
    ];
    for (const [name, result] of operations) {
      expect(typeof result, name).toBe("string");
      expect(result, name).not.toBe(source);
    }
    expect(source).toBe(snapshot);
  });

  it("throws for unknown blocks instead of splicing the wrong span", () => {
    expect(() => setStatus(PAIR, "ZZZ999", "HRR")).toThrow(/agent_block_not_found/);
    expect(() => setReviewBody(PAIR, "ZZZ999", "x")).toThrow(/agent_block_not_found/);
    // A review-only task has no parent to carry a status.
    expect(() => setStatus("> [!agent-review] ID: CCC333\n> body\n", "CCC333", "HRR"))
      .toThrow(/agent_parent_block_not_found/);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Shared state (panel + inline)                                    *
 * ------------------------------------------------------------------ */

const mounted: { host: HTMLElement; root: Root }[] = [];

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const fakeApi = (ids: string[] = []): AgentConsoleApi => ({
  agentIds: vi.fn(async () => ({ ids })),
  completions: vi.fn(async () => ({ results: [] })),
});

/**
 * One store, two placements: exactly how `DocView` wires the console.
 */
function Harness({ initial, api }: { initial: string; api: AgentConsoleApi }) {
  const [draft, setDraft] = useState(initial);
  const store = useAgentConsole({
    source: draft,
    baseline: initial,
    path: "Note.md",
    onChange: setDraft,
    api,
    onAccept: () => {},
    onReject: () => {},
  });
  return createElement(
    "div",
    null,
    createElement("pre", { id: "draft" }, draft),
    createElement(AgentConsolePanel, { state: store }),
    ...store.blocks.map((block, index) =>
      createElement(AgentInlineCard, { key: `${block.start}-${index}`, state: store, block }),
    ),
  );
}

function mountConsole(initial: string, api: AgentConsoleApi = fakeApi()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness, { initial, api })));
  mounted.push({ host, root });
  return host;
}

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

const changeSelect = (select: HTMLSelectElement, value: string) => {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

/** Set a controlled field the way a user would (bypasses React's value tracker). */
const typeInto = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("S7-7 console placements share one state", () => {
  it("drives the panel, the inline card and the draft from a single store", () => {
    const host = mountConsole(PAIR);
    const inline = host.querySelector<HTMLSelectElement>(".agent-inline-card .agent-status-select");
    const panel = host.querySelector<HTMLSelectElement>(".agent-task-row .agent-status-select");
    expect(inline).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(inline?.value).toBe("new");

    changeSelect(inline!, "HRR");

    const inlineAfter = host.querySelector<HTMLSelectElement>(".agent-inline-card .agent-status-select");
    const panelAfter = host.querySelector<HTMLSelectElement>(".agent-task-row .agent-status-select");
    expect(inlineAfter?.value).toBe("HRR");
    expect(panelAfter?.value).toBe("HRR");
    expect(host.querySelector(".agent-task-row .agent-status-pill")?.textContent).toBe("HRR");
    // The review half of the pair has no status of its own.
    expect(host.querySelectorAll(".agent-inline-card .agent-status-pill")[0].textContent).toBe("review");
    expect(host.querySelector("#draft")?.textContent).toContain("status:HRR id: ABC123 target: document");
    // The review block is untouched by the status edit.
    expect(host.querySelector("#draft")?.textContent).toContain("> [!agent-review] ID: ABC123");
  });

  it("still drives the draft when the panel select is used", () => {
    const host = mountConsole(PAIR);
    const panel = host.querySelector<HTMLSelectElement>(".agent-task-row .agent-status-select");
    changeSelect(panel!, "apply");
    expect(host.querySelector<HTMLSelectElement>(".agent-inline-card .agent-status-select")?.value).toBe("apply");
    expect(host.querySelector("#draft")?.textContent).toContain("status:apply id: ABC123");
  });

  it("lists every status but never enables finished", () => {
    const host = mountConsole(PAIR);
    const select = host.querySelector<HTMLSelectElement>(".agent-task-row .agent-status-select")!;
    const options = [...select.querySelectorAll("option")];
    expect(options.map((option) => option.value)).toEqual([
      "new",
      "HRR",
      "apply",
      "rejected",
      "finished",
      "cancelled",
      "halted",
    ]);
    const finished = options.find((option) => option.value === "finished")!;
    expect(finished.disabled).toBe(true);
    expect(finished.title).toBe(
      "Set by the OpenClaw sweep once an `apply` has actually been applied.",
    );
    // new → cancelled is not an edge in the transition table.
    expect(options.find((option) => option.value === "cancelled")?.disabled).toBe(true);
    // halted needs a typed reason before it can be chosen.
    expect(options.find((option) => option.value === "halted")?.disabled).toBe(true);
  });

  it("requires reviewer feedback before rejected is offered", () => {
    const host = mountConsole(PAIR);
    const select = host.querySelector<HTMLSelectElement>(".agent-task-row .agent-status-select")!;
    changeSelect(select, "HRR");
    const rejected = () =>
      [...host.querySelectorAll<HTMLOptionElement>(".agent-task-row .agent-status-select option")]
        .find((option) => option.value === "rejected")!;
    expect(rejected().disabled).toBe(true);
    expect(rejected().title).toBe(
      "Reviewer feedback is required before a task may be set to rejected.",
    );

    const feedback = host.querySelector<HTMLTextAreaElement>(".agent-feedback-input")!;
    typeInto(feedback, "Evidence is thin.");
    const save = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Save feedback",
    ) as HTMLButtonElement;
    act(() => save.click());
    expect(host.querySelector("#draft")?.textContent).toContain("> **Reviewer feedback**\n> Evidence is thin.");
    expect(rejected().disabled).toBe(false);
  });

  it("keeps Accept/Reject draft-only (host-owned); a `new` task needs no review", () => {
    const host = mountConsole(LEGACY_TASK);
    expect(host.querySelector(".agent-save-blocked")).toBeNull();
    const inline = host.querySelector<HTMLSelectElement>(".agent-inline-card .agent-status-select")!;
    // The legacy value is not canonical, so only `new` is offered.
    expect(inline.value).toBe("");
    changeSelect(inline, "new");
    expect(host.querySelector("#draft")?.textContent).toContain("> [!agent] status:new id: LEG001 target: document");
    // A `new` task has not been worked yet, so it needs no review block and Save is not blocked.
    expect(host.querySelector(".agent-save-blocked")).toBeNull();
    expect(host.querySelector(".agent-finding.blocking")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 3. Exact Save gate                                                  *
 * ------------------------------------------------------------------ */

describe("S7-7 Save gate", () => {
  it("is disabled iff a blocking error exists on a session-edited block", () => {
    expect(isSaveBlocked([])).toBe(false);

    const legacy = validateAgentBlocks(LEGACY_TASK, { previousSource: LEGACY_TASK });
    expect(legacy.some((finding) => finding.severity === "error")).toBe(true);
    expect(legacy.every((finding) => finding.blocking === false)).toBe(true);
    expect(isSaveBlocked(legacy)).toBe(false);

    const edited = validateAgentBlocks(
      LEGACY_TASK.replace("> legacy instruction body", "> legacy instruction body edited"),
      { previousSource: LEGACY_TASK },
    );
    expect(edited.some((finding) => finding.blocking)).toBe(true);
    expect(isSaveBlocked(edited)).toBe(true);
  });

  it("uses the same expression in DocView's Save button", () => {
    const docView = read("src/client/components/DocView.tsx");
    expect(docView).toContain(
      "disabled={saving || !dirty || !baseEtag || !!conflict || saveBlocked}",
    );
    expect(docView).toContain("const saveBlocked = isSaveBlocked(agentConsole.findings)");
    expect(docView).not.toContain("save anyway");
  });

  it("never enables finished from any editable status", () => {
    for (const status of ["new", "HRR", "apply", "rejected", "cancelled", "halted"] as const) {
      expect(statusOptionState(status, "finished").disabled, status).toBe(true);
    }
    expect(statusOptionState(null, "finished").disabled).toBe(true);
    expect(statusOptionState("new", "HRR").disabled).toBe(false);
    expect(statusOptionState("new", "cancelled").disabled).toBe(true);
    expect(statusOptionState("HRR", "rejected", { feedbackReady: true }).disabled).toBe(false);
    expect(statusOptionState("HRR", "rejected", { feedbackReady: false }).disabled).toBe(true);
    expect(statusOptionState("halted", "HRR", { haltReason: "why" }).disabled).toBe(false);
    expect(statusOptionState(null, "new").disabled).toBe(false);
    expect(statusOptionState(null, "apply").disabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Edited vs legacy validation                                      *
 * ------------------------------------------------------------------ */

describe("S7-6/S7-7 edit-scoped validation", () => {
  it("shows legacy findings as amber advisory, never blocking", () => {
    const findings = validateAgentBlocks(LEGACY_TASK, { previousSource: LEGACY_TASK });
    const r5 = findings.find((finding) => finding.rule === "R5")!;
    expect(r5.severity).toBe("error");
    expect(r5.displaySeverity).toBe("warning");
    expect(r5.advisory).toBe(true);
    expect(r5.blocking).toBe(false);
    expect(isSaveBlocked(findings)).toBe(false);
  });

  it("marks the same error blocking once the block was edited this session", () => {
    const byDiff = validateAgentBlocks(
      LEGACY_TASK.replace("> legacy instruction body", "> legacy instruction body edited"),
      { previousSource: LEGACY_TASK },
    );
    expect(byDiff.find((finding) => finding.rule === "R5")?.blocking).toBe(true);

    const byId = validateAgentBlocks(LEGACY_TASK, { editedBlockIds: ["LEG001"] });
    expect(byId.find((finding) => finding.rule === "R5")?.blocking).toBe(true);
    expect(isSaveBlocked(byId)).toBe(true);
  });

  it("keeps two tasks isolated: editing A never makes B block Save", () => {
    // A worked task (HRR) edited without a review must block; an untouched legacy task must not.
    const taskA = "> [!agent] status:HRR ID: AAA111 TARGET: document\n> task a body\n";
    const baseline = `${taskA}\n${TASK_B}`;
    const source = `${taskA.replace("> task a body\n", "> task a body edited\n")}\n${TASK_B}`;
    const findings = validateAgentBlocks(source, { previousSource: baseline });
    const a = findings.filter((finding) => finding.blockId === "AAA111");
    const b = findings.filter((finding) => finding.blockId === "BBB222");
    expect(a.some((finding) => finding.blocking)).toBe(true);
    expect(b.every((finding) => finding.blocking === false)).toBe(true);
  });

  it("exposes click-to-jump ranges and safe fixes for the panel", () => {
    const legacyReview = [
      "> [!agent] status:new ID: DDD444 TARGET: document",
      "> instruction",
      "",
      "> [!agent-review] status:pending ID: DDD444",
      "> review body",
      "",
    ].join("\n");
    const findings = validateAgentBlocks(legacyReview, { previousSource: legacyReview });
    const r6 = findings.find((finding) => finding.rule === "R6")!;
    expect(r6.range.end).toBeGreaterThan(r6.range.start);
    expect(r6.fix?.label).toBe("Remove review status");
    expect(r6.fix!.apply(legacyReview)).toContain("> [!agent-review] id: DDD444");
    expect(r6.fix!.apply(legacyReview)).not.toContain("status:pending");
  });
});

/* ------------------------------------------------------------------ *
 * 5. Read-mode pill                                                   *
 * ------------------------------------------------------------------ */

describe("S7-7 read-mode status vocabulary", () => {
  it("uses the canonical vocabulary and a legend tooltip", () => {
    const view = read("src/client/components/AgentBlocksView.tsx");
    expect(view).toContain("canonicaliseStatus");
    expect(view).toContain("statusLegend");
    expect(view).toContain("block.metadata?.status");
    expect(view).toContain("admin-status");
    expect(view).toContain("title={statusLegend(");
  });

  it("defines both theme token sets for the status colours", () => {
    const styles = read("src/client/styles.css");
    const occurrences = (token: string) => styles.split(token).length - 1;
    expect(occurrences("--agent-status-hrr:")).toBe(2);
    expect(occurrences("--agent-status-halted:")).toBe(2);
    expect(styles).toContain("html[data-theme='light']");
    expect(styles).toContain(".agent-status-pill.status-hrr");
  });
});
