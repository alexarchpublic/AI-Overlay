// @ts-check
/**
 * eslint.config.js
 *
 * Why it exists: Enforces the PRD §0 D6 lint baseline —
 * `@typescript-eslint/strict-type-checked` + Prettier compatibility. Flat config
 * (ESLint 9+) so tooling survives the 2026 ecosystem.
 *
 * Rule of thumb: if a new rule stops fires across Chunks 2–7, tighten here; if
 * a rule creates widespread noise without surfacing real bugs, relax here.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'logs/**',
      '**/*.d.ts',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // `tsconfig.preload.json` is included so `src/preload/**` parses
        // against typescript-eslint's typed-rule pass (the preload was
        // moved out of tsconfig.main.json's include when esbuild took over
        // its emit — see scripts/build-preload.mjs for the why).
        project: [
          './tsconfig.main.json',
          './tsconfig.preload.json',
          './tsconfig.renderer.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Allow underscore-prefixed unused args (standard escape hatch).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests can be looser — type-only assertions do not need to survive strict
    // narrowing and `any` is sometimes the point.
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
