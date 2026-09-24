import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The editor package is vendored under `vendor/` and linked into node_modules.
  // Dedupe React so the vendored ESM modules share the test's React instance
  // (a second copy produces "Invalid hook call").
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    server: { deps: { inline: [/atomic-editor/, '@atomic-editor/editor'] } },
  },
});
