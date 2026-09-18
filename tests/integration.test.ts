import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ObsidianFileSystemVaultProvider, sha256 } from '../src/server/obsidian-filesystem-provider.js';
import { VaultService } from '../src/server/vault-service.js';
import { loadConfig } from '../src/shared/config.js';

let dir: string;
let service: VaultService;

function cfg(over: Partial<any> = {}) {
  return {
    ...(loadConfig as any).values ?? {},
    dataDir: path.join(dir, '.kv-data'),
    indexLocation: path.join(dir, '.kv-data', 'index.json'),
    backupDir: path.join(dir, '.kv-data', 'backups'),
    fileWatching: false,
    backupBeforeDestructive: true,
    ratingScale: 5,
    excludedFolders: ['.obsidian', '.git', '.kv-data'],
    excludedFiles: [],
    attachmentFolders: ['Attachments'],
    server: { host: '127.0.0.1', port: 0 },
    ...over,
  };
}

const mk = (p: string, c: string) => {
  const abs = path.join(dir, p);
  return fs.mkdir(path.dirname(abs), { recursive: true }).then(() => fs.writeFile(abs, c, 'utf8'));
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kv-svc-'));
  const provider = new ObsidianFileSystemVaultProvider(dir, {
    excludedFolders: ['.obsidian', '.git', '.kv-data'],
    watch: false,
  });
  service = new VaultService(provider, cfg() as any);
  await service.start();
});

afterEach(async () => {
  await service.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('VaultService', () => {
  it('indexes on start and exposes overview', async () => {
    await mk('A.md', '# A\nSee [[B]].');
    await mk('B.md', '# B');
    await service.reconcile();
    const ov = await service.overview();
    expect(ov.docCount).toBe(2);
    expect(ov.stats.linkCount).toBe(1);
  });

  it('ratings write into the source file frontmatter via service', async () => {
    const original = `---\ntype: concept\nstatus: draft\n---\n# X`;
    await mk('X.md', original);
    await service.reconcile();
    const full = await service.provider.readDocument('X.md');
    const updated = await import('../src/shared/frontmatter.js').then((m) =>
      m.setFrontmatterField(full!.content, 'rating', 5)
    );
    const res = await service.saveDocument('X.md', updated, sha256(full!.content));
    expect(res.ok).toBe(true);
    const text = await fs.readFile(path.join(dir, 'X.md'), 'utf8');
    expect(text).toContain('rating: 5');
    expect(text).toContain('type: concept');
    expect(text).toContain('status: draft');
  });

  it('external modification is detected via save conflict', async () => {
    await mk('Y.md', 'v1\n\n[[B]]');
    await service.reconcile();
    const d = await service.getDocument('Y.md');
    // External edit while offline.
    await fs.writeFile(path.join(dir, 'Y.md'), 'v1 external\n\n[[B]]', 'utf8');
    const staleHash = d!.meta.contentHash;
    const result = await service.saveDocument('Y.md', 'my edit', staleHash);
    expect(result.ok).toBe(false);
    expect(result.conflicted).toBe(true);
  });

  it('deletes back up before destructive removal', async () => {
    await mk('Z.md', '# Z\nprecious');
    await service.reconcile();
    const res = await service.deleteDocument('Z.md');
    expect(res.ok).toBe(true);
    const backups = await fs.readdir(path.join(dir, '.kv-data', 'backups'));
    expect(backups.length).toBeGreaterThan(0);
  });

  it('backlinks and broken link stats reflect real content', async () => {
    await mk('S1.md', '# S1\nLinks to [[S2]].');
    await mk('S2.md', '# S2');
    await mk('orphan.md', '# Orphan (nothing links in or out)');
    await service.reconcile();
    const ov = await service.overview();
    const s = ov.stats;
    expect(s.backlinkCount).toBeGreaterThanOrEqual(1);
    expect(s.brokenLinkCount).toBe(0);
    expect(s.orphanCount).toBeGreaterThanOrEqual(1);
  });
});