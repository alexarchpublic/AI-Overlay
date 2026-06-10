/**
 * @file src/shared/harnessConstants.ts
 *
 * Why it exists: PRD §3.1 calls out a dedicated harness-constants module so
 * the extension list, ignore globs, header strings, and token-per-char ratio
 * land in one place. Importing them from `shared/constants.ts` would have
 * worked but bloated the catch-all file; harness rules change as a unit and
 * benefit from co-location with their tests.
 *
 * No magic numbers / strings live in `harnessLoader.ts` or `harnessUtils.ts` —
 * everything tunable is here.
 */

// ---------------------------------------------------------------------------
// Allowed file extensions (PRD §0 D2)
// ---------------------------------------------------------------------------

/**
 * Extensions the loader will read. Lowercase + leading dot. Comparison is
 * case-insensitive at match time so `Foo.MD` and `foo.md` both pass.
 */
export const HARNESS_SUPPORTED_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.md',
  '.mdx',
  '.txt',
];

// ---------------------------------------------------------------------------
// Ignore rules (PRD §0 D3)
// ---------------------------------------------------------------------------

/**
 * Directory names that, if encountered as a path segment, prune the entire
 * subtree. Compared verbatim against POSIX path segments — no globbing.
 */
export const HARNESS_IGNORED_DIR_SEGMENTS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.venv',
  '__pycache__',
];

/**
 * File-name suffixes that exclude a file regardless of extension. Used for
 * lockfiles + minified bundles per PRD §0 D3. Compared case-insensitively.
 */
export const HARNESS_IGNORED_FILE_SUFFIXES: readonly string[] = [
  '.lock',
  '.min.js',
  '.min.css',
  '.min.mjs',
  '.min.cjs',
];

/**
 * Dotfile names that should never be loaded even if their extension would
 * otherwise pass. Matched case-insensitively; `.env` matches `.env`,
 * `.env.local`, `.env.production`, etc. via prefix match.
 */
export const HARNESS_IGNORED_DOTFILE_PREFIXES: readonly string[] = [
  '.env',
  '.ds_store',
];

/** Hard cap on a single file's on-disk size before we skip it (PRD §0 D3). */
export const HARNESS_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

// ---------------------------------------------------------------------------
// Header & envelope (PRD §0 D5/D6)
// ---------------------------------------------------------------------------

/**
 * Per-file header prefix. Final string is `### FILE: <relPath>\n\n`.
 * Matches `Context.md §6` verbatim.
 */
export const HARNESS_FILE_HEADER_PREFIX = '### FILE: ';

/** Per-file separator that follows the file body. */
export const HARNESS_FILE_SEPARATOR = '\n\n---\n\n';

/** Bundle envelope opener — first line of `HarnessBundle.text` (PRD §0 D6). */
export const HARNESS_ENVELOPE_OPENER = '### HARNESS BUNDLE';

// ---------------------------------------------------------------------------
// Token estimation (PRD §0 D7)
// ---------------------------------------------------------------------------

/**
 * Characters-per-token ratio used by the cheap estimator. PRD §0 D7 locks
 * `3.8` for code-heavy bundles. Tunable here; tests assert ±15% against a
 * captured reference so this can drift without breaking the load path.
 */
export const HARNESS_CHARS_PER_TOKEN = 3.8;

// ---------------------------------------------------------------------------
// Token ceiling (PRD §0 D8)
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on the bundle's `approxTokens`. Loader errors with
 * `TOKEN_CEILING_EXCEEDED` if a load would exceed this. Well under Gemini
 * 1.5 Pro's 2M usable window so screenshots + conversation in Chunk 5 still
 * fit comfortably above the bundle.
 */
export const HARNESS_TOKEN_CEILING = 1_500_000;

// ---------------------------------------------------------------------------
// Watcher (PRD §0 D9 / D18)
// ---------------------------------------------------------------------------

/** Debounce window for chokidar reload triggers (PRD §0 D9). */
export const HARNESS_WATCHER_DEBOUNCE_MS = 500;

/** Stability window before chokidar fires `add`/`change` (PRD §3.7 atomicity). */
export const HARNESS_WATCHER_STABILITY_THRESHOLD_MS = 200;

/** Chokidar internal poll interval inside `awaitWriteFinish`. */
export const HARNESS_WATCHER_POLL_INTERVAL_MS = 50;

/** Env var (PRD §0 D18) that opts watcher polling on for network-mounted dirs. */
export const HARNESS_WATCHER_POLLING_ENV = 'HARNESS_WATCHER_POLLING';

// ---------------------------------------------------------------------------
// Manifest (PRD §0 D14)
// ---------------------------------------------------------------------------

/** Filename of the optional curation manifest, located at the harness root. */
export const HARNESS_MANIFEST_FILENAME = 'HARNESS_INDEX.json';

// ---------------------------------------------------------------------------
// Secret hygiene (PRD §0 D13)
// ---------------------------------------------------------------------------

/**
 * Filename regex flagged as suspicious. Matched against the file's BASE name
 * (case-insensitive). A hit excludes the file from the bundle and emits a
 * `harness.suspiciousFile` warn log. Defense-in-depth — primary control is
 * repo `.gitignore`.
 */
export const HARNESS_SUSPICIOUS_FILENAME_REGEX = /(\.env|\.pem|\.key|secrets?|credentials?)/i;

/**
 * Heuristic: a single line longer than this many characters whose Shannon
 * entropy exceeds `HARNESS_HIGH_ENTROPY_BITS_PER_CHAR` is flagged as a
 * probable API-key-like blob. Conservative thresholds to keep false-positive
 * rate low on legitimate Arch Public files.
 */
export const HARNESS_HIGH_ENTROPY_MIN_LINE_LENGTH = 32;
export const HARNESS_HIGH_ENTROPY_BITS_PER_CHAR = 4.5;

// ---------------------------------------------------------------------------
// Settings store keys (PRD §3.4)
// ---------------------------------------------------------------------------

/** electron-store key for the user-overridden harness root path. */
export const HARNESS_STORE_KEY_ROOT_PATH = 'harness.rootPath';
export const HARNESS_STORE_KEY_LAST_LOADED_AT = 'harness.lastLoadedAt';
export const HARNESS_STORE_KEY_LAST_LOAD_DURATION = 'harness.lastLoadDurationMs';
export const HARNESS_STORE_KEY_LAST_FILE_COUNT = 'harness.lastFileCount';
export const HARNESS_STORE_KEY_LAST_APPROX_TOKENS = 'harness.lastApproxTokens';
/** Hidden inspector flag (PRD §0 D17) — analogous to capture.dev.showRecentCaptures. */
export const HARNESS_STORE_KEY_SHOW_INSPECTOR = 'harness.showInspector';

// ---------------------------------------------------------------------------
// Default harness root subdirectory under userData (PRD §0 D1)
// ---------------------------------------------------------------------------

export const HARNESS_DEFAULT_USERDATA_SUBDIR = 'arch-public-harness';
