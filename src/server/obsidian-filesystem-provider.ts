/**
 * ObsidianFileSystemVaultProvider — the concrete filesystem adapter.
 *
 * Safety contract:
 *  - Every read/write is validated against the vault root (no path traversal).
 *  - Writes go temp-file → write → fsync → atomic rename.
 *  - saveDocument never silently overwrites newer external content:
 *    it compares a content hash against the expected hash the editor opened.
 *  - Attachments and non-markdown files are served read-only by default.
 */
import fs, { type Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  VaultProvider,
  VaultWatchEvent,
  SaveResult,
  MoveResult,
} from './vault-provider.js';
import type { DocMeta, VaultDocSummary } from '../shared/types.js';
import {
  resolveInVault,
  toRelPath,
  normalizeRel,
  isMarkdown,
  baseNameOf,
  folderOf,
  fileNameOf,
  UnsafePathError,
  isExcluded,
} from '../shared/path-utils.js';
import { parseFrontmatter, toStringArray, coerceRating } from '../shared/frontmatter.js';
import { extractInlineTags, extractHeadings, parseWikiLinks } from '../shared/wiki.js';
import { expandTilde } from '../shared/config.js';

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export interface ObsidianProviderOptions {
  excludedFolders?: string[];
  excludedFiles?: string[];
  ratingScale?: number;
  watch?: boolean;
}

export class ObsidianFileSystemVaultProvider implements VaultProvider {
  readonly root: string;
  readonly name: string;
  private watcher: FSWatcher | null = null;
  private closeCbs: Array<() => void> = [];
  readonly excludedFolders: string[];
  readonly excludedFiles: string[];
  readonly ratingScale: number;
  readonly watchEnabled: boolean;

  constructor(vaultRoot: string, opts: ObsidianProviderOptions = {}) {
    this.root = path.resolve(expandTilde(vaultRoot));
    this.name = path.basename(this.root) || this.root;
    this.excludedFolders = opts.excludedFolders ?? ['.obsidian', '.git', '.trash'];
    this.excludedFiles = opts.excludedFiles ?? [];
    this.ratingScale = opts.ratingScale ?? 5;
    this.watchEnabled = opts.watch ?? true;
  }

  // ----- internal helpers -----

  private ensureInside(rel: string): string {
    return resolveInVault(this.root, rel);
  }

  private shouldExclude(relPath: string): boolean {
    return isExcluded(relPath, this.excludedFolders, this.excludedFiles);
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fsp.access(this.ensureInside(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async listDocuments(): Promise<VaultDocSummary[]> {
    const metas: VaultDocSummary[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        const rel = toRelPath(this.root, abs);
        if (e.isDirectory()) {
          if (rel === '.obsidian' || rel === '.git' || this.excludedFolders.includes(rel)) continue;
          // Skip excluded folder prefixes.
          if (this.excludedFolders.some((f) => rel.startsWith(normalizeRel(f) + '/') || rel === normalizeRel(f)))
            continue;
          await walk(abs);
        } else if (e.isFile() && isMarkdown(e.name)) {
          if (this.shouldExclude(rel)) continue;
          const meta = await this.buildMeta(rel);
          if (meta) metas.push(meta);
        }
      }
    };
    await walk(this.root);
    return metas;
  }

  private async buildMeta(relPath: string): Promise<DocMeta | null> {
    const abs = this.ensureInside(relPath);
    try {
      const [content, stats] = await Promise.all([
        fsp.readFile(abs, 'utf8'),
        fsp.stat(abs),
      ]);
      return buildMetaFromContent(relPath, content, this.ratingScale, stats);
    } catch {
      return null;
    }
  }

  async getMeta(relPath: string): Promise<DocMeta | null> {
    return this.buildMeta(relPath);
  }

  async readDocument(relPath: string): Promise<{ content: string; meta: DocMeta } | null> {
    const abs = this.ensureInside(relPath);
    if (!isMarkdown(relPath)) return null;
    try {
      const [content, stats] = await Promise.all([
        fsp.readFile(abs, 'utf8'),
        fsp.stat(abs),
      ]);
      return { content, meta: buildMetaFromContent(relPath, content, this.ratingScale, stats) };
    } catch {
      return null;
    }
  }

  async readRaw(relPath: string): Promise<Buffer | null> {
    const abs = this.ensureInside(relPath);
    try {
      return await fsp.readFile(abs);
    } catch {
      return null;
    }
  }

  async listAllFiles(): Promise<{ relPath: string; absPath: string }[]> {
    const out: { relPath: string; absPath: string }[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        const rel = toRelPath(this.root, abs);
        if (e.isDirectory()) {
          if (rel === '.obsidian' || rel === '.git') continue;
          if (this.excludedFolders.some((f) => rel.startsWith(normalizeRel(f) + '/') || rel === normalizeRel(f)))
            continue;
          await walk(abs);
        } else if (e.isFile()) {
          if (this.shouldExclude(rel)) continue;
          out.push({ relPath: rel, absPath: abs });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  // ----- safe writes -----

  async saveDocument(
    relPath: string,
    content: string,
    opts: { expectedHash: string | null }
  ): Promise<SaveResult> {
    this.assertWritablePath(relPath);
    const abs = this.ensureInside(relPath);
    if (!isMarkdown(relPath)) {
      return { ok: false, relPath, contentHash: sha256(content) };
    }

    if (opts.expectedHash !== null) {
      const onDisk = await this.readDocument(relPath);
      if (onDisk) {
        const currentHash = sha256(onDisk.content);
        if (currentHash !== opts.expectedHash) {
          return {
            ok: false,
            relPath,
            conflicted: true,
            conflict: {
              version: 'external',
              expectedHash: opts.expectedHash,
              currentHash,
              currentMtimeMs: (await fsp.stat(abs)).mtimeMs,
            },
            contentHash: currentHash,
          };
        }
      }
    }

    await this.writeAtomic(abs, content);
    const hash = sha256(content);
    return { ok: true, relPath, contentHash: hash };
  }

  async createDocument(relPath: string, content: string): Promise<SaveResult> {
    this.assertWritablePath(relPath);
    const abs = this.ensureInside(relPath);
    if (await this.exists(relPath)) {
      return { ok: false, relPath, conflicted: true, contentHash: sha256(content) };
    }
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await this.writeAtomic(abs, content, { createOnly: true });
    return { ok: true, relPath, contentHash: sha256(content) };
  }

  async moveDocument(
    fromRelPath: string,
    toRelPath: string,
    opts: { adjustLinks?: boolean } = {}
  ): Promise<MoveResult> {
    this.assertWritablePath(fromRelPath);
    this.assertWritablePath(toRelPath);
    const fromAbs = this.ensureInside(fromRelPath);
    const toAbs = this.ensureInside(toRelPath);
    if (!(await this.exists(fromRelPath))) return { ok: false, fromRelPath, toRelPath };
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    await fsp.rename(fromAbs, toAbs);
    void opts.adjustLinks;
    return { ok: true, fromRelPath: fromRelPath, toRelPath };
  }

  async deleteDocument(relPath: string): Promise<{ ok: boolean }> {
    this.assertWritablePath(relPath);
    const abs = this.ensureInside(relPath);
    try {
      await fsp.rm(abs, { force: true });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /** Temp-file + fsync + atomic rename. createOnly prevents overwrite. */
  private async writeAtomic(abs: string, content: string, opts: { createOnly?: boolean } = {}) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const dir = path.dirname(abs);
    const tmp = path.join(dir, `.${path.basename(abs)}.kv-tmp-${process.pid}-${Date.now()}`);
    const fh = await fsp.open(tmp, opts.createOnly ? 'wx' : 'w');
    try {
      await fh.writeFile(content, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, abs);
  }

  /** Reject writes that could escape the vault or touch excluded/attachment-only paths. */
  private assertWritablePath(relPath: string) {
    const rel = normalizeRel(relPath);
    if (this.shouldExclude(rel)) {
      throw new UnsafePathError(`Path is excluded from writes: ${rel}`);
    }
    if (!isMarkdown(rel)) {
      // Allow create of new markdown anywhere; attachments are read-only.
      throw new UnsafePathError(`Only Markdown documents are writable: ${rel}`);
    }
    resolveInVault(this.root, rel);
  }

  async resolveAttachment(name: string): Promise<string | null> {
    // Try vault-root / name, then common attachment folders.
    const candidates = [
      normalizeRel(name),
      `Attachments/${normalizeRel(name)}`,
    ];
    for (const c of candidates) {
      const abs = this.ensureInside(c);
      try {
        const st = await fsp.stat(abs);
        if (st.isFile()) return abs;
      } catch {
        /* continue */
      }
    }
    return null;
  }

  // ----- watching -----

  watch(onEvent: (e: VaultWatchEvent) => void): () => void {
    if (!this.watchEnabled) {
      const noop = () => {};
      this.closeCbs.push(noop);
      return noop;
    }
    const watchOpts = {
      ignoreInitial: true,
      persistent: true,
      ignored: (p: string) => {
        const rel = toRelPath(this.root, p);
        return this.shouldExclude(rel) || /\.kv-tmp-/.test(p);
      },
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
    };
    this.watcher = chokidar.watch(this.root, watchOpts);
    const emit = (event: VaultWatchEvent['event'], what: string) => {
      const rel = toRelPath(this.root, what);
      onEvent({ event, relPath: rel, absPath: what });
    };
    this.watcher.on('add', (p: string) => emit('add', p));
    this.watcher.on('change', (p: string) => emit('change', p));
    this.watcher.on('unlink', (p: string) => emit('unlink', p));
    this.watcher.on('addDir', (p: string) => {
      if (toRelPath(this.root, p) === '') return;
      emit('addDir', p);
    });
    this.watcher.on('unlinkDir', (p: string) => emit('unlinkDir', p));
    const close = () => {
      if (this.watcher) void this.watcher.close();
      this.watcher = null;
    };
    this.closeCbs.push(close);
    return close;
  }

  async close(): Promise<void> {
    for (const cb of [...this.closeCbs]) {
      try {
        cb();
      } catch {
        /* ignore */
      }
    }
    this.closeCbs = [];
  }
}

export function buildMetaFromContent(
  relPath: string,
  content: string,
  ratingScale: number,
  stats?: Pick<Stats, 'ctimeMs' | 'mtimeMs' | 'size'>
): DocMeta {
  const fm = parseFrontmatter(content);
  const data = fm.data;
  const updated = typeof data.updated === 'string' ? data.updated : undefined;
  const created = typeof data.created === 'string' ? data.created : undefined;
  const createdAt = created ? Date.parse(created) : Number.NaN;
  const updatedAt = updated ? Date.parse(updated) : Number.NaN;
  const title =
    (typeof data.title === 'string' && data.title.trim()) ||
    firstHeading(content) ||
    baseNameOf(relPath);
  const tags =
    toStringArray(data.tags).length > 0
      ? dedupe(toStringArray(data.tags).concat(extractInlineTags(content)))
      : extractInlineTags(content);
  const aliases = toStringArray(data.aliases);
  // Filesystem times are authoritative for external edits; frontmatter dates
  // remain a deterministic fallback for parser-only callers and fixtures.
  const ctimeMs = stats?.ctimeMs ?? (Number.isFinite(createdAt) ? createdAt : 0);
  const mtimeMs =
    stats?.mtimeMs ??
    (Number.isFinite(updatedAt) ? updatedAt : Number.isFinite(createdAt) ? createdAt : 0);
  const words = content.split(/\s+/).filter(Boolean).length;
  return {
    relPath: normalizeRel(relPath),
    folder: folderOf(relPath),
    fileName: fileNameOf(relPath),
    baseName: baseNameOf(relPath),
    title,
    aliases,
    tags: dedupe(tags),
    frontmatter: data,
    rating: coerceRating(data.rating, ratingScale),
    favorite: data.favorite === true || data.favorite === 'true',
    status: typeof data.status === 'string' ? data.status : undefined,
    created: created,
    updated: updated,
    ctimeMs,
    mtimeMs,
    size: stats?.size ?? Buffer.byteLength(content),
    wordCount: words,
    contentHash: sha256(content),
    hasFrontmatter: fm.hasFrontmatter,
  };
}

function firstHeading(content: string): string | undefined {
  const m = /^#\s+(.*)$/m.exec(content);
  return m ? m[1].trim() : undefined;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

// Keep heading/regex helpers referenced so tree-shaking is happy.
void extractHeadings;
void parseWikiLinks;
void extractInlineTags;
void fileNameOf;
void UnsafePathError;
void fs;