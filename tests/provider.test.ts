import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ObsidianFileSystemVaultProvider, sha256 } from '../src/server/obsidian-filesystem-provider.js';
import { UnsafePathError } from '../src/shared/path-utils.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kv-provider-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const mk = (p: string, c: string) => {
  const abs = path.join(dir, p);
  return fs.mkdir(path.dirname(abs), { recursive: true }).then(() => fs.writeFile(abs, c, 'utf8'));
};

describe('ObsidianFileSystemVaultProvider', () => {
  it('lists markdown documents and ignores non-md and excluded folders', async () => {
    await mk('a.md', '# A');
    await mk('sub/b.md', '# B');
    await mk('sub/c.txt', 'text');
    await mk('.obsidian/x.md', '# hidden');
    const p = new ObsidianFileSystemVaultProvider(dir);
    const docs = await p.listDocuments();
    expect(docs.map((d) => d.relPath).sort()).toEqual(['a.md', 'sub/b.md']);
  });

  it('uses real filesystem timestamps in document metadata', async () => {
    await mk('dated.md', '# Dated');
    const desired = new Date('2026-08-15T12:34:56.000Z');
    await fs.utimes(path.join(dir, 'dated.md'), desired, desired);
    const p = new ObsidianFileSystemVaultProvider(dir, { watch: false });
    const doc = await p.readDocument('dated.md');
    expect(Math.abs((doc?.meta.mtimeMs ?? 0) - desired.getTime())).toBeLessThan(1_000);
    expect(doc?.meta.ctimeMs).toBeGreaterThan(0);
    expect(doc?.meta.size).toBe(Buffer.byteLength('# Dated'));
    await p.close();
  });

  it('creates documents and reports existence', async () => {
    const p = new ObsidianFileSystemVaultProvider(dir);
    const r = await p.createDocument('notes/new.md', '# New');
    expect(r.ok).toBe(true);
    expect(await p.exists('notes/new.md')).toBe(true);
    // Duplicate create fails (no silent overwrite).
    const dup = await p.createDocument('notes/new.md', '# New');
    expect(dup.ok).toBe(false);
  });

  it('safe write: rejects conflicting external modification', async () => {
    await mk('doc.md', 'version 1');
    const p = new ObsidianFileSystemVaultProvider(dir);
    const { meta } = (await p.readDocument('doc.md'))!;
    const mine = sha256('version 1');
    const res = await p.saveDocument('doc.md', 'version 2 mine', { expectedHash: mine });
    expect(res.ok).toBe(true);
    // Now simulate external change and try to overwrite from our stale baseline.
    await fs.writeFile(path.join(dir, 'doc.md'), 'version 3 external', 'utf8');
    const stale = sha256('version 2 mine');
    const conflict = await p.saveDocument('doc.md', 'version 4', { expectedHash: stale });
    expect(conflict.ok).toBe(false);
    expect(conflict.conflicted).toBe(true);
    expect(conflict.conflict?.currentHash).toBe(sha256('version 3 external'));
    // On-disk content must not have been overwritten.
    expect((await fs.readFile(path.join(dir, 'doc.md'), 'utf8'))).toBe('version 3 external');
  });

  it('forced write (expectedHash null) overwrites', async () => {
    await mk('doc.md', 'v1');
    const p = new ObsidianFileSystemVaultProvider(dir);
    const res = await p.saveDocument('doc.md', 'v2 forced', { expectedHash: null });
    expect(res.ok).toBe(true);
    expect(await fs.readFile(path.join(dir, 'doc.md'), 'utf8')).toBe('v2 forced');
  });

  it('move and delete documents', async () => {
    await mk('a.md', '# A');
    const p = new ObsidianFileSystemVaultProvider(dir);
    const moved = await p.moveDocument('a.md', 'sub/a.md');
    expect(moved.ok).toBe(true);
    expect(await p.exists('sub/a.md')).toBe(true);
    expect(await p.exists('a.md')).toBe(false);
    const del = await p.deleteDocument('sub/a.md');
    expect(del.ok).toBe(true);
    expect(await p.exists('sub/a.md')).toBe(false);
  });

  it('rejects writes that escape the vault or touch excluded paths', async () => {
    const p = new ObsidianFileSystemVaultProvider(dir);
    await expect(p.saveDocument('../evil.md', 'x', { expectedHash: null })).rejects.toThrow(UnsafePathError);
    await expect(p.saveDocument('.obsidian/secret.md', 'x', { expectedHash: null })).rejects.toThrow(UnsafePathError);
    await expect(p.saveDocument('notes/not-md.txt', 'x', { expectedHash: null })).rejects.toThrow(UnsafePathError);
  });

  it('preserves unrelated YAML when rating via frontmatter field set', async () => {
    const original = `---
type: concept
status: draft
created: 2026-01-01
tags:
  - a
  - b
customBlock: |
  multiline
---

# Body`;
    await mk('doc.md', original);
    const p = new ObsidianFileSystemVaultProvider(dir);
    const { content } = (await p.readDocument('doc.md'))!;
    const { setFrontmatterField } = await import('../src/shared/frontmatter.js');
    const updated = setFrontmatterField(content, 'rating', 4);
    const out = await p.saveDocument('doc.md', updated, { expectedHash: sha256(content) });
    expect(out.ok).toBe(true);
    const finalText = await fs.readFile(path.join(dir, 'doc.md'), 'utf8');
    expect(finalText).toContain('rating: 4');
    expect(finalText).toContain('type: concept');
    expect(finalText).toContain('created: 2026-01-01');
    expect(finalText).toContain('customBlock: |');
  });
});