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
  excludePath: string;
  ids: string[];
}

/**
 * Cached reserved-ID set. The cache is keyed on the in-memory index signature
 * (relPath + mtime + size) plus the excluded note, so a vault change or reindex
 * invalidates it without re-reading every note on each request.
 */
export class AgentIdIndex {
  private cache: CacheEntry | null = null;
  private externalCache: { signature: string; ids: string[] } | null = null;

  constructor(private readonly service: VaultService) {}

  private signature(): string {
    return [...this.service.index.notes.values()]
      .map((note) => `${note.meta.relPath}:${note.meta.mtimeMs}:${note.meta.size}`)
      .sort()
      .join("|");
  }

  /** IDs referenced by Agent_Sweep_Log.md only — the source-less external set. */
  async externalReserved(): Promise<string[]> {
    const signature = this.signature();
    if (this.externalCache && this.externalCache.signature === signature)
      return this.externalCache.ids;
    const ids = new Set<string>();
    if (this.service.index.notes.has(SWEEP_LOG_PATH)) {
      try {
        const sweep = await this.service.provider.readDocument(SWEEP_LOG_PATH);
        if (sweep?.content) for (const id of idsFromSweepLog(sweep.content)) ids.add(id);
      } catch {
        // Absent sweep log is not an error.
      }
    }
    const sorted = [...ids].sort();
    this.externalCache = { signature, ids: sorted };
    return sorted;
  }

  /**
   * Reserved IDs across the vault plus the sweep log. Pass `excludePath` (the
   * note being validated) so its own agent blocks are not reported as reserved
   * collisions — R3 must not flag the block that is being edited.
   */
  async reserved(excludePath?: string): Promise<string[]> {
    const signature = this.signature();
    if (
      this.cache &&
      this.cache.signature === signature &&
      this.cache.excludePath === (excludePath ?? "")
    )
      return this.cache.ids;

    const ids = new Set<string>();
    for (const note of this.service.index.notes.values()) {
      if (excludePath && note.meta.relPath === excludePath) continue;
      try {
        const full = await this.service.provider.readDocument(note.meta.relPath);
        if (full?.content) for (const id of idsFromNote(full.content)) ids.add(id);
      } catch {
        // A note that vanished mid-scan is simply skipped.
      }
    }

    for (const id of await this.externalReserved()) ids.add(id);

    const sorted = [...ids].sort();
    this.cache = { signature, excludePath: excludePath ?? "", ids: sorted };
    return sorted;
  }
}
