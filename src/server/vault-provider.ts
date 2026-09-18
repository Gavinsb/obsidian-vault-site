/**
 * VaultProvider interface.
 *
 * The rest of the application depends only on this contract, never on
 * Obsidian-specific filesystem code. Alternative storage backends (remote
 * vaults, plugged-in sync, databases) can be added later without touching the
 * UI or the API layer (§29).
 */
import type { DocMeta, VaultDocSummary } from '../shared/types.js';

export type WatchEventName = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface VaultWatchEvent {
  event: WatchEventName;
  /** Vault-relative path (files). */
  relPath?: string;
  /** Absolute path. */
  absPath: string;
}

export interface SaveResult {
  ok: boolean;
  relPath: string;
  conflicted?: boolean;
  conflict?: ConflictInfo;
  contentHash: string;
}

export interface ConflictInfo {
  version: 'external';
  /** Hash the client based its edit on (now stale). */
  expectedHash: string;
  /** Hash of the file on disk when the write arrived. */
  currentHash: string;
  currentMtimeMs: number;
}

export interface MoveResult {
  ok: boolean;
  fromRelPath: string;
  toRelPath: string;
  adjusted?: boolean;
}

export interface VaultProvider {
  readonly root: string;
  /** Names of the vault (basename of the root). */
  readonly name: string;

  listDocuments(): Promise<VaultDocSummary[]>;
  readDocument(relPath: string): Promise<{ content: string; meta: DocMeta } | null>;
  /** Read raw bytes (for attachments / non-markdown files). */
  readRaw(relPath: string): Promise<Buffer | null>;
  getMeta(relPath: string): Promise<DocMeta | null>;

  /**
   * Atomic safe write. `expectedHash` is the hash the editor started from.
   * When it differs from the file on disk, a conflict is returned instead of
   * overwriting. Pass expectedHash=null to force-overwrite.
   */
  saveDocument(
    relPath: string,
    content: string,
    opts: { expectedHash: string | null }
  ): Promise<SaveResult>;

  createDocument(relPath: string, content: string): Promise<SaveResult>;
  moveDocument(fromRelPath: string, toRelPath: string, opts?: { adjustLinks?: boolean }): Promise<MoveResult>;
  deleteDocument(relPath: string): Promise<{ ok: boolean }>;
  exists(relPath: string): Promise<boolean>;

  /** Enumerate all files (including attachments) under the vault. */
  listAllFiles(): Promise<{ relPath: string; absPath: string }[]>;

  /** Location of an attachment file by its Obsidian-resolved name. */
  resolveAttachment(name: string): Promise<string | null>;

  watch(onEvent: (e: VaultWatchEvent) => void): () => void;
  close(): Promise<void>;
}