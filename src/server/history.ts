/**
 * Change tracking. Maintains a monotonic log of create/modify/delete/rename
 * events. Source of truth is the filesystem; this log is derived and can be
 * rebuilt by a rescan. When Git is present we also surface last-commit info
 * (optional).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChangeEvent, ChangeType } from '../shared/types.js';
import type { KnowledgeIndex } from './indexer.js';

export interface HistoryEntry extends ChangeEvent {
  seq: number;
}

export class ChangeHistory {
  private log: HistoryEntry[] = [];
  private seq = 0;
  private recentDeletes = new Map<string, { atMs: number; title?: string }>();

  push(type: ChangeType, relPath: string, index: KnowledgeIndex): HistoryEntry {
    const note = index.notes.get(relPath)?.meta;
    const entry: HistoryEntry = {
      seq: ++this.seq,
      type,
      relPath,
      atMs: Date.now(),
      rating: note?.rating,
      tags: note?.tags ?? [],
      title: note?.title,
    };
    if (type === 'deleted') {
      this.recentDeletes.set(relPath, { atMs: entry.atMs, title: entry.title });
    }
    this.log.push(entry);
    if (this.log.length > 5000) this.log = this.log.slice(-4000);
    return entry;
  }

  /** Primitive rename detection: a delete shortly followed by an add with same basename. */
  detectRename(index: KnowledgeIndex): HistoryEntry | null {
    const now = Date.now();
    for (const [relPath, info] of this.recentDeletes) {
      if (now - info.atMs > 15000) continue;
      const base = basename(relPath);
      for (const n of index.notes.values()) {
        if (basename(n.meta.relPath) === base && n.meta.relPath !== relPath) {
          this.recentDeletes.delete(relPath);
          const entry: HistoryEntry = {
            seq: ++this.seq,
            type: 'renamed',
            relPath: `${relPath} -> ${n.meta.relPath}`,
            atMs: now,
            rating: n.meta.rating,
            tags: n.meta.tags ?? [],
            title: n.meta.title,
          };
          this.log.push(entry);
          return entry;
        }
      }
    }
    return null;
  }

  /** All changes, newest first. */
  all(): HistoryEntry[] {
    return [...this.log].reverse();
  }

  /** Changes bucketed by recency for the "What's Changed?" view. */
  buckets(): {
    today: HistoryEntry[];
    yesterday: HistoryEntry[];
    thisWeek: HistoryEntry[];
    older: HistoryEntry[];
  } {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYesterday = startToday - 86400000;
    const dayMs = 86400000;
    const weekAgo = startToday - 7 * dayMs;
    const today: HistoryEntry[] = [];
    const yesterday: HistoryEntry[] = [];
    const thisWeek: HistoryEntry[] = [];
    const older: HistoryEntry[] = [];
    for (const e of this.all()) {
      if (e.atMs >= startToday) today.push(e);
      else if (e.atMs >= startYesterday) yesterday.push(e);
      else if (e.atMs >= weekAgo) thisWeek.push(e);
      else older.push(e);
    }
    return { today, yesterday, thisWeek, older };
  }

  /** Reset the log (used after a full rescan). */
  reset() {
    this.log = [];
    this.recentDeletes.clear();
  }

  staysCleanYear: number = 0;
}

function basename(relPath: string): string {
  return path.posix.basename(relPath);
}

/** Best-effort optional Git metadata for a file (empty when not in a repo). */
export async function gitStatusFor(root: string, relPath: string): Promise<{
  available: boolean;
  lastCommitDate?: string;
  lastCommitMessage?: string;
}> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = await import('node:child_process');
    return await new Promise((resolve) => {
      execFile(
        'git',
        ['-C', root, 'log', '-1', '--format=%cI|%s', '--', relPath],
        { timeout: 3000 },
        (err, stdout) => {
          if (err) return resolve({ available: false });
          const line = stdout.trim();
          if (!line) return resolve({ available: false });
          const [date, ...rest] = line.split('|');
          resolve({
            available: true,
            lastCommitDate: date,
            lastCommitMessage: rest.join('|'),
          });
        }
      );
    });
  } catch {
    return { available: false };
  }
}
void fs;