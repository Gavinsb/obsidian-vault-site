import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ServerConfig {
  host: string;
  port: number;
}

export interface AppConfig {
  vaultPath: string;
  dataDir: string;
  siteName: string;
  theme: 'dark' | 'light' | 'system';
  ratingScale: number;
  excludedFolders: string[];
  excludedFiles: string[];
  attachmentFolders: string[];
  gitIntegration: 'auto' | 'on' | 'off';
  fileWatching: boolean;
  indexLocation: string;
  backupBeforeDestructive: boolean;
  backupDir: string;
  server: ServerConfig;
}

export class ConfigError extends Error {}

/**
 * Load configuration from (in priority order):
 * 1. process.env.KV_* / VAULT_PATH overrides
 * 2. an optional config file passed via --config
 * 3. config/default.json
 *
 * The vault path is never hard-coded into application code. It comes from
 * config and/or the environment.
 */
export function loadConfig(explicitConfigPath?: string): AppConfig {
  const root = projectRoot();
  const defaultPath = path.join(root, 'config', 'default.json');
  const cfgPath =
    explicitConfigPath ||
    process.env.KV_CONFIG ||
    (fs.existsSync(defaultPath) ? defaultPath : undefined);

  const base: AppConfig = {
    ...readJSON<AppConfig>(cfgPath || defaultPath),
    dataDir: path.resolve(root, 'data'),
    indexLocation: path.resolve(root, 'data', 'index.json'),
    backupDir: path.resolve(root, 'data', 'backups'),
  };

  const overrides: Partial<AppConfig> = {
    vaultPath: envStr(['KV_VAULT_PATH', 'VAULT_PATH']) ?? base.vaultPath,
    siteName: envStr(['KV_SITE_NAME']) ?? base.siteName,
    theme: (envStr(['KV_THEME']) as AppConfig['theme']) ?? base.theme,
    ratingScale: envNum(['KV_RATING_SCALE']) ?? base.ratingScale,
  };
  const cfg: AppConfig = { ...base, ...overrides };

  if (!cfg.vaultPath) {
    throw new ConfigError(
      'No vault path configured. Set VAULT_PATH (or KV_VAULT_PATH) or add "vaultPath" to your config file. See README "Connect an Obsidian vault".'
    );
  }
  cfg.vaultPath = path.resolve(cfg.vaultPath);

  if (!fs.existsSync(cfg.dataDir)) fs.mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}

export function validateVaultPath(vaultPath: string): {
  ok: boolean;
  errors: string[];
  checks: Record<string, { pass: boolean; detail: string }>;
} {
  const errors: string[] = [];
  const checks: Record<string, { pass: boolean; detail: string }> = {};

  if (!fs.existsSync(vaultPath)) {
    checks.exists = { pass: false, detail: 'Directory does not exist' };
    errors.push('directory does not exist');
  } else {
    checks.exists = { pass: true, detail: 'Directory exists' };

    let mode = null;
    try {
      const st = fs.statSync(vaultPath);
      if (!st.isDirectory()) {
        checks.isDir = { pass: false, detail: 'Path is not a directory' };
        errors.push('path is not a directory');
      } else {
        checks.isDir = { pass: true, detail: 'Path is a directory' };
      }
      // Test read access by listing.
      try {
        fs.readdirSync(vaultPath);
        checks.read = { pass: true, detail: 'Directory is readable' };
      } catch {
        checks.read = { pass: false, detail: 'Directory is not readable (permissions)' };
        errors.push('directory is not readable');
      }
      // Test that at least one markdown file is readable (if any exist).
      let anyMarkdown = false;
      const all = fs.readdirSync(vaultPath, { withFileTypes: true });
      for (const e of all) {
        if (e.isFile() && /\.md$/i.test(e.name)) {
          anyMarkdown = true;
          try {
            fs.readFileSync(path.join(vaultPath, e.name), 'utf8');
            checks.readMarkdown = { pass: true, detail: 'Markdown is readable' };
          } catch {
            checks.readMarkdown = { pass: false, detail: 'Markdown not readable' };
            errors.push('markdown files are not readable');
          }
          break;
        }
      }
      if (!anyMarkdown) {
        checks.hasMarkdown = {
          pass: true,
          detail: 'No markdown at root (may exist in subfolders); will attempt deeper scan',
        };
      }
      // Test write access with a temp file.
      const probe = path.join(vaultPath, `.kv-write-probe-${Date.now()}`);
      try {
        fs.writeFileSync(probe, '', { flag: 'wx' });
        fs.unlinkSync(probe);
        checks.write = { pass: true, detail: 'Directory is writable' };
      } catch {
        checks.write = { pass: false, detail: 'Directory is not writable (permissions)' };
        errors.push('directory is not writable');
      }
      void mode;
    } catch (err) {
      checks.stat = { pass: false, detail: String(err) };
      errors.push('could not stat path');
    }
  }
  return { ok: errors.length === 0, errors, checks };
}

/** Paths nested inside the vault that the app never touches/stores data in. */
export function projectRoot(): string {
  return path.resolve(new URL('..', import.meta.url).pathname, '..');
}

function readJSON<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}
function envStr(names: string[]): string | undefined {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}
function envNum(names: string[]): number | undefined {
  for (const n of names) {
    if (process.env[n]) {
      const v = Number(process.env[n]);
      if (!Number.isNaN(v)) return v;
    }
  }
  return undefined;
}

export function expandTilde(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}