# Project State — Arch Public AI Overlay

Living backlog tracked against the MVP chunking plan. Each chunk below links
back to the canonical spec in `../MVP_Chunking_Plan.md §2`. Tick a box only
after the chunk's Definition of Done passes end-to-end verification on a
clean macOS 14+ machine.

## MVP Chunks

- [ ] **Chunk 1 — App Shell & Dev Foundation** ([plan](../MVP_Chunking_Plan.md) · [PRD](../PRD_Chunk_1_App_Shell.md))
- [ ] **Chunk 2 — Always-On-Top Widget** ([plan](../MVP_Chunking_Plan.md))
- [ ] **Chunk 3 — Screenshot Engine & Region Picker** ([plan](../MVP_Chunking_Plan.md))
- [ ] **Chunk 4 — Harness Loader & Knowledge Base** ([plan](../MVP_Chunking_Plan.md))
- [ ] **Chunk 5 — Gemini Chat + Vision (end-to-end round-trip)** ([plan](../MVP_Chunking_Plan.md))
- [ ] **Chunk 6 — Rich Logging, Handoff & Observability** ([plan](../MVP_Chunking_Plan.md))
- [ ] **Chunk 7 — Packaging, Permissions & Demo Polish** ([plan](../MVP_Chunking_Plan.md))

## Current Focus

Chunks 1, 2, 3, 4, and 5 are implemented end-to-end inside the sandbox. All
five boxes stay unchecked until the operator's macOS 14+ acceptance run
passes each chunk's Definition of Done on a real Mac.

### Chunk 1 — pending Mac acceptance
Scaffold verified clean inside the Cowork sandbox (typecheck, lint, tests,
build) with `package-lock.json` committed. Tick Chunk 1's box once the PRD §7
verification passes on the operator's Mac:

1. `nvm use`
2. `npm install`
3. `npm run typecheck`
4. `npm run lint`
5. `npm test`
6. `npm run dev` (window appears; inspect `logs/app-<today>.jsonl`)
7. Close the window (observe `app.quit` log line)
8. Inspect `CLAUDE_HANDOFF.md` and `project-state.md` at the repo root
9. `npm run build` (produces `dist/`)
10. Spot-check folder layout against `PRD_Chunk_1_App_Shell.md §3.1`

### Chunk 2 — pending Mac acceptance
Overlay widget + first-run permission flow + native context menu + 640×480
Settings shell + electron-store persistence are implemented and green against
typecheck / lint / vitest (40 tests) / `vite build` + `tsc -p tsconfig.main.json`
inside the sandbox. Tick Chunk 2's box only after the full PRD §5 Definition
of Done passes on macOS 14+:

1. `nvm use && npm install && npm run build && npm run dev`
2. Confirm transparent 48×48 pill appears in default top-right anchor
3. Drag to a new position; restart; confirm position restored
4. First run: screen-recording modal appears once; Continue → native prompt
   fires; grant flips pill to `ready`
5. Deny path: modal re-renders with "Open System Settings"; deep-link opens
   the Screen Recording pane; returning to the app flips pill to `ready`
   without restart
6. Right-click the pill: four items (Capture now · Toggle auto-capture · Open
   Settings · Quit); Open Settings opens a single 640×480 window (second
   invocation focuses the existing window, does not open a duplicate)
7. Widget survives Spaces switch + fullscreen transitions (returns on its own
   after Mission Control / native screencapture UI)
8. `logs/app-<today>.jsonl` contains `widget.shown`, `widget.click`,
   `perms.screen.*`, `widget.menuAction`, and `widget.positionPersisted` lines
9. Known open item: PRD §3.2 needs a `widget.setInteractive(on)` amendment
   before Chunk 3 begins (see `CLAUDE_HANDOFF.md` for rationale)

Only after Chunk 2's box is ticked should paired PRDs for Chunks 3 (Screenshot
Engine & Region Picker) and any overlapping capture/permissions seams begin.

### Chunk 3 — pending Mac acceptance
Screenshot engine, region picker (one transparent fullscreen window per
display), in-memory ring buffer (N=5), 30-min disk pruner, `'capturing'`
600ms widget flash, dev-only Recent Captures panel, full `capture.*` /
`region.*` IPC surface, and the one-shot `widget.autoCapture` →
`capture.autoCapture` electron-store migration are implemented and green
inside the sandbox: `npx tsc --noEmit` (×3 configs), `npx eslint`, and
`npx vitest run` (132/132 tests). Tick Chunk 3's box only after the full
PRD §7 verification (steps 1–18) passes on macOS 14+ with at least one
external display attached:

1. `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`
   - **If `npm run dev` errors with `Could not load the "sharp" module using the darwin-arm64 runtime`**, run `npm install --os=darwin --cpu=arm64 sharp` (or `rm -rf node_modules package-lock.json && npm install`) — the lockfile shipped from the AI dev sandbox is Linux-locked; sharp 0.33+ uses platform-specific optional subpackages
2. With `capture.region` unset: right-click pill shows *Capture now* / *Toggle auto-capture* **disabled**, *Set capture region…* **enabled**
3. *Set capture region…* opens one transparent picker window per display; drag draws a rect; mouse-up confirms; ESC cancels
4. With auto-capture on at default 15s: capture cadence holds 15s ± 250ms across a 5-min window; widget flashes cyan for 600ms each capture
5. Drag the settings interval slider to 10s; next tick lands at 10s ± 250ms with no restart; exactly one `capture.intervalChanged` log line
6. *Capture now* twice within 500ms — the second is logged as debounced and produces no new file
7. `window.api.capture.getRecent()` from the dev panel never returns more than 5 entries; newest first
8. Manually `touch -t 202001010000 <captures-dir>/<some-file>.jpg`; within 60s the pruner removes it
9. With auto-capture running, revoke screen recording in System Settings — within one interval the widget flips to `'permDenied'`, the loop halts, and `capture.permissionLost` is logged
10. Disconnect the display the region was drawn on; relaunch — widget is amber, *Capture now* / *Toggle auto-capture* are disabled, *Set capture region…* is enabled
11. Pre-seed `electron-store` with `{ widget: { autoCapture: true } }`; launch — value moves to `capture.autoCapture`, old key is gone, exactly one `migration.captureAutoCapture` log line; relaunch produces no second migration line
12. With `NODE_ENV=development` the settings window shows the `RecentCapturesPanel` thumbnail grid; with `NODE_ENV=production` the panel is absent
13. Quit cleanly — final pruner sweep runs; `app.quit` log line is the last entry
14. Captured JPEGs open cleanly in Preview, are ≤ 1024px on the longest edge, and are < 500KB at q85 for a typical TradingView region
15. Inspect `CLAUDE_HANDOFF.md` and `project-state.md`; tick Chunk 3 only when 1–14 pass

### Chunk 4 — pending Mac acceptance
Harness loader, dev-mode chokidar watcher (debounced reload),
electron-store `harness.*` namespace, settings panel (`HarnessSettings`)
+ dev-only inspector (`HarnessInspector`), full `harness.*` IPC surface,
and 57 new tests are implemented and green inside the sandbox: `npm run
typecheck` + `npm run lint` + `npm test` (189/189 tests; 132 pre-existing
+ 37 harnessUtils + 11 harnessLoader + 5 harnessWatcher + 4 harnessStore).
`npm run build` produces a 165 kB renderer bundle (55 modules) and a
6.5 kB sandboxed preload bundle. Tick Chunk 4's box only after the full
PRD §7 verification (steps 1–23) passes on macOS 14+:

1. `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`
   - `chokidar@^3.6.0` is the only new dep — already present transitively from `sharp`'s deps, so install is a no-op resolution
2. **Cold load on representative fixture.** With `HARNESS_ROOT=tests/fixtures/harness-fixture-a` (or by selecting it via Settings → Harness → Browse), `npm run dev` writes a single `harness.loaded` log line with `fileCount=20`, `algorithms=12`, `docs=8`, `approxTokens` within ±15% of a Gemini-tokenizer reference, `loadDurationMs < 500`. Settings panel reflects the same numbers
3. **Header format snapshot.** Open the dev inspector (`Settings → Harness → Show bundle text`); the first three `### FILE:` headers match the fixture content byte-for-byte. The full text is also covered by `tests/harnessLoader.spec.ts` ("text envelope matches the D5/D6 byte-for-byte format")
4. **Determinism.** Two cold loads of the same fixture produce byte-identical bundle text (modulo the envelope's load timestamp). Automated by the same spec file
5. **Empty directory.** Repoint to `tests/fixtures/harness-fixture-empty/`. Settings panel shows `fileCount: 0`, yellow "empty harness directory" banner. `harness.empty` warn log appears once
6. **Ignored files.** Repoint to `tests/fixtures/harness-fixture-mixed/` — exactly one file (`algorithms/keep.ts`) is loaded; warnings list `secrets.env` (suspicious filename), `with-blob.ts` (suspicious content), `oversize.txt`, and the .pdf skip count. The bundle text contains neither `SECRET_API_KEY` nor the high-entropy blob
7. **Manifest applied.** Repoint to `tests/fixtures/harness-fixture-manifested/`. Bundle order shows `algorithms/zeta.ts` before `algorithms/alpha.ts`; `metadata.manifestUsed === true`; `docs/exclude-me.md` is absent
8. **Manifest malformed.** Edit the fixture's `HARNESS_INDEX.json` to be invalid JSON, click "Reload now". Settings shows red `MANIFEST_INVALID` banner; the previously-cached bundle (if there was one) is preserved
9. **Token ceiling.** Repoint to `tests/fixtures/harness-fixture-oversize/`. Settings shows red banner with `TOKEN_CEILING_EXCEEDED`; previous bundle preserved
10. **Hot reload (dev).** With `NODE_ENV !== 'production'` and a real harness root in use, edit a file under the root. Within ~700ms a single `harness.reloaded` log line appears; settings panel updates; renderer subscriber receives the IPC event. Run a script that writes the same file 10 times in 200ms — exactly one `harness.reloaded` log line (rapid-fire coalescing)
11. **Production behavior.** `npm run build && npm run package` produces a `.app`. Launching it: no `chokidar` instances; editing a harness file produces no log lines until "Reload now" is clicked; resolved root is the userData path, never the repo-relative dev fallback
12. **Browse / setRootPath.** Click "Browse for harness folder…", choose a different valid folder. Settings updates with the new root, file counts; `electron-store` reflects the change after restart. Choose a folder that doesn't exist (simulate via direct `setRootPath` IPC) — receive `ROOT_NOT_FOUND`; previous root remains persisted (rolled back on failure)
13. **Concurrent calls.** From the dev console, fire ten `window.api.harness.getMetadata()` calls in parallel against a freshly started loader. All ten resolve; exactly one `harness.loaded` log line (in-flight Promise dedup)
14. **`getBundleText()` gating in prod.** In a packaged build with `harness.showInspector === false`, calling `window.api.harness.getBundleText()` from a renderer console rejects with a typed error
15. **Watcher teardown.** Quit the app from the menu. No "watching" log lines after `app.quit`. No file descriptor leaks (verified via `lsof` on a long-running session before quit, then after)
16. Inspect `CLAUDE_HANDOFF.md` (new appended Session entry) and `project-state.md`; tick Chunk 4 only when 1–15 pass

Only after Chunk 4's box is ticked should the Chunk 5 PRD (Gemini Chat +
Vision) begin in earnest. Chunk 5 is the next sequential bottleneck per
`MVP_Chunking_Plan.md §1`.

### Chunk 5 — pending Mac acceptance (with real Gemini API key)
Gemini chat surface, vision attachment, JSON-mode structured output, single-
construction prompt builder, conversation memory (clear-on-close + Flash
summary truncation), token-budget guard, frameless 480×640 chat window,
five-variant error taxonomy, AI settings panel, and the locked Chunk 6
log-event names are implemented end-to-end and green inside the sandbox:
`npm run typecheck` + `npm run lint` + `npm test` (240/240 tests; 189 pre-
existing + 16 aiStore + 7 tokenBudget + 7 conversationStore + 9 geminiService
+ 5 chatStore + 7 chatPanel.smoke). Tick Chunk 5's box only after the full
PRD §7 verification (steps 1–31) passes on macOS 14+ with a real Gemini
API key:

1. `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`
   - New deps: `@google/generative-ai@^0.20.0`, `react-markdown@^9`, `remark-gfm@^4`, `rehype-highlight@^7` (runtime); `jsdom` (dev). All pure JS — no native binaries; no Apple Silicon install risk.
2. **Cold launch with no key.** Click widget — chat opens within 300ms with `<ChatError variant="no-api-key" />`; Send disabled; "Open AI Settings" CTA visible.
3. **Set API key** in Settings → AI → paste valid key → Save. Masked form displays. `ai.apiKeyUpdated` log line appears with the key value redacted by the existing `REDACT_PATHS` rule.
4. **First turn.** Type "What's the current signal and why?" Send. Within 10s an assistant message renders with: a markdown `analysis`, a `suggested_parameter_changes` table with at least one row + Copy buttons, a confidence badge, a risk callout. `gemini.callStarted` and `gemini.callCompleted` log lines appear with the documented field shape.
5. **System prompt composition is verifiable.** Inspect `gemini.callStarted.promptHash` (sha256). The composed prompt order matches D4: persona → harness envelope (`### HARNESS BUNDLE`) → schema reminder.
6. **Vision attachment is verifiable.** With three captures in the ring buffer, `gemini.callStarted.screenshotCount === 3` and `screenshotIds` correlate to files in `app.getPath('temp')/arch-public-ai-overlay/captures/`.
7. **JSON-mode reliability sweep.** 20 consecutive sends across a varied prompt set. ≥95% parse cleanly on first attempt. `GeminiCallStats.jsonParseFailRate` < 0.05.
8. **Multi-turn memory.** Send "Current signal?" → "Be more conservative." Second answer references the first turn. `conversationStore.getHistory(sessionId).length === 2`.
9. **Clear-on-close.** Close chat (window button OR second widget click OR `ESC` with no in-flight). Re-open. Message list is empty. `chat:historyCleared` push event fired.
10. **Quick prompts.** Each of the three D16 chips prefills the input bar verbatim and does not auto-send.
11. **Copy suggestion stub.** Click "Copy" on a `suggested_parameter_changes` row — clipboard contains `<parameter>: <current> → <proposed> # <rationale>`. `chat.suggestionCopied` log line written. NO TradingView mutation.
12. **Cancel-in-flight.** Press ESC during an in-flight call. State returns to `'idle'` within 100ms; no half-rendered assistant message appears.
13. **Token-ceiling guard.** Repoint loader at `tests/fixtures/harness-fixture-oversize/` (it busts the 1.5M ceiling). `<ChatError variant="token-ceiling" />` shown; Send disabled.
14. **Empty-harness guard.** Repoint to `tests/fixtures/harness-fixture-empty/`. `<ChatError variant="no-harness" />` shown; "Open Harness Settings" CTA visible.
15. **Settings model swap.** Change model from `gemini-3.1-pro-preview` to `gemini-3-flash-preview` (or `gemini-3.1-flash-lite-preview`). `ai.modelChanged` log line; next turn uses the new model (verifiable via `gemini.callStarted.model`).
16. **Slide-in animation.** Visually confirm 220ms ease-out open and 180ms ease-in close on a 2023 MacBook Air.
17. **Single-instance chat window.** Click the widget while chat is open — chat closes (slide-out + history cleared). Click again — chat opens fresh.
18. **Markdown rendering is sane.** Assistant `analysis` rendered with `react-markdown` + `remark-gfm`; fenced code blocks highlighted via `rehype-highlight`; tables render; raw HTML is dropped (no `rehype-raw`).
19. **30-minute crash-free session.** Continuous use (auto-capture on, ten chat turns spread across the window, two harness reloads in dev) — no unhandled errors, no memory growth > 50MB above baseline, no leaked Gemini in-flight requests on quit.
20. **IPC surface lock.** Reviewer greps `src/preload/index.ts` for any namespace beyond `log.*`, `widget.*`, `perms.*`, `capture.*`, `region.*`, `harness.*`, `chat.*`, `ai.*` — none present.
21. **Single-construction grep.** Reviewer greps for `new GoogleGenerativeAI` outside `src/main/geminiService.ts` — none present. Reviewer greps for `PERSONA_PROMPT` outside `src/shared/persona.ts`, `src/main/geminiService.ts`, and `tests/` — none present.
22. **API-key-never-raw audit.** `window.api.ai.getApiKey()` returns `{ present, masked }` only; raw key never crosses IPC. Renderer never references the raw value.
23. Inspect `CLAUDE_HANDOFF.md` (new appended Session entry) and `project-state.md`; tick Chunk 5 only when 1–22 pass

Only after Chunk 5's box is ticked should the Chunk 6 PRD (Rich Logging,
Handoff & Observability) begin in earnest. Chunk 6 is the next sequential
bottleneck per `MVP_Chunking_Plan.md §1`. The D28 event names + redaction
contract Chunk 6 inherits are already enforced in this chunk's code.
