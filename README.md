# Arch Public AI Overlay

Always-on-top AI co-pilot for Arch Public sales and CS employees during live
client video calls. Captures the client's shared TradingView screen, grounds
answers in the full published documentation corpus, and returns structured
suggestions with a client-safe talk track.

See [`../Context.md`](../Context.md) (v0.3.0) for vision and
[`../PRD_Internal_Copilot_Pivot.md`](../PRD_Internal_Copilot_Pivot.md) for the
approved product direction.

**Current status:** Internal co-pilot pivot Phases 0–5 complete in code.
Phase 6 (eval bank + latency sweep) and Mac acceptance remain. See
[`project-state.md`](project-state.md) and [`MAC_ACCEPTANCE.md`](MAC_ACCEPTANCE.md).

## Prerequisites

- macOS 14+ (Windows port is post-MVP per `Context.md §3`)
- [nvm](https://github.com/nvm-sh/nvm) — Node 20.x LTS activates from `.nvmrc`

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

CI (`.github/workflows/ci.yml`) runs the same gates on `macos-latest` for every
push to `main` / `dev`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite + main watch + preload bundle + Electron |
| `npm run build` | Typecheck → Vite renderer → tsc main → preload bundle |
| `npm run package` | Local unsigned `.app` inspection (`electron-builder --dir`) |
| `npm test` | Vitest unit + smoke suite |
| `npm run test:coverage` | Vitest with branch thresholds (orchestrator) |
| `npm run ingest:docs` | Fetch docs.archpublic.com pages, snapshot corpus, emit bundle |
| `npm run typecheck` | Strict typecheck (three tsconfigs) |
| `npm run lint` | ESLint — `@typescript-eslint/strict-type-checked` + scripts |

## Where things live

- `logs/app-YYYY-MM-DD.jsonl` — structured pino logs (created at first launch).
- `CLAUDE_HANDOFF.md` — append-only AI-to-AI session log. Never overwrite.
- `project-state.md` — chunk checklist + pivot phase status.
- `knowledge/docs-corpus/` — verbatim page snapshots from ingest (committed).
- `knowledge/bundles/docs-*.json` — content-hashed chunk bundle loaded at runtime.
- `security-harness-PRD.md` — **superseded** Phase 0 security spec (archived).

## Sources of truth

1. **`../PRD_Internal_Copilot_Pivot.md`** — approved product direction, schema v3,
   persona v3, acceptance criteria.
2. **`../Context.md`** — product vision and MVP scope (v0.3.0, internal co-pilot).
3. **`../EXECUTION_PLAN_Internal_Copilot_Pivot.md`** — phase-by-phase implementation plan.

Propose changes to Context or the pivot PRD before changing behavior that
contradicts them.

## Internal demo acceptance

Before wide internal rollout, run the **eval bank** (20 call scenarios in
`EXECUTION_PLAN_Internal_Copilot_Pivot.md` §Phase 6) and the **call-simulation
flow** in `MAC_ACCEPTANCE.md` Phase H (Zoom screen-share + region capture +
latency check). Targets: p50 ≤ 6s, p95 ≤ 12s per send.
