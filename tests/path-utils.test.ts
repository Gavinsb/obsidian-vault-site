import { describe, it, expect } from 'vitest';
import {
  resolveInVault,
  toRelPath,
  normalizeRel,
  isMarkdown,
  isExcluded,
  UnsafePathError,
  sanitizeFileName,
} from '../src/shared/path-utils.js';

const root = '/vault';

describe('path safety', () => {
  it('rejects path traversal', () => {
    expect(() => resolveInVault(root, '../secret')).toThrow(UnsafePathError);
    expect(() => resolveInVault(root, 'a/../../x')).toThrow(UnsafePathError);
    expect(() => resolveInVault(root, '..\\..\\evil')).toThrow(UnsafePathError);
  });

  it('normalizes absolute or rooted paths safely into the vault (no escape)', () => {
    // A leading slash becomes a vault-relative path that stays inside the root.
    expect(resolveInVault(root, '/etc/passwd')).toBe('/vault/etc/passwd');
    expect(() => resolveInVault(root, '/etc/passwd'))
      .not.toThrow();
  });

  it('rejects NUL bytes', () => {
    expect(() => resolveInVault(root, 'a\u0000b.md')).toThrow(UnsafePathError);
  });

  it('allows safe paths and normalizes them', () => {
    expect(resolveInVault(root, 'notes/a.md')).toBe('/vault/notes/a.md');
    expect(resolveInVault(root, 'notes/./b.md')).toBe('/vault/notes/b.md');
  });

  it('round-trips to relative path', () => {
    expect(toRelPath('/vault', '/vault/a/b.md')).toBe('a/b.md');
    expect(toRelPath('/vault', '/vault/a.md')).toBe('a.md');
  });

  it('normalizes windows and leading slashes', () => {
    expect(normalizeRel('\\a\\b.md')).toBe('a/b.md');
    expect(normalizeRel('/a/b.md')).toBe('a/b.md');
  });

  it('identifies markdown and exclusions', () => {
    expect(isMarkdown('a.md')).toBe(true);
    expect(isMarkdown('a.txt')).toBe(false);
    expect(isExcluded('.obsidian/app.json', ['.obsidian', '.git'], [])).toBe(true);
    expect(isExcluded('notes/a.md', ['.obsidian'], [])).toBe(false);
    expect(isExcluded('secret.md', [], ['secret.md'])).toBe(true);
  });

  it('sanitizes illegal filename characters', () => {
    expect(sanitizeFileName('a/b:c*d?')).not.toMatch(/[\\/:*?"<>|]/);
  });
});