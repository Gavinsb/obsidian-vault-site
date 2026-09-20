/**
 * VaultService orchestrates the provider, index, watcher, history, and backup.
 * It is the single seam the API routes talk to. It also re-indexes what
 * changed while the app was offline (reconciliation on start, §2).
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { VaultProvider } from "./vault-provider.js";
import {
  buildMetaFromContent,
  type ObsidianFileSystemVaultProvider,
} from "./obsidian-filesystem-provider.js";
import { readDocumentMetaAndContent } from "./doc-io.js";
import { KnowledgeIndex } from "./indexer.js";
import { ChangeHistory, type HistoryEntry } from "./history.js";
import type { AppConfig } from "../shared/config.js";
import { maskAgentBlocks } from "../shared/agent-blocks.js";
import type {
  DocMeta,
  Document,
  VaultDocSummary,
  IndexStats,
  VaultOverview,
} from "../shared/types.js";

export interface SyncState {
  state: "synced" | "indexing" | "detected" | "conflict";
  pendingFiles: number;
  detail?: string;
}

export class VaultService {
  readonly provider: VaultProvider;
  readonly index = new KnowledgeIndex();
  readonly history = new ChangeHistory();
  private config: AppConfig;
  private watcherCleanup: (() => void) | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private syncState: SyncState = { state: "synced", pendingFiles: 0 };
  private listeners = new Set<(s: SyncState) => void>();
  private recentExternal = new Set<string>();

  constructor(provider: VaultProvider, config: AppConfig) {
    this.provider = provider;
    this.config = config;
  }

  setSyncState(state: SyncState) {
    this.syncState = state;
    for (const l of this.listeners) l(state);
  }

  onSyncChange(l: (s: SyncState) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async start() {
    await this.reconcile();
    if (this.config.fileWatching) {
      this.watcherCleanup = this.provider.watch((e) =>
        this.handleWatchEvent(e),
      );
    }
  }

  /** Full rebuild of the index from source (also reconciliation). */
  async reconcile(): Promise<number> {
    this.setSyncState({
      state: "indexing",
      pendingFiles: 0,
      detail: "Scanning vault…",
    });
    const docsPromise = this.provider.listDocuments();
    const files = await docsPromise;
    const withContent: Array<{ meta: DocMeta; content: string }> = [];
    this.setSyncState({
      state: "indexing",
      pendingFiles: files.length,
      detail: `Reading ${files.length} documents…`,
    });
    for (const summary of files) {
      const full = await this.provider.readDocument(summary.relPath);
      if (full) withContent.push(this.publicIndexEntry(full));
    }
    const count = await this.index.rebuild(async () => withContent);
    this.setSyncState({ state: "synced", pendingFiles: 0 });
    return count;
  }

  private handleWatchEvent(e: {
    event: string;
    relPath?: string;
    absPath: string;
  }) {
    const relPath = e.relPath ?? "";
    if (!relPath) return; // ignore root
    if (!/\.md$/i.test(relPath)) return; // attachments handled via raw reads
    if (this.recentExternal.has(relPath) && e.event === "unlink") {
      this.recentExternal.delete(relPath);
    }
    this.setSyncState({
      state: "detected",
      pendingFiles: this.debounceTimers.size + 1,
      detail: relPath,
    });

    // Debounce rapid successive events for the same file.
    const existing = this.debounceTimers.get(relPath);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      relPath,
      setTimeout(() => {
        this.debounceTimers.delete(relPath);
        void this.applyWatchEvent(
          e.event as "add" | "change" | "unlink",
          relPath,
        ).then(() => {
          const pending = this.debounceTimers.size;
          if (pending === 0)
            this.setSyncState({ state: "synced", pendingFiles: 0 });
          else this.setSyncState({ state: "detected", pendingFiles: pending });
        });
      }, 350),
    );
    void e.absPath;
  }

  private async applyWatchEvent(
    event: "add" | "change" | "unlink",
    relPath: string,
  ) {
    if (event === "unlink") {
      this.index.removeNote(relPath);
      this.history.push("deleted", relPath, this.index);
      return;
    }
    const full = await this.provider.readDocument(relPath);
    if (!full) return;
    const existing = this.index.notes.get(relPath);
    const isNew = !existing;
    this.index.upsertNote(...this.publicIndexArgs(full));
    this.history.push(isNew ? "created" : "modified", relPath, this.index);
    // Rename detection.
    this.history.detectRename(this.index);
  }

  private publicIndexEntry(full: { meta: DocMeta; content: string }) {
    const content = maskAgentBlocks(full.content);
    const meta = buildMetaFromContent(
      full.meta.relPath,
      content,
      this.config.ratingScale,
      {
        ctimeMs: full.meta.ctimeMs,
        mtimeMs: full.meta.mtimeMs,
        size: full.meta.size,
      },
    );
    return { meta, content };
  }

  private publicIndexArgs(full: {
    meta: DocMeta;
    content: string;
  }): [DocMeta, string] {
    const entry = this.publicIndexEntry(full);
    return [entry.meta, entry.content];
  }

  /** Stats & overview. */
  async overview(): Promise<VaultOverview> {
    const stats = this.index.stats();
    const folders = new Set<string>();
    for (const n of this.index.notes.values()) folders.add(n.meta.folder);
    return {
      name: this.provider.name,
      path: this.provider.root,
      docCount: this.index.notes.size,
      folderCount: folders.size,
      stats,
      lastIndexedAt: this.index.indexedAt,
      syncState: this.syncState.state,
      pendingFiles: this.syncState.pendingFiles,
    };
  }

  async getStats(): Promise<IndexStats> {
    return this.index.stats();
  }

  async listDocuments(): Promise<VaultDocSummary[]> {
    return [...this.index.notes.values()].map((n) => ({
      relPath: n.meta.relPath,
      title: n.meta.title,
      folder: n.meta.folder,
      tags: n.meta.tags ?? [],
      rating: n.meta.rating,
      status: n.meta.status,
      mtimeMs: n.meta.mtimeMs,
      ctimeMs: n.meta.ctimeMs,
      size: n.meta.size,
      aliases: n.meta.aliases ?? [],
    }));
  }

  async getDocument(relPath: string): Promise<Document | null> {
    const full = await this.provider.readDocument(relPath);
    if (!full) return null;
    const outgoing = [];
    // Build outgoing with resolution.
    for (const r of this.index.notes.get(relPath)?.outgoing ?? []) {
      const hits = this.index.resolveTarget(r.target);
      const targetRelPath = hits.size ? [...hits][0] : undefined;
      outgoing.push({
        target: r.target,
        alias: r.alias,
        heading: r.heading,
        resolved: hits.size > 0,
        targetRelPath,
      });
    }
    const backlinks = [];
    for (const src of this.index.backlinksOf(relPath)) {
      const srcMeta = this.index.notes.get(src)?.meta;
      backlinks.push({
        sourceRelPath: src,
        sourceTitle: srcMeta?.title ?? src,
        context: "", // filled by client via snippet if needed
      });
    }
    return { meta: full.meta, content: full.content, outgoing, backlinks };
  }

  async saveDocument(
    relPath: string,
    content: string,
    expectedHash: string | null,
  ) {
    const res = await this.provider.saveDocument(relPath, content, {
      expectedHash,
    });
    if (res.ok) {
      const full = await this.provider.readDocument(relPath);
      if (full) {
        this.index.upsertNote(...this.publicIndexArgs(full));
        this.history.push("modified", relPath, this.index);
      }
    }
    return res;
  }

  async createDocument(relPath: string, content: string) {
    const res = await this.provider.createDocument(relPath, content);
    if (res.ok) {
      const full = await this.provider.readDocument(relPath);
      if (full) {
        this.index.upsertNote(...this.publicIndexArgs(full));
        this.history.push("created", relPath, this.index);
      }
    }
    return res;
  }

  async moveDocument(from: string, to: string) {
    const res = await this.provider.moveDocument(from, to);
    if (res.ok) {
      const full = await this.provider.readDocument(to);
      if (full) {
        this.index.upsertNote(...this.publicIndexArgs(full));
        this.history.push("renamed", `${from} -> ${to}`, this.index);
      }
    }
    return res;
  }

  async deleteDocument(relPath: string) {
    // Optional backup before destructive operation.
    if (this.config.backupBeforeDestructive) {
      try {
        const full = await this.provider.readDocument(relPath);
        if (full) await this.backup(relPath, full.content);
      } catch {
        /* non-fatal */
      }
    }
    const res = await this.provider.deleteDocument(relPath);
    if (res.ok) this.history.push("deleted", relPath, this.index);
    return res;
  }

  private async backup(relPath: string, content: string) {
    const dir = path.join(this.config.backupDir, path.dirname(relPath));
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${path.basename(relPath)}.${stamp}.bak`);
    await fs.writeFile(file, content, "utf8");
  }

  recentChanges(): HistoryEntry[] {
    return this.history.all();
  }

  async close() {
    if (this.watcherCleanup) {
      this.watcherCleanup();
      this.watcherCleanup = null;
    }
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    await this.provider.close();
  }
}

export type { VaultProvider, ObsidianFileSystemVaultProvider };
export { readDocumentMetaAndContent };
