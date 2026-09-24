import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  // The editor package is vendored under `vendor/` (linked via node_modules);
  // dedupe React so the vendored modules resolve the single project copy.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:18790',
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});