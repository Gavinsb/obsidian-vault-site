import { describe, it, expect } from 'vitest';
import {
  parseWikiLinks,
  extractInlineTags,
  extractHeadings,
  extractMarkdownLinks,
  parseCalloutStart,
} from '../src/shared/wiki.js';

describe('wiki links', () => {
  it('parses basic wiki links', () => {
    const links = parseWikiLinks('See [[Agent Architecture]] here.');
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('Agent Architecture');
  });

  it('parses aliased links [[Page|Alias]]', () => {
    const links = parseWikiLinks('[[Confirmation Bias|confirmation]]');
    expect(links[0].target).toBe('Confirmation Bias');
    expect(links[0].alias).toBe('confirmation');
  });

  it('parses heading and block references', () => {
    const h = parseWikiLinks('[[Page#Section]]');
    expect(h[0].target).toBe('Page');
    expect(h[0].heading).toBe('Section');
    const b = parseWikiLinks('[[Page#^blockid]]');
    expect(b[0].block).toBe('blockid');
  });

  it('ignores links inside code blocks', () => {
    const links = parseWikiLinks('```\n[[NotALink]]\n```\nOutside [[RealLink]]');
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('RealLink');
  });

  it('parses embeds separately', () => {
    const links = parseWikiLinks('![[image.png]] and [[real]]', { includeEmbeds: false });
    // Embed skipped, normal link kept.
    expect(links.map((l) => l.target)).toEqual(['real']);
  });
});

describe('tags', () => {
  it('extracts inline and nested tags', () => {
    const tags = extractInlineTags('A note about #ai and #ai/agents and #security.\n## A Heading');
    expect(tags).toContain('ai');
    expect(tags).toContain('ai/agents');
    expect(tags).toContain('security');
    expect(tags).not.toContain('heading');
  });

  it('does not treat URLs or pure numbers as tags', () => {
    const tags = extractInlineTags('Check https://example.com/x#frag and #123 or issue#42');
    expect(tags).not.toContain('frag');
    expect(tags).not.toContain('123');
  });
});

describe('headings', () => {
  it('extracts headings and slugs', () => {
    const heads = extractHeadings('# Big Title\n## Sub');
    expect(heads).toHaveLength(2);
    expect(heads[0].slug).toBe('big-title');
    expect(heads[1].slug).toBe('sub');
  });
});

describe('markdown links & callouts', () => {
  it('extracts standard markdown links', () => {
    const links = extractMarkdownLinks('[text](https://x.com) and [y](local.md)');
    expect(links).toHaveLength(2);
    expect(links[1].url).toBe('local.md');
  });

  it('parses obsidian callouts', () => {
    expect(parseCalloutStart('> [!warning] Careful')?.type).toBe('warning');
    expect(parseCalloutStart('> [!note]')).toBeTruthy();
    expect(parseCalloutStart('plain text')).toBeNull();
  });
});