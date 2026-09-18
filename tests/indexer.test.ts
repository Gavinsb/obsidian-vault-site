import { describe, it, expect } from 'vitest';
import { KnowledgeIndex } from '../src/server/indexer.js';
import { buildMetaFromContent } from '../src/server/obsidian-filesystem-provider.js';

function note(relPath: string, content: string) {
  return { meta: buildMetaFromContent(relPath, content, 5), content };
}

describe('KnowledgeIndex', () => {
  it('builds backlinks and resolves wiki targets by title/alias', () => {
    const idx = new KnowledgeIndex();
    idx.upsertNote(note('A.md', '# A\nLink to [[B]].').meta, '# A\nLink to [[B]]');
    idx.upsertNote(note('B.md', '# B').meta, '# B');
    expect(idx.resolveTarget('B').has('B.md')).toBe(true);
    expect(idx.backlinksOf('B.md').has('A.md')).toBe(true);
  });

  it('resolves aliases', () => {
    const idx = new KnowledgeIndex();
    idx.upsertNote(
      note('C.md', '---\naliases:\n  - Some Alias\n---\n# C').meta,
      '---\naliases:\n  - Some Alias\n---\n# C'
    );
    expect(idx.resolveTarget('Some Alias').has('C.md')).toBe(true);
  });

  it('reports broken links', () => {
    const idx = new KnowledgeIndex();
    idx.upsertNote(note('A.md', '# A\n[[Missing]]').meta, '# A\n[[Missing]]');
    const s = idx.stats();
    expect(s.brokenLinkCount).toBe(1);
    expect(s.unresolvedWikiLinkCount).toBe(1);
  });

  it('rebuilds from scratch cleanly', async () => {
    const idx = new KnowledgeIndex();
    idx.upsertNote(note('X.md', '# X').meta, '# X');
    idx.upsertNote(note('Y.md', '# Y').meta, '# Y');
    const count = await idx.rebuild(async () => [note('Z.md', '# Z')]);
    expect(count).toBe(1);
    expect(idx.notes.has('X.md')).toBe(false);
    expect(idx.notes.has('Z.md')).toBe(true);
  });

  it('removes notes and their graph contributions', () => {
    const idx = new KnowledgeIndex();
    idx.upsertNote(note('A.md', '# A\n[[B]]').meta, '# A\n[[B]]');
    idx.upsertNote(note('B.md', '# B').meta, '# B');
    expect(idx.backlinksOf('B.md').has('A.md')).toBe(true);
    idx.removeNote('A.md');
    expect(idx.backlinksOf('B.md').has('A.md')).toBe(false);
    expect(Array.from(idx.resolveTarget('B')).sort()).toEqual(['B.md']);
  });

  it('invalidates cached neighbours after live link changes', () => {
    const idx = new KnowledgeIndex();
    idx.upsertNote(note('A.md', '# A\n[[B]]').meta, '# A\n[[B]]');
    idx.upsertNote(note('B.md', '# B').meta, '# B');
    idx.upsertNote(note('C.md', '# C').meta, '# C');
    expect(idx.neighboursOf('B.md').has('A.md')).toBe(true);

    idx.updateLinks('A.md', '# A\n[[C]]');
    expect(idx.neighboursOf('B.md').has('A.md')).toBe(false);
    expect(idx.neighboursOf('C.md').has('A.md')).toBe(true);
  });

  it('annotates ratings from frontmatter', () => {
    const idx = new KnowledgeIndex();
    idx.upsertNote(
      note('R.md', '---\nrating: 4\n---\n# R').meta,
      '---\nrating: 4\n---\n# R'
    );
    const s = idx.stats();
    expect(s.ratedCount).toBe(1);
    expect(s.avgRating).toBe(4);
  });
});