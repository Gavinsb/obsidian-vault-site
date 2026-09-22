import { describe, expect, it } from "vitest";
import fs from "node:fs";

const docView = fs.readFileSync(
  new URL("../src/client/components/DocView.tsx", import.meta.url),
  "utf8",
);
const agentBlocksView = fs.readFileSync(
  new URL("../src/client/components/AgentBlocksView.tsx", import.meta.url),
  "utf8",
);
const apiSrc = fs.readFileSync(
  new URL("../src/client/api.ts", import.meta.url),
  "utf8",
);
const styles = fs.readFileSync(
  new URL("../src/client/styles.css", import.meta.url),
  "utf8",
);

describe("S6-1 agent blocks in read-only view", () => {
  it("adds a signed-in-only toggle to the read toolbar", () => {
    expect(docView).toContain('canEdit && (');
    expect(docView).toContain("agentBlocksView");
    expect(docView).toContain("Show agent blocks");
    expect(docView).toContain("Hide agent blocks");
  });

  it("switches the read fetch to the unmasked projection when toggled on", () => {
    expect(apiSrc).toContain("getDocAgents");
    expect(apiSrc).toContain("?agents=1");
    expect(docView).toContain("api.getDocAgents(p)");
  });

  it("renders AgentBlocksView only for signed-in readers with the toggle on", () => {
    expect(docView).toContain("AgentBlocksView");
    expect(docView).toContain("canEdit && agentsOn");
  });

  it("renders blueprint cards, badges, pairs, and encapsulated sections", () => {
    for (const token of [
      "admin-instruction-block",
      "admin-badge",
      "-block",
      "encapsulated",
      "agent-pair",
      "segmentBodyByAgentBlocks",
      "TARGET:",
    ]) {
      expect(agentBlocksView).toContain(token);
    }
  });

  it("shows the block status in a top-right pill", () => {
    expect(agentBlocksView).toContain("admin-status");
    expect(agentBlocksView).toContain("block.metadata?.status");
    expect(agentBlocksView).toContain("admin-block-head");
    expect(styles).toContain(".admin-status");
    expect(styles).toContain("margin-left: auto");
  });

  it("defines theme-adaptable palette tokens for dark and light themes", () => {
    expect(styles).toMatch(/--agent-block-bg:/);
    expect(styles).toMatch(/--agent-block-border:/);
    expect(styles).toMatch(/--agent-badge-bg:/);
    expect(styles).toMatch(/--agent-pair-accent:/);
    expect(styles).toMatch(/--agent-block-bg:/);
    const root = styles.slice(0, styles.indexOf("html[data-theme"));
    const light = styles.slice(styles.indexOf("html[data-theme"));
    expect(root).toContain("--agent-pair-accent: #34d399");
    expect(light).toContain("--agent-pair-accent: #059669");
  });

  it("keeps the plain public read path as the default for signed-out readers", () => {
    // The masked default GET /docs/:path remains the fallback; the unmasked
    // projection is gated server-side (see tests/s6-agent-read.test.ts).
    expect(docView).toContain("wantAgents && user");
    expect(docView).toContain("await api.getDoc(p)");
  });
});