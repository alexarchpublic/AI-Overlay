# Repository Audit — Arch Public AI Overlay

**Date:** 2026-06-10 · **Scope:** `arch-public-ai-overlay/` (plus top-level planning docs) · **Method:** full read of main-process core, security modules, preload, configs, and docs; targeted reads of renderer and shared modules; grep verification of every cited claim. **No code was modified.**

All `file:line` references are relative to `arch-public-ai-overlay/` unless noted. Findings are labeled **[fact]** (verifiable at the cited location) or **[judgment]** (my assessment).

---

## 1. Executive Summary

Overall health: **B−**. The code itself is unusually disciplined for an MVP — strict TypeScript everywhere, dependency-injected modules, a locked IPC surface with runtime type guards, correct Electron sandboxing, a real defense-in-depth IP firewall, and ~28 spec files of behavior-asserting tests. What drags the grade down is not sloppiness but three structural risks: (1) the audited folder has **no version control and no CI** — every claimed-green check is unverifiable convention; (2) the **chat orchestrator (`runChatSend`) contains two real correctness bugs** (token-budget trims computed but never applied; stale history snapshot) and is the one core path with zero direct tests; (3) the runtime is **Electron 31, well past end-of-life**, in an app whose entire job is screen capture plus an external API. The top three opportunities are cheap relative to payoff: initialize git + a CI gate (hours), extract and test the orchestrator then fix its two bugs (1–2 days), and finish the half-completed Phase 0 security migration by deciding the fate of the legacy harness subsystem (~2,000 LOC that loads raw proprietary source into memory for no model-facing purpose). The security architecture is genuinely good; it deserves a process and runtime that match it.

---

## 2. Repo Map

**Purpose.** Always-on-top macOS desktop co-pilot for traders running Arch Public algorithms on TradingView: periodic region screenshots → Gemini vision + a proprietary-knowledge context → structured tuning suggestions in a floating chat window. Internal demo / MVP, explicitly pre-production (`Context.md §1`), but with a superimposed zero-IP-leakage security mandate (`security-harness-PRD.md §1`).

**Stack.** Electron 31 (main: CommonJS TS), React 18 + Vite 5 + Tailwind (renderer), esbuild-bundled sandboxed preload, Zustand, pino, sharp, chokidar, `@google/generative-ai`, electron-store v10, Vitest 1.6. Node 20 via `.nvmrc`. macOS 14+ only.

**Architecture (runtime).**

```
widget-less chat window (renderer, sandboxed)
        │  window.api.* (preload, typed, locked namespaces)
        ▼
main/index.ts ── orchestrates everything ──┬─ screenshotService (desktopCapturer + sharp → temp JPEGs, ring N=5)
   runChatSend():                          ├─ knowledgeStore (servable abstraction chunks, AES-GCM cache)
   enumerationMonitor → retrieval →        ├─ geminiService (JSON-mode send loop, retry, firewall gate)
   tokenBudget.fit → conversationStore →   ├─ conversationStore (in-memory, clear-on-close)
   geminiService.send → firewall → UI      └─ legacy harnessLoader (+watcher/store/inspector — no longer feeds the model)
```

**Key directories.**

| Path | What it is |
|---|---|
| `src/main/` (27 files) | All privileged logic; `index.ts` (1,478 LOC) is bootstrap + IPC + chat orchestration |
| `src/shared/firewall/` | Deterministic disclosure gate, deep-tier fingerprints, forward-suggestion permits |
| `src/shared/knowledge/` | Servable-tier bundle build/retrieval/prompt composition (Phase 0 security harness) |
| `src/renderer/{chat,settings,regionPicker,widget}/` | React trees per `?view=`; `widget/` is no longer mountable (see M5) |
| `src/preload/index.ts` | Single `window.api` bridge, 8 namespaces, no string literals |
| `tests/` (28 spec files, ~335 cases) | Vitest unit/smoke + red-team gate cases + fixtures |
| `knowledge/` | Servable abstraction JSON + deep fingerprints + review manifest |
| `arch-public-harness/` | Drop folder containing raw proprietary algorithm source (gitignored) |
| `scripts/` | dev orchestrator, preload bundler, knowledge pipeline, red-team smoke, mac acceptance |
| Top level (`../`) | `Context.md` (declared source of truth), MVP chunk plan, per-chunk PRDs |

**Maturity.** Chunks 1–5 of 7 implemented plus Phase 0 of the security harness; **zero chunks accepted on real hardware** (`project-state.md:10–16`, all boxes unchecked, pending Mac acceptance).

**Surprises.**
1. No `.git` directory and no CI config anywhere — for a project this process-heavy, the most consequential gap.
2. The product pivoted from "overlay pill widget" to "chat window as primary surface" (`src/main/index.ts:1014`) but README/Context still describe the pill.
3. Two parallel knowledge subsystems coexist: the legacy full-bundle harness loader and the new abstraction-only knowledge store. Only the latter feeds the model (`src/main/geminiService.ts:128`).
4. AI-to-AI development is institutionalized (`CLAUDE_HANDOFF.md`, append-only session log) — and its "Open Questions" sections candidly pre-document several findings below.

---

## 3. Audit Report

Test suite note: the suite could not be executed in this audit environment (rollup native binding missing for this platform), so "240/240 green" claims in `project-state.md` are **reported, not verified**.

### 3.1 Severity index

| ID | Severity | Dimension | One-liner |
|----|----------|-----------|-----------|
| C1 | Critical | DevEx/Ops | No version control, no CI — all quality gates are convention |
| H1 | High | Correctness | Token-budget history trims computed and logged but never applied to the request |
| H2 | High | Correctness | Send uses a pre-truncation history snapshot |
| H3 | High | Security | Hardcoded-key crypto fallback silently reachable in production |
| H4 | High | Reliability | No global rejection trap; unguarded fire-and-forget orchestrator can wedge the chat FSM |
| H5 | High | Dependencies | Electron 31 is past end-of-life; several majors behind across the stack |
| M1 | Medium | Architecture | `main/index.ts` is a 1,478-line god file holding the only untested core path |
| M2 | Medium | Architecture/Security | Legacy harness subsystem still loads raw IP into memory for no model purpose |
| M3 | Medium | Security | "Encrypted at rest" knowledge index ships beside its own plaintext |
| M4 | Medium | Code quality | Token-estimate constants duplicated in four places, one disagreeing |
| M5 | Medium | Code quality | Dead widget subsystem (renderer tree, IPC channels, preload API) |
| M6 | Medium | Documentation | README/Context materially contradict the implemented system |
| M7 | Medium | DevEx | Lockfile is Linux-locked; first install on the actual target (macOS) fails |
| M8 | Medium | Testing | Orchestrator has zero direct tests; no coverage measurement configured |
| L1–L8 | Low | various | See §3.7 |

### 3.2 Architecture & design

**C1 — No version control or CI in the audited folder. [fact, with caveat]**
Where: repo root — no `.git/` (verified `ls -a`), no `.github/`, no CI config of any kind. A `.gitignore` exists but is inert without git; `dist/`, `release/`, and `node_modules/` sit on disk alongside source.
Why it matters: the project's entire quality story (three tsconfig typechecks, strict lint, ~335 test cases, red-team gate) runs only when a developer remembers to run it. There is no history, no revert path, no blame, no protection for `CLAUDE_HANDOFF.md`'s append-only contract, and no machine-verified green. For a codebase developed largely by AI agents across sessions, VCS is the safety net that makes everything else auditable.
Caveat: if this folder is an export and a git remote exists elsewhere, C1 downgrades to "repo copy hygiene" — flagged in Open Questions.

**M1 — God file: `src/main/index.ts` (1,478 lines). [fact + judgment]**
Where: `src/main/index.ts` — bootstrap sequence (202–512), permission-poll FSM (592–660), widget flash timer (549–580), IPC registration for seven namespaces (696–1466), and the chat orchestrator `runChatSend` (1098–1288), all coordinating through ~14 module-scoped nullable singletons (`logger`, `state`, `capture`, … 170–200).
Why it matters: every handler begins with null-guard boilerplate (`if (!log || !ai || !conv || …) return;` 1109), the orchestrator can't be unit-tested without booting Electron, and both High-severity correctness bugs (H1, H2) live precisely here. `CLAUDE_HANDOFF.md` ("Open Questions") explicitly admits the orchestrator is untested. This is the highest-leverage refactor in the codebase.

**M2 — Dual knowledge subsystems; the legacy one contradicts the security posture. [fact + judgment]**
Where: the harness loader still boots and eagerly loads raw proprietary source into main-process memory (`src/main/index.ts:381`), keeps a dev watcher, a settings panel, and a renderer-reachable full-text dump gated by a single boolean (`src/main/index.ts:913–921`, gate = `isDev || store.getShowInspector()`), while the model path uses exclusively scoped abstraction retrieval (`src/main/geminiService.ts:128` — "never the legacy harness full-bundle path"; `runChatSend` calls `knowledgeStore.retrieve`, `src/main/index.ts:1139`).
Why it matters: `security-harness-PRD.md §1` makes "raw IP never enters the model's context" the load-bearing invariant — honored — but the legacy path keeps raw IP resident in app memory and one persisted flag away from the renderer, and costs ~2,000 LOC of loader/watcher/store/UI/tests maintenance for a subsystem nothing model-facing consumes. Half-finished migration is the single biggest architecture smell.

Module boundaries elsewhere are genuinely good: stores, services, and pure-function modules (`tokenBudget`, `harnessUtils`, `retrieval`, firewall) are cleanly separated with injectable dependencies; no circular dependencies observed in the import graph I traced.

### 3.3 Code quality & correctness

**H1 — Token-budget trims are computed, logged, and then discarded. [fact]**
Where: `src/main/index.ts:1177–1182` runs `fitTokenBudget({ …history… })`; `1184–1191` logs a `gemini.tokenBudgetTrim` line per dropped item; but `1231–1237` calls `gemini.send({ …, history, screenshots: fitResult.screenshots, … })` — passing the **original** `history` (read at 1119), not `fitResult.history`. `tokenBudget.fit` (`src/main/tokenBudget.ts:110–203`) returns the trimmed history precisely for this purpose.
Why it matters: when a long session crosses the soft ceiling, the app logs that it trimmed history, then sends the untrimmed request anyway — oversized requests, real-money token cost, possible 4xx/length failures, and logs that actively lie to whoever debugs it. Screenshots, by contrast, *are* taken from `fitResult` — so the bug is invisible in light testing.

**H2 — Send uses a stale, pre-truncation history snapshot. [fact]**
Where: `src/main/index.ts:1119` snapshots `const history = conv.getHistory()` (a copy — `src/main/conversationStore.ts:124–127` returns `turns.slice()`); `1160` then runs `await conv.maybeTruncate(…)`, which replaces older turns with a Flash summary (`conversationStore.ts:174–186`); the send at `1231` still transmits the pre-truncation snapshot.
Why it matters: the turn that triggers truncation pays for both the summary call *and* the full untruncated history; the summarization benefit only lands a turn late. Combined with H1, the entire "memory + budget" subsystem — individually well-built and well-tested — is mis-wired at the only integration point, which is also the only untested one (M8).

**M4 — Token-estimate constants duplicated 4×, one divergent. [fact]**
Where: `src/shared/aiConstants.ts:69,120` (`PER_IMAGE_TOKEN_ESTIMATE = 2_000`, `CHARS_PER_TOKEN = 3.8`); re-declared locally in `src/main/geminiService.ts:855–856` with a "mirror" comment; `src/shared/harnessConstants.ts:101` (3.8); `src/shared/knowledge/retrieval.ts:14` (**4**, used for the knowledge budget).
Why it matters: `CLAUDE_HANDOFF.md` instructs the operator to tune these constants after the first real Gemini call — tuning `aiConstants` will silently not touch the copy inside `geminiService`'s log estimate or the retrieval budget, so budgeting, logging, and retrieval will quietly disagree.

**M5 — Dead widget subsystem. [fact]**
Where: `src/renderer/main.tsx:37–39` routes only `settings | regionPicker | chat` — the 374-LOC `src/renderer/widget/` tree is unmountable; IPC channels `widget:emitClick`, `widget:setInteractive`, `widget:moveBy` (`src/shared/ipcChannels.ts:25,32,34`) have **no main-process consumers** (grep-verified), yet preload still exposes them (`src/preload/index.ts:127–172`); `src/main/overlayWindow.ts` is reduced to a 37-line URL helper with a stale filename.
Why it matters: the docs (README, Context.md §2.1) still present the pill widget as the product; a new contributor will hunt for a window that never opens. Dead IPC surface also bloats the "locked namespace" audit story (`project-state.md` step 20 greps the preload for allowed namespaces — dead channels pass that check while doing nothing).

**Smaller items:** dead conditional in `src/main/secretsStore.ts:68–73` (both branches return `raw`; the `isEncryptionAvailable()` check is decorative) [fact]; `projected += 0` no-op in `src/main/enumerationMonitor.ts:122` [fact]; `DISCLOSURE_RULES[n].message` self-references by hardcoded array index (`src/shared/firewall/disclosureRules.ts:55` ff.) — reordering rules silently mis-labels hits [fact]; the `new Function('return import(…)')` ESM-import hack is copy-pasted across five store files (`src/main/{aiStore,widgetState,captureStore,harnessStore,knowledgeStoreState}.ts`) [fact]; error-path turn drop (`src/main/index.ts:1264`) removes the user turn from main's history while the renderer keeps rendering it — benign today but a real main/renderer divergence [fact + judgment].

### 3.4 Security

Posture is strong overall (see Strengths). Findings:

**H3 — Hardcoded-key crypto fallback reachable in production, silently. [fact]**
Where: `src/main/secretsStore.ts:47–52` (`resolveSafeStorage`) and its duplicate `src/main/knowledgeStoreFactory.ts:49–54` fall back to `createTestSafeStorage()` whenever Electron `safeStorage` is unavailable; the test double encrypts with the literal key `'phase-0-test-key-32-bytes!!!!'` (`src/main/knowledgeCrypto.ts:22`). No log line marks the downgrade.
Why it matters: the Gemini API key and the knowledge index would be "encrypted" under a key published in the source tree, while every log and doc claims OS-keychain backing (`aiStore.ts:15–17`). On macOS with the app started after `app.whenReady` this path shouldn't trigger — but `isEncryptionAvailable()` can be false in locked-keychain sessions, and the comment scopes the fallback to "Vitest, CI" without enforcing that. Fail-closed (throw / disable persistence + loud log) is the correct behavior for a project whose PRD lists on-disk artifact theft as in-scope (`security-harness-PRD.md §3`).

**H4 — No global rejection trap; chat FSM can wedge. [fact]**
Where: no `process.on('unhandledRejection'|'uncaughtException')` anywhere in `src/` or `scripts/` (grep-verified) — despite a comment assuming one exists (`src/main/index.ts:383`, "so the unhandled-rejection trap stays clean"). `runChatSend` is invoked fire-and-forget (`void runChatSend(text, ids)`, `src/main/index.ts:1364`) and its body (1098–1288) has no enclosing try/catch — only `store.retrieve` is guarded.
Why it matters: any unexpected throw after state flips to `'awaiting'` (e.g., from `conv.maybeTruncate`, a knowledge-store regression, or a future edit) leaves the UI stuck on the typing indicator forever and surfaces as an unhandled rejection. One try/catch plus two process-level traps closes it.

**M3 — At-rest encryption of the knowledge index protects nothing. [fact + judgment]**
Where: the plaintext servable bundle ships inside the packaged app (`electron-builder.yml:40–44`, `extraResources: knowledge/bundles`) and is re-read on every init (`src/main/knowledgeStore.ts:152–159, 190–214`); the AES-GCM-encrypted copy written under userData (`knowledgeStore.ts:161–173`) sits beside it.
Why it matters: PRD D-6 ("local-only, encrypted abstraction store") is satisfied in letter, not effect — an attacker reading disk takes the plaintext from Resources. Impact is tempered because the servable tier is non-IP by design (abstractions pass D-3 review), but then the encryption is pure cost. Pick one: ship encrypted-only, or drop the redundant layer and document the accepted risk.

**Accepted/low security notes:** raw API key is deliberately passed through a log call relying on pino redaction to scrub it (`src/main/index.ts:1422–1426`; redaction verified present, `src/main/logger.ts:52–66`) — works today, but it is a single-config-line failure mode; log the masked form instead [L3]. Screenshots of the user's trading screen persist unencrypted in the OS temp dir for up to 30 minutes (`src/main/index.ts:259`; TTL in `shared/constants.ts`) — reasonable for the MVP, worth a line in the threat model [L7]. No hardcoded API secrets anywhere in `src/` (grep-verified; the only key-shaped strings are the firewall's own detection regexes, `disclosureRules.ts:32`). IPC payloads are consistently runtime-validated (`index.ts:999–1011, 1354–1361, 1468–1478`; `logger.ts:271–279`).

### 3.5 Testing

**M8 — The riskiest path is the only untested one. [fact]**
Where: no spec exercises `runChatSend` (admitted in `CLAUDE_HANDOFF.md` Open Questions); `tests/` covers each unit it composes (geminiService send loop incl. abort/JSON-retry/firewall, tokenBudget boundary cases, conversationStore truncation, knowledge retrieval, firewall gate red-team cases) but never the composition — which is exactly where H1/H2 live.
Also: no coverage tooling configured (`vitest.config.ts` has no coverage section, no `test:coverage` script in `package.json:12–27`); no E2E/packaged-app smoke (acceptable pre-Chunk-7); suite not executable in this environment, so green status is unverified here.
Test *quality* otherwise is high [judgment]: specs assert behavior and byte-exact contracts (e.g., bundle envelope format), use injected clocks/fs/SDKs rather than module mocks, and include an adversarial red-team suite (`tests/redteam/`, `npm run red-team`) — rare and commendable.

### 3.6 Performance

No significant issues found; this dimension is healthy for the scale. The capture loop is a self-correcting `setTimeout` chain with debounce and a bounded ring buffer (`src/main/screenshotService.ts` header contract); disk growth is bounded by a 30-min pruner; stats arrays are pruned on read and write (`src/main/aiStore.ts:168–171`); retrieval is O(chunks) lexical scoring over ~8 abstraction docs — fine. Two micro-notes [judgment]: every send base64-encodes up to 3 JPEGs from disk into memory (`geminiService.ts:225–237`) — irrelevant at N=3 but don't raise `SCREENSHOTS_PER_TURN` casually; `broadcastToAllWindows` fans every chat event to all windows including settings (`index.ts:1061–1065`) — harmless at 3 windows.

### 3.7 Dependencies

**H5 — Runtime past end-of-life. [fact for versions; judgment on risk]**
Where: installed `electron@31.7.7` (`package.json:50` pins `^31`; Electron 31 shipped mid-2024 and left the supported-majors window long ago — by today it is many majors and ~two years of Chromium/Node security patches behind). Also one-plus majors behind: `vite@5.4.21`, `vitest@1.6`, `zustand@4`, `chokidar@3`, `electron-builder@24`.
Why it matters: unpatched Chromium in an app that takes screen captures and holds an API key. Mitigations that genuinely reduce exposure: no remote content is ever loaded (file/localhost only), all renderers are sandboxed, no `rehype-raw`. Still the wrong place to be before any external demo.
Lockfile hygiene: lockfile present and consistent, but **M7 [fact]** — it was generated on Linux; `sharp@0.33+` platform subpackages mean first install on macOS fails until the documented manual fix runs (`README.md:27–47`). The target platform failing first-install is real onboarding friction and is why CI must run on macOS.
License: all permissive; `UNLICENSED` private package — fine for internal use.

### 3.8 DevEx & operations

Covered largely by C1/M7/H4. Additional notes: lint intentionally ignores `scripts/**` (`eslint.config.js:21–28`) — the dev orchestrator, preload bundler, and knowledge pipeline are unlinted and untyped [fact, low]; there is no `npm run check`-style single gate combining typecheck+lint+test (each must be invoked separately, and nothing enforces it) [fact, low]; logging/observability is a genuine strength — structured JSONL with event names locked per PRD, redaction plus firewall-sanitized model-output fields (`logger.ts:72–110`).

### 3.9 Documentation

**M6 — The two declared sources of truth no longer describe the system. [fact]**
Where: `README.md:5–6` states the repo "is currently at the end of **Chunk 1**" while Chunks 1–5 plus the Phase 0 security harness are implemented; README's run instructions (lines 21–25) describe the pill-widget UX that no longer exists (`index.ts:1014` — chat window "replaces overlay pill"); `Context.md` (declared "Single Source of Truth", line 5) still specifies "No security… required" (§1) and full-source harness injection (§2.3) — both superseded by `security-harness-PRD.md`, with no amendment recorded in either document.
Why it matters: the project's own governance rule ("propose changes to the Context before changing behavior", `README.md:72–74`) was broken by its largest change. For an AI-agent-driven repo where each session re-reads the docs as ground truth, doc drift directly causes future wrong code.
Otherwise documentation is far above average: per-file "why it exists" headers, decision IDs (D-n) traceable from PRD to code comment to test, an honest handoff log, and a Mac acceptance runbook.

### 3.10 Strengths (preserve these)

1. **Process isolation done right:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on every window (`chatWindow.ts:120–125`, `settingsWindow.ts:46–51`, `regionPicker.ts:174–178`); single typed `window.api`; channel constants only.
2. **The firewall is real engineering, not theater:** deterministic regex gate with forward-suggestion permits (`deterministicGate.ts:37–58`), zero-width-character normalization (line 24–26), deep-tier verbatim fingerprints, gate-then-retry-then-rewrite pipeline in the send loop (`geminiService.ts:636–694`), firewalled summarizer (783–792), firewall-sanitized logs, plus a scripted red-team suite and operator checklist (`RED_TEAM.md`).
3. **Dependency injection everywhere** (fs, SDK, clocks, ULIDs) — the 865-line Gemini send loop is fully testable offline (`geminiService.ts:144–154`).
4. **Typed error taxonomy** end-to-end: discriminated unions from SDK failure to UI banner (`geminiService.ts:111–124` → `ChatError` variants).
5. **Secret handling:** keychain encryption with transparent plaintext migration (`aiStore.ts:134–151`), masked-only IPC (`preload/index.ts:406–411`), broad redact paths seeded from day one (`logger.ts:52–66`).
6. **Conventions are explicit and machine-checkable** (grep contracts like "only `geminiService` constructs the SDK"), which any improvement plan should keep honoring.

---

## 4. Improvement Strategy

### Theme 1 — Make green verifiable (provenance & gates)
Most findings are amplified by one fact: nothing enforces anything (C1, M7, M8-coverage, the unverifiable test claims). **Target state:** the folder is a git repo with the existing `.gitignore` honored (proprietary harness and bundles stay untracked); a CI workflow on a macOS runner runs `typecheck + lint + vitest + red-team` on every push and fails loudly; lockfile installs reproducibly on macOS. **Principle:** an agent-developed codebase needs machine-verified ground truth more than a human one does — the next session can't ask the last one what it actually ran.

### Theme 2 — The orchestrator is the weak joint; extract it, test it, then fix it
H1, H2, H4, M1, and M8 are one cluster: well-tested units composed in an untested 1,478-line file. **Target state:** `runChatSend` lives in its own module taking an explicit deps object; characterization tests pin current behavior first, then flip to assert the fixed behavior (trimmed history sent, post-truncation history read, all throws land in `emitChatError`). **Principle:** never refactor or bug-fix the core money path without tests around it first — that ordering is Milestone 0 vs 1 below.

### Theme 3 — Finish the security migration; don't run two knowledge architectures
H3, M2, M3 are all "Phase 0 stopped one step short." **Target state:** legacy harness loader/watcher/inspector either deleted or compile-time-gated out of production builds; crypto fails closed with a loud log instead of falling back to a published key; one deliberate decision on plaintext-bundle shipping. **Principle:** a defense-in-depth story is judged by its weakest deliberate exception.

### Theme 4 — One source of truth for constants and docs
M4, M5, M6: drifted estimates, dead surfaces, stale governance docs. **Target state:** a single `tokenEstimate.ts` consumed by budget/logging/retrieval; dead widget tree and IPC removed; README rewritten to the current product; `Context.md` amended (or formally superseded by the security PRD) per the project's own rule. **Principle:** in this repo, docs are executable — agents act on them.

### Theme 5 — Runtime currency
H5/M7. **Target state:** Electron on a currently supported major, upgraded *after* the safety net exists and *before* any external demo; a written policy ("stay within supported majors") so it doesn't rot again. **Principle:** match patch currency to the app's privilege level (screen recording).

### Explicitly NOT recommended now
Vector/embedding retrieval (lexical over ~8 curated chunks is correct at this scale — `retrieval.ts` even documents the seam); guard-model + canary tokens + automated red-team CI beyond the deterministic suite (PRD already defers to Phase 1+); ESM migration of the main process (the `importESM` hack is ugly but contained — fold into a single utility instead); Windows support; multi-user auth; global coverage targets (test the orchestrator and firewall hard; don't chase percentages on settings panels); replacing electron-store. Each is real effort with little de-risking for an internal demo.

### Definition of done (measurable)
Git history exists and CI is required-green on macOS for typecheck, lint, full vitest, and `npm run red-team`. Zero Critical/High findings open. `runChatSend` extracted with tests covering: trimmed-history-sent, post-truncation send, every error variant, and FSM-never-stuck (a thrown dep always yields `error` state). One token-estimate module; grep finds no second `CHARS_PER_TOKEN =`. Packaged build refuses to persist secrets when `safeStorage` is unavailable (test asserts loud failure). Electron within supported majors. README quick-start matches observed behavior on a clean Mac.

---

## 5. Task Plan

### Milestone 0 — Safety net (do first, ~1 day total)

| ID | Task | Files/areas | Acceptance | Effort | Risk | Deps |
|----|------|-------------|------------|--------|------|------|
| T0.1 | Initialize git, baseline commit, tag `audit-2026-06-10` | repo root | `git log` shows baseline; `git status` clean; `arch-public-harness/**`, `knowledge/bundles/*.json`, `dist/`, `release/` untracked (verify with `git status --ignored`) | S | None | — |
| T0.2 | CI on macOS runner: `npm ci && npm run typecheck && npm run lint && npm test && npm run red-team` | new `.github/workflows/ci.yml` | CI green on baseline; a seeded lint error fails the build; sharp installs (proves/falsifies M7 in CI) | M | Low | T0.1 |
| T0.3 | Characterization tests for `runChatSend` via injected fakes (knowledgeStore, gemini, conversationStore, screenshotService, monitor) | new `tests/chatOrchestrator.spec.ts`; minimal export seam in `src/main/index.ts` | Tests pin current behavior incl. the H1/H2 bugs (assert untrimmed history is sent — documenting the defect), every `ChatError` variant, enumeration block path | M–L | Low (test-only + one export) | T0.1 |

### Milestone 1 — Critical & High fixes

| ID | Task | Files/areas | Acceptance | Effort | Risk | Deps |
|----|------|-------------|------------|--------|------|------|
| T1.1 | Fix H1+H2: re-read history after `maybeTruncate`; pass `fitResult.history` to `gemini.send` | `src/main/index.ts:1119–1237` | T0.3 tests flipped to assert trimmed/post-truncation history; trim log lines correspond to actual request content | S | Med (core-path behavior change — that's what T0.3 is for) | T0.3 |
| T1.2 | Fix H3: fail-closed `resolveSafeStorage` in packaged builds (throw or disable persistence + `secrets.encryptionUnavailable` error log); deduplicate the two resolvers | `src/main/secretsStore.ts:47–52`, `src/main/knowledgeStoreFactory.ts:49–54`, `src/main/knowledgeCrypto.ts` | Unit test: prod mode + unavailable safeStorage ⇒ loud failure, no write; test double only injectable explicitly | S | Low | T0.3 (suite green) |
| T1.3 | Fix H4: try/catch around `runChatSend` body → `emitChatError({variant:'fatal'})` + state reset; add `process.on('unhandledRejection'/'uncaughtException')` → logger | `src/main/index.ts` | Test: a throwing injected dep yields `error` state, never a stuck `awaiting`; traps log with event names | S | Low | T0.3 |
| T1.4 | Upgrade Electron to a supported major (+ electron-builder, and the cheap minors: chokidar 4, zustand 5); re-run Mac acceptance | `package.json`, lockfile, `electron-builder.yml`, sharp unpack config | CI green; `MAC_ACCEPTANCE.md` Phase A passes on macOS; capture + safeStorage + always-on-top behaviors re-verified | L–XL | Med-High (native deps, BrowserWindow behavior changes across majors) | T0.2 |

### Milestone 2 — High-leverage improvements

| ID | Task | Files/areas | Acceptance | Effort | Risk | Deps |
|----|------|-------------|------------|--------|------|------|
| T2.1 | Split `main/index.ts`: `bootstrap.ts`, `ipc/{widget,perms,capture,region,harness,chat,ai}.ts`, `chatOrchestrator.ts` with explicit deps object (kill module-scoped nullable singletons) | `src/main/index.ts` → ~8 files | No file >400 LOC; orchestrator has zero Electron imports; T0.3 suite passes against the extracted module; boot order preserved (log sequence unchanged) | L | Med | T0.3, T1.1, T1.3 |
| T2.2 | Decide + execute legacy harness fate: delete loader/watcher/inspector/settings-panel + dead widget tree & IPC (preferred), or gate behind a build-time flag default-off in production | `src/main/{harnessLoader,harnessWatcher,harnessStore}.ts`, `src/renderer/{widget,settings/Harness*}`, `src/preload/index.ts`, `src/shared/ipcChannels.ts`, related tests | Packaged build never reads the harness root; no IPC channel without a main-side consumer; LOC drops ~2k; red-team + suite green | M–L | Med | Owner decision (OQ-2), T0.2 |
| T2.3 | Single token-estimate module consumed by `tokenBudget`, `geminiService`, `retrieval`, harness utils | new `src/shared/tokenEstimate.ts`; M4's four sites | `grep -rn "CHARS_PER_TOKEN ="` matches exactly one file; budget/log/retrieval estimates agree in a test | S | Low | — |
| T2.4 | Reproducible macOS installs: regenerate lockfile on macOS in CI, or commit per-platform install script; remove the manual sharp workaround from the happy path | `package-lock.json`, README, CI | Fresh `npm ci` on macOS runner succeeds with zero manual steps | S–M | Low | T0.2 |

### Milestone 3 — Quality & polish

| ID | Task | Files/areas | Acceptance | Effort | Risk | Deps |
|----|------|-------------|------------|--------|------|------|
| T3.1 | Docs reconciliation: rewrite README (current UX, current chunk status), amend `Context.md` per its own governance, refresh `project-state.md` | top-level docs | A new reader's quick-start matches observed behavior; no doc claims the pill widget or "end of Chunk 1" | S–M | None | T2.2 (so docs describe the decided architecture) |
| T3.2 | Coverage reporting + thresholds on `src/main/chatOrchestrator.ts` (≥90% branches) and `src/shared/firewall/**` (≥95%) | `vitest.config.ts`, CI | CI publishes coverage; thresholds enforced | S | Low | T0.2, T2.1 |
| T3.3 | M3 decision: stop shipping plaintext bundle (encrypt-at-build, decrypt-on-init) or remove the redundant userData encryption and document accepted risk | `electron-builder.yml:40–44`, `src/main/knowledgeStore.ts` | Exactly one at-rest representation exists in the packaged app; decision recorded in security PRD §12 | S–M | Low | OQ-5 |
| T3.4 | Low-findings sweep: L1 dead conditional, L2 no-op, L3 mask key in log call, L4 rule self-indexing, L5 lint `scripts/**`, L6 single `importESM` util, error-path UI/history divergence | various (see §3.3/§3.4) | Each verified by lint/test; no behavior change beyond L3 log content | S | Low | — |

### Quick wins (high impact, S effort — start today)
T0.1 (git init — the single highest value-per-minute action available), T1.2 (fail-closed crypto), T1.3 (error traps), T2.3 (token-estimate unification), L3 (log masked key instead of relying on redaction).

### Implementation sketches — top 3

**T0.3 + T1.1 (orchestrator tests, then the history fixes).**
Approach: export `runChatSend`'s body as `createChatOrchestrator(deps)` where `deps = { logger, aiStore, conversationStore, geminiService, knowledgeStore, screenshotService, enumerationMonitor, emit: { turnAppended, stateChanged, error } }` — the existing module-scoped function already reads exactly this set (`index.ts:1102–1109`), so extraction is mechanical. Write specs with hand-rolled fakes (project convention — see `tests/geminiService.spec.ts`'s `sdkFactory` pattern; avoid `vi.mock`). Pin current behavior including the bugs; then in T1.1 change two lines — move `const history = conv.getHistory()` to *after* `await conv.maybeTruncate(…)`, and pass `history: fitResult.history` at the send call — and flip the assertions. Gotchas: `maybeTruncate`'s summarizer needs the *old* history, so compute the truncation input before re-reading (the store handles this internally — just reorder the read); keep `emitTurnAppended(userTurn)` ordering so the UI still paints the user message before `awaiting`; the abort path asserts `chatInflight` identity (`index.ts:1239`) — preserve the controller swap semantics in the extracted version.

**T1.2 (fail-closed secrets).**
Approach: give `resolveSafeStorage` an explicit mode: production callers (`createAiStore`, `createKnowledgeStore`) pass `{ allowFallback: false }`; only tests construct the double directly. When unavailable and fallback disallowed: for the API key, surface a new `ChatError`-style settings error ("OS keychain unavailable — key not saved") rather than throwing at boot; for the knowledge index, skip the encrypted-cache write (serve from the plain bundle in memory) and log `knowledge.encryptionUnavailable`. Delete the duplicate resolver in `knowledgeStoreFactory.ts` and import the one in `secretsStore.ts`. Gotchas: `aiStore.getApiKey()` runs on every send — don't let an unavailable keychain turn into a per-send throw; cache the availability check. Keep the legacy-plaintext read path (it must still *read* old values even when it refuses to *write*), and delete the dead branch at `secretsStore.ts:68–73` while you're in there.

**T2.1 (split the god file).**
Approach: top-down, one extraction per commit, CI green between each: (1) `ipc/registerCaptureIpc.ts` etc. — pure moves, handlers already take their deps as parameters (`index.ts:696–847` signature proves it); (2) chat orchestrator (done in T0.3); (3) permission-poll FSM into `permissionSync.ts` (state: timer + deps, `index.ts:592–690`); (4) leave `index.ts` as a ≤200-line boot sequence that constructs deps and calls registrars. Replace nullable module singletons with a single `AppContext` object created inside `app.whenReady`. Gotchas: `registerHarnessIpc` closes over the *mutable* `harnessWatcher` variable for restart-on-root-change (`index.ts:938–945`) — pass a small `watcherHandle` object, not the variable; `before-quit` (`index.ts:519–537`) must keep its exact teardown order (abort in-flight → cancelAll → endSession → close window → shutdown services); the boot log-line order is asserted by the Mac acceptance runbook, so preserve it.

---

## 6. Open Questions (need a human)

1. **OQ-1 (gates C1):** Does a git repository for this project exist elsewhere (the folder may be an export without `.git`)? If yes, C1 becomes "sync this working copy"; if no, T0.1 is the first action taken on this codebase.
2. **OQ-2 (gates T2.2):** Is the legacy harness loader + inspector still wanted as a dev tool for authoring abstractions, or is it fully superseded by the `knowledge/` pipeline? Delete vs. dev-only-gate changes the scope of M2's fix.
3. **OQ-3 (prioritization):** Has *any* chunk passed Mac acceptance on real hardware (`project-state.md` shows none)? If a demo is imminent, the acceptance run and T1.4 (Electron) may need to leapfrog Milestone 2.
4. **OQ-4 (risk appetite):** Target date for the first external demo — this sets how hard to push the Electron upgrade and the red-team manual-live pass (`RED_TEAM.md` requires all manual cases PASS before any external demo).
5. **OQ-5 (gates T3.3):** Is shipping the plaintext servable bundle acceptable given abstractions are non-IP by design, or must PRD D-6's encrypted-at-rest hold strictly (encrypt at build time)?
6. **OQ-6:** Are there latency/cost targets for the chat loop (p50/p95 are collected but no budget is stated)? Affects whether the per-send disk reads and 3-image default deserve attention.
7. **OQ-7 (governance):** Should `Context.md` be amended to reflect the security-harness pivot, or formally demoted with `security-harness-PRD.md` becoming the source of truth? The repo's own rules require one or the other.

---

*Areas receiving lighter review: renderer component internals (`chat/*.tsx`, settings panels — skimmed for XSS/dangerous patterns only), `harnessUtils.ts`/`harnessWatcher.ts` internals (header contracts + test files read in lieu of full source), the knowledge build pipeline scripts (`scripts/*.mjs` skimmed), and CSS/Tailwind. Nothing in the skimmed areas contradicted the findings above.*
