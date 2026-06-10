/**
 * @file src/main/harnessLoader.ts
 *
 * Why it exists: PRD §3.1 / §3.5 — the single source of truth for harness
 * text. Recursively reads the harness root, applies D2/D3/D14 rules,
 * classifies + orders the result per D4/D15, prepends the D5 header to each
 * file, wraps the whole bundle in the D6 envelope, caches it in main-process
 * memory, and exposes the typed API Chunk 5's `geminiService` consumes.
 *
 * Design constraints worth re-stating (from PRD §0/§3):
 *
 *   - **Single read path.** `getHarness()` is the only sanctioned way for
 *     any other main-process module to read harness text. No ad-hoc
 *     directory walks elsewhere.
 *   - **Atomic cache replacement.** Concurrent readers see either the OLD
 *     bundle or the NEW bundle, never a half-built one. (PRD §3.5 + D11)
 *   - **In-flight dedup.** Concurrent `getHarness()` calls share the same
 *     `Promise<HarnessBundle>`; exactly one walk per cache miss. (D11)
 *   - **Reload preserves the old cache on failure.** A failed reload does
 *     NOT invalidate the previously-good bundle — `onLoadError` fires and
 *     the cache stays intact so Chunk 5 can keep responding. (PRD §3.5)
 *   - **Empty harness is non-fatal.** PRD D19 — `fileCount: 0` with a
 *     warning, never an exception.
 *   - **Token ceiling is fatal.** PRD D8 — `TOKEN_CEILING_EXCEEDED` is the
 *     only auto-validation that throws on load.
 *
 * What it does NOT own:
 *   - chokidar watcher (`harnessWatcher.ts`)
 *   - electron-store persistence (`harnessStore.ts`)
 *   - Pure rules (`harnessUtils.ts`)
 *
 * Injectable deps mirror the `screenshotService` pattern so Vitest can run
 * the entire load orchestrator against a fake fs without an Electron import.
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { Stats } from 'node:fs';
import type { AppLogger } from './logger';
import {
  applyManifestToPath,
  classifyFile,
  containsHighEntropyLine,
  estimateTokens,
  exceedsMaxFileBytes,
  hasSuspiciousFilename,
  isUnderIgnoredDir,
  orderPaths,
  parseManifest,
  passesDefaultIncludeRules,
  toPosixRelPath,
} from './harnessUtils';
import {
  HARNESS_ENVELOPE_OPENER,
  HARNESS_FILE_HEADER_PREFIX,
  HARNESS_FILE_SEPARATOR,
  HARNESS_MANIFEST_FILENAME,
  HARNESS_TOKEN_CEILING,
} from '../shared/harnessConstants';
import type {
  HarnessBundle,
  HarnessFileMeta,
  HarnessLoadErrorPayload,
  HarnessManifest,
  HarnessMetadata,
} from '../shared/types';

// ---------------------------------------------------------------------------
// Injectable surfaces — kept narrow so tests don't need real fs / Electron
// ---------------------------------------------------------------------------

export interface HarnessFsLike {
  /**
   * Recursive directory walk. Returns relative POSIX-form paths to every
   * regular file under `root` (caller filters). Implementations may be
   * lazy / streaming; the loader collects the result into a regular array.
   */
  walk(root: string): Promise<readonly { relPath: string; absPath: string; stat: HarnessFileStat }[]>;
  readFile(absPath: string): Promise<string>;
  /**
   * Resolve the absolute, symlink-followed-once form of `root`. Used to
   * detect `ROOT_NOT_FOUND` vs `PERMISSION_DENIED` cleanly.
   */
  realpath(absPath: string): Promise<string>;
  /** Cheap existence check for the optional manifest file. */
  exists(absPath: string): Promise<boolean>;
}

export interface HarnessFileStat {
  size: number;
  mtimeMs: number;
  isFile: boolean;
}

export interface HarnessLoaderDeps {
  logger: AppLogger;
  /** Initial root path. Setter persists; constructor does not. */
  initialRootPath: string;
  fs: HarnessFsLike;
  /** Persistence of the resolved root + last-load summary. */
  onLoaded?: (m: HarnessMetadata) => void;
  /** ISO clock injection so tests can produce deterministic timestamps. */
  now?: () => number;
}

export interface HarnessLoader {
  getHarness(): Promise<HarnessBundle>;
  getMetadata(): Promise<HarnessMetadata>;
  reload(): Promise<HarnessBundle>;
  setRootPath(path: string): Promise<HarnessBundle>;
  getRootPath(): string;
  onReloaded(cb: (m: HarnessMetadata) => void): () => void;
  onLoadError(cb: (e: HarnessLoadErrorPayload) => void): () => void;
  /** Drop the in-memory cache + listeners. Idempotent. */
  shutdown(): Promise<void>;
}

/**
 * Sentinel error class so the loader can route specific failure shapes to
 * `onLoadError` without parsing strings. Internal — not exported on the
 * IPC surface (the renderer sees the `HarnessLoadErrorPayload`).
 */
export class HarnessLoadError extends Error {
  override readonly name = 'HarnessLoadError';
  readonly payload: HarnessLoadErrorPayload;

  constructor(payload: HarnessLoadErrorPayload) {
    super(payload.message);
    this.payload = payload;
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * One-line "we considered file X but skipped it" record. Aggregated into
 * `metadata.warnings` and into the `harness.skippedFiles` log line.
 */
interface SkipRecord {
  relPath: string;
  reason:
    | 'ignoredDir'
    | 'ignoredFile'
    | 'unsupportedExt'
    | 'oversize'
    | 'suspiciousName'
    | 'suspiciousContent'
    | 'pdfSkipped'
    | 'manifestExcluded'
    | 'manifestMissing'
    | 'readFailed';
  detail?: string;
}

export function createHarnessLoader(deps: HarnessLoaderDeps): HarnessLoader {
  const now = deps.now ?? Date.now;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  /** Caller-visible root path. May be replaced via `setRootPath`. */
  let rootPath = deps.initialRootPath;
  /** Last successfully-loaded bundle. Replaced atomically on reload. */
  let cached: HarnessBundle | null = null;
  /** In-flight load promise so concurrent callers share one walk (D11). */
  let inFlight: Promise<HarnessBundle> | null = null;

  // -------------------------------------------------------------------------
  // Bundle composition
  // -------------------------------------------------------------------------

  function buildEnvelope(opts: {
    body: string;
    fileCount: number;
    approxTokens: number;
  }): string {
    const isoTs = new Date(now()).toISOString();
    const header =
      `${HARNESS_ENVELOPE_OPENER}\n` +
      `Generated: ${isoTs}\n` +
      `Files: ${String(opts.fileCount)}\n` +
      `Approx tokens: ${String(opts.approxTokens)}\n\n` +
      `---\n\n`;
    return header + opts.body;
  }

  /**
   * Concatenate per-file blocks. Each block is `### FILE: <relPath>\n\n` +
   * file body + `\n\n---\n\n` separator. Matches `Context.md §6` byte-exact.
   */
  function composeBody(files: readonly { relPath: string; text: string }[]): string {
    const parts: string[] = [];
    for (const f of files) {
      parts.push(`${HARNESS_FILE_HEADER_PREFIX}${f.relPath}\n\n`);
      parts.push(f.text);
      parts.push(HARNESS_FILE_SEPARATOR);
    }
    return parts.join('');
  }

  // -------------------------------------------------------------------------
  // Manifest discovery
  // -------------------------------------------------------------------------

  async function loadManifestIfPresent(rootAbs: string): Promise<HarnessManifest | null> {
    const manifestAbs = path.join(rootAbs, HARNESS_MANIFEST_FILENAME);
    const present = await deps.fs.exists(manifestAbs);
    if (!present) return null;
    let raw: string;
    try {
      raw = await deps.fs.readFile(manifestAbs);
    } catch (err) {
      throw new HarnessLoadError({
        code: 'MANIFEST_INVALID',
        message: 'failed to read HARNESS_INDEX.json',
        rootPath: rootAbs,
        detail: { ioError: err instanceof Error ? err.message : String(err) },
      });
    }
    const parsed = parseManifest(raw);
    if (!parsed.ok) {
      throw new HarnessLoadError({
        code: 'MANIFEST_INVALID',
        message: 'HARNESS_INDEX.json failed validation',
        rootPath: rootAbs,
        detail: { parserError: parsed.error ?? 'unknown' },
      });
    }
    return parsed.manifest ?? null;
  }

  // -------------------------------------------------------------------------
  // The walk + filter pass
  // -------------------------------------------------------------------------

  async function walkAndFilter(
    rootAbs: string,
    manifest: HarnessManifest | null,
  ): Promise<{
    candidates: { relPath: string; absPath: string; stat: HarnessFileStat }[];
    skipped: SkipRecord[];
  }> {
    let entries: readonly { relPath: string; absPath: string; stat: HarnessFileStat }[];
    try {
      entries = await deps.fs.walk(rootAbs);
    } catch (err) {
      // Distinguish ENOENT (root gone) from EACCES (perm) for the renderer
      // banner; everything else is bucketed as IO_ERROR.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new HarnessLoadError({
          code: 'ROOT_NOT_FOUND',
          message: 'harness root directory not found',
          rootPath: rootAbs,
        });
      }
      if (code === 'EACCES') {
        throw new HarnessLoadError({
          code: 'PERMISSION_DENIED',
          message: 'permission denied reading harness root',
          rootPath: rootAbs,
        });
      }
      throw new HarnessLoadError({
        code: 'IO_ERROR',
        message: err instanceof Error ? err.message : String(err),
        rootPath: rootAbs,
      });
    }

    const candidates: { relPath: string; absPath: string; stat: HarnessFileStat }[] = [];
    const skipped: SkipRecord[] = [];
    let pdfCount = 0;

    for (const entry of entries) {
      const { relPath, absPath, stat } = entry;
      if (!stat.isFile) continue;

      // The manifest itself is metadata, never part of the bundle.
      if (relPath === HARNESS_MANIFEST_FILENAME) continue;

      // Ignored-directory check first — short-circuit before any work.
      if (isUnderIgnoredDir(relPath)) {
        skipped.push({ relPath, reason: 'ignoredDir' });
        continue;
      }

      // Filename-level secret heuristic runs BEFORE the extension filter so
      // a `secrets.env` is flagged as `suspiciousName` (a security signal)
      // rather than being silently bucketed as `unsupportedExt`. Defense-in-
      // depth: this is what surfaces the yellow "suspicious filename"
      // banner in the settings panel.
      if (hasSuspiciousFilename(relPath)) {
        skipped.push({ relPath, reason: 'suspiciousName' });
        continue;
      }

      // Manifest takes priority over the default include rules.
      const manifestVerdict = applyManifestToPath(relPath, manifest);
      if (manifestVerdict === 'exclude') {
        skipped.push({ relPath, reason: 'manifestExcluded' });
        continue;
      }
      if (manifestVerdict === 'default' && !passesDefaultIncludeRules(relPath)) {
        // Surface PDFs distinctly so the rate-limited log line is accurate.
        const ext = path.posix.extname(relPath).toLowerCase();
        if (ext === '.pdf') {
          pdfCount++;
          skipped.push({ relPath, reason: 'pdfSkipped' });
        } else {
          // Distinguish lockfiles / minified bundles from "wrong extension".
          skipped.push({ relPath, reason: 'unsupportedExt' });
        }
        continue;
      }

      // Size cap (D3) — applied even when the manifest explicitly includes a
      // file. A 5MB markdown file is still too big for the bundle.
      if (exceedsMaxFileBytes(stat.size)) {
        skipped.push({ relPath, reason: 'oversize', detail: `${String(stat.size)} bytes` });
        continue;
      }

      candidates.push({ relPath, absPath, stat });
    }

    if (pdfCount > 0) {
      deps.logger.warn('harness.pdfSkipped', { count: pdfCount, rootPath: rootAbs });
    }

    return { candidates, skipped };
  }

  // -------------------------------------------------------------------------
  // The read pass — produces per-file text + metadata, applying the
  // content-level secret heuristic. Errors on a single file are isolated
  // (PRD §3.5 — "Error isolation").
  // -------------------------------------------------------------------------

  async function readAndClassify(
    candidates: readonly { relPath: string; absPath: string; stat: HarnessFileStat }[],
  ): Promise<{
    files: { meta: HarnessFileMeta; text: string }[];
    skipped: SkipRecord[];
  }> {
    const files: { meta: HarnessFileMeta; text: string }[] = [];
    const skipped: SkipRecord[] = [];

    for (const { relPath, absPath, stat } of candidates) {
      let text: string;
      try {
        text = await deps.fs.readFile(absPath);
      } catch (err) {
        skipped.push({
          relPath,
          reason: 'readFailed',
          detail: err instanceof Error ? err.message : String(err),
        });
        deps.logger.warn('harness.fileReadFailed', {
          relPath,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      // Content-level secret heuristic. Defense-in-depth on top of D13's
      // filename rule — primary control is repo `.gitignore`.
      if (containsHighEntropyLine(text)) {
        skipped.push({ relPath, reason: 'suspiciousContent' });
        deps.logger.warn('harness.suspiciousFile', {
          relPath,
          reason: 'highEntropyLine',
        });
        continue;
      }
      const charCount = text.length;
      const meta: HarnessFileMeta = {
        relPath,
        bytes: stat.size,
        approxTokens: estimateTokens(charCount),
        classification: classifyFile(relPath),
        modifiedAt: stat.mtimeMs,
      };
      files.push({ meta, text });
    }

    return { files, skipped };
  }

  // -------------------------------------------------------------------------
  // Top-level load orchestrator
  // -------------------------------------------------------------------------

  async function performLoad(): Promise<HarnessBundle> {
    const startTs = now();
    const rootAbs = resolveRoot(rootPath);

    const manifest = await loadManifestIfPresent(rootAbs);

    const { candidates, skipped: walkSkipped } = await walkAndFilter(rootAbs, manifest);
    const { files, skipped: readSkipped } = await readAndClassify(candidates);

    // Verify priority paths actually exist — surface manifest typos.
    if (manifest?.priority) {
      const present = new Set(files.map((f) => f.meta.relPath));
      for (const p of manifest.priority) {
        if (!present.has(p)) {
          walkSkipped.push({ relPath: p, reason: 'manifestMissing' });
        }
      }
    }

    // Apply ordering — manifest priority first, then alphabetical for the
    // remainder. Files are sorted by `meta.relPath` (POSIX-form).
    const allRelPaths = files.map((f) => f.meta.relPath);
    const ordered = orderPaths(allRelPaths, manifest);
    const byRel = new Map(files.map((f) => [f.meta.relPath, f]));
    const orderedFiles = ordered
      .map((p) => byRel.get(p))
      .filter((x): x is { meta: HarnessFileMeta; text: string } => x !== undefined);

    // Compute the bundle text. The order above is the byte-stable order
    // promised in §5 DoD #2/#3.
    const body = composeBody(
      orderedFiles.map((f) => ({ relPath: f.meta.relPath, text: f.text })),
    );

    const fileApproxTokens = orderedFiles.reduce((sum, f) => sum + f.meta.approxTokens, 0);

    // D8 ceiling: enforced on the SUM of per-file approxTokens, not the
    // envelope-wrapped text. The envelope adds ~100 tokens — well within
    // the ±15% tolerance band.
    if (fileApproxTokens > HARNESS_TOKEN_CEILING) {
      throw new HarnessLoadError({
        code: 'TOKEN_CEILING_EXCEEDED',
        message: `harness exceeds token ceiling: approxTokens=${String(
          fileApproxTokens,
        )} > ceiling=${String(HARNESS_TOKEN_CEILING)}`,
        rootPath: rootAbs,
        detail: { approxTokens: fileApproxTokens, ceiling: HARNESS_TOKEN_CEILING },
      });
    }

    const fullText = buildEnvelope({
      body,
      fileCount: orderedFiles.length,
      approxTokens: fileApproxTokens,
    });

    const skipped = [...walkSkipped, ...readSkipped];
    const warnings = buildWarnings(orderedFiles.length, skipped);

    const algorithms = orderedFiles
      .filter((f) => f.meta.classification === 'algorithms')
      .map((f) => f.meta.relPath);
    const docs = orderedFiles
      .filter((f) => f.meta.classification === 'docs')
      .map((f) => f.meta.relPath);
    const other = orderedFiles
      .filter((f) => f.meta.classification === 'other')
      .map((f) => f.meta.relPath);

    const loadedAt = now();
    const metadata: HarnessMetadata = {
      rootPath: rootAbs,
      fileCount: orderedFiles.length,
      approxTokens: fileApproxTokens,
      algorithms,
      docs,
      other,
      files: orderedFiles.map((f) => f.meta),
      loadedAt,
      loadDurationMs: loadedAt - startTs,
      warnings,
      manifestUsed: manifest !== null,
    };

    const bundle: HarnessBundle = { text: fullText, metadata };

    // ATOMIC cache replacement (D11 + §3.5). One assignment.
    cached = bundle;

    // Emit a single structured `harness.loaded` log line — the demo string
    // in PRD §3.3 #3 is reproducible from this record.
    deps.logger.info(orderedFiles.length === 0 ? 'harness.empty' : 'harness.loaded', {
      rootPath: rootAbs,
      fileCount: metadata.fileCount,
      approxTokens: metadata.approxTokens,
      algorithms: algorithms.length,
      docs: docs.length,
      other: other.length,
      loadDurationMs: metadata.loadDurationMs,
      manifestUsed: metadata.manifestUsed,
      warnings: warnings.length,
    });

    if (skipped.length > 0) {
      deps.logger.debug('harness.skippedFiles', {
        rootPath: rootAbs,
        skipped: skipped.map((s) => ({ relPath: s.relPath, reason: s.reason })),
      });
    }

    deps.onLoaded?.(metadata);
    emitter.emit('reloaded', metadata);

    return bundle;
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  function buildAndCacheError(err: unknown): HarnessLoadErrorPayload {
    if (err instanceof HarnessLoadError) {
      const payload = err.payload;
      deps.logger.error('harness.loadError', { ...payload });
      emitter.emit('loadError', payload);
      return payload;
    }
    const payload: HarnessLoadErrorPayload = {
      code: 'IO_ERROR',
      message: err instanceof Error ? err.message : String(err),
      rootPath,
    };
    deps.logger.error('harness.loadError', { ...payload });
    emitter.emit('loadError', payload);
    return payload;
  }

  /**
   * Force a fresh walk + cache replace. Concurrent callers reuse the
   * in-flight promise. On failure the previous cache is preserved.
   */
  async function loadOrReload(): Promise<HarnessBundle> {
    if (inFlight) return inFlight;
    const p = (async (): Promise<HarnessBundle> => {
      try {
        return await performLoad();
      } catch (err) {
        const payload = buildAndCacheError(err);
        // Re-throw a structured error so callers can `.catch` if they want.
        throw new HarnessLoadError(payload);
      } finally {
        inFlight = null;
      }
    })();
    inFlight = p;
    return p;
  }

  return {
    async getHarness() {
      if (cached) return cached;
      return loadOrReload();
    },
    async getMetadata() {
      const b = cached ?? (await loadOrReload());
      return b.metadata;
    },
    async reload() {
      // Drop the cached pointer ONLY if the new load succeeds (preserve on
      // failure — see `performLoad` / `buildAndCacheError`).
      const previous = cached;
      try {
        return await loadOrReload();
      } catch (err) {
        // Restore — we never want a successful previous bundle replaced by
        // a thrown error during reload.
        cached = previous;
        throw err;
      }
    },
    async setRootPath(p) {
      const previous = rootPath;
      rootPath = p;
      try {
        return await loadOrReload();
      } catch (err) {
        // Roll the path back so the user's previous root remains the source
        // of truth — the renderer can then keep showing "the previous load
        // is still cached at <previous>" while the user picks again.
        rootPath = previous;
        throw err;
      }
    },
    getRootPath() {
      return rootPath;
    },
    onReloaded(cb) {
      emitter.on('reloaded', cb);
      return () => emitter.off('reloaded', cb);
    },
    onLoadError(cb) {
      emitter.on('loadError', cb);
      return () => emitter.off('loadError', cb);
    },
    async shutdown() {
      cached = null;
      inFlight = null;
      emitter.removeAllListeners();
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the absolute path used for the actual walk. */
function resolveRoot(p: string): string {
  return path.resolve(p);
}

function buildWarnings(
  fileCount: number,
  skipped: readonly SkipRecord[],
): string[] {
  const out: string[] = [];
  if (fileCount === 0) {
    out.push('empty harness directory');
  }
  // Aggregate skip reasons for the metadata view (settings panel). Map is
  // used in lieu of an object so the type system tracks `undefined`-on-miss
  // — the strict-type-checked lint rule rejects record-style access for
  // optional reads.
  const buckets = new Map<SkipRecord['reason'], string[]>();
  for (const s of skipped) {
    const list = buckets.get(s.reason) ?? [];
    list.push(s.relPath);
    buckets.set(s.reason, list);
  }
  const susName = buckets.get('suspiciousName');
  if (susName && susName.length > 0) {
    out.push(`suspicious filename excluded: ${susName.join(', ')}`);
  }
  const susContent = buckets.get('suspiciousContent');
  if (susContent && susContent.length > 0) {
    out.push(`suspicious content excluded: ${susContent.join(', ')}`);
  }
  const oversize = buckets.get('oversize');
  if (oversize && oversize.length > 0) {
    out.push(`oversize files skipped: ${oversize.join(', ')}`);
  }
  const pdfSkipped = buckets.get('pdfSkipped');
  if (pdfSkipped && pdfSkipped.length > 0) {
    out.push(
      `pdf files skipped (${String(pdfSkipped.length)}): ${pdfSkipped
        .slice(0, 3)
        .join(', ')}`,
    );
  }
  const readFailed = buckets.get('readFailed');
  if (readFailed && readFailed.length > 0) {
    out.push(`read failures: ${readFailed.join(', ')}`);
  }
  const manifestMissing = buckets.get('manifestMissing');
  if (manifestMissing && manifestMissing.length > 0) {
    out.push(`manifest priority paths not found: ${manifestMissing.join(', ')}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Production fs adapter
// ---------------------------------------------------------------------------

/**
 * Build the production `HarnessFsLike` against `node:fs/promises`. The
 * walker uses `fs.readdir(..., { recursive: true, withFileTypes: true })`
 * which is native on Node 20+ — no `fast-glob` dep needed. Symlinks are
 * NOT followed (PRD §3.7 — symlink loops avoided).
 */
export function createNodeHarnessFs(): HarnessFsLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsp = require('node:fs/promises') as typeof import('node:fs/promises');
  return {
    async walk(root) {
      const entries = await fsp.readdir(root, {
        recursive: true,
        withFileTypes: true,
      });
      const out: { relPath: string; absPath: string; stat: HarnessFileStat }[] = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (e.isSymbolicLink()) continue;
        // Node 20.x: `Dirent.parentPath` is the absolute parent path. Older
        // builds expose `.path`; check both for safety.
        const parentPath: string =
          (e as Dirent20Compat).parentPath ?? (e as Dirent20Compat).path ?? root;
        const absPath = path.join(parentPath, e.name);
        const relPath = toPosixRelPath(root, absPath);
        let s: Stats;
        try {
          s = await fsp.stat(absPath);
        } catch {
          continue;
        }
        out.push({
          relPath,
          absPath,
          stat: { size: s.size, mtimeMs: s.mtimeMs, isFile: s.isFile() },
        });
      }
      return out;
    },
    async readFile(absPath) {
      return fsp.readFile(absPath, 'utf8');
    },
    async realpath(absPath) {
      return fsp.realpath(absPath);
    },
    async exists(absPath) {
      try {
        await fsp.access(absPath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Internal compat shape for Node 18→20 `Dirent` differences. */
interface Dirent20Compat {
  parentPath?: string;
  path?: string;
}
