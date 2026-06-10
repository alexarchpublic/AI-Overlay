# arch-public-harness/

This folder is the drop-zone for the proprietary Arch Public algorithm source
code and supporting documentation. **The real contents are gitignored** —
only this README and the optional `HARNESS_INDEX.json.example` are committed.
The Chunk 4 harness loader (`src/main/harnessLoader.ts`) reads this directory
on app start; without contents, the loader emits a `harness.empty` warning
and the app's chat surface (Chunk 5) shows "no harness loaded — point the
app at your Arch Public folder in settings."

## Resolved root path (PRD §0 D1)

The active root is resolved in this order, first match wins:

1. User-overridden value persisted in `electron-store` under `harness.rootPath`
   (set via Settings → Harness → "Browse for harness folder…")
2. `<userData>/arch-public-harness/` (default for packaged builds)
3. Repo-relative `./arch-public-harness/` (dev only — fallback when 2 is empty)

## Expected layout

```
arch-public-harness/
├── algorithms/
│   ├── trend-following/
│   ├── mean-reversion/
│   └── ...
├── docs/
│   ├── parameter-glossary.md
│   ├── strategy-whitepaper.md   # text-extracted — PDFs are NOT parsed at load time
│   └── ...
├── README.md
└── HARNESS_INDEX.json           # optional curation manifest (PRD §0 D14)
```

## Supported file types (PRD §0 D2)

`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.py`, `.md`, `.mdx`, `.txt` —
case-insensitive. Binaries are ignored. Extract any PDF prose to markdown
or plain text before dropping it here; PDFs encountered at the root are
logged once via `harness.pdfSkipped` and excluded from the bundle.

## Ignored paths (PRD §0 D3)

Anything under `node_modules/`, `.git/`, `dist/`, `build/`, `.venv/`,
`__pycache__/`; lockfiles (`*.lock`); minified bundles (`*.min.*`); dotfiles
matching `.env*`/`.DS_Store`; and any single file larger than 2 MB.

## Optional curation manifest (`HARNESS_INDEX.json`) — PRD §0 D14

Drop a JSON file at the root with any of three keys to override the defaults:

```json
{
  "include": ["algorithms/**/*.ts", "docs/strategy-whitepaper.md"],
  "exclude": ["docs/internal-notes.md"],
  "priority": ["algorithms/trend-following/index.ts", "docs/strategy-whitepaper.md"]
}
```

Behavior:

- `include` — when set, ONLY these files (POSIX-relative globs) are loaded.
  When unset, the default extension filter applies.
- `exclude` — additional ignore patterns layered on top of the defaults.
- `priority` — explicit ordering; listed files come first in the listed
  order, then everything else falls back to alphabetical.

A malformed manifest produces a `MANIFEST_INVALID` error at load time and
the previously-cached bundle (if any) is preserved. Settings surfaces a red
banner with the parser detail.

See `HARNESS_INDEX.json.example` for a fully commented template.

## Do not commit proprietary source

- The repo `.gitignore` excludes everything under `arch-public-harness/`
  except `README.md` and `HARNESS_INDEX.json.example`.
- Do not paste secrets, API keys, or `.env`-style files here. The loader
  flags filenames matching `(\.env|\.pem|\.key|secrets?|credentials?)` and
  any line that looks like an API-key blob (long + high-entropy), and
  excludes the file from the bundle. This is defense-in-depth — the
  primary control is `.gitignore` above.

## Hot reload (dev) vs. read-once (prod) — PRD §0 D9 / §3.6

Dev builds (`npm run dev`) start a `chokidar` watcher that fires a
debounced reload (500 ms quiet window) on every change under the harness
root. Production builds read once at app start and never start the
watcher; click "Reload now" in Settings → Harness to re-read the bundle.
