import { useMemo } from "react";
import {
  segmentBodyByAgentBlocks,
  type AgentBlock,
  type BodySegment,
} from "../../shared/agent-blocks";
import { canonicaliseStatus, statusLegend } from "../../shared/agent-status";
import { Markdown } from "./Markdown";

/**
 * S6-1 — Signed-in read-only rendering of agent instruction/review blocks.
 * The body is segmented so plain markdown flows through the normal pipeline
 * while agent blocks render as blueprint cards, paired start/end blocks get a
 * bracket line and hover shading over the encapsulated section.
 */
export function AgentBlocksView({
  content,
  baseFolder,
}: {
  content: string;
  baseFolder?: string;
}) {
  const segments = useMemo(() => segmentBodyByAgentBlocks(content), [content]);
  return (
    <div className="agent-blocks-view">
      {segments.map((seg, i) => (
        <Segment key={i} seg={seg} baseFolder={baseFolder} />
      ))}
    </div>
  );
}

function Segment({
  seg,
  baseFolder,
}: {
  seg: BodySegment;
  baseFolder?: string;
}) {
  if (seg.kind === "text") return <Markdown content={seg.text} baseFolder={baseFolder} />;
  if (seg.kind === "agent")
    return <AdminBlockCard block={seg.block} role="standalone" baseFolder={baseFolder} />;
  return (
    <div className="agent-pair" data-pair-id={seg.id}>
      <AdminBlockCard block={seg.start} role="start" baseFolder={baseFolder} />
      <div className="encapsulated" data-linked-to={seg.id}>
        {seg.inner.map((s, i) => (
          <Segment key={i} seg={s} baseFolder={baseFolder} />
        ))}
      </div>
      <AdminBlockCard block={seg.end} role="end" baseFolder={baseFolder} />
    </div>
  );
}

function AdminBlockCard({
  block,
  role,
  baseFolder,
}: {
  block: AgentBlock;
  role: "start" | "end" | "standalone";
  baseFolder?: string;
}) {
  const label =
    block.type === "agent" ? "Admin Instruction" : "Agent Review";
  const idText = block.id ? ` #${block.id}` : "";
  const roleText =
    role === "start" ? "Start " : role === "end" ? "End " : "";
  const target = block.target ? `TARGET: ${block.target}` : "";
  // Read mode speaks the canonical vocabulary and carries the legend tooltip;
  // a legacy value is still shown, but marked as non-canonical.
  const rawStatus = block.metadata?.status ?? "";
  const status = canonicaliseStatus(rawStatus);
  return (
    <div
      className={`admin-instruction-block ${role}-block`}
      data-instruction-id={block.id ?? undefined}
    >
      <div className="admin-block-head">
        <span className="admin-badge">
          {roleText}
          {label}
          {idText}
        </span>
        {target && <span className="admin-target mono">{target}</span>}
        {rawStatus && (
          <span
            className={`admin-status${status ? ` status-${status.toLowerCase()}` : " legacy"}`}
            data-status={status ?? rawStatus}
            title={statusLegend(rawStatus)}
          >
            {status ?? rawStatus}
          </span>
        )}
      </div>
      {block.content && (
        <div className="admin-block-content">
          {/* Run through the normal pipeline so proposed images render
              inline and links are clickable for review. */}
          <Markdown content={block.content} baseFolder={baseFolder} />
        </div>
      )}
    </div>
  );
}