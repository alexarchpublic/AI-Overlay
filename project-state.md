# Project State — Arch Public AI Overlay

Living backlog tracked against the MVP chunking plan and the internal co-pilot
pivot (`../PRD_Internal_Copilot_Pivot.md`). Tick a box only after end-to-end
verification on clean hardware (`MAC_ACCEPTANCE.md` / `WIN_ACCEPTANCE.md`).

## Internal Co-Pilot Pivot (2026-07-09)

Branch: `pivot/internal-copilot` · one commit per phase · see
`../EXECUTION_PLAN_Internal_Copilot_Pivot.md`.

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Preflight (baseline green, branch created) | ✅ complete |
| 1 | Security-harness teardown (D-P1) | ✅ complete |
| 2 | Docs ingestion pipeline (D-P2, D-P3, D-P11) | ✅ complete |
| 3 | Persona v3, schema v3, prompt composition (D-P5, D-P6, D-P8) | ✅ complete |
| 4 | Renderer — talk track, quick prompts, algorithm picker, Knowledge settings (D-P7, D-P9, D-P10) | ✅ complete |
| 5 | Project docs reset (D-P12) | ✅ complete |
| 6 | Verification & eval bank (20 scenarios, latency sweep, grep contracts) | ✅ complete |

**Corpus stats (Phase 6 ingest refresh):** 13 pages, 89 chunks, ~28.7k tokens →
`USE_FULL_CORPUS_INJECTION=true` (≤ 50k threshold). Bundle: `docs-bbfecbdd4e1d.json`.

**Test count (optimizer integration):** 420 Vitest cases + 2 env-gated live
e2e (Chunk 7 baseline was 371; pivot baseline 280).

### Pivot acceptance (Phase 6)

- [x] Grep contracts — zero `firewall` / `EnumerationMonitor` / `d3Pass` / `deep-fingerprints` in `src/`, `scripts/`, `tests/`
- [x] `npm run ingest:docs` produces bundle with all 13 `llms.txt` pages (hash unchanged: `bbfecbdd4e1d`)
- [x] Eval bank offline — 20/20 scenarios ground in injected corpus (`tests/evalBank.spec.ts`)
- [ ] Live eval bank — operator runs `GEMINI_API_KEY=... npm run eval:bank` (20 scenarios, must-hit + talk track + no performance promises)
- [ ] Latency — p50 ≤ 6s / p95 ≤ 12s over live eval bank sweep
- [ ] Call-simulation acceptance — Zoom screen-share + region capture (`MAC_ACCEPTANCE.md` Phase H)

---

## Infrastructure

- [x] Git repository + baseline history
- [x] CI matrix `macos-latest` + `windows-latest` (typecheck, lint, test; coverage macOS only)
- [x] `runChatSend` extracted to `chatOrchestrator.ts` with characterization tests
- [x] Legacy harness loader / widget tree removed
- [x] Token-estimate constants unified (`src/shared/tokenEstimate.ts`)
- [x] Electron upgraded to supported major (40+)
- [x] Docs ingestion pipeline (`npm run ingest:docs`)
- [x] OS-keychain API key encryption (fail-closed when unavailable)
- [x] Public releases repo `alexarchpublic/AI-Overlay-releases` + tag-triggered `release.yml`
- [x] Windows NSIS + macOS dmg/zip artifacts for `v0.2.0-alpha.1`
- [ ] Mac acceptance run — **no chunk ticked yet** (operator hardware; D14 not a Chunk 7 hard gate)
- [ ] Windows acceptance Phases A–H on two machines (`WIN_ACCEPTANCE.md`)
- [ ] S1 pilot — two CS users, ≥1 real client call each

## MVP Chunks

Implementation status in code vs. Mac acceptance:

| Chunk | Implemented | Mac acceptance |
|-------|-------------|----------------|
| 1 — App Shell & Dev Foundation | yes | pending |
| 2 — Always-On-Top Widget | superseded by chat-first UX¹ | n/a |
| 3 — Screenshot Engine & Region Picker | yes | pending |
| 4 — Harness Loader | superseded by docs-corpus pipeline² | n/a |
| 5 — Gemini Chat + Vision | yes (schema v3 + talk track) | pending |
| 6 — Rich Logging & Observability | partial (D28 events enforced) | pending |
| 7 — Packaging, Windows Port & Internal Distribution | yes (Phases 0–6 docs/pipeline) | pending hardware + pilot |

¹ Chunk 2's overlay pill was removed during the chat-first UX pivot.
² Chunk 4's full-source harness and Phase 0 abstraction pipeline were removed
during the internal co-pilot pivot (2026-07-09). Knowledge is now the ingested
docs corpus (`knowledge/bundles/docs-*.json`).

Checkboxes (tick after DoD):

- [ ] **Chunk 1 — App Shell & Dev Foundation**
- [ ] **Chunk 3 — Screenshot Engine & Region Picker**
- [ ] **Chunk 5 — Gemini Chat + Vision**
- [ ] **Chunk 6 — Rich Logging, Handoff & Observability**
- [ ] **Chunk 7 — Packaging, Windows Port & Internal Distribution** (code + docs Phases 0–6; Gate 5.7/5.8 update loop + Gate 6.5/6.7 hardware/pilot remain)

## Superseded (archived — do not extend)

- ~~Phase 0 security harness (firewall, enumeration monitor, D-3, red-team)~~ — removed Phase 1
- ~~Abstraction-only knowledge / `build:knowledge` / `generate:abstractions`~~ — replaced by `ingest:docs`
- ~~Manual red-team checklist (`RED_TEAM.md`)~~ — deleted; eval bank replaces it
- ~~Client-facing zero-leakage boundary~~ — trusted internal users; full docs corpus

## Chunk 7 — Packaging (branch `chunk-7/packaging-windows`)

| Phase | Status |
|-------|--------|
| 0–4 Preflight → Key provisioning | ✅ complete |
| 5 CI, release pipeline, first publish | ✅ [v0.2.0-alpha.1](https://github.com/alexarchpublic/AI-Overlay-releases/releases/tag/v0.2.0-alpha.1) artifacts (`.exe`/`.dmg`/`.zip`/`latest.yml`/`latest-mac.yml`); Gate 5.7/5.8 update loop still needs real Windows |
| 6 Acceptance docs + rollout | ✅ docs/scripts landed (`WIN_ACCEPTANCE.md`, `win-acceptance.mjs`, `INSTALL_WINDOWS.md`, `DISTRIBUTION.md`); **Context.md §3** Windows now In Scope; Gate 6.5/6.7 hardware + pilot **pending operator** |

**Distribution channel:** GitHub Releases on public binaries repo `alexarchpublic/AI-Overlay-releases` + `electron-updater` (Windows silent; macOS notify-only).

**Windows support:** first-class target (10/11 x64). Platform branching via `src/main/platform.ts`.

**Gate 5:** **PARTIAL** — both-platform release assets live; Windows alpha.1→alpha.2 update loop not yet verified on hardware.

**Gate 6:** **PARTIAL** — acceptance + install + distribution docs complete; two-machine A–H pass + two-pilot-user real-call gate still open.

## Optimizer MCP integration (branch `feat/optimizer-mcp`, PRD_Optimizer_MCP_Integration)

| Phase | Scope | Status |
|-------|-------|--------|
| A1–A3 | Optimizer repo: streamable-http + team-key middleware, `mcp` compose service, Caddy `/mcp*` route | ✅ complete (deployed) |
| A4 | Production verification: 401/401/11 tools/`/api/meta` 200, 60/min zone, key absent from caddy logs | ✅ complete (2026-08-14) |
| B1 | Shared types, `optimizer.*` config store, team-config v2, `optimizer:` IPC | ✅ complete |
| B2 | `optimizerMcpService` (D-M5) + production smoke (11 tools, backtest 491 ms) | ✅ complete |
| B3 | Job tracker + Optimizer panel; live e2e: done-with-card / cancel / expired-on-restart | ✅ complete |
| B4 | Bounded Gemini tool loop (≤2 rounds, 15 s/tool, ≤2k-token summaries); disabled ⇒ byte-identical | ✅ complete — live gate 2026-08-14: p50 3.0 s / p95 3.7 s over 20 runs (evidence in CLAUDE_HANDOFF OPT-MCP-002) |
| B5 | Grep contracts, acceptance rows (Phase I), docs fan-out | ✅ complete |
| C | Merge → `v0.3.0-alpha.1` tag → CI publish → config-first rollout | ✅ released 2026-08-14 (operator-directed Friday-rule override): all assets + `latest.yml`/`latest-mac.yml` on AI-Overlay-releases, updater feed verified. Remaining: distribute v2 `team-config.json` to the S1 pair; observe one Windows silent update (DoD #5 / Gate 5.7-5.8) |

## Current Focus

1. **Pilot rollout** — distribute the v2 `team-config.json` (Desktop copy, keys included) to the S1 pilot pair; their 0.2.0-alpha.2 installs auto-update to 0.3.0-alpha.1 within ~4 h (Windows silent / macOS notify)
2. **Gate 5.7/5.8** — Windows update loop verification on hardware (now via alpha.2 → 0.3.0-alpha.1)
3. **Gate 6.5** — execute `WIN_ACCEPTANCE.md` A–I on two distinct Windows machines (iGPU + discrete ideally)
4. **Gate 6.7 / S1** — two CS pilot users, one Slack thread, ≥1 real client call each (now doubles as the optimizer pilot gate, §8.4)
5. Mac acceptance remains open (D14 — not a hard gate for Chunk 7)

Quick verification inside the repo:

```bash
nvm use
npm ci
npm run typecheck && npm run lint && npm test && npm run test:coverage
node scripts/win-acceptance.mjs   # Windows automated slice (also runs typecheck/lint/test/build)
npm run ingest:docs   # refresh docs corpus (optional; bundle ships committed)
npm run eval:bank     # live 20-scenario sweep (requires GEMINI_API_KEY)
npm run dev           # chat window opens; set region on client screen-share; paste API key
```
