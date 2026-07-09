/**
 * vitest.config.ts
 *
 * Why it exists: Drives the Chunk 1 smoke suite. Kept minimal; component tests
 * arrive with React UI in Chunks 2 and 5. The `@shared` alias mirrors Vite's
 * so tests can import from the same paths as renderer code.
 *
 * Chunk 5: enable the automatic JSX transform via esbuild so .spec.tsx files
 * can render renderer components without a `import React` shim.
 *
 * Milestone 3 (T3.2): coverage thresholds on the chat orchestrator.
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    // Default to node — fast and matches Chunks 1-4 specs. The renderer
    // smoke tests opt in to jsdom via `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/main/chatOrchestrator.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        'src/main/chatOrchestrator.ts': {
          branches: 90,
        },
      },
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
