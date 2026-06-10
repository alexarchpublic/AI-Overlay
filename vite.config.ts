/**
 * vite.config.ts
 *
 * Why it exists: Vite owns the renderer bundle and HMR. Main process is compiled
 * separately by `tsc -p tsconfig.main.json` so we do not mix bundlers.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
