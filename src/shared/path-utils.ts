/**
 * Path helpers with strict vault-relative validation.
 * All filesystem access must go through resolveInVault to prevent path
 * traversal and writes outside the configured vault.
 */
import path from 'node:path';

export class UnsafePathError extends Error {}

/** Normalise a vault-relative path to POSIX form with no leading slash. */
export function normalizeRel(rel: string): string {
  let r = rel.replace(/\\/g, '/');
  r = r.replace(/^\/+/, '');
  r = path.posix.normalize(r);
  if (r === '.' || r === './') r = '';
  return r;
}

/**
 * Resolve a vault-relative path to an absolute path, guaranteeing the result
 * stays inside the vault root. Rejects traversal, absolute escapes, and NUL.
 */
export function resolveInVault(vaultRoot: string, rel: string): string {
  if (rel.includes('\0')) throw new UnsafePathError('Path contains NUL byte');
  const root = path.resolve(vaultRoot);
  const norm = normalizeRel(rel);
  if (path.isAbsolute(rel) && !norm) throw new UnsafePathError('Empty path');
  const abs = path.resolve(root, norm);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new UnsafePathError(`Path escapes vault: ${rel}`);
  }
  return abs;
}

/** Convert an absolute path back to a vault-relative POSIX path. */
export function toRelPath(vaultRoot: string, abs: string): string {
  return normalizeRel(path.relative(path.resolve(vaultRoot), path.resolve(abs)));
}

export function isMarkdown(p: string): boolean {
  return /\.md$/i.test(p);
}

/** Folder portion of a rel path ('' when at root). */
export function folderOf(relPath: string): string {
  const norm = normalizeRel(relPath);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

export function baseNameOf(relPath: string): string {
  const norm = normalizeRel(relPath);
  const idx = norm.lastIndexOf('/');
  const file = idx === -1 ? norm : norm.slice(idx + 1);
  return file.replace(/\.md$/i, '');
}

export function fileNameOf(relPath: string): string {
  const norm = normalizeRel(relPath);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

/** Strip characters that are illegal in Obsidian filenames. */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function isExcluded(
  relPath: string,
  excludedFolders: string[],
  excludedFiles: string[]
): boolean {
  const norm = normalizeRel(relPath);
  const file = fileNameOf(norm);
  if (excludedFiles.some((f) => f === file || f === norm)) return true;
  return excludedFolders.some((f) => {
    const nf = normalizeRel(f);
    return norm === nf || norm.startsWith(nf + '/');
  });
}

/** True when the path is inside an attachment folder. */
export function isAttachment(relPath: string, attachmentFolders: string[]): boolean {
  const norm = normalizeRel(relPath);
  return attachmentFolders.some((f) => {
    const nf = normalizeRel(f);
    return norm.startsWith(nf + '/') || folderOf(norm) === nf;
  });
}
