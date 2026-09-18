import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { KnowledgeIndex } from '../src/server/indexer.js';
import {
  buildKnowledgeMap,
  KNOWLEDGE_MAP_COMPONENTS,
  KNOWLEDGE_MAP_LENSES,
} from '../src/server/knowledge-map.js';
import type { DocMeta, KnowledgeLens } from '../src/shared/types.js';
import { createApi } from '../src/server/api.js';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const DAY = 86_400_000;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
    )
  );
});

function add(
  index: KnowledgeIndex,
  relPath: string,
  content: string,
  options: { rating?: number; mtimeMs?: number; tags?: string[] } = {}
) {
  const baseName = relPath.replace(/^.*\//, '').replace(/\.md$/, '');
  const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  const meta: DocMeta = {
    relPath,
    folder,
    fileName: `${baseName}.md`,
    baseName,
    title: baseName,
    aliases: [],
    tags: options.tags ?? [],
    frontmatter: {},
    rating: options.rating,
    ctimeMs: options.mtimeMs ?? NOW,
    mtimeMs: options.mtimeMs ?? NOW,
    size: content.length,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    contentHash: relPath,
    hasFrontmatter: false,
  };
  index.upsertNote(meta, content);
}

describe('Knowledge Map scoring', () => {
  it('keeps structural importance when rating is missing or zero', () => {
    const index = new KnowledgeIndex();
    add(index, 'Hub.md', '# Hub\n[[Leaf]]', { rating: 0, mtimeMs: NOW - 30 * DAY });
    add(index, 'Leaf.md', '# Leaf\n[[Hub]]', { mtimeMs: NOW - 30 * DAY });
    add(index, 'Second.md', '# Second\n[[Hub]]', { mtimeMs: NOW - 30 * DAY });
    add(index, 'Rated isolated.md', '# Rated', { rating: 5, mtimeMs: NOW - 30 * DAY });

    const response = buildKnowledgeMap(index, { ratingScale: 5, asOfMs: NOW });
    const hub = response.items.find((item) => item.relPath === 'Hub.md')!;
    const leaf = response.items.find((item) => item.relPath === 'Leaf.md')!;

    expect(hub.components.rating).toBe(0);
    expect(leaf.components.rating).toBe(0);
    expect(hub.scores.important.contributions.backlinks).toBeGreaterThan(0);
    expect(hub.scores.important.contributions.connectivity).toBeGreaterThan(0);
    expect(hub.scores.important.value).toBeGreaterThan(0);
    expect(response.rankings.central[0]).toBe('Hub.md');
  });

  it('clamps recency and handles an index with no links without division errors', () => {
    const index = new KnowledgeIndex();
    add(index, 'Future.md', '# Future', { mtimeMs: NOW + DAY });
    add(index, 'Old.md', '# Old', { mtimeMs: NOW - 800 * DAY });

    const response = buildKnowledgeMap(index, { ratingScale: 5, asOfMs: NOW });
    const future = response.items.find((item) => item.relPath === 'Future.md')!;
    const old = response.items.find((item) => item.relPath === 'Old.md')!;

    expect(future.components.recency).toBe(1);
    expect(old.components.recency).toBe(0);
    for (const item of response.items) {
      expect(item.components.backlinks).toBe(0);
      expect(item.components.connectivity).toBe(0);
      for (const score of Object.values(item.scores)) {
        expect(Number.isFinite(score.value)).toBe(true);
        expect(score.value).toBeGreaterThanOrEqual(0);
        expect(score.value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('uses deterministic relPath ordering after equal score and title', () => {
    const index = new KnowledgeIndex();
    add(index, 'B/Same.md', '# Same', { mtimeMs: NOW });
    add(index, 'A/Same.md', '# Same', { mtimeMs: NOW });

    const response = buildKnowledgeMap(index, { ratingScale: 5, asOfMs: NOW });
    expect(response.rankings.important).toEqual(['A/Same.md', 'B/Same.md']);
  });
});

describe('Knowledge Map API data shape', () => {
  it('serves the documented read-only response from GET /api/knowledge-map', async () => {
    const index = new KnowledgeIndex();
    add(index, 'API.md', '# API', { rating: 3, mtimeMs: NOW });
    const service = {
      index,
      provider: { name: 'test', root: '/test' },
    };
    const config = { ratingScale: 5 };
    const app = express();
    app.use('/api', createApi(service as never, config as never));
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/knowledge-map`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ratingScale: 5,
      components: KNOWLEDGE_MAP_COMPONENTS,
      lenses: KNOWLEDGE_MAP_LENSES,
      items: [{ relPath: 'API.md', rating: 3 }],
    });
    expect(Object.keys(body.rankings).sort()).toEqual(
      KNOWLEDGE_MAP_LENSES.map((lens) => lens.key).sort()
    );
  });

  it('returns documented components, every lens, score breakdowns, and valid rankings', () => {
    const index = new KnowledgeIndex();
    add(index, 'Concepts/A.md', '# A\n[[B]]', {
      rating: 4,
      mtimeMs: NOW - DAY,
      tags: ['concept'],
    });
    add(index, 'B.md', '# B', { mtimeMs: NOW - 10 * DAY });

    const response = buildKnowledgeMap(index, { ratingScale: 5, asOfMs: NOW });
    const lensKeys = KNOWLEDGE_MAP_LENSES.map((lens) => lens.key);

    expect(response).toMatchObject({
      asOf: '2026-09-18T12:00:00.000Z',
      ratingScale: 5,
      components: KNOWLEDGE_MAP_COMPONENTS,
    });
    expect(response.items).toHaveLength(2);
    expect(Object.keys(response.rankings).sort()).toEqual([...lensKeys].sort());

    for (const lens of KNOWLEDGE_MAP_LENSES) {
      expect(lens.terms.reduce((sum, term) => sum + term.weight, 0)).toBeCloseTo(1);
      expect(response.rankings[lens.key]).toHaveLength(response.items.length);
      expect(new Set(response.rankings[lens.key]).size).toBe(response.items.length);
    }

    for (const item of response.items) {
      expect(Object.keys(item.components).sort()).toEqual(
        ['backlinks', 'connectivity', 'rating', 'recency'].sort()
      );
      expect(Object.keys(item.scores).sort()).toEqual([...lensKeys].sort());
      for (const lens of lensKeys as KnowledgeLens[]) {
        const detail = item.scores[lens];
        const sum = Object.values(detail.contributions).reduce((total, value) => total + value, 0);
        expect(detail.value).toBeCloseTo(sum, 3);
      }
    }
  });
});
