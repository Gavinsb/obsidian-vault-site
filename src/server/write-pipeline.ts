import { setFrontmatterField } from "../shared/frontmatter.js";
import { sha256 } from "./obsidian-filesystem-provider.js";
import type { VaultService } from "./vault-service.js";

export function etagFor(mtimeMs: number, contentHash: string): string {
  return `"${Math.trunc(mtimeMs).toString(16)}-${contentHash.slice(0, 16)}"`;
}

const APP_ETAG_INNER = /^[0-9a-f]+-[0-9a-f]{16}$/i;

/**
 * Normalize a client `If-Match` value into the canonical strong app ETag.
 * Accepts the strong quoted form we emit, a weak `W/` prefix some proxies
 * apply, an unquoted transport loss, and a re-quoted value. Returns the
 * canonical `"mtime-hash16"` token, or null for anything malformed so the
 * caller can keep rejecting junk (wildcards, wrong shape, empty, unparsable).
 */
export function parseIfMatch(value: string | undefined): string | null {
  if (!value) return null;
  let token = value.split(",")[0].trim();
  token = token.replace(/^W\//i, "");
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    token = token.slice(1, -1);
  }
  if (!APP_ETAG_INNER.test(token)) return null;
  return `"${token.toLowerCase()}"`;
}
export function injectUpdated(content: string, now = new Date()): string {
  return setFrontmatterField(content, "updated", now.toISOString());
}

const locks = new Map<string, Promise<void>>();
async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  locks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export type WriteOutcome =
  | { status: 200; result: unknown; etag: string; content: string }
  | { status: 404 }
  | { status: 412; currentEtag: string; currentMtimeMs: number };
export async function conditionalSave(
  service: VaultService,
  relPath: string,
  content: string,
  ifMatch: string,
  now = new Date(),
): Promise<WriteOutcome> {
  return locked(relPath, async () => {
    const current = await service.provider.readDocument(relPath);
    if (!current) return { status: 404 };
    const currentEtag = etagFor(current.meta.mtimeMs, current.meta.contentHash);
    if (currentEtag !== ifMatch)
      return { status: 412, currentEtag, currentMtimeMs: current.meta.mtimeMs };
    const prepared = injectUpdated(content, now);
    const result = await service.saveDocument(
      relPath,
      prepared,
      sha256(current.content),
    );
    if (!result.ok) {
      const latest = await service.provider.readDocument(relPath);
      return {
        status: 412,
        currentEtag: latest
          ? etagFor(latest.meta.mtimeMs, latest.meta.contentHash)
          : currentEtag,
        currentMtimeMs: latest?.meta.mtimeMs ?? current.meta.mtimeMs,
      };
    }
    const saved = await service.provider.readDocument(relPath);
    if (!saved) return { status: 404 };
    return {
      status: 200,
      result,
      etag: etagFor(saved.meta.mtimeMs, saved.meta.contentHash),
      content: prepared,
    };
  });
}
