/**
 * Knowledge Health: surfaces issues and opportunities without modifying the
 * vault. Everything here is derived state for review.
 */
import type { KnowledgeIndex } from './indexer.js';
import type { HealthIssue } from '../shared/types.js';

export interface HealthOptions {
  /** Markdown files that are essentially empty. */
  emptyThresholdWords?: number;
  /** Notes not modified within this many days are "stale". */
  staleDays?: number;
  /** Notes shorter than this many words are "minimal". */
  minimalWords?: number;
  now?: number;
}

export function computeHealth(
  index: KnowledgeIndex,
  opts: HealthOptions = {}
): HealthIssue[] {
  const now = opts.now ?? Date.now();
  const emptyWords = opts.emptyThresholdWords ?? 5;
  const staleMs = (opts.staleDays ?? 365) * 86400000;
  const minimalWords = opts.minimalWords ?? 40;

  const issues: HealthIssue[] = [];

  // Orphans: no incoming links and no outgoing resolved links.
  for (const n of index.notes.values()) {
    const backlinks = index.backlinksOf(n.meta.relPath).size;
    const hasOutgoingResolved = n.outgoingTargets.some((t) => index.resolveTarget(t).size > 0);
    if (backlinks === 0 && !hasOutgoingResolved) {
      issues.push({
        kind: 'orphan',
        severity: 'warn',
        relPath: n.meta.relPath,
        description: `Orphan note with no incoming links and no resolved outgoing links.`,
      });
    }
  }

  // Broken / unresolved links.
  for (const n of index.notes.values()) {
    for (const t of n.outgoingTargets) {
      if (index.resolveTarget(t).size === 0) {
        issues.push({
          kind: 'broken-link',
          severity: 'warn',
          relPath: n.meta.relPath,
          description: `Unresolved wiki link "[[${t}]]".`,
        });
      }
    }
  }

  // Pages with no incoming links.
  for (const n of index.notes.values()) {
    if (index.backlinksOf(n.meta.relPath).size === 0) {
      issues.push({
        kind: 'no-incoming',
        severity: 'info',
        relPath: n.meta.relPath,
        description: 'No incoming links (nothing links to this note).',
      });
    }
  }

  // Pages with no outgoing links.
  for (const n of index.notes.values()) {
    if (n.outgoing.length === 0) {
      issues.push({
        kind: 'no-outgoing',
        severity: 'info',
        relPath: n.meta.relPath,
        description: 'No outgoing links.',
      });
    }
  }

  // Empty documents.
  for (const n of index.notes.values()) {
    if (n.meta.wordCount <= emptyWords) {
      issues.push({
        kind: 'empty',
        severity: 'warn',
        relPath: n.meta.relPath,
        description: `Near-empty document (${n.meta.wordCount} words).`,
      });
    }
  }

  // Duplicate titles.
  const byTitle = new Map<string, string[]>();
  for (const n of index.notes.values()) {
    const key = n.meta.title.trim().toLowerCase();
    if (!key) continue;
    const arr = byTitle.get(key) ?? [];
    arr.push(n.meta.relPath);
    byTitle.set(key, arr);
  }
  for (const [title, paths] of byTitle) {
    if (paths.length > 1) {
      issues.push({
        kind: 'duplicate-title',
        severity: 'warn',
        description: `Duplicate title "${title}" across ${paths.length} notes: ${paths.join(', ')}.`,
      });
    }
  }

  // Missing attachments (raw image/embed targets that resolve to nothing).
  for (const n of index.notes.values()) {
    // Images referenced by markdown or embed are checked by the service against
    // the filesystem; here we only flag embed-style targets with common ext.
    const extRe = /\.(png|jpe?g|gif|webp|svg|pdf|mp3|mp4|mov)$/i;
    for (const t of n.outgoingTargets) {
      if (extRe.test(t) && index.resolveTarget(t).size === 0) {
        issues.push({
          kind: 'missing-attachment',
          severity: 'warn',
          relPath: n.meta.relPath,
          description: `References missing attachment "${t}".`,
        });
      }
    }
  }

  // Stale pages (not modified recently).
  for (const n of index.notes.values()) {
    const age = now - n.meta.mtimeMs;
    if (age > staleMs) {
      const days = Math.floor(age / 86400000);
      issues.push({
        kind: 'stale',
        severity: 'info',
        relPath: n.meta.relPath,
        description: `Not modified for ~${days} days.`,
      });
    }
  }

  // Minimal content.
  for (const n of index.notes.values()) {
    if (n.meta.wordCount > emptyWords && n.meta.wordCount < minimalWords) {
      issues.push({
        kind: 'minimal',
        severity: 'info',
        relPath: n.meta.relPath,
        description: `Very short document (${n.meta.wordCount} words).`,
      });
    }
  }

  // Unrated.
  for (const n of index.notes.values()) {
    if (n.meta.rating === undefined) {
      issues.push({
        kind: 'unrated',
        severity: 'info',
        relPath: n.meta.relPath,
        description: 'No rating set.',
      });
    }
  }

  return issues;
}

export function issueCountByKind(issues: HealthIssue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issues) out[i.kind] = (out[i.kind] ?? 0) + 1;
  return out;
}