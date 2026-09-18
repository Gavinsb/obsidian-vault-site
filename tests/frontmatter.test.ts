import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  setFrontmatterField,
  removeFrontmatterField,
  getField,
  toStringArray,
  coerceRating,
} from '../src/shared/frontmatter.js';

describe('frontmatter', () => {
  const withFm = `---
type: concept
status: draft
tags:
  - psychology
  - cognition
note: keep me unchanged
---

# Title

Body`;
  const noFm = `# Title\n\nNo frontmatter here.`;

  it('parses existing frontmatter and body', () => {
    const fm = parseFrontmatter(withFm);
    expect(fm.hasFrontmatter).toBe(true);
    expect(fm.data.type).toBe('concept');
    expect(fm.content).toContain('# Title');
  });

  it('detects absence of frontmatter', () => {
    expect(parseFrontmatter(noFm).hasFrontmatter).toBe(false);
  });

  it('adds a rating while preserving unrelated fields byte-for-byte', () => {
    const updated = setFrontmatterField(withFm, 'rating', 4);
    expect(getField(updated, 'rating')).toBe(4);
    // Unrelated fields and formatting preserved.
    expect(updated).toContain('type: concept');
    expect(updated).toContain('status: draft');
    expect(updated).toContain('note: keep me unchanged');
    expect(updated).toContain('  - psychology');
    expect(updated).toContain('\n\n# Title');
  });

  it('reuses existing frontmatter when none exists', () => {
    const updated = setFrontmatterField(noFm, 'rating', 5);
    expect(getField(updated, 'rating')).toBe(5);
    expect(updated).toContain('---\nrating: 5\n---');
    expect(updated).toContain('# Title');
  });

  it('updates an existing scalar in place without duplicating', () => {
    const once = setFrontmatterField(withFm, 'status', 'active');
    const match = once.match(/^status:/gm);
    expect(match).toHaveLength(1);
    expect(getField(once, 'status')).toBe('active');
  });

  it('removes a field cleanly', () => {
    const updated = setFrontmatterField(withFm, 'rating', 3);
    const removed = removeFrontmatterField(updated, 'rating');
    expect(getField(removed, 'rating')).toBeUndefined();
    expect(parseFrontmatter(removed).data.type).toBe('concept');
  });

  it('handles multiple sequential field updates cumulatively', () => {
    let s = setFrontmatterField(withFm, 'rating', 4);
    s = setFrontmatterField(s, 'favorite', 'true');
    s = setFrontmatterField(s, 'status', 'needs-review');
    expect(getField(s, 'rating')).toBe(4);
    expect(getField(s, 'favorite')).toBe('true');
    expect(getField(s, 'status')).toBe('needs-review');
  });

  it('coerces ratings to the scale', () => {
    expect(coerceRating(4, 5)).toBe(4);
    expect(coerceRating('3', 5)).toBe(3);
    expect(coerceRating(9, 5)).toBe(5);
    expect(coerceRating('abc', 5)).toBeUndefined();
    expect(coerceRating(null, 5)).toBeUndefined();
  });

  it('parses tags and aliases from string or array forms', () => {
    expect(toStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(toStringArray('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(toStringArray('solo')).toEqual(['solo']);
    expect(toStringArray(undefined)).toEqual([]);
  });
});