# Arch Public AI Overlay

Always-on-top AI co-pilot for Arch Public sales and CS employees during live
client video calls. Captures the client's shared TradingView screen, grounds
answers in the full published documentation corpus, and returns structured
suggestions with a client-safe talk track.

See [`../Context.md`](../Context.md) (v0.3.0) for vision and
[`../PRD_Internal_Copilot_Pivot.md`](../PRD_Internal_Copilot_Pivot.md) for the
approved product direction.

**Current status:** Internal co-pilot pivot complete in code. Chunk 7 packaging
ships Windows 10/11 x64 + macOS arm64 alphas via
[`AI-Overlay-releases`](https://github.com/alexarchpublic/AI-Overlay-releases)
(`v0.2.0-alpha.1`). Windows hardware acceptance + S1 pilot remain. See
[`project-state.md`](project-state.md), [`WIN_ACCEPTANCE.md`](WIN_ACCEPTANCE.md),
[`INSTALL_WINDOWS.md`](INSTALL_WINDOWS.md), and [`DISTRIBUTION.md`](DISTRIBUTION.md).

## Prerequisites

- **Windows 10/11 x64** (CS distribution target) or **macOS 14+ arm64**
- [nvm](https://github.com/nvm-sh/nvm) / nvm-windows — Node 20.x LTS from `.nvmrc`

## Run it

```bash
nvm use
npm ci
npm run dev
```

The **chat window** opens as the primary surface (480×640, always-on-top).
Select the active algorithm in the header (Market Wave default). Right-click
the chat header for capture controls:

- **Capture now** / **Toggle auto-capture**
- **Set capture region…** (opens the fullscreen region picker)

On first launch macOS prompts for screen-recording permission — grant it, then
set a capture region over the **client's shared screen** in your meeting window
(Zoom/Meet). Paste a Gemini API key in **Settings → AI** before sending chat
messages.

## Knowledge corpus

The model answers from published docs at `docs.archpublic.com`, ingested
verbatim. A committed bundle ships with the app; refresh when docs change:

```bash
npm run ingest:docs
```

See [`knowledge/README.md`](knowledge/README.md) for the ingest workflow and
corpus layout.

## Quality gates

```bash
npm run typecheck   # strict TS on main, preload, renderer
npm run lint        # ESLint (src + scripts)
npm test            # Vitest (256 cases)
npm run test:coverage  # branch thresholds on chatOrchestrator
```

CI (`.github/workflows/ci.yml`) runs typecheck/lint/test on `macos-latest` and
`windows-latest` for pushes to `main` / `dev` / `chunk-7/packaging-windows`.
Coverage stays macOS-only.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite + main watch + preload bundle + Electron |
| `npm run build` | Typecheck → Vite renderer → tsc main → preload bundle |
| `npm run package` | Local unsigned unpacked dir (`electron-builder --dir`) |
| `npm run package:mac` | macOS arm64 `.dmg` + `.zip` (publish never) |
| `npm run package:win` | Windows x64 NSIS installer (publish never; run on Windows) |
| `npm run release` | Build win+mac and publish to `AI-Overlay-releases` (CI) |
| `npm test` | Vitest unit + smoke suite |
| `npm run test:coverage` | Vitest with branch thresholds (orchestrator) |
| `npm run ingest:docs` | Fetch docs.archpublic.com pages, snapshot corpus, emit bundle |
| `npm run eval:bank` | Live 20-scenario eval sweep (requires `GEMINI_API_KEY`) |
| `npm run typecheck` | Strict typecheck (three tsconfigs) |
| `npm run lint` | ESLint — `@typescript-eslint/strict-type-checked` + scripts |
| `node scripts/win-acceptance.mjs` | Windows automated acceptance slice + Chunk 7 grep contracts |
| `node scripts/mac-acceptance.mjs` | macOS automated acceptance slice |

## Where things live

- `logs/app-YYYY-MM-DD.jsonl` — structured pino logs (created at first launch).
- Packaged Windows logs: `%APPDATA%\arch-public-ai-overlay\logs\`.
- `CLAUDE_HANDOFF.md` — append-only AI-to-AI session log. Never overwrite.
- `project-state.md` — chunk checklist + pivot / Chunk 7 status.
- `knowledge/docs-corpus/` — verbatim page snapshots from ingest (committed).
- `knowledge/bundles/docs-*.json` — content-hashed chunk bundle loaded at runtime.
- `DISTRIBUTION.md` — operator release / rollback / key rotation runbook.
- `security-harness-PRD.md` — **superseded** Phase 0 security spec (archived).

## Sources of truth

1. **`../PRD_Internal_Copilot_Pivot.md`** — approved product direction, schema v3,
   persona v3, acceptance criteria.
2. **`../Context.md`** — product vision and MVP scope (v0.3.1, cross-platform).
3. **`../PRD_Chunk_7_Packaging_Windows_Internal_Distribution.md`** — packaging,
   Windows port, releases.
4. **`../EXECUTION_PLAN_Internal_Copilot_Pivot.md`** — pivot phase plan.

Propose changes to Context or the governing PRD before changing behavior that
contradicts them.

## Internal demo acceptance

- **Windows (distribution target):** `WIN_ACCEPTANCE.md` Phases A–H on two machines;
  CS install path in `INSTALL_WINDOWS.md`.
- **macOS:** `MAC_ACCEPTANCE.md` (D14 — not a Chunk 7 hard gate).
- **Eval bank:** 20 call scenarios in `EXECUTION_PLAN_Internal_Copilot_Pivot.md`
  §Phase 6. Targets: p50 ≤ 6s, p95 ≤ 12s per send.
