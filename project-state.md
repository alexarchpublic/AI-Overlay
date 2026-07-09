# Project State — Arch Public AI Overlay

Living backlog tracked against the MVP chunking plan and the internal co-pilot
pivot (`../PRD_Internal_Copilot_Pivot.md`). Tick a box only after end-to-end
verification on a clean macOS 14+ machine (`MAC_ACCEPTANCE.md`).

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
| 6 | Verification & eval bank (20 scenarios, latency sweep, grep contracts) | ⬜ pending |

**Corpus stats (Phase 2 ingest):** 13 pages, 89 chunks, ~28.7k tokens →
`USE_FULL_CORPUS_INJECTION=true` (≤ 50k threshold). Bundle: `docs-bbfecbdd4e1d.json`.

**Test count:** 256 Vitest cases (down from ~315 + 21 red-team after harness removal).

### Pivot acceptance (Phase 6 — not yet run)

- [ ] Grep contracts — zero `firewall` / `EnumerationMonitor` / `d3Pass` / `deep-fingerprints` / `FORBIDDEN` in `src/`, `scripts/`, `tests/`
- [ ] `npm run ingest:docs` produces bundle with all `llms.txt` pages
- [ ] Eval bank — 20 scenario Q&As pass (correct inputs, doc_ref, talk track, no performance promises)
- [ ] Latency — p50 ≤ 6s / p95 ≤ 12s over eval bank sweep
- [ ] Call-simulation acceptance — Zoom screen-share + region capture (`MAC_ACCEPTANCE.md` Phase H)

---

## Infrastructure

- [x] Git repository + baseline history
- [x] CI on `macos-latest` (typecheck, lint, test, coverage)
- [x] `runChatSend` extracted to `chatOrchestrator.ts` with characterization tests
- [x] Legacy harness loader / widget tree removed
- [x] Token-estimate constants unified (`src/shared/tokenEstimate.ts`)
- [x] Electron upgraded to supported major (40+)
- [x] Docs ingestion pipeline (`npm run ingest:docs`)
- [x] OS-keychain API key encryption (fail-closed when unavailable)
- [ ] Mac acceptance run — **no chunk ticked yet** (operator hardware)

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
| 7 — Packaging & Demo Polish | partial (`npm run package` dev-only) | pending |

¹ Chunk 2's overlay pill was removed during the chat-first UX pivot.
² Chunk 4's full-source harness and Phase 0 abstraction pipeline were removed
during the internal co-pilot pivot (2026-07-09). Knowledge is now the ingested
docs corpus (`knowledge/bundles/docs-*.json`).

Checkboxes (tick after Mac DoD):

- [ ] **Chunk 1 — App Shell & Dev Foundation**
- [ ] **Chunk 3 — Screenshot Engine & Region Picker**
- [ ] **Chunk 5 — Gemini Chat + Vision**
- [ ] **Chunk 6 — Rich Logging, Handoff & Observability**
- [ ] **Chunk 7 — Packaging, Permissions & Demo Polish**

## Superseded (archived — do not extend)

- ~~Phase 0 security harness (firewall, enumeration monitor, D-3, red-team)~~ — removed Phase 1
- ~~Abstraction-only knowledge / `build:knowledge` / `generate:abstractions`~~ — replaced by `ingest:docs`
- ~~Manual red-team checklist (`RED_TEAM.md`)~~ — deleted; eval bank replaces it
- ~~Client-facing zero-leakage boundary~~ — trusted internal users; full docs corpus

## Current Focus

1. **Phase 6** — eval bank (20 scenarios), latency sweep, grep contracts, coverage gate
2. **Mac acceptance** — `MAC_ACCEPTANCE.md` Phases A → F + Phase H (call simulation)
3. After acceptance: Chunk 6 observability polish, Chunk 7 signed `.dmg`

Quick verification inside the repo:

```bash
nvm use
npm ci
npm run typecheck && npm run lint && npm test && npm run test:coverage
npm run ingest:docs   # refresh docs corpus (optional; bundle ships committed)
npm run dev           # chat window opens; set region on client screen-share; paste API key
```
