import { setFrontmatterField } from "../shared/frontmatter.js";
import { sha256 } from "./obsidian-filesystem-provider.js";
import type { VaultService } from "./vault-service.js";

export function etagFor(mtimeMs: number, contentHash: string): string {
  return `"${Math.trunc(mtimeMs).toString(16)}-${contentHash.slice(0, 16)}"`;
}
export function parseIfMatch(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0].trim();
  return /^"[0-9a-f]+-[0-9a-f]{16}"$/i.test(first) ? first : null;
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
