# Arch Public AI Overlay

Always-on-top AI co-pilot for TradingView + Arch Public algorithms. Internal
demo / MVP — see [`../Context.md`](../Context.md) for vision and
[`security-harness-PRD.md`](security-harness-PRD.md) for the Phase 0 security
invariants that govern the current build.

**Current status:** Chunks 1–5 and the Phase 0 security harness are implemented
in code. Chunk 6 (observability polish) and Chunk 7 (packaging / demo polish)
remain. No chunk has passed macOS hardware acceptance yet — see
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
Right-click the chat header for capture controls:

- **Capture now** / **Toggle auto-capture**
- **Set capture region…** (opens the fullscreen region picker)

On first launch macOS prompts for screen-recording permission — grant it, then
set a capture region over your TradingView chart via the context menu. Paste a
Gemini API key in **Settings → AI** before sending chat messages.

## Quality gates

```bash
npm run typecheck   # strict TS on main, preload, renderer
npm run lint        # ESLint (src + scripts)
npm test            # Vitest (~310 cases)
npm run test:coverage  # branch thresholds on chatOrchestrator + firewall
npm run red-team    # adversarial disclosure gate smoke
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
| `npm run test:coverage` | Vitest with branch thresholds (orchestrator + firewall) |
| `npm run red-team` | Deterministic firewall red-team smoke |
| `npm run build:knowledge` | Offline servable bundle pipeline (`knowledge/bundles/`) |
| `npm run typecheck` | Strict typecheck (three tsconfigs) |
| `npm run lint` | ESLint — `@typescript-eslint/strict-type-checked` + scripts |

## Where things live

- `logs/app-YYYY-MM-DD.jsonl` — structured pino logs (created at first launch).
- `CLAUDE_HANDOFF.md` — append-only AI-to-AI session log. Never overwrite.
- `project-state.md` — seven-chunk checklist + Mac acceptance status.
- `knowledge/` — D-3-reviewed abstraction JSON + offline bundle output (servable
  tier only; raw proprietary source never enters the model).
- `security-harness-PRD.md` — Phase 0 security spec (supersedes Context.md §8
  on encryption and harness injection).

## Sources of truth

1. **`security-harness-PRD.md`** — security invariants, knowledge architecture,
   firewall, and Phase 0 acceptance criteria.
2. **`../Context.md`** — product vision and MVP scope (amended 2026-06-10 to
   reflect the chat-first UX and security pivot; see §1 amendment note).
3. **`../MVP_Chunking_Plan.md`** — seven-chunk delivery sequence.

Propose changes to Context or the security PRD before changing behavior that
contradicts them.
