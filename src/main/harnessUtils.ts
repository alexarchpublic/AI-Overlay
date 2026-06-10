/**
 * @file src/main/harnessUtils.ts
 *
 * Why it exists: PRD §3.1 — single source of truth for the pure rules that
 * decide which files the loader includes, how it classifies them, how it
 * estimates tokens, and how it sniffs for secrets. Pulling these out of
 * `harnessLoader.ts` keeps the loader's I/O orchestration readable and lets
 * Vitest exercise every rule against synthetic strings without touching the
 * filesystem.
 *
 * Every function here is pure / synchronous unless noted otherwise.
 */

import path from 'node:path';
import {
  HARNESS_CHARS_PER_TOKEN,
  HARNESS_HIGH_ENTROPY_BITS_PER_CHAR,
  HARNESS_HIGH_ENTROPY_MIN_LINE_LENGTH,
  HARNESS_IGNORED_DIR_SEGMENTS,
  HARNESS_IGNORED_DOTFILE_PREFIXES,
  HARNESS_IGNORED_FILE_SUFFIXES,
  HARNESS_MAX_FILE_BYTES,
  HARNESS_SUPPORTED_EXTENSIONS,
  HARNESS_SUSPICIOUS_FILENAME_REGEX,
} from '../shared/harnessConstants';
import type { HarnessFileMeta, HarnessManifest } from '../shared/types';

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Convert any platform-native path to the POSIX-relative form used in the
 * D5 header and in `HarnessFileMeta.relPath`. Stable across macOS / Linux /
 * (potentially) Windows ports.
 */
export function toPosixRelPath(rootAbs: string, fileAbs: string): string {
  const rel = path.relative(rootAbs, fileAbs);
  // `path.relative` returns OS-native separators; rewrite to POSIX so the
  // bundle text is byte-identical across platforms.
  return rel.split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Extension + ignore matching (PRD §0 D2 / D3)
// ---------------------------------------------------------------------------

/** Extension match (case-insensitive). `relPath` must be POSIX-form. */
export function hasSupportedExtension(relPath: string): boolean {
  const ext = path.posix.extname(relPath).toLowerCase();
  return HARNESS_SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * True iff any path segment matches an ignored directory name. Cheap path
 * walk — no glob engine needed because the ignore list is well-known.
 */
export function isUnderIgnoredDir(relPath: string): boolean {
  const segments = relPath.split('/');
  // Drop the leaf (file) — it's checked by the dotfile / suffix rules.
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i] ?? '';
    if (HARNESS_IGNORED_DIR_SEGMENTS.includes(seg)) return true;
  }
  return false;
}

/** True iff the file's BASE name starts with an ignored dotfile prefix. */
export function isIgnoredDotfile(relPath: string): boolean {
  const base = path.posix.basename(relPath).toLowerCase();
  if (!base.startsWith('.')) return false;
  for (const prefix of HARNESS_IGNORED_DOTFILE_PREFIXES) {
    if (base === prefix || base.startsWith(`${prefix}.`) || base.startsWith(`${prefix}-`)) {
      return true;
    }
  }
  // Catch-all for hidden files we don't otherwise care about. Per PRD D3,
  // dotfiles with extensions we'd otherwise read (.env.local etc.) still
  // get caught above; truly unknown dotfiles fall through to the extension
  // check, which excludes them by default.
  return false;
}

/** True iff the file's name carries an ignored suffix (lockfile, minified). */
export function hasIgnoredSuffix(relPath: string): boolean {
  const base = path.posix.basename(relPath).toLowerCase();
  return HARNESS_IGNORED_FILE_SUFFIXES.some((suf) => base.endsWith(suf));
}

/**
 * Composite: does this file pass the default include rules? Manifest
 * overrides are applied separately by the loader.
 */
export function passesDefaultIncludeRules(relPath: string): boolean {
  if (isUnderIgnoredDir(relPath)) return false;
  if (isIgnoredDotfile(relPath)) return false;
  if (hasIgnoredSuffix(relPath)) return false;
  if (!hasSupportedExtension(relPath)) return false;
  return true;
}

/** True iff the file size exceeds the per-file cap. */
export function exceedsMaxFileBytes(bytes: number): boolean {
  return bytes > HARNESS_MAX_FILE_BYTES;
}

// ---------------------------------------------------------------------------
// Classification (PRD §0 D15)
// ---------------------------------------------------------------------------

export function classifyFile(relPath: string): HarnessFileMeta['classification'] {
  if (relPath.startsWith('algorithms/')) return 'algorithms';
  if (relPath.startsWith('docs/')) return 'docs';
  const ext = path.posix.extname(relPath).toLowerCase();
  if (ext === '.md' || ext === '.mdx' || ext === '.txt') return 'docs';
  return 'other';
}

// ---------------------------------------------------------------------------
// Token estimation (PRD §0 D7)
// ---------------------------------------------------------------------------

/**
 * Cheap character-based token estimate: `ceil(chars / HARNESS_CHARS_PER_TOKEN)`.
 * Tests assert ±15% against a Gemini-tokenizer captured reference.
 */
export function estimateTokens(charCount: number): number {
  if (charCount <= 0) return 0;
  return Math.ceil(charCount / HARNESS_CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Secret-hygiene checks (PRD §0 D13)
// ---------------------------------------------------------------------------

/**
 * Filename hit. Matched against the BASE name only — a directory called
 * `secrets/` does NOT trip the regex; only files like `secrets.env` or
 * `keys.pem` do.
 */
export function hasSuspiciousFilename(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  return HARNESS_SUSPICIOUS_FILENAME_REGEX.test(base);
}

/**
 * Cheap Shannon entropy of a string in bits/char. ~4.5 bits/char is roughly
 * the threshold where random base64 / hex blobs sit; English prose lands
 * around 3.5–4 bits/char. Used only to flag suspicious lines, not to make
 * load decisions.
 */
export function shannonEntropyBitsPerChar(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const len = s.length;
  let H = 0;
  for (const c of counts.values()) {
    const p = c / len;
    H -= p * Math.log2(p);
  }
  return H;
}

/**
 * True iff any text token (or quoted string literal) in `text` looks like
 * an API-key blob — long enough, no embedded whitespace, high Shannon
 * entropy. We tokenize by stripping common code chrome (quotes, brackets,
 * commas, semicolons) and then split on whitespace so `const KEY = "blob"`
 * is detected by the blob token, not by the assignment chrome.
 *
 * The first matching token in the file wins — once we know the file is
 * being excluded, scanning more tokens is wasted work.
 */
export function containsHighEntropyLine(text: string): boolean {
  const lines = text.split('\n');
  for (const raw of lines) {
    // Replace common code-chrome characters with spaces so they don't fuse
    // a token to its surrounding syntax (`KEY="blob"` → `KEY  blob `).
    const stripped = raw.replace(/["'`<>{}[\](),;:]/g, ' ');
    for (const tok of stripped.split(/\s+/)) {
      if (tok.length < HARNESS_HIGH_ENTROPY_MIN_LINE_LENGTH) continue;
      // A token containing only digits or only one repeated character is
      // long but low-entropy — let the entropy check decide.
      const H = shannonEntropyBitsPerChar(tok);
      if (H >= HARNESS_HIGH_ENTROPY_BITS_PER_CHAR) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Manifest validation (PRD §0 D14)
// ---------------------------------------------------------------------------

export interface ManifestParseResult {
  ok: boolean;
  manifest?: HarnessManifest;
  /** Parser-level reason — surfaced verbatim in `MANIFEST_INVALID.detail`. */
  error?: string;
}

/**
 * Parse + validate the optional `HARNESS_INDEX.json`. Returns a structured
 * result rather than throwing so the loader can decide whether to surface
 * the failure as `MANIFEST_INVALID` or proceed without the manifest.
 */
export function parseManifest(rawText: string): ManifestParseResult {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'manifest root must be an object' };
  }
  const obj = json as Record<string, unknown>;
  for (const key of ['include', 'exclude', 'priority']) {
    const v = obj[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      return { ok: false, error: `manifest.${key} must be a string[] when present` };
    }
  }
  const manifest: HarnessManifest = {
    ...(obj.include !== undefined ? { include: obj.include as readonly string[] } : {}),
    ...(obj.exclude !== undefined ? { exclude: obj.exclude as readonly string[] } : {}),
    ...(obj.priority !== undefined ? { priority: obj.priority as readonly string[] } : {}),
  };
  return { ok: true, manifest };
}

/**
 * Apply the manifest's exclude/include rules to a candidate POSIX path.
 * Returns `'include' | 'exclude' | 'default'` so the loader can decide
 * whether the path overrides the default include rules or just adds an
 * extra exclusion.
 */
export function applyManifestToPath(
  relPath: string,
  manifest: HarnessManifest | null,
): 'include' | 'exclude' | 'default' {
  if (!manifest) return 'default';
  const exclude = manifest.exclude ?? [];
  for (const pat of exclude) {
    if (matchesGlob(relPath, pat)) return 'exclude';
  }
  const include = manifest.include ?? [];
  if (include.length === 0) return 'default';
  for (const pat of include) {
    if (matchesGlob(relPath, pat)) return 'include';
  }
  return 'exclude'; // include[] is set but no pattern matched → exclude
}

/**
 * Minimal glob: supports `*` (anything except `/`), `**` (anything across
 * segments), `**\/` (zero-or-more segments + a slash). No braces, no
 * character classes — simpler than micromatch because manifests in this
 * project will be small and curated. If a use case needs more, swap to
 * micromatch and update tests.
 *
 * Critical edge case: `algorithms/**\/*.ts` must match BOTH `algorithms/foo.ts`
 * AND `algorithms/sub/foo.ts`. We translate `**\/` to `(?:.*\/)?` so the
 * directory portion is optional (zero-or-more segments-with-trailing-slash).
 */
export function matchesGlob(p: string, glob: string): boolean {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        // `**\/` — zero-or-more path segments followed by a slash.
        re += '(?:.*/)?';
        i += 3;
        continue;
      }
      // bare `**` — match anything (including `/`).
      re += '.*';
      i += 2;
      continue;
    }
    if (c === '*') {
      re += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i++;
      continue;
    }
    if (/[.+()|^$\\[\]{}]/.test(c)) {
      re += `\\${c}`;
      i++;
      continue;
    }
    re += c;
    i++;
  }
  re += '$';
  return new RegExp(re).test(p);
}

// ---------------------------------------------------------------------------
// Ordering (PRD §0 D4 — POSIX-normalized alphabetical, stable)
// ---------------------------------------------------------------------------

/**
 * Sort comparator for relative POSIX paths. Case is preserved (PRD §0 D4
 * "lowercase comparison disabled — preserve case for stability across
 * case-insensitive filesystems"). The sort is stable in V8.
 */
export function comparePosixRelPaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Apply manifest-driven priority ordering. Files listed in `priority` come
 * first in the listed order; everything else falls back to alphabetical.
 * Files in `priority` that don't actually exist in `paths` are silently
 * skipped (the loader logs them via `metadata.warnings`).
 */
export function orderPaths(
  paths: readonly string[],
  manifest: HarnessManifest | null,
): readonly string[] {
  const priority = manifest?.priority ?? [];
  if (priority.length === 0) {
    return [...paths].sort(comparePosixRelPaths);
  }
  const pathSet = new Set(paths);
  const out: string[] = [];
  const used = new Set<string>();
  for (const p of priority) {
    if (pathSet.has(p) && !used.has(p)) {
      out.push(p);
      used.add(p);
    }
  }
  const rest = paths.filter((p) => !used.has(p)).sort(comparePosixRelPaths);
  return [...out, ...rest];
}
