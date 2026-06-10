# Arch Public AI Overlay

Always-on-top AI co-pilot for TradingView + Arch Public algorithms. Internal
demo / MVP — see `../Context.md` for the full vision and `../MVP_Chunking_Plan.md`
for the seven-chunk delivery plan. This repository is currently at the end of
**Chunk 1: App Shell & Dev Foundation** (`../PRD_Chunk_1_App_Shell.md`).

## Prerequisites

- macOS 14+ (Windows port is post-MVP per `Context.md §3`)
- [nvm](https://github.com/nvm-sh/nvm) — Node 20.x LTS activates from `.nvmrc`

## Run it

```bash
nvm use
npm install
npm run dev
```

The chat window opens as the primary surface. Right-click the chat header for
capture controls (Capture now / Toggle auto-capture / Set capture region…).
On first launch macOS will prompt for screen-recording permission — grant it,
then set a capture region over your TradingView window via the context menu.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Launches Vite, compiles main in watch mode, then starts Electron once both are ready |
| `npm run build` | Typecheck → bundle renderer (Vite) → compile main (tsc) |
| `npm run package` | `electron-builder --dir` — local inspection only, no signing (Chunk 7) |
| `npm test` | Runs the Vitest smoke suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | Strict typecheck on both main and renderer tsconfigs |
| `npm run lint` | ESLint — `@typescript-eslint/strict-type-checked` |
| `npm run format` | Prettier over the whole tree |

## Where things live

- `logs/app-YYYY-MM-DD.jsonl` — structured pino logs (created at first launch).
- `CLAUDE_HANDOFF.md` — append-only AI-to-AI session log (repo root). Never overwrite.
- `project-state.md` — seven-chunk checklist tracking MVP progress.
- `arch-public-harness/` — gitignored drop-folder for proprietary source. See
  the README inside for the expected layout; Chunk 4 consumes it.

## Single source of truth

`../Context.md` is the project's source of truth. Nothing in code or docs
should contradict it — propose changes to the Context before changing
behavior.
