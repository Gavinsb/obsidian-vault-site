import { describe, expect, it } from "vitest";
import {
  AGENT_STATUSES,
  ID_RE,
  LEGACY_STATUS_MAP,
  TERMINAL,
  TRANSITIONS,
  canTransition,
  canonicaliseAgentHeader,
  canonicaliseStatus,
  formatAgentHeader,
  generateId,
  parseAgentHeader,
} from "../src/shared/agent-status.js";

describe("agent status model", () => {
  it("defines the seven exact statuses and the terminal set", () => {
    expect(AGENT_STATUSES).toEqual(["new", "HRR", "apply", "rejected", "finished", "cancelled", "halted"]);
    expect(TERMINAL).toEqual(["finished", "cancelled"]);
  });

  it("locks the plan transition table including halted exits", () => {
    expect(TRANSITIONS).toEqual({
      new: ["HRR", "apply"],
      HRR: ["apply", "rejected", "cancelled"],
      rejected: ["HRR"],
      apply: ["finished"],
      finished: [],
      cancelled: [],
      halted: ["new", "HRR", "cancelled"],
    });
  });

  it("allows only legal transitions, with sweep-only and safety reasons", () => {
    expect(canTransition("new", "apply")).toMatchObject({ ok: true });
    expect(canTransition("rejected", "HRR")).toMatchObject({ ok: true });
    expect(canTransition("halted", "HRR")).toMatchObject({ ok: true });
    expect(canTransition("apply", "finished").reason).toMatch(/sweep/i);
    expect(canTransition("new", "finished")).toMatchObject({ ok: false });
    expect(canTransition("finished", "new").reason).toMatch(/terminal/i);
    // Any status may enter halted on a safety/integrity failure.
    for (const status of AGENT_STATUSES) expect(canTransition(status, "halted").ok).toBe(true);
  });

  it("canonicalises strictly and keeps migration separate", () => {
    expect(canonicaliseStatus("HRR")).toBe("HRR");
    expect(canonicaliseStatus("hrr")).toBeNull();
    expect(canonicaliseStatus(" new")).toBeNull();
    expect(LEGACY_STATUS_MAP).toEqual({ pending: "new", "Pending Human Approval": "HRR", "Human Approved": "apply" });
  });

  it("parses tolerant case-insensitive headers including legacy multi-word values", () => {
    expect(parseAgentHeader("> [!AGENT]- TARGET: Section ID: Ab12Cd STATUS: HRR")).toMatchObject({
      type: "agent", fold: "-", status: "HRR", id: "Ab12Cd", target: "Section",
    });
    expect(parseAgentHeader("> [!agent-review] id: ZX90Qw Status: Pending Human Approval")).toMatchObject({
      type: "agent-review", id: "ZX90Qw", status: "Pending Human Approval",
    });
  });

  it("writes only canonical, edit-scoped headers with value case preserved", () => {
    expect(formatAgentHeader("agent", { target: "Block One", id: "Ab12Cd", status: "HRR" })).toBe(
      '> [!agent] status:HRR id: Ab12Cd target: "Block One"',
    );
    expect(canonicaliseAgentHeader("> [!AGENT] TARGET: document STATUS: HRR ID: Ab12Cd")).toBe(
      "> [!agent] status:HRR id: Ab12Cd target: document",
    );
    expect(formatAgentHeader("agent-review", { status: "new", id: "Ab12Cd", target: "ignored" })).toBe(
      "> [!agent-review] id: Ab12Cd",
    );
  });

  it("validates and generates collision-free six-character alphanumeric IDs", () => {
    expect(ID_RE.test("A1b2C3")).toBe(true);
    expect(ID_RE.test("A1-b2C")).toBe(false);
    expect(ID_RE.test("short")).toBe(false);
    const samples = [...Array(6).fill(0), ...Array(6).fill(0.1)];
    expect(generateId(new Set(["AAAAAA"]), () => samples.shift() ?? 0.2)).toBe("DDDDDD");
  });
});
