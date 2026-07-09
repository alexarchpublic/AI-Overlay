# Project State — Arch Public AI Overlay

Living backlog tracked against the MVP chunking plan. Each chunk links back to
the canonical spec in `../MVP_Chunking_Plan.md §2`. Tick a box only after the
chunk's Definition of Done passes end-to-end verification on a clean macOS 14+
machine (`MAC_ACCEPTANCE.md`).

## Infrastructure (post-audit 2026-06-10)

- [x] Git repository + baseline history
- [x] CI on `macos-latest` (typecheck, lint, test, coverage, red-team)
- [x] `runChatSend` extracted to `chatOrchestrator.ts` with characterization tests
- [x] Legacy harness loader / widget tree removed (abstraction-only knowledge path)
- [x] Token-estimate constants unified (`src/shared/tokenEstimate.ts`)
- [x] Electron upgraded to supported major (40+)
- [ ] Mac acceptance run — **no chunk ticked yet** (operator hardware)

## MVP Chunks

Implementation status in code vs. Mac acceptance:

| Chunk | Implemented | Mac acceptance |
|-------|-------------|----------------|
| 1 — App Shell & Dev Foundation | yes | pending |
| 2 — Always-On-Top Widget | superseded by chat-first UX¹ | n/a |
| 3 — Screenshot Engine & Region Picker | yes | pending |
| 4 — Harness Loader | replaced by Phase 0 knowledge pipeline¹ | n/a |
| 5 — Gemini Chat + Vision | yes | pending |
| 6 — Rich Logging & Observability | partial (D28 events enforced) | pending |
| 7 — Packaging & Demo Polish | partial (`npm run package` dev-only) | pending |

¹ Chunk 2's overlay pill and Chunk 4's full-source harness loader were removed
during the security-harness pivot (Milestone 2 T2.2). Acceptance for capture,
region picker, and knowledge retrieval is covered under Chunks 3 + 5 flows in
`MAC_ACCEPTANCE.md`.

Checkboxes (tick after Mac DoD):

- [ ] **Chunk 1 — App Shell & Dev Foundation**
- [ ] **Chunk 3 — Screenshot Engine & Region Picker**
- [ ] **Chunk 5 — Gemini Chat + Vision**
- [ ] **Chunk 6 — Rich Logging, Handoff & Observability**
- [ ] **Chunk 7 — Packaging, Permissions & Demo Polish**

## Phase 0 Security Harness

- [x] Abstraction-only knowledge store + offline bundle pipeline
- [x] Deterministic disclosure firewall + red-team smoke suite
- [x] OS-keychain API key encryption (fail-closed when unavailable)
- [x] Enumeration monitor for tuning-loop rate limiting
- [x] At-rest knowledge decision documented (security PRD §12 D-12)
- [ ] Manual red-team checklist (`RED_TEAM.md`) — required before external demo
- [ ] Mac acceptance with real Gemini key + live capture

## Current Focus

Run `MAC_ACCEPTANCE.md` on the operator's MacBook (Phase A → E). Until that
passes, all chunk boxes stay unchecked regardless of CI green.

Quick verification inside the repo:

```bash
nvm use
npm ci
npm run typecheck && npm run lint && npm test && npm run test:coverage && npm run red-team
npm run dev   # chat window opens; set region; paste API key in Settings → AI
```

Test count: ~315 Vitest cases + 21 red-team smoke cases (see CI for authoritative green).

## Next sequential work (after Mac acceptance)

1. Chunk 6 PRD — handoff logger automation, coverage on observability paths
2. Chunk 7 PRD — signed `.dmg`, entitlements, demo polish
3. Phase 1 security backlog (guard-model, CI red-team, server-side knowledge stub)
