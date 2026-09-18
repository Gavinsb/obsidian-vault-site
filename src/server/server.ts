/**
 * Server entrypoint.
 *
 *   VAULT_PATH=/path/to/vault KV_PORT=<port> npx tsx src/server/server.ts
 */
import http from 'node:http';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateVaultPath, ConfigError } from '../shared/config.js';
import { ObsidianFileSystemVaultProvider } from './obsidian-filesystem-provider.js';
import { VaultService } from './vault-service.js';
import { createApi } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  let config;
  try {
    config = loadConfig(process.argv[2]);
  } catch (err) {
    console.error(`\nConfiguration error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const validation = validateVaultPath(config.vaultPath);
  if (!validation.ok) {
    console.error('\nVault validation failed:');
    for (const e of validation.errors) console.error(`  - ${e}`);
    console.error('\nFix VAULT_PATH/config, then restart.\n');
    process.exit(1);
  }

  const provider = new ObsidianFileSystemVaultProvider(config.vaultPath, {
    excludedFolders: config.excludedFolders,
    excludedFiles: config.excludedFiles,
    ratingScale: config.ratingScale,
    watch: config.fileWatching,
  });

  const service = new VaultService(provider, config);
  await service.start();
  console.log(
    `\nIndexed ${service.index.notes.size} documents from vault "${provider.name}" (${provider.root})\n`
  );

  const app = express();
  app.use('/api', createApi(service, config));

  // Serve built client if present (production), else dev handles the rest.
  const clientDist = path.resolve(__dirname, '../../dist/client');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .send('Obsidian Vault Microsite API is running. Build-watch the client with `npm run dev:web`.');
    });
  }

  const { host, port } = config.server;
  const server: http.Server = app.listen(port, host, () => {
    console.log(`Knowledge Vault microsite listening on http://${host}:${port}`);
    console.log(`  API:     http://${host}:${port}/api`);
  });

  // Live index refresh on external change: WS is out of scope for v1; the UI
  // polls /api/vault/overview for sync state.

  const shutdown = async () => {
    console.log('\nShutting down…');
    await service.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { ConfigError };