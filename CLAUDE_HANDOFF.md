<!--
  CLAUDE_HANDOFF.md is APPEND-ONLY.

  Per `Context.md §7`, no session may edit, reformat, or delete a prior entry.
  New sessions add a new block at the bottom using the exact template from
  `Role.md`. Tooling that touches this file (see `src/main/handoffLogger.ts`,
  landing in Chunk 6) must seek-and-append only — never truncate.
-->

# Arch Public AI Overlay — Claude Handoff Log

This file is the AI-to-AI continuity record for the Arch Public AI Overlay
project. Every Claude-Dev session writes exactly one block when it finishes
meaningful work. Entries are chronological, newest at the bottom.

---

## Session Handoff Log
**Session ID:** 2026-04-23-ARCH-MVP-000-chunking
**Timestamp:** 2026-04-23T00:00:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** MVP chunking plan — slicing Context.md scope into sequential vertical chunks ready for per-chunk PRD authoring

### Decisions Made
- Adopted vertical-slice chunking (7 chunks) with strict sequential ordering per user confirmation
- Placed baseline pino logging inside Chunk 1 rather than deferring to Chunk 6 — rationale: Electron + overlay debugging without logs is painful
- Sequenced Harness Loader (Chunk 4) before Gemini integration (Chunk 5) so the first AI round-trip can be grounded in real harness content, not a stub
- Chunks 3 and 4 called out as the one natural parallelization seam should that ever become desirable
- Each chunk includes a ready-to-lift PRD outline so the user can start writing PRDs immediately without structural decisions

### Files Modified / Created
- `MVP_Chunking_Plan.md` (new)

### Open Questions / Risks
- Node.js version pinning choice (20.x LTS proposed, awaiting confirmation)
- Whether Gemini model selector should expose a post-1.5-Pro option available in 2026 — propose small allowlist in settings
- Harness token budget behavior if Arch Public source grows past Gemini usable context — MVP proposes hard-error with clear message; selection strategy is Post-MVP
- Ad-hoc signing gatekeeper UX for internal tester machines — captured in Chunk 7

### Recommended Next Steps for Next Claude Instance
1. Confirm the chunking plan with the human operator and adjust any chunk boundaries
2. Author the PRD for Chunk 1 using the outline in §2.1 — use it as the template for the remaining six
3. Once Chunk 1 PRD is approved, begin scaffolding the repository (do not start Chunk 2 until Chunk 1 acceptance criteria pass)
4. After Chunk 1 ships, draft Chunks 2 + 3 PRDs together since they share the widget/permissions seam

### Key Context Delta
- Chunking dimension chosen: vertical slices (demoable per chunk)
- Workflow chosen: strictly sequential
- Harness Loader confirmed as a first-class chunk rather than a sub-task of AI integration
- Deliverable chosen: single plan document; PRDs to be authored by the human operator from the per-chunk outlines

---

## Session Handoff Log
**Session ID:** 2026-04-23-ARCH-MVP-001-prd-chunk-1
**Timestamp:** 2026-04-23T00:00:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** Authoring the PRD for Chunk 1 (App Shell & Dev Foundation) per MVP_Chunking_Plan.md §2

### Decisions Made
- Lifted Chunk 1's PRD outline verbatim from the chunking plan and expanded each section to reviewer-ready detail
- Surfaced all open questions (from the plan plus newly identified tsconfig-split and palette-token questions) into a single "Decisions Needed" table at the top so the human operator can resolve them in one pass
- Locked caret-range versions for Electron 31, React 18, TypeScript 5.4, Vite 5, Tailwind 3, Vitest 1.6, Pino 9 — no speculative additions
- Chose split tsconfigs (base + main + renderer) over a single config to avoid target/module churn across environments
- Included a "Build produces artifact" criterion in Definition of Done so later chunks don't discover a broken build step late
- Seeded redaction config and the smoke-test hook for it in Chunk 1 even though full logging is Chunk 6, because the `pino` shape is set here

### Files Modified / Created
- `PRD_Chunk_1_App_Shell.md` (new)

### Open Questions / Risks
- D1–D8 in §0 need human sign-off before implementation; proposed defaults are safe but override-able
- Electron + Vite main/renderer wiring carries the usual template risk — captured in §6 with `electron-vite` reference as mitigation
- Preload IPC surface is narrow on purpose; any additions in later chunks require a PRD amendment to avoid ad-hoc sprawl

### Recommended Next Steps for Next Claude Instance
1. Walk through §0 Decisions Needed with the human operator and lock D1–D8
2. Once approved, scaffold the repo exactly per §3.1, run §7 verification, and tick Chunk 1 in `project-state.md`
3. Begin the paired PRDs for Chunks 2 and 3 (they share the widget + permissions seam per the chunking plan)
4. Do not start Chunk 2 implementation until Chunk 1 acceptance is signed off

### Key Context Delta
- First per-chunk PRD now exists; serves as the template for Chunks 2–7
- Tsconfig split and palette tokens added as new decisions beyond the chunking plan
- Redaction + smoke-test hook pulled forward into Chunk 1 to lock the pino shape early

---

## Session Handoff Log
**Session ID:** 2026-04-23-ARCH-MVP-002-chunk-1-scaffold
**Timestamp:** 2026-04-23T17:15:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** Chunk 1 implementation — scaffolded the Electron 31 + React 18 + TypeScript-strict skeleton per `PRD_Chunk_1_App_Shell.md` after the human operator approved §0 defaults D1–D8

### Decisions Made
- Applied approved defaults D1–D8 verbatim (Node 20 LTS via `.nvmrc`; npm; Electron 31; React 18; Tailwind 3; `@typescript-eslint/strict-type-checked`; split tsconfigs; palette tokens `#0b1220 / #16c784 / #e6b84a / #e6edf5`)
- Adopted a small `scripts/dev.mjs` orchestrator rather than a raw `concurrently` chain so Electron only launches after both the main bundle and the Vite server are ready — future chunks get a cleaner seam for adding watchers (e.g. overlay window rebuilds)
- Kept main-process code on relative imports and reserved the `@shared/*` alias for the renderer only, mitigating the runtime alias risk called out in PRD §6 without pulling in `tsc-alias`
- Split the logger into a pure pino wrapper (`createAppLogger`, `wrapPino`) plus a lazily-loaded Electron IPC bridge (`registerRendererLogBridge`) so Vitest can exercise the exact shape without spinning up Electron
- Seeded the redaction path list with every obvious secret field (`apiKey` / `token` / `authorization` / `secret`, plus wildcards) so Chunk 5's Gemini keys are covered the moment they appear
- Locked the preload surface to `window.api.log.{debug,info,warn,error}`; any expansion requires a PRD amendment per Chunk 1 §6 risk row
- Filed `postcss.config.js` (CommonJS) instead of the PRD-listed `.ts` because Tailwind 3 + Vite read JS configs without an extra TS loader — flagged as a minor deviation for the next PRD to formalize or revert

### Files Modified / Created
- `arch-public-ai-overlay/` (new repo folder created inside the workspace)
- `package.json`, `.nvmrc`, `.gitignore`, `.prettierrc`, `eslint.config.js`
- `tsconfig.json`, `tsconfig.main.json`, `tsconfig.renderer.json`
- `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `vitest.config.ts`, `electron-builder.yml`
- `scripts/dev.mjs`
- `src/main/index.ts`, `src/main/logger.ts`
- `src/preload/index.ts`
- `src/renderer/index.html`, `src/renderer/index.css`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/env.d.ts`
- `src/renderer/widget/.gitkeep`, `src/renderer/chat/.gitkeep`, `src/renderer/settings/.gitkeep`
- `src/shared/types.ts`, `src/shared/constants.ts`
- `arch-public-harness/README.md`
- `tests/logger.smoke.spec.ts`
- `README.md`, `project-state.md`, `CLAUDE_HANDOFF.md` (this entry)

### Open Questions / Risks
- `npm install` has not been run end-to-end on a clean macOS 14+ machine inside this Cowork sandbox (no Electron binary available here). The human operator should run PRD §7 steps 1–10 on their Mac and report any install-time drift before ticking Chunk 1 in `project-state.md`.
- ESLint 9 flat config + `typescript-eslint` v7 is new territory. If install resolves a different major, adjust `eslint.config.js` (the plugin namespace import style changes between majors).
- `package-lock.json` is NOT checked in because no install was run in this sandbox — it will materialize from the operator's first `npm install`.
- `postcss.config.js` deviates from PRD §3.1 (which listed `.ts`). Low-risk deviation; fix path is either accept as-is or add `postcss-load-config` with a TS loader in a follow-up.

### Recommended Next Steps for Next Claude Instance
1. On a clean macOS 14+ machine: `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`. Capture any install-time drift and pin versions in `package-lock.json`.
2. Tick Chunk 1 in `project-state.md` once §7 verification passes end-to-end.
3. Begin paired PRDs for Chunk 2 (overlay widget) and Chunk 3 (screenshot engine) — they share the macOS screen-recording permission seam per MVP_Chunking_Plan.md §2.
4. Do not expand the `window.api` preload surface in Chunk 2 without first amending Chunk 1's PRD (explicit §6 risk row).

### Key Context Delta
- Repo now bootstraps from `npm install && npm run dev` on macOS 14+; `src/**` layout matches PRD §3.1 exactly.
- Logger shape, redaction paths, and the `(event, context)` convention are locked — every subsequent chunk inherits them without retrofitting.
- `scripts/dev.mjs` replaces the speculative `concurrently + wait-on` chain with a single-file orchestrator; no extra dev-tool dependencies beyond what the PRD §4 stack locks call out.
- Main-process code uses relative imports only; `@shared/*` alias is renderer-scoped. New rule to carry forward.

---

## Session Handoff Log
**Session ID:** 2026-04-24-ARCH-MVP-003-chunk-1-verify
**Timestamp:** 2026-04-24T07:54:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** Dry-running Chunk 1 verification inside the Cowork sandbox — `npm install`, typecheck, lint, vitest, `vite build`, and `tsc -p tsconfig.main.json` all executed against the scaffold; small cross-version fixes applied before handoff

### Decisions Made
- Bumped `typescript-eslint` from `^7.10.0` to `^8.0.0` — the 7.x line only accepts ESLint 8, and we pinned ESLint 9 in Chunk 1 to stay on the flat-config path
- Bumped `eslint-plugin-react-hooks` from `^4.6.0` to `^5.0.0` for the same ESLint-9 compat reason; bumped `eslint-plugin-react` from `^7.34.0` to `^7.35.0` for completeness
- Dropped the unused module-level `mainWindow` reference in `src/main/index.ts`. Electron retains its own reference to every live `BrowserWindow`, so the extra variable only tripped the strict `noUnusedLocals` check
- Replaced the deprecated `JSX.Element` return type in `src/renderer/App.tsx` with `ReactElement` from `react` — ESLint's `@typescript-eslint/no-deprecated` flagged it under the new typescript-eslint major
- Stringified the dev-server port inside a template literal in `src/main/index.ts` to satisfy `restrict-template-expressions` under the stricter typed-lint rules
- Committed the resulting `package-lock.json` so future installs reproduce the exact combo that passed verification in this session

### Files Modified / Created
- `package.json` (dep-range bumps for ESLint 9 compat)
- `package-lock.json` (new — materialized from the first `npm install`)
- `src/main/index.ts` (dropped unused `mainWindow` ref; stringified port in template literal)
- `src/main/logger.ts` (trimmed one stale eslint-disable clause)
- `src/renderer/App.tsx` (replaced `JSX.Element` with `ReactElement`)

### Open Questions / Risks
- Verification ran on Node 22 in the sandbox, not the pinned Node 20. The pino/vitest/tsc paths exercised here are not version-sensitive, but the operator's run on macOS + Node 20 is still the one that closes Chunk 1
- `npm install` was executed with `--ignore-scripts` to skip Electron's postinstall binary download. The operator's first install on their Mac will pull the Electron binary, which is the piece the sandbox cannot validate
- Minor Node warning `MODULE_TYPELESS_PACKAGE_JSON` fires on ESLint config reparse. Informational only; can be silenced by renaming `eslint.config.js` → `eslint.config.mjs`, at the cost of a one-line deviation from PRD §3.1. Left as-is; the operator can pick either path

### Verification Results (inside sandbox)
- `npm install` — 706 packages, 0 peer-dep conflicts after the bumps above
- `npx tsc --noEmit -p tsconfig.main.json` — clean
- `npx tsc --noEmit -p tsconfig.renderer.json` — clean
- `npx eslint "src/**/*.{ts,tsx}"` — 0 errors, 0 warnings
- `npx vitest run` — 5/5 tests pass; logger shape + redaction verified end-to-end against the real pino instance
- `npx vite build` — 31 modules, 143 kB JS, 5.67 kB CSS emitted to `dist/renderer/`
- `npx tsc -p tsconfig.main.json` — emits `dist/main/index.js`, `dist/main/logger.js`, `dist/preload/index.js`, `dist/shared/*.js`. Preload path math in main matches the emitted layout

### Recommended Next Steps for Next Claude Instance
1. On macOS 14+ with Node 20: `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`. The lockfile landed in this session should reproduce the verified tree.
2. Confirm the real Electron binary downloads cleanly (the piece we could not validate in the sandbox), then inspect `logs/app-<today>.jsonl` for `app.ready` + `renderer.ready` before ticking Chunk 1 in `project-state.md`.
3. Begin paired PRDs for Chunks 2 + 3 — the permissions seam is the real cross-cut; keep the current `window.api.log` surface untouched until those PRDs are approved.
4. If the ESLint 9 / typescript-eslint 8 combo keeps producing version-churn noise over the next chunks, consider pinning minor versions in `package.json` to the exact ones in `package-lock.json` rather than caret ranges.

### Key Context Delta
- ESLint/TSLint stack is now confirmed on ESLint 9 + typescript-eslint 8 + react-hooks plugin 5 — this trio is the version floor for all subsequent chunks
- `package-lock.json` is now the authoritative record of the Chunk 1 dep graph; treat it as sticky until a PRD amendment bumps a dep
- Chunk 1 scaffold is end-to-end green against typecheck/lint/test/build inside the sandbox. The only remaining signal the operator needs to produce is a real `npm run dev` session on their Mac that writes the expected `app.ready` + `renderer.ready` lines into `logs/`

---

## Session Handoff Log
**Session ID:** 2026-04-24-ARCH-MVP-004-chunk-2-widget
**Timestamp:** 2026-04-24T15:45:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** Chunk 2 implementation — replaced the Chunk 1 dev-shell with the frameless transparent always-on-top overlay widget, first-run macOS screen-recording permission flow, native right-click context menu, 640×480 Settings shell, and the full widget/perms IPC surface per `PRD_Chunk_2_Always_On_Top_Widget.md` after the operator approved §0 defaults D1–D12

### Decisions Made
- Applied approved defaults D1–D12 verbatim: 48×48 body with 4 px transparent halo (56×56 window), default anchor top-right with 72 px inset, `alwaysOnTop('screen-saver')` + `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})`, status vocabulary `ready|paused|permDenied` with 2 s pulse on ready, native `Menu.buildFromTemplate` context menu (Capture now · Toggle auto-capture · Open Settings · Quit), Settings window single-instance 640×480 non-resizable, one-shot permission modal with 'Continue' / 'Skip for now' / 'Open System Settings' recovery
- Treat the permission denial state as a first-class `WidgetStatus` (`permDenied`) rather than a separate prop — keeps the widget's render path driven by a single enum and makes Chunk 5's Gemini gate trivial (`status !== 'ready'` short-circuits chat input)
- Persistence strategy for `widget.position`: write only on the BrowserWindow `moved` event (drag-end), not on every `move`, per PRD §6. Avoids hammering `electron-store` during a drag; survives crashes because `electron-store` sync-writes
- Split `widgetState.ts` into a pure `wrapStore(StoreLike)` wrapper + a `createWidgetStateStore()` factory that dynamically `import()`s the ESM-only `electron-store` v10. Tests inject a fake `StoreLike`; production lazy-loads the real store at `app.whenReady`. No ESM-in-CommonJS build drift and no `electron-store` in Vitest's module graph
- `clampPosition(saved, ctx)` extracted as a pure function taking a synthetic `DisplayInfo[]` + `primaryId`. Covers the four real scenarios (in-saved-display, saved-display-gone, off-all-displays, no-saved-position) and is fully unit-testable without Electron's `screen` module
- Permissions: Electron's `systemPreferences.askForMediaAccess` does NOT support `'screen'`. The only portable trigger for the macOS native prompt is a throwaway `desktopCapturer.getSources({types:['screen'], thumbnailSize:{1,1}})` call. `buildPermissionsHelper(deps)` encapsulates this with a poll loop that reads `getMediaAccessStatus('screen')` until it settles or a deadline expires. Dev-ergonomics short-circuit treats non-`darwin` platforms as `granted`
- Click-through halo architecture: the BrowserWindow starts with `setIgnoreMouseEvents(true, {forward: true})`; the renderer toggles it off via a new `widget.setInteractive(on)` IPC channel on `mouseenter`/`mouseleave` of the pill body. PRD §3.2 listed no such channel, so this is a scope addition — flagged for a PRD amendment before Chunk 3 starts
- Two BrowserWindows (overlay + settings) share one Vite bundle; disambiguation is a `?view=widget|settings` query param in dev and a `#view=…` hash in prod (`loadFile` doesn't carry query strings, so a hash fragment is the transport). `resolveView()` in `renderer/main.tsx` parses both and adds an `html.view-widget` / `html.view-settings` class that drives the transparent-vs-opaque body background
- Renderer UI state held in a single Zustand store (`useWidgetStore`) with a pure `statusFromPermission` helper exported for tests. Avoids prop-drilling the permission/modal state through `Widget → PermissionModal` and keeps the status-reducer logic testable in isolation
- Context menu is built in the **main** process (`Menu.buildFromTemplate` + `menu.popup(window, {x,y})`) per PRD D12 — the renderer only tells main "open the menu at X,Y" via IPC. Menu actions execute in main (Settings open, app quit) and log `widget.menuAction` with the action string
- Left-click emits `widget:click` with `{at, bounds, ts}` and is logged by main only; Chunk 5 will subscribe. The renderer does not synthesize any AI-specific semantics in Chunk 2
- Non-null-assertion-free control flow in `clampPosition`: guarded with `if (displays.length === 0) return …` so TypeScript narrows `displays[0]` to `DisplayInfo` without a `!`. Matches the project's lint posture (no `!` allowed) and avoids a suppressed rule

### Files Modified / Created
- `package.json` (added `electron-store ^10.0.0`)
- `src/shared/ipcChannels.ts` (new — 10 channel constants + 4 menu-action strings)
- `src/shared/types.ts` (extended — `WidgetStatus`, `WidgetPosition`, `PermissionState`, `PersistedWidgetState`, `WidgetClickPayload`, `Bounds`)
- `src/shared/constants.ts` (added widget + settings + permissions constants, removed Chunk 1 dev-window sizes)
- `src/main/widgetState.ts` (new — `StoreLike`, `wrapStore`, `createWidgetStateStore`, `clampPosition`, `DEFAULT_WIDGET_STATE`)
- `src/main/permissions.ts` (new — `buildPermissionsHelper`, `createPermissionsHelper`, `statusForPermission`)
- `src/main/overlayWindow.ts` (new — `createOverlayWindow`, `buildRendererUrl`)
- `src/main/settingsWindow.ts` (new — single-instance `openSettingsWindow`)
- `src/main/contextMenu.ts` (new — `buildWidgetMenuTemplate`, `popupWidgetMenu`)
- `src/main/index.ts` (rewritten — boot sequence: logger → state store → permissions → IPC → overlay; full Chunk 2 IPC registry; narrow runtime type guards)
- `src/preload/index.ts` (extended — `window.api.widget.*` + `window.api.perms.*` preserving the Chunk 1 log surface unchanged)
- `src/renderer/env.d.ts` (widget + perms surface typings)
- `src/renderer/index.css` (widget palette tokens; `view-widget` vs `view-settings` body background rules)
- `src/renderer/main.tsx` (rewritten — `resolveView()`, view-class side effect, mounts `Widget` or `SettingsShell`)
- `src/renderer/widget/widgetStore.ts` (new — Zustand store + `statusFromPermission`)
- `src/renderer/widget/widget.module.css` (new — `.frame` drag region, `.body` no-drag pill, `.pulseReady`, ring variants, modal styles)
- `src/renderer/widget/Widget.tsx` (new — pill + first-run modal + click-through enter/leave handlers)
- `src/renderer/settings/SettingsShell.tsx` (new — blank settings pane placeholder)
- `src/renderer/App.tsx` (deleted — superseded by per-view entry points)
- `src/renderer/widget/.gitkeep`, `src/renderer/settings/.gitkeep` (deleted — folders now have real code)
- `tests/widgetStore.spec.ts` (new — 9 tests; status-from-permission matrix + Zustand setters + `applyPermissionOutcome`)
- `tests/widgetState.spec.ts` (new — 13 tests; `wrapStore` round-trips against a fake store + `clampPosition` across all four scenarios including a two-display topology)
- `tests/permissions.spec.ts` (new — 13 tests; `statusForPermission` matrix, `getScreenRecordingStatus` platform branches, `requestScreenRecording` happy path / denied path / thrown-capturer path / deadline expiry)

### Open Questions / Risks
- **PRD amendment pending**: `widget.setInteractive(on: boolean)` is not in PRD §3.2's locked IPC surface but is required for D5's click-through halo to function under `setIgnoreMouseEvents`. The alternative (renderer computes the pill-body hitbox from cursor geometry and tells main when to flip) is strictly worse. Proposal: amend PRD §3.2 to add the channel before Chunk 3 starts. Flagged here so the amendment isn't forgotten
- **Sandbox cannot exercise the real macOS prompt**: `systemPreferences.getMediaAccessStatus('screen')` + `desktopCapturer.getSources` are Electron-runtime APIs. All Chunk 2 permission tests inject fakes. The operator's Mac acceptance run is the only signal that the real prompt fires, denial path recovers via System Settings deep-link, and the `permDenied` → `ready` transition happens without restart
- **`electron-store` v10 is ESM-only**: the dynamic-`import()` bridge inside `createWidgetStateStore` works under both `ts-node` and the compiled CommonJS main bundle, but if a future chunk bundles main with esbuild/rollup it must preserve the dynamic import (don't let the bundler inline it)
- **Transparent window + rounded CSS on macOS**: the pill body uses a CSS `border-radius: 50%`. Some macOS versions clip the transparent corners less cleanly when `roundedCorners: true` on the BrowserWindow; we set `roundedCorners: false` + `hasShadow: false` to put the shadow in CSS and own the visual. The operator should verify no square halo appears on macOS 14/15
- **`alwaysOnTop` vs fullscreen apps**: macOS refuses to keep any window above Mission Control, native `screencaptureui`, or certain secure-input surfaces. This is documented behavior, not a bug. The widget will momentarily recede during those OS interactions; it returns on its own

### Verification Results (inside sandbox)
- `npm install --ignore-scripts` — 731 packages total (added 25 for `electron-store` and its deps), 0 peer-dep conflicts
- `npx tsc --noEmit -p tsconfig.main.json` — clean
- `npx tsc --noEmit -p tsconfig.renderer.json` — clean
- `npx eslint "src/**/*.{ts,tsx}"` — 0 errors, 0 warnings
- `npx vitest run` — 40/40 tests pass (5 Chunk 1 logger + 9 widgetStore + 13 widgetState + 13 permissions)
- `npx vite build` — 47 modules, 151.4 kB JS, 8.79 kB CSS emitted to `dist/renderer/`
- `npx tsc -p tsconfig.main.json` — emits `dist/main/{index,logger,widgetState,permissions,overlayWindow,settingsWindow,contextMenu}.js` + `dist/preload/index.js` + `dist/shared/*.js`; preload `path.join(__dirname, '..', 'preload', 'index.js')` in `overlayWindow.ts` matches the emitted layout

### Recommended Next Steps for Next Claude Instance
1. On macOS 14+ with Node 20: run `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`. Validate all 14 items in `PRD_Chunk_2_Always_On_Top_Widget.md §5` on the real Mac, then tick Chunk 2 in `project-state.md`. Key Mac-only checks: the first-run modal fires once and never again, denial path opens System Settings and flips to `ready` on return without app restart, the widget survives Spaces + fullscreen transitions, drag persists across relaunch, right-click menu shows all four items with working accelerators
2. Amend `PRD_Chunk_2_Always_On_Top_Widget.md §3.2` to formally include `widget.setInteractive(on: boolean)` before Chunk 3's PRD goes out — Chunk 3's region picker will want the same seam
3. Once Chunk 2 is ticked, start the Chunk 3 PRD (Screenshot Engine & Region Picker). The `capture.*` electron-store namespace and any new `desktopCapturer` usage should cite the existing `widget.*` store layout so two namespaces evolve in parallel, not in conflict
4. If the operator wants a Chunk 2 → Chunk 3 parallel seam, Chunk 3 can start its region-picker UI work now; it does not depend on the Mac acceptance run for Chunk 2 since the widget surface is locked

### Key Context Delta
- Overlay BrowserWindow flags, `screen-saver` always-on-top level, `visibleOnAllWorkspaces({visibleOnFullScreen:true})`, and the `setIgnoreMouseEvents(true, {forward:true})` default are now locked. Every later chunk that opens a new window inherits these as the template
- Status vocabulary `WidgetStatus = 'ready' | 'paused' | 'permDenied'` is the single source of truth for the pill's visual state. Chunk 3 (capture pause/resume), Chunk 5 (chat readiness gate), and Chunk 6 (logging) all consume it directly
- IPC namespaces settled: `log.*` (Chunk 1), `widget.*` + `perms.*` (Chunk 2). Chunks 3/5 will add `capture.*` and `ai.*` at the top level of `window.api`; no refactoring of the existing three is anticipated
- Electron-store schema: `widget.{position,status,autoCapture,permissionsPromptSeen}` is live. Chunks 3/5 must not touch any `widget.*` key; their new namespaces (`capture.*`, `ai.*`) are reserved at the same level
- One open PRD amendment tracked: `widget.setInteractive` addition to §3.2. Do not start Chunk 3 implementation until this is either amended in or explicitly acknowledged by the operator

---

## Session Handoff Log
**Session ID:** 2026-04-26-ARCH-MVP-005-chunk-3-capture
**Timestamp:** 2026-04-26T17:18:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** Chunk 3 implementation — screenshot engine, region picker, dev settings panel, and the full `capture.*` / `region.*` IPC surface per `PRD_Chunk_3_Screenshot_Engine_Region_Picker.md` after the operator approved §0 defaults D1–D16

### Decisions Made
- Applied approved defaults D1–D16 verbatim: 15s default cadence (slider 5–60s), N=5 ring, M=30min disk TTL with 60s pruner, JPEG q85 1024px-longest-edge sRGB EXIF-stripped, captures dir under `app.getPath('temp')/arch-public-ai-overlay/captures/`, screen-saver-level fullscreen frameless picker per display, ESC/Enter keybindings, dual logical+physical coord storage, re-prompt on missing displayId, dev-only Recent Captures panel gated on `import.meta.env.DEV`, `'capturing'` 600ms flash status added, self-correcting `setTimeout` chain, 500ms manual debounce, one picker window per display
- `displayUtils.ts` is the single source of truth for Retina coord math — `logicalRectToPhysical`/`physicalRectToLogical`/`buildCaptureRegion`/`isRegionStillValid` are all pure and tested at scaleFactor 1, 2, 3 (PRD §6 high-risk surface)
- `screenshotService` accepts injectable `desktopCapturer`/`sharp`/`fs`/`permissions`/timer/clock surfaces so the entire loop is exercised in pure Node — 21 tests cover ring eviction, scheduler behavior, in-flight guard, manual debounce, permission revocation, pruner, and event emission with no Electron import
- The picker spawns one transparent fullscreen `BrowserWindow` per display via `screen.getAllDisplays()`; the `displayId` is encoded in the renderer URL (query in dev, hash in prod) so the React tree knows which window it is when `_pickerConfirm` fires. Picker-internal channels are prefixed `_` on the `window.api.region` surface so reviewers can spot accidental use from the overlay/settings
- Manual `captureNow` initialized `lastManualTs` to `Number.NEGATIVE_INFINITY` so the very first call is never debounced — caught by the test rig (the obvious `0` default would have shipped a silent regression)
- The `'capturing'` status is **transient by contract** — main never persists it, the widget store wrapper rejects it on read, and main's `flashWidgetCapturing` schedules a 600ms reset that honors a mid-flash `'paused'` (PRD D11). Two layers of "paused wins" defense: main checks the persisted status before re-broadcasting `'ready'`, and the renderer-side `decideFlashReset` keeps `paused`/`permDenied` if they raced in
- One-shot migration `widget.autoCapture` → `capture.autoCapture` lives in `captureStore.ts` with a sticky `capture.migrations.autoCaptureFromWidget` flag so subsequent launches no-op even if some other code re-adds the legacy key. Unit-tested for the `true`/`false`/`undefined`/`wrong-type` paths
- `sharp` was added at `^0.33.0` and `ulid` at `^2.3.0` per PRD §4. `npm install --ignore-scripts` resolved cleanly inside the sandbox (the operator's Mac will run scripts and produce the native binary)
- The `desktopCapturer.getSources` adapter in `main/index.ts` widens our `readonly` types into Electron's mutable `SourcesOptions` and projects the `Source[]` down to the narrow `DesktopCapturerSource[]` the service consumes — keeps the service interface defensive without leaking Electron types
- IPC surface additions match PRD §3.2 verbatim: `window.api.capture.{getLoopState, start, stop, captureNow, setIntervalMs, getRecent, onCaptured, onLoopStateChanged}` + `window.api.region.{getRegion, openPicker, clearRegion}`. The two picker-internal channels (`_pickerConfirm`/`_pickerCancel`) are flagged as private and reviewed below as a scope addition for the next PRD amendment
- Disk pruner runs for the entire app lifetime (not just while the loop is on) so a paused-and-forgotten session still has its temp files swept. Final sweep on `app.before-quit` per PRD §3.5

### Files Modified / Created
- `package.json` (added `sharp@^0.33.0`, `ulid@^2.3.0`)
- `src/shared/types.ts` (extended — `Screenshot`, `CaptureRegion`, `CaptureLoopState`, `CapturePermissionError`; widened `WidgetStatus` to include `'capturing'`)
- `src/shared/ipcChannels.ts` (extended — 8 capture channels, 5 region channels, `MENU_ACTION_SET_REGION`)
- `src/shared/constants.ts` (extended — capture cadence/buffer/pruner/JPEG/flash/debounce/slider constants)
- `src/main/displayUtils.ts` (new — pure logical↔physical helpers, `buildCaptureRegion`, `isRegionStillValid`, FNV-1a region id hash, `getCurrentDisplays` factory)
- `src/main/captureStore.ts` (new — `wrapCaptureStore`, `clampIntervalMs`, `migrateAutoCaptureKey`, `createCaptureStore` ESM dynamic import)
- `src/main/screenshotService.ts` (new — capture loop + ring buffer + pruner + emitter; `DesktopCapturerLike`/`SharpLike`/`FsLike`/`PermissionsCheckLike` injectable surfaces)
- `src/main/regionPicker.ts` (new — one transparent picker `BrowserWindow` per display; `openRegionPicker()` returns `Promise<CaptureRegion | null>`; idempotent active-session tracking)
- `src/main/contextMenu.ts` (extended — real handlers for *Capture now* / *Toggle auto-capture* / new *Set capture region…*; enabled state driven by `loopState.regionValid` + `permission`; `toolTip` strings on disabled items)
- `src/main/index.ts` (extended — capture store + migration log line, screenshotService instantiation with the desktopCapturer/sharp/fs/permissions adapters, `flashWidgetCapturing` 600ms broadcaster, capture+region IPC handlers, `runRegionPicker` shared path, resume-loop-on-launch guard, `app.before-quit` shutdown call)
- `src/preload/index.ts` (extended — `window.api.capture.*` and `window.api.region.*` namespaces with locked `_pickerConfirm`/`_pickerCancel` internals)
- `src/renderer/env.d.ts` (extended — capture + region surface typings to match the preload)
- `src/renderer/main.tsx` (extended — `'regionPicker'` view added to the resolver)
- `src/renderer/index.css` (extended — `html.view-regionPicker` transparent fullscreen body rules)
- `src/renderer/regionPicker/RegionPicker.tsx` (new — crosshair draw UX, ESC/Enter handlers, hint footer, mouse-up auto-confirm)
- `src/renderer/regionPicker/regionGeometry.ts` (new — pure `rectFromDrag` + `isRectViable` math)
- `src/renderer/regionPicker/regionPicker.module.css` (new — scrim, draw rect outline, dimensions label, key-hint chips)
- `src/renderer/widget/widgetStore.ts` (extended — `flashCapturing()` helper, `decideFlashReset` pure rule, `'capturing'` accepted by setStatus)
- `src/renderer/widget/Widget.tsx` (extended — `'capturing'` ring class)
- `src/renderer/widget/widget.module.css` (extended — `.ringCapturing` cyan flash style)
- `src/renderer/settings/SettingsShell.tsx` (rewritten — mounts `<CaptureSettings />` always, `<RecentCapturesPanel />` only in dev builds)
- `src/renderer/settings/CaptureSettings.tsx` (new — interval slider with 150ms IPC debounce, region status display, Re-draw / Start-Stop / Capture-now buttons)
- `src/renderer/settings/RecentCapturesPanel.tsx` (new — dev-only thumbnail/metadata grid for the last N=5 captures, live-updates on `onCaptured`)
- `tests/displayUtils.spec.ts` (new — 18 tests; logical↔physical at scaleFactor 1/2/3 + edge cases, region id stability, region validity matrix)
- `tests/captureStore.spec.ts` (new — 18 tests; clamp + round-trip + region defensive parse + the four migration paths)
- `tests/screenshotService.spec.ts` (new — 21 tests; ring eviction, manual debounce, scheduler scheduling/re-arm/stop, in-flight guard, permission revocation, pruner sweeps, event emission)
- `tests/regionPicker.spec.ts` (new — 11 tests; rect normalization in all four drag directions, viewport clamping, viable-rect filter)
- `tests/contextMenu.spec.ts` (rewritten — adds 9 new tests for Chunk 3 enabled-state rules + handler wiring; preserves all Chunk 2 assertions)
- `tests/widgetStore.spec.ts` (extended — `'capturing'` accepted, `decideFlashReset` rule, `flashCapturing()` timer behavior with `vi.useFakeTimers`)
- `tests/widgetState.spec.ts` (extended — defensive note that persisted `'capturing'` is rejected)

### Open Questions / Risks
- **PRD amendment pending**: `window.api.region._pickerConfirm` / `_pickerCancel` channels are picker-internal but live on the same `window.api.region` namespace. They are essential (the picker's React tree needs a way to confirm/cancel back to main) but are not in the locked PRD §3.2 surface. Same shape as the Chunk 2 `widget.setInteractive` deviation — propose formalizing in the next amendment alongside the still-open Chunk 2 item
- **Sandbox cannot exercise the real capture pipeline**: `desktopCapturer.getSources` is an Electron-runtime API and `sharp` ships native binaries; all 21 service tests inject fakes. The operator's Mac acceptance run is the only signal that `desktopCapturer` returns the right thumbnail size on Retina, that sharp's `extract({left, top, width, height})` lines up with the picker's draw, and that the resulting JPEG opens cleanly in Preview at the expected dimensions
- **macOS `displayId` stability across reboots is not guaranteed**: per D9 we re-prompt rather than guess. If the operator finds this UX too aggressive after dogfooding, the override is to switch D9 to "best-effort proportional rect" — simple change in `screenshotService.start()` and the picker is unaffected
- **`sharp` native install on Apple Silicon**: pinned at `^0.33.0`. Smoke-test in §7 verification step #1 is the gate — a failure here would block Chunk 7 packaging. **Confirmed hit on first Mac launch (2026-04-26)**: `npm install` in the Linux sandbox only pulled `@img/sharp-linux-x64`, so the lockfile shipped to the Mac was missing `@img/sharp-darwin-arm64`. Fix is one of: `npm install --os=darwin --cpu=arm64 sharp` (surgical) or `rm -rf node_modules package-lock.json && npm install` (clean). Documented in `README.md` under "Sharp install on Apple Silicon" and inlined into `project-state.md`'s Chunk 3 acceptance checklist step #1. **Future AI sessions**: when adding any native-binary dep on Linux, anticipate this for the operator's Mac and document the fix in advance.
- **Vite `outDir` permission quirk in this sandbox**: `vite build` couldn't unlink the prior `dist/renderer/assets/*.js` due to the mounted-folder permission setup, but the build itself was clean (53 modules transformed; the same build to `/tmp/build-renderer-out` succeeded). On the operator's Mac this is moot — `dist/` will be rebuildable normally. Documented so the next instance doesn't chase a phantom bug
- **Vitest 1.6 + Vite 5 CJS deprecation warning**: cosmetic; will need a test-config bump when Vitest catches up. Not blocking
- **Picker window appearing in `desktopCapturer` output**: if the user manages to trigger overlapping captures while the picker is open, the in-flight guard blocks the second one. The picker is destroyed before the next scheduled capture fires, so the steady-state risk is low. Operator should still verify on the Mac that the picker is gone from `desktopCapturer` source enumeration during a capture cycle

### Verification Results (inside sandbox)
- `npx tsc --noEmit -p tsconfig.main.json` — clean
- `npx tsc --noEmit -p tsconfig.preload.json` — clean
- `npx tsc --noEmit -p tsconfig.renderer.json` — clean
- `npx eslint "src/**/*.{ts,tsx}"` — 0 errors, 0 warnings
- `npx vitest run` — **132/132 tests pass** (5 logger + 13 perms + 13 widgetState + 17 widgetStore + 16 contextMenu + 18 displayUtils + 18 captureStore + 11 regionPicker + 21 screenshotService)
- `npx tsc -p tsconfig.main.json` — emits `dist/main/{index,logger,widgetState,permissions,overlayWindow,settingsWindow,contextMenu,captureStore,displayUtils,regionPicker,screenshotService}.js`
- `node scripts/build-preload.mjs` — emits `dist/preload/index.js` (5.1 kB) + sourcemap
- `vite build` to `/tmp/build-renderer-out` — 53 modules transformed cleanly (sandbox `dist/renderer/` mount-permission quirk only)

### Recommended Next Steps for Next Claude Instance
1. On macOS 14+ with Node 20: `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`. Walk every item in `PRD_Chunk_3_Screenshot_Engine_Region_Picker.md §7` (steps 1–18). Ticking Chunk 3 in `project-state.md` requires all 18 to pass on a real Mac with at least one external display attached for the multi-display picker check (#7)
2. Particular Mac-only checks: (a) `desktopCapturer` returns thumbnails at the display's *physical* resolution and `sharp.extract({left:px, top:py, width:pw, height:ph})` produces a pixel-accurate crop on Retina; (b) the 600ms `'capturing'` flash is visible and pleasant in peripheral vision; (c) revoking screen-recording permission mid-loop in System Settings flips the widget to amber within one interval and writes one `capture.permissionLost` log line; (d) interval slider drag from 60→5 produces exactly one `capture.intervalChanged` log line, not 56
3. Amend `PRD_Chunk_3_Screenshot_Engine_Region_Picker.md §3.2` to formally include `window.api.region._pickerConfirm` and `_pickerCancel` (or refactor them into a separate `_picker.*` namespace if a reviewer prefers stricter naming). Same posture as the Chunk 2 `widget.setInteractive` open item
4. Begin the Chunk 4 PRD (Harness Loader & Knowledge Base) — Chunks 3 and 4 are the natural parallelization seam per `MVP_Chunking_Plan.md §1`. Chunk 4 owns the `harness.*` electron-store + IPC namespaces and adds a panel alongside `<CaptureSettings />` in the Settings shell
5. When drafting the Chunk 5 PRD, restate the §3.2 IPC contract verbatim — Chunk 5's `geminiService` subscribes to `window.api.capture.onCaptured` and pulls `getRecent({limit: 1..3})` per the §8 handoff seam in this PRD

### Key Context Delta
- Capture pipeline is event-driven from day one (`onCaptured`, `onLoopStateChanged`); Chunk 5's Gemini service subscribes rather than polls
- `WidgetStatus` is now `'ready' | 'paused' | 'permDenied' | 'capturing'`. The new value is **transient** — never persisted, always reset within 600ms (paused/denied win the race)
- IPC namespaces settled: `log.*` (Chunk 1), `widget.*` + `perms.*` (Chunk 2), `capture.*` + `region.*` (Chunk 3). Chunk 4 will claim `harness.*`, Chunk 5 will claim `ai.*` — none should ever read or write outside its own
- Electron-store schema: `widget.*` (Chunk 2) and `capture.*` (Chunk 3) coexist in the same `config` JSON file; the migration of `widget.autoCapture` → `capture.autoCapture` is one-shot and sticky
- New deps: `sharp@^0.33.0`, `ulid@^2.3.0`. No others
- The `displayUtils.ts` module is the only place that multiplies/divides by `scaleFactor`. Any future Retina bug should be tracked back to this file first
- `arch-public-harness/` directory remains a placeholder for Chunk 4 — untouched here

---

## Session Handoff Log
**Session ID:** 2026-04-26-ARCH-MVP-006-chunk-4-harness
**Timestamp:** 2026-04-26T18:02:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** Chunk 4 implementation — harness loader, dev-mode chokidar watcher, electron-store harness namespace, settings panel + dev inspector, full `harness.*` IPC surface, and 57 new tests per `PRD_Chunk_4_Harness_Loader_Knowledge_Base.md` after the operator approved §0 defaults D1–D20

### Decisions Made
- Applied approved defaults D1–D20 verbatim: harness root precedence userData → repo-relative dev fallback (D1), the locked extension list + ignore globs + 2 MB per-file cap (D2/D3), POSIX-normalized alphabetical ordering with case preserved (D4), the `### FILE: <relPath>\n\n` header + `\n\n---\n\n` separator + envelope opener (D5/D6), `ceil(charCount/3.8)` token estimator (D7), 1.5M token ceiling (D8), 500 ms chokidar debounce + dev-only (D9), in-memory cache only (D10), in-flight-Promise dedup for concurrent callers (D11), PDF skip + once-per-load log (D12), defense-in-depth secrets heuristic — filename regex + Shannon entropy on tokenized line content (D13), optional `HARNESS_INDEX.json` curation manifest with `include`/`exclude`/`priority` (D14), `algorithms/`/`docs/` path-prefix classification (D15), settings panel scope (D16), inspector gated on dev OR `harness.showInspector` (D17), `HARNESS_WATCHER_POLLING=1` opt-in (D18), empty harness is non-fatal (D19), `harness:reloaded` event payload is metadata-only (D20)
- Chose a Map<reason, string[]> bucket for `buildWarnings` rather than `Record<string, string[]>` — `strict-type-checked` + `no-unnecessary-condition` rejects the indexed-record pattern because TS types miss as `string[]` not `string[] | undefined`. Map preserves the optionality the linter wants
- Filename-level secret heuristic now runs BEFORE the default-extension check (intentional reorder during Vitest debugging) — a `secrets.env` should surface as `suspiciousName` (security signal in the metadata.warnings yellow banner) rather than being silently bucketed as `unsupportedExt`. The PRD §0 D13 contract says "the file is not included in the bundle" — both orderings honor that, but only the new order surfaces the right warning copy
- Tokenized the high-entropy content scan rather than treating each whole line as a single token. The original implementation skipped any line containing whitespace, which meant `const KEY = "<blob>"` slipped through. New impl strips common code-chrome characters (quotes, brackets, commas, semicolons) to whitespace and entropy-checks each whitespace-separated token. Same threshold (`HARNESS_HIGH_ENTROPY_BITS_PER_CHAR = 4.5`); just looks at tokens not lines
- Glob impl learned `**/` → `(?:.*/)?` so `algorithms/**/*.ts` matches both `algorithms/foo.ts` AND `algorithms/sub/foo.ts`. Standard glob behavior; the original `**` → `.*` translation was off by a path segment. Tests cover both shapes
- Atomic cache replacement on reload (PRD §3.5 / §0 D11): `cached` is replaced via a single assignment AFTER the new bundle resolves successfully. On reload failure, the previous bundle is preserved and `onLoadError` fires — concurrent readers see either the old or the new bundle, never a half-built one
- `setRootPath` rolls the path back on failure: a path that resolves to `ROOT_NOT_FOUND` would otherwise become sticky and the user would have no obvious recovery. Previous root remains the source of truth; renderer banner points at it via `getRootPath()`
- Watcher restarts on `setRootPath` so future edits under the new root trigger reloads. Old watcher is awaited-closed before the new one is constructed (`harnessWatcher.spec.ts` exercises close() idempotency + pending-debounce cancellation)
- Skipped the Chunk-2-not-shipped fallback path (PRD §3.3 #7 + §5 DoD #22). Chunk 2 has already shipped in this codebase (`SettingsShell.tsx` exists), so the standalone "Debug → Open Harness Inspector…" window is dead code. Documented as a deliberate simplification — if Chunk 2 ever ships out from under us, the renderer-side mount in `SettingsShell` is the only call site, and a single `BrowserWindow` standalone is straightforward to add back
- Dev-only inspector gating defaults to `import.meta.env.DEV`. The hidden `harness.showInspector` flag (PRD §0 D17) is read on the main side via `harnessStore.getShowInspector()` — main's `getBundleText()` handler honors both signals; the renderer-side mount currently honors only the build-time signal because exposing the flag's value to the renderer would need its own IPC seam (no benefit until a non-dev demo asks for it)
- IPC error wrapping: `setRootPath` and `reload` reject Promises with an `Error` whose `.message` is the JSON-serialized `HarnessLoadErrorPayload`. The renderer's `parseErrorPayload` parses it back. ipcMain can't transport `Error` instances or arbitrary classes natively; this round-trip is the simplest stable contract and matches the existing PRD-locked `HarnessLoadErrorPayload` shape

### Files Modified / Created
- `package.json` (added `chokidar@^3.6.0` to dependencies — present transitively from sharp's deps so resolution is no-op)
- `.gitignore` (also unblocked `arch-public-harness/HARNESS_INDEX.json.example`)
- `arch-public-harness/README.md` (rewritten — root precedence, supported types, ignore rules, manifest template, secrets policy)
- `arch-public-harness/HARNESS_INDEX.json.example` (new — fully commented manifest template)
- `src/shared/types.ts` (extended — `HarnessFileMeta`, `HarnessMetadata`, `HarnessBundle`, `HarnessLoadErrorPayload`, `HarnessLoadErrorCode`, `HarnessManifest`)
- `src/shared/ipcChannels.ts` (extended — `IPC_HARNESS_*` channels, `IPC_HARNESS_RELOADED`, `IPC_HARNESS_LOAD_ERROR`, `IPC_HARNESS_BROWSE_ROOT`)
- `src/shared/harnessConstants.ts` (new — extension list, ignore globs, header strings, token-per-char ratio, ceiling, watcher tuning, suspicious-file heuristics, store keys)
- `src/main/harnessUtils.ts` (new — pure helpers: `passesDefaultIncludeRules`, `classifyFile`, `estimateTokens`, suspicious-name + entropy heuristics, manifest parser + glob, ordering)
- `src/main/harnessStore.ts` (new — `wrapHarnessStore`, `createHarnessStore` electron-store wrapper for the `harness.*` namespace)
- `src/main/harnessLoader.ts` (new — recursive walk, header/envelope composition, atomic cache replacement, in-flight dedup, `getHarness`/`reload`/`setRootPath`/`onReloaded`/`onLoadError`, `createNodeHarnessFs` adapter)
- `src/main/harnessWatcher.ts` (new — chokidar wiring with 500ms debounce, polling opt-in via env, fake-factory injection for tests)
- `src/main/index.ts` (extended — boot sequence instantiates harness store + loader + dev-only watcher, registers `harness.*` IPC, broadcasts `harness:reloaded`/`harness:loadError`, tears down on `before-quit`, `dialog.showOpenDialog` for browse)
- `src/preload/index.ts` (extended — `window.api.harness.*` namespace; surfaces from prior chunks unchanged)
- `src/renderer/env.d.ts` (extended — `harness` namespace typings to match preload)
- `src/renderer/settings/HarnessSettings.tsx` (new — root display, stats grid, reload button, browse button, warning + error banners; subscribes to `onReloaded`/`onLoadError`)
- `src/renderer/settings/HarnessInspector.tsx` (new — dev-only per-file metadata grid + lazy-loaded full-bundle text viewer)
- `src/renderer/settings/SettingsShell.tsx` (extended — mounts `HarnessSettings` always, `HarnessInspector` gated on dev)
- `tests/fixtures/harness-fixture-a/` (new — 12 algorithms + 8 docs, exactly 20 files for PRD §7 step 5's expected counts)
- `tests/fixtures/harness-fixture-empty/` (new — single `.keep` placeholder; loader sees an empty directory)
- `tests/fixtures/harness-fixture-mixed/` (new — exercises every D2/D3/D12/D13 exclusion path: .json/.png/node_modules/.env/.pdf/oversize/high-entropy-blob)
- `tests/fixtures/harness-fixture-manifested/` (new — three .ts + two .md + valid `HARNESS_INDEX.json` with include/exclude/priority)
- `tests/fixtures/harness-fixture-oversize/` (new — twelve ~550KB markdown files; total ~1.74M tokens — busts the D8 1.5M ceiling)
- `tests/harnessUtils.spec.ts` (new — 37 tests: extension/ignore/dotfile/suffix matching, classification, token estimate, suspicious-name + entropy, manifest parse + apply, glob impl, ordering, POSIX rel-path)
- `tests/harnessLoader.spec.ts` (new — 11 tests: cold load on fixture-a; D5/D6 envelope format; determinism; empty dir non-throw; mixed fixture excludes everything D2/D3/D12/D13 calls out; concurrent dedup; reload picks up edits; manifest applied; malformed manifest preserves cache; token ceiling thrown; setRootPath rollback on ROOT_NOT_FOUND)
- `tests/harnessWatcher.spec.ts` (new — 5 tests: debounced reload, rapid-fire coalescing, add/unlink trigger, close cancels pending debounce, close idempotent)
- `tests/harnessStore.spec.ts` (new — 4 tests: rootPath round-trip + clear, last-load fields default-null + round-trip, defensive type check, showInspector default-false + override)

### Open Questions / Risks
- **Sandbox cannot exercise the production fs walk against the real Arch Public bundle.** All loader tests run against fixtures (max ~6.4MB total in the oversize case). The operator's first run against the real Arch Public source will be the only signal that `fs.promises.readdir({ recursive: true })` performs acceptably on a deeper / wider tree. If the cold load is > 2s, PRD §0 D10 has a documented fallback (content-hashed JSON cache under `<userData>/cache/`) — Post-MVP work
- **D7 token ratio is the load-bearing heuristic that hasn't been calibrated against real Gemini counts.** PRD §6 mitigation row notes the ±15% tolerance band; recommend the operator capture a Gemini-tokenizer count against the real bundle on first load and either accept the band or tune `HARNESS_CHARS_PER_TOKEN` in `src/shared/harnessConstants.ts`
- **D13 secrets heuristic produced no false positives across the test fixtures**, but it's defense-in-depth. Primary control is `.gitignore` excluding `arch-public-harness/*` (verified). If the operator finds a legitimate Arch Public file gets caught by the entropy rule, override via `HARNESS_INDEX.json` `include` whitelist (D14) or relax `HARNESS_HIGH_ENTROPY_BITS_PER_CHAR` in the constants module
- **Skipped the Chunk-2-not-shipped fallback path** (PRD §3.3 #7 + §5 DoD #22). Documented in Decisions Made above. If Chunk 2 ever gets pulled, re-add a standalone `BrowserWindow` debug entry point. Low risk — Chunk 2 has shipped end-to-end in code
- **`chokidar` polling fallback (D18) is opt-in via `HARNESS_WATCHER_POLLING=1`.** Anyone running the harness off an SMB / NFS mount must set this explicitly or hot-reload silently no-ops. Logged via `harness.watcherPolling` warn line on opt-in so the operator can see why CPU is up
- **`HARNESS_INDEX.json` parser is permissive** — it accepts unknown top-level keys. The example manifest documents this as an intentional escape hatch (a `_comment_for_humans` key for inline notes), but if a future Chunk decides to tighten this, the `parseManifest` rejection list is the place to add it
- **Renderer-side inspector gate honors only build-time signal.** Main-side gate (`getBundleText()` rejection in production with `harness.showInspector === false`) is the load-bearing defense. If a future internal-demo flow needs runtime gating, expose `harness.showInspector` via a new IPC handler and update `useHarnessInspectorEnabled()` in `SettingsShell.tsx` to consume it

### Verification Results (inside sandbox)
- `npm run typecheck` — clean across all three configs (`tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`)
- `npm run lint` — 0 errors, 0 warnings (the pre-existing `MODULE_TYPELESS_PACKAGE_JSON` info-message from Chunk 1 is unchanged)
- `npm test` — **189/189 tests pass** (132 pre-existing from Chunks 1–3 + 57 new: 37 harnessUtils + 11 harnessLoader + 5 harnessWatcher + 4 harnessStore)
- `npx tsc -p tsconfig.main.json` — emits `dist/main/{harnessLoader,harnessStore,harnessUtils,harnessWatcher}.js` + `dist/shared/harnessConstants.js`
- `node scripts/build-preload.mjs` — emits `dist/preload/index.js` (6.5 kB, was 5.1 kB pre-Chunk-4)
- `npx vite build` — 55 modules transformed cleanly (was 53 pre-Chunk-4); the two new modules are `HarnessSettings.tsx` and `HarnessInspector.tsx`

### Recommended Next Steps for Next Claude Instance
1. On macOS 14+ with Node 20: `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`. Walk every item in `PRD_Chunk_4_Harness_Loader_Knowledge_Base.md §7` (steps 1–23). Ticking Chunk 4 in `project-state.md` requires all 23 to pass on a real Mac
2. **Capture a real Gemini-tokenizer count against the real Arch Public harness** on first dev run and compare to `metadata.approxTokens`. PRD §0 D7 is the load-bearing heuristic; the ±15% band is the contract. If observed drift is greater, tune `HARNESS_CHARS_PER_TOKEN` in `src/shared/harnessConstants.ts`
3. **Confirm the real bundle sits comfortably under D8's 1.5M ceiling.** If it sits within ~10% of the ceiling, raise the ceiling preemptively in the same constants file before Chunk 5 (the operator can override D8 in the PRD if Gemini headroom analysis supports it — that's documented as the override path)
4. Begin the Chunk 5 PRD (Gemini Chat + Vision). Restate Chunk 4's §3.2 IPC contract verbatim in Chunk 5's §0/§3.2 — `getHarnessLoader().getHarness()` is the only sanctioned read path. Chunk 5's `geminiService` subscribes to `onReloaded` to invalidate its system-prompt cache
5. If a future review pushes back on the renderer-side inspector gating, expose `harness.showInspector` via a new IPC channel (mirror the pattern of `capture.dev.showRecentCaptures`) and consume it from `useHarnessInspectorEnabled()` in `SettingsShell.tsx`

### Key Context Delta
- `arch-public-harness/` is now the live drop-zone for harness content; the loader is the single source of truth and `getHarness()` is the only sanctioned read path. Any future module that wants to read harness content goes through `getHarnessLoader().getHarness()` — direct fs walks under the harness root are explicitly forbidden
- IPC namespaces settled: `log.*` (Chunk 1), `widget.*` + `perms.*` (Chunk 2), `capture.*` + `region.*` (Chunk 3), `harness.*` (Chunk 4). Chunk 5 will claim `ai.*`. None should ever read or write outside its own
- electron-store schema: `widget.*`, `capture.*`, and `harness.*` coexist in the same `config` JSON file. The `harness.*` slice persists only the small projection (rootPath, last-load summary, showInspector flag) — the full bundle text never lands on disk per PRD §3.4
- New deps: `chokidar@^3.6.0`. No others — token estimation is character-based per D7 (no `tiktoken`); PDF handling is upstream per D12 (no `pdf-parse`); manifest globbing uses a hand-rolled implementation tested at the same depth as a real glob library would have been
- The `harnessLoader`'s injectable `HarnessFsLike` mirrors `screenshotService`'s injectable-deps pattern. Vitest exercises the loader against the real `createNodeHarnessFs()` adapter and against fixture directories — no Electron, no chokidar
- `WidgetStatus` and the capture / region surfaces are unchanged. Chunk 4 added entirely new surface area; nothing pre-existing was modified beyond extending the type / channels / preload / settings shell
- The `harness:reloaded` IPC event is the seam Chunk 5's chat surface subscribes to. Payload is metadata-only (PRD §0 D20) — Chunk 5 calls `getHarness()` to pull the actual text only when it needs to rebuild the prompt
- One open PRD-amendment carry-over: PRD §3.3 #7's Chunk-2-not-shipped fallback path is documented but not implemented. Low-risk simplification — Chunk 2 has shipped end-to-end

---

## Session Handoff Log
**Session ID:** 2026-04-26-ARCH-MVP-007-chunk-5-gemini-chat
**Timestamp:** 2026-04-26T20:50:00-05:00 (CDT)
**Model:** Claude Opus 4.7
**Focus Area:** Chunk 5 implementation per `PRD_Chunk_5_Gemini_Chat_Vision.md` (Gemini Chat + Vision — End-to-End AI Round-Trip). Operator approved §0 defaults D1–D30 verbatim. Built `geminiService` (single-construction prompt builder + JSON-mode send + retry), `chatWindow` (frameless 480×640 with edge-anchored slide-in), `conversationStore` (in-process, clear-on-close, Flash-summary truncation), `aiStore` (electron-store `ai.*` namespace + 7-day rolling stats), `tokenBudget` (oldest-first trim), full `chat.*` + `ai.*` IPC surface, renderer chat tree (`ChatPanel` + `MessageList` + `AssistantMessage` + `UserMessage` + `InputBar` + `QuickPrompts` + `ApplySuggestion` + `ChatError` + `TypingIndicator` + `chatStore`), and `AISettings` panel mounted in the existing settings shell.

### Decisions Made
- **All §0 defaults D1–D30 adopted verbatim.** Operator's "approve defaults" message is captured in this session's transcript; PRD lock is the source of truth.
- **`PERSONA_PROMPT` lives in exactly one file** (`src/shared/persona.ts`) per D3 + D5. Reviewer-grep contract documented in the file's header.
- **`geminiService.buildSystemPrompt()` is the only sanctioned composer** (D5). Composition order matches D4 byte-for-byte: `PERSONA_PROMPT → \n\n → bundle.text → \n\n → OUTPUT_SCHEMA_INSTRUCTIONS`. Cached in service memory; invalidated via `invalidateSystemPromptCache()` which is called from `harnessLoader.onReloaded` per D26.
- **JSON mode over function calling** (D6): `responseMimeType: 'application/json'` + `responseSchema: OUTPUT_SCHEMA`. The schema mirrors `Context.md §6` with `schema_version: '1'` added (D7); `current` and `proposed` are typed as `string` in the JSON schema to sidestep loose-typing quirks, parsed back to `string | number` in the renderer.
- **One auto-retry on JSON parse failure with the `JSON_RETRY_REMINDER` appended** (D8). Failure → fatal `'invalid-json'`. Implemented in `geminiService.send()`'s top-level loop; both raw snippets logged via `gemini.jsonParseFailed`.
- **One auto-retry on transient errors** (D21). 5xx + network errors + `RESOURCE_EXHAUSTED` are classified as transient; 4xx + auth + safety + JSON-fail are NOT. 1.5s backoff. Per-call timeout is 30s (D20); on timeout the same retry decision logic runs.
- **`AbortSignal` is honored end-to-end** (D24). Caller's signal is forwarded into a per-call internal `AbortController` so `cancelAll()` (called from `app.before-quit`) can abort the in-flight set without disturbing user-controlled signals.
- **3 screenshots per turn, oldest-first inside the message** (D9). Caller pulls `getRecent(3)` (newest-first) and reverses before passing to `tokenBudget.fit()` → `geminiService.send()`. `inlineData` base64 attachment per D10; missing files log `gemini.screenshotMissing` and skip without failing the call.
- **Conversation memory is in-process only** (D11). `conversationStore` clears on chat-window close (and on cancel/shutdown). Truncation kicks in above 20 turns: oldest 10 pairs go to a Flash-model summarizer; failed summary is non-fatal (PRD §3.7).
- **Chat window is frameless 480×640 with `level: 'screen-saver'`** (D13). `computeAnchor()` picks the nearest screen-edge relative to the widget bounds and clamps into the work area. Slide-in is a CSS `@keyframes chat-slide-in` on `#root` (220ms ease-out) so main doesn't have to animate frame-by-frame.
- **Single-instance chat window** (D13). Second widget click closes; `closeChatWindow('toggle')` aborts in-flight, clears conversation, broadcasts `chat:historyCleared`, transitions FSM to `'idle'`.
- **API key plain-text in `electron-store` `ai.apiKey`** (D18 + Context.md §8). The literal `// TODO: Replace with secure storage before any external demo` comment lives at both read + write sites in `aiStore.ts` AND in the `AISettings` panel footer. `getApiKey()` IPC returns `{ present, masked }` only — raw key never crosses the IPC boundary (PRD §5 DoD #24).
- **Five-variant `ChatError` taxonomy locked** (D25). One `<ChatErrorView>` component variant per error; map is exhaustive in TypeScript (`switch` over discriminated union, no default).
- **Logging events match D28 exactly.** Event names + field shapes are stable for Chunk 6 to pick up: `gemini.callStarted` (model, promptHash, promptTokenEstimate, screenshotCount, screenshotIds, historyTurnCount), `gemini.callCompleted` (model, promptHash, promptTokenEstimate, latencyMs, jsonOk, jsonRetryAttempted, suggestionCount, confidenceScore), `gemini.callFailed`, `gemini.jsonParseFailed`, `gemini.timeout`, `gemini.tokenBudgetTrim`, `gemini.summaryFailed`, `gemini.screenshotMissing`, `chat.opened`, `chat.closed`, `chat.messageSent`, `chat.suggestionCopied`, `chat.errorShown`, `ai.modelChanged`, `ai.apiKeyUpdated` (with `apiKey` field redacted by the existing `logger.ts` `REDACT_PATHS`).
- **Token budget math** (D22): `PERSONA + harnessApproxTokens + history + (PER_IMAGE × N) + userText + OUTPUT_HEADROOM`. Trim oldest pair-aware history first, then oldest screenshots, then fail. Soft 900k / hard 1.5M ceilings (matches Chunk 4 D8). Pure-function module + 7 boundary tests.
- **`maybeTruncate` is called once per send.** The orchestrator in `main/index.ts` calls it before reading history so the truncated state is what feeds `tokenBudget.fit()`.
- **Renderer chat surface uses `react-markdown` + `remark-gfm` + `rehype-highlight`** (D23). HTML in markdown is dropped (no `rehype-raw`); XSS smoke test asserts `<script>` never makes it to the DOM.
- **Three quick-prompt chips verbatim from D16.** Click prefills `chatStore.draft`; never auto-sends.
- **`<ApplySuggestion>` is copy-only** (D17). Format is `<parameter>: <current> → <proposed> # <rationale>`, locked in `formatSuggestionForClipboard` in `main/index.ts`. No TradingView mutation.
- **`AISettings` panel is the third tab in the existing settings shell** (Capture → Harness → AI per PRD §3.1). Shell remained layout-agnostic per the Chunk 3 §8 / Chunk 4 §3.1 contract.
- **`sdkFactory` injection** keeps the `@google/generative-ai` SDK behind a narrow `GeminiSdkLike` interface so vitest exercises the full send loop without network. Production wires the real `GoogleGenerativeAI` class.

### Files Modified / Created
- `package.json` (added `@google/generative-ai@^0.20.0`, `react-markdown@^9`, `remark-gfm@^4`, `rehype-highlight@^7`, dev: `jsdom`)
- `src/shared/types.ts` (extended — `ChatRole`, `ChatTurn`, `SuggestedParameterChange`, `AnalysisResponse`, `ChatState`, `ChatError`, `GeminiCallStats`, `ApiKeyPresence`, `RecordedCall`)
- `src/shared/persona.ts` (new — `PERSONA_PROMPT` verbatim from `Context.md §6` + `PERSONA_TOKEN_ESTIMATE`)
- `src/shared/aiSchema.ts` (new — `OUTPUT_SCHEMA` + `OUTPUT_SCHEMA_INSTRUCTIONS` + `JSON_RETRY_REMINDER`)
- `src/shared/aiConstants.ts` (new — `MODEL_ALLOWLIST`, `DEFAULT_MODEL`, `SUMMARY_MODEL`, `SCREENSHOTS_PER_TURN`, `PER_IMAGE_TOKEN_ESTIMATE`, `HISTORY_KEEP_PAIRS`, `HISTORY_TRUNCATE_AT_PAIRS`, `SOFT_CEILING_TOKENS`, `HARD_CEILING_TOKENS`, `OUTPUT_HEADROOM_TOKENS`, `CHARS_PER_TOKEN`, `GEMINI_TIMEOUT_MS`, `GEMINI_RETRY_BACKOFF_MS`, `GEMINI_MAX_AUTO_RETRIES`, `STATS_WINDOW_DAYS`, `CHAT_WINDOW_WIDTH/HEIGHT`, `CHAT_OPEN/CLOSE_ANIM_MS`, `AI_STORE_KEY_*`)
- `src/shared/ipcChannels.ts` (extended — `IPC_CHAT_*` + `IPC_AI_*` constants)
- `src/main/aiStore.ts` (new — `wrapAiStore`, `maskApiKey`, `percentile`, `pruneStatsCalls`, factory)
- `src/main/conversationStore.ts` (new — session lifecycle, append/drop, Flash-summary truncation)
- `src/main/tokenBudget.ts` (new — pure `fit()` with `TrimRecord[]` output)
- `src/main/geminiService.ts` (new — SDK wrapper, single composer, send loop with abort/timeout/retry/JSON-retry, summarize, cancelAll, hashPrompt)
- `src/main/chatWindow.ts` (new — frameless 480×640 BrowserWindow, single-instance, edge-anchored `computeAnchor`)
- `src/main/overlayWindow.ts` (extended — `BuildRendererUrlOptions.view` widened to include `'chat'`)
- `src/main/index.ts` (extended — instantiates `aiStore` + `conversationStore` + `geminiService`; subscribes `geminiService` to `harnessLoader.onReloaded` for D26 invalidation; `runChatSend()` orchestrator; `registerChatAndAiIpc()` handler set; `widget:click` now toggles chat via `toggleChatFromWidgetClick()`; `before-quit` aborts in-flight + closes chat)
- `src/preload/index.ts` (extended — `window.api.chat.*` + `window.api.ai.*`; raw API key never returned)
- `src/renderer/env.d.ts` (extended — `chat` + `ai` namespace typings)
- `src/renderer/main.tsx` (extended — added `'chat'` view + `ChatPanel` mount + `highlight.js` theme import)
- `src/renderer/index.css` (extended — `html.view-chat` body sizing + `@keyframes chat-slide-in`)
- `src/renderer/chat/chatStore.ts` (new)
- `src/renderer/chat/ChatPanel.tsx` (new)
- `src/renderer/chat/MessageList.tsx` (new)
- `src/renderer/chat/AssistantMessage.tsx` (new)
- `src/renderer/chat/UserMessage.tsx` (new)
- `src/renderer/chat/InputBar.tsx` (new)
- `src/renderer/chat/QuickPrompts.tsx` (new)
- `src/renderer/chat/ApplySuggestion.tsx` (new)
- `src/renderer/chat/ChatError.tsx` (new)
- `src/renderer/chat/TypingIndicator.tsx` (new)
- `src/renderer/settings/AISettings.tsx` (new — model picker, masked-key + Show + Save + Clear, 7-day stats)
- `src/renderer/settings/SettingsShell.tsx` (extended — mounts `<AISettings />` after Harness)
- `vitest.config.ts` (extended — `esbuild.jsx: 'automatic'` so `.spec.tsx` compiles without `import React`)
- `tests/aiStore.spec.ts` (new — 16 tests: mask helper, percentile, prune, store wrapper, model allowlist enforcement, stats roll-up)
- `tests/tokenBudget.spec.ts` (new — 7 tests: char→token math, history sum, under/over both ceilings, history-then-screenshot trim order)
- `tests/conversationStore.spec.ts` (new — 7 tests: session lifecycle, append, drop, no-truncate-below-threshold, truncate-above-threshold, summary-failure-is-non-fatal)
- `tests/geminiService.spec.ts` (new — 9 tests: composition order, cache, invalidate, no-api-key, happy-path parse, ```json fence strip, JSON parse retry, fatal invalid-json after both retries, abort)
- `tests/chatStore.spec.ts` (new — 5 tests: append, clear, error transitions)
- `tests/chatPanel.smoke.spec.tsx` (new — 7 tests: each `<ChatError>` variant + `<AssistantMessage>` happy path + XSS smoke; jsdom env via per-file `// @vitest-environment jsdom`)
- `package-lock.json` (regenerated for the new deps)

### Open Questions / Risks
- **Sandbox cannot exercise the live `@google/generative-ai` network call.** All tests inject `sdkFactory`; the actual JSON-mode reliability rate (PRD §5 DoD #5 — ≥95% across 20 sends) is the operator's first-run signal. If the rate sits below 95% across the 20-call sweep, the rolling `GeminiCallStats.jsonParseFailRate` in `AISettings` is the canary; tune `OUTPUT_SCHEMA_INSTRUCTIONS` or escalate to function-calling per D6 override.
- **No real-bundle token measurement yet.** The `PER_IMAGE_TOKEN_ESTIMATE` (~2k) is conservative but unverified against Gemini's actual vision token accounting. Operator should compare `gemini.callStarted.promptTokenEstimate` to the SDK's `usageMetadata` after the first real call and tune `aiConstants.PER_IMAGE_TOKEN_ESTIMATE` and `CHARS_PER_TOKEN` if the drift exceeds ±15%.
- **Chat window position is recomputed on every open** — by design (D14: window position not persisted; always anchors to widget). If the operator drags the widget while chat is open and reopens later, the new chat will anchor to the dragged position. Documented in PRD §3.5.
- **`window.api.chat.copySuggestion` IPC contract is `'fire-and-forget'`** even though it returns `Promise<void>`. The clipboard write happens inside the main-process handler; the promise resolves once `clipboard.writeText` returns. No structured failure surfaced to the renderer — `chat.suggestionCopyFailed` log line is the only signal. If copy reliability becomes a concern, expand the contract to `Promise<{ ok: boolean }>`.
- **The `AISettings` "Open AI Settings" / "Open Harness Settings" CTAs in `<ChatError>` only log a placeholder event today** — there's no IPC channel that opens the Settings window from a renderer. Chunk 7's onboarding flow will need a `chat → settings` IPC seam; for MVP the user can right-click the widget → Open Settings.
- **`@google/generative-ai` is pinned to `^0.20.0`.** The SDK's structured-output API has been stable since v0.7 but the Gemini API itself is on a faster cadence; if a model rename or schema change lands between MVP build and demo, the operator should re-run the §7 sweep before flipping the default.
- **`react-markdown` v9 requires React 18.** Currently fine; if a future Chunk upgrades React, re-verify markdown rendering.
- **Test coverage on the chat orchestrator (`runChatSend` in `main/index.ts`) is end-to-end via the geminiService spec only.** A future test pass could mock `harnessLoader.getMetadata`, `screenshotService.getRecent`, and `conversationStore` to drive the full FSM — deferred since the existing tests cover each unit's contract and the orchestrator is mostly composition.
- **The `IPC_CHAT_OPEN` handler from the renderer is functional but currently unreachable from the renderer's UI** (the chat opens via `widget:click` only, per D15). Kept the handler in place because it's part of the locked PRD §3.2 surface and Chunk 7's smoke test relies on it.
- **Harness reload mid-turn**: the in-flight call uses the prompt it was built with; the cache invalidation applies to the next turn (PRD D26 + §3.10). Confirmed in `geminiService.spec.ts`'s "rebuilds after invalidateSystemPromptCache" case.

### Verification Results (inside sandbox)
- `npm run typecheck` — clean across all three configs (`tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`)
- `npm run lint` — 0 errors, 0 warnings
- `npm test` — **240/240 tests pass** (189 pre-existing + 51 new: 16 aiStore + 7 tokenBudget + 7 conversationStore + 9 geminiService + 5 chatStore + 7 chatPanel.smoke)
- `npx tsc -p tsconfig.main.json` — emits `dist/main/{aiStore,chatWindow,conversationStore,geminiService,tokenBudget}.js` + `dist/shared/{aiConstants,aiSchema,persona}.js`
- `node scripts/build-preload.mjs` — bundles cleanly; `chat` + `ai` namespaces exposed; raw key never leaves main
- `npm run build` — renderer bundle includes the chat tree + the `atom-one-dark` highlight.js theme

### Recommended Next Steps for Next Claude Instance
1. On macOS 14+ with Node 20: `nvm use && npm install && npm run typecheck && npm run lint && npm test && npm run build && npm run dev`. Walk every item in `PRD_Chunk_5_Gemini_Chat_Vision.md §7` (steps 1–31). Ticking Chunk 5 in `project-state.md` requires all 31 to pass on a real Mac with a real Gemini API key.
2. **Capture the first real `gemini.callStarted.promptTokenEstimate` and compare to the SDK's `usageMetadata` actual token count** on first dev run. If drift exceeds ±15%, tune `PER_IMAGE_TOKEN_ESTIMATE` + `CHARS_PER_TOKEN` in `src/shared/aiConstants.ts`.
3. **Run the §7 #10 JSON-mode reliability sweep** (20 sends across a varied prompt set). If `GeminiCallStats.jsonParseFailRate` settles below 0.05 the chunk is healthy; if it sits above, tune `OUTPUT_SCHEMA_INSTRUCTIONS` first, escalate to function calling per D6 override only as a last resort.
4. Wire the `<ChatError>` "Open AI Settings" CTA to actually open the Settings window once Chunk 7's smoke test PRD lands — likely a new `IPC_CHAT_OPEN_SETTINGS` channel. For now the right-click-menu path is the documented fallback.
5. Begin the Chunk 6 PRD (Rich Logging, Handoff & Observability). Restate the D28 event names verbatim in Chunk 6's §0/§3, and confirm the redaction contract for `ai.apiKey*` fields covers both the current `apiKey` path and any new fields Chunk 6 adds.
6. If the operator decides to flip the default model post-1.5-Pro (D1 override), update `DEFAULT_MODEL` in `src/shared/aiConstants.ts` and re-run §7 #5 against the new default before flipping.

### Key Context Delta
- IPC namespaces are now: `log.*` (Chunk 1), `widget.*` + `perms.*` (Chunk 2), `capture.*` + `region.*` (Chunk 3), `harness.*` (Chunk 4), `chat.*` + `ai.*` (Chunk 5). All seven namespaces are PRD-locked; no additions without an amendment.
- electron-store schema: `widget.*`, `capture.*`, `harness.*`, and `ai.*` coexist in the same `config` JSON file. `ai.apiKey` is plain-text per D18 — the literal TODO comment lives at both read + write sites.
- New deps: `@google/generative-ai@^0.20.0`, `react-markdown@^9`, `remark-gfm@^4`, `rehype-highlight@^7` (runtime); `jsdom` (dev — needed for the Chunk 5 smoke test's React render path).
- `geminiService.buildSystemPrompt()` is the single source of truth for the prompt sent to Gemini. Reviewer-grep contract: `new GoogleGenerativeAI` only appears in `geminiService.ts`; `PERSONA_PROMPT` only in `persona.ts` + `geminiService.ts` + tests.
- `conversationStore` is in-process, session-scoped, clears on chat close. `ai.apiKey` and `ai.model` persist; conversation history never does (PRD §3.4).
- The `widget:click` IPC event from Chunk 2 D11 now has a real subscriber: `toggleChatFromWidgetClick()` in `src/main/index.ts`. Closing chat via second click runs the same teardown path as the window-close button (clears history, aborts in-flight, broadcasts `chat:historyCleared`).
- Renderer chat tree is a fresh sibling of `widget/` and `settings/`. Mounted via the same `?view=` mechanism Chunks 1–3 already use.
- Vitest now uses `esbuild.jsx: 'automatic'` so `.spec.tsx` files don't need `import React`. Tested against the existing pure `.spec.ts` files; no regressions.
- One new dev dep (`jsdom`) was needed for the React render smoke test. The default test environment is still `node`; only `chatPanel.smoke.spec.tsx` opts into jsdom via the `// @vitest-environment jsdom` comment.

---

## Session Handoff Log
**Session ID:** 2026-07-09-ARCH-PIVOT-P0P1
**Timestamp:** 2026-07-09T13:55:00-05:00 (CDT)
**Model:** Composer
**Focus Area:** Internal co-pilot pivot — Phase 0 preflight + Phase 1 security-harness teardown (D-P1)

### Decisions Made
- Created branch `pivot/internal-copilot` from `dev` (uncommitted local changes carried forward).
- Removed the entire IP-protection stack per D-P1: deterministic firewall, enumeration monitor, D-3 validator, abstraction generation pipeline, red-team suite/CI step, and servable/deep knowledge artifacts. Kept `knowledgeCrypto.ts` + `secretsStore.ts` (API-key keychain hygiene).
- Simplified `bundleBuilder.ts` to a minimal servable bundle builder (no D-3 gate, no deep fingerprints) so existing knowledge-store tests keep working until Phase 2 replaces it with the docs-corpus pipeline.
- Replaced firewall log sanitization with length-based truncation (`truncateLogSnippet`) — operational hygiene only, not a disclosure gate.
- Model output now renders directly: `geminiService.send()` retains JSON-parse retry only; no post-model gate.

### Files Modified / Created
- Deleted: `src/shared/firewall/**`, `src/main/enumerationMonitor.ts`, abstraction/D-3 pipeline files, `scripts/{red-team-smoke,generate-abstractions,build-knowledge-bundle}.mjs`, `tests/{firewall,redteam}/**`, enumeration + abstraction test specs, `knowledge/{deep,servable,deep-fingerprints.json,bundles/servable-*}`, `RED_TEAM.md`
- Edited: `chatOrchestrator.ts`, `bootstrap.ts`, `appContext.ts`, `chatLifecycle.ts`, `geminiService.ts`, `logger.ts`, `aiStore.ts`, `types.ts`, `ChatError.tsx`, `bundleBuilder.ts`, `knowledgeTypes.ts`, `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, and related test specs

### Open Questions / Risks
- **`npm run dev` will fail knowledge init** until Phase 2 lands a docs bundle — `knowledge/bundles/` is empty after servable artifact deletion. Expected; chat sends surface `no-harness`.
- **`SCHEMA_V2_FORBIDDEN_FIELDS` remains** in `aiSchema.ts` until Phase 3 schema v3 work removes it (not part of Phase 1 grep contract).
- Node 22 ran tests successfully despite `engines` requiring Node 20 — CI uses `.nvmrc`; local dev should prefer `nvm use`.

### Verification Results
- Phase 0 baseline (pre-teardown): **315 tests pass** on `dev` (`typecheck`, `lint`, `test` all green).
- Phase 1 post-teardown: **236 tests pass** (`typecheck`, `lint`, `test` all green).
- Grep contract: `git grep -iE "firewall|enumerationmonitor|d3pass|deep-fingerprints" -- src/ scripts/ tests/` → **empty**.

### Recommended Next Steps for Next Claude Instance
1. **Phase 2** — implement `scripts/ingest-docs.mjs` + `npm run ingest:docs`; rework knowledge layer to `DocChunk` / docs bundles per execution plan §Phase 2.
2. Commit Phase 0+1 as separate commits on `pivot/internal-copilot` if the operator wants the one-commit-per-phase convention.
3. Phase 3: persona v3, schema v3, prompt composition (remove `SCHEMA_V2_FORBIDDEN_FIELDS`).

### Key Context Delta
- Product direction pivots from client-facing zero-leakage demo to internal sales/CS co-pilot with full-fidelity docs (`PRD_Internal_Copilot_Pivot.md`).
- Security harness PRD is superseded; `Context.md` still at v0.2.0 until Phase 5 doc reset.
- Chat error taxonomy is now four variants (removed `enumeration-throttled`).
- CI no longer runs `npm run red-team`; coverage thresholds target `chatOrchestrator` only.
