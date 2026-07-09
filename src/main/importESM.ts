/**
 * @file src/main/importESM.ts
 *
 * Why it exists: `electron-store` v10 is ESM-only while the main process
 * compiles to CommonJS. This single helper loads ESM modules from CJS
 * without duplicating the `new Function('return import(...)')` hack.
 */

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport: (specifier: string) => Promise<unknown> = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<unknown>;

/** Load an ESM-only package from the CommonJS main process. */
export function importESM<T = unknown>(specifier: string): Promise<T> {
  return dynamicImport(specifier) as Promise<T>;
}
