/**
 * S7-4 — vault-wide reserved agent ID index.
 *
 * Reserved IDs come from agent/agent-review blocks in every vault note plus
 * any ID referenced by Agent_Sweep_Log.md. The result is session-gated and
 * contains IDs only — never agent instructions, proposals or note content.
 */
import { parseAgentBlocks } from "../shared/agent-blocks.js";
import type { VaultService } from "./vault-service.js";

export const SWEEP_LOG_PATH = "Agent_Sweep_Log.md";
const ID_RE = /^[A-Za-z0-9]{6}$/;
const SWEEP_ID_RE = /\bID:\s*([A-Za-z0-9]{6})\b/gi;

/** IDs referenced by the sweep log, which records them as `(ID: ABC123)`. */
export function idsFromSweepLog(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(SWEEP_ID_RE)) {
    if (ID_RE.test(match[1])) ids.add(match[1]);
  }
  return [...ids];
}

/** IDs declared by agent blocks in one note. */
export function idsFromNote(content: string): string[] {
  const ids = new Set<string>();
  for (const block of parseAgentBlocks(content)) {
    if (block.id && ID_RE.test(block.id)) ids.add(block.id);
  }
  return [...ids];
}

interface CacheEntry {
  signature: string;
  ids: string[];
}

/**
 * Cached reserved-ID set. The cache is keyed on the in-memory index signature
 * (relPath + mtime + size), so a vault change or reindex invalidates it without
 * re-reading every note on each request.
 */
export class AgentIdIndex {
  private cache: CacheEntry | null = null;

  constructor(private readonly service: VaultService) {}

  private signature(): string {
    return [...this.service.index.notes.values()]
      .map((note) => `${note.meta.relPath}:${note.meta.mtimeMs}:${note.meta.size}`)
      .sort()
      .join("|");
  }

  async reserved(): Promise<string[]> {
    const signature = this.signature();
    if (this.cache && this.cache.signature === signature) return this.cache.ids;

    const ids = new Set<string>();
    for (const note of this.service.index.notes.values()) {
      try {
        const full = await this.service.provider.readDocument(note.meta.relPath);
        if (full?.content) for (const id of idsFromNote(full.content)) ids.add(id);
      } catch {
        // A note that vanished mid-scan is simply skipped.
      }
    }

    if (this.service.index.notes.has(SWEEP_LOG_PATH)) {
      try {
        const sweep = await this.service.provider.readDocument(SWEEP_LOG_PATH);
        if (sweep?.content) for (const id of idsFromSweepLog(sweep.content)) ids.add(id);
      } catch {
        // Absent sweep log is not an error.
      }
    }

    const sorted = [...ids].sort();
    this.cache = { signature, ids: sorted };
    return sorted;
  }
}
