# Operator Mac Acceptance (Internal Co-Pilot)

Use this runbook on **macOS 14+** with **screen recording** and a **Gemini API key**.
Automated steps: `node scripts/mac-acceptance.mjs` (add `--logs` after a dev session).

**Node:** `nvm use` (Node 20). Current machine reported Node 22 — works for CI here but PRD targets 20.

**Audience:** internal sales/CS employees testing the co-pilot before client calls.

---

## Phase A — Automated (no GUI)

| Step | Command | Pass when |
|------|---------|-----------|
| A1 | `nvm use && npm install` | No errors; sharp loads |
| A2 | `node scripts/mac-acceptance.mjs` | All checks green |
| A3 | Spot-check `dist/` exists after build | `dist/main`, `dist/renderer`, `dist/preload` |
| A4 | `npm run ingest:docs` (optional refresh) | 13 pages, bundle emitted, no fetch errors |

**Sharp fix if dev fails:** `npm install --os=darwin --cpu=arm64 sharp`

### Screen recording: no popup?

macOS only shows the **native permission dialog** when status is `not-determined`. If you (or a prior run) already chose **Don’t Allow**, status is **`denied`** — there is **no second popup**. The app skips auto-prompt and shows an **amber** pill instead.

1. Check today’s log: `~/Library/Application Support/arch-public-ai-overlay/logs/app-YYYY-MM-DD.jsonl` for `"event":"perms.screen.initial"` — `state` is usually `denied` or `granted`.
2. **Right-click the pill** → **Open System Settings…** (only when the pill is amber).
3. **System Settings → Privacy & Security → Screen Recording** — enable the app:
   - In **`npm run dev`**, look for **Electron** or **Arch Public AI Overlay** (not Terminal or Cursor unless you know you need those too).
   - If the app is missing, click **+** and add:  
     `arch-public-ai-overlay/node_modules/electron/dist/Electron.app`
4. Return to the overlay (click the pill window). The pill should flip **green** without restart (main re-syncs on focus). If it stays amber, quit and `npm run dev` again.

To **re-test the first-run dialog** on a dev machine: remove the app from Screen Recording, reset with `tccutil reset ScreenCapture com.github.Electron`, delete `widget.permissionsPromptSeen` from `~/Library/Application Support/arch-public-ai-overlay/config.json`, then relaunch.

**Check what macOS reports** (do not paste multiline `electron -e` scripts — the shell breaks them). From the repo root:

```bash
npm run check:screen-perm
```

Do **not** use `electron -e '…'` with a multiline script — zsh treats it as a file path and errors. The npm script handles this.

If you run Electron from a Cursor/IDE terminal and see `app` / `whenReady` errors, unset `ELECTRON_RUN_AS_NODE` first (`env -u ELECTRON_RUN_AS_NODE npm run check:screen-perm`). The npm script clears it automatically.

You want `"screenRecordingStatus": "granted"`. The output also prints `electronAppBundle` — that exact `.app` must be enabled with the toggle **on** in Screen Recording.

---

## Phase B — Chunk 1 (shell)

1. `npm run dev` — chat window appears (480×640, always-on-top).
2. Open `logs/app-YYYY-MM-DD.jsonl` — see `app.ready`, `renderer.ready`.
3. Quit app (context menu → Quit) — last line `app.quit`.
4. Confirm `CLAUDE_HANDOFF.md` and `project-state.md` exist at repo root.

---

## Phase C — Capture permissions

| # | Action | Pass when |
|---|--------|-----------|
| C1 | First run / reset perms | Modal once → Continue → macOS prompt → grant → **ready** (green) |
| C2 | Deny path (optional) | "Open System Settings" → grant → **ready** without restart |
| C3 | Right-click chat header | Capture now · Toggle auto-capture · Set capture region… · Open Settings · Quit |
| C4 | Open Settings twice | Single 640×480 window, second call focuses |
| C5 | Spaces / fullscreen | Chat window returns after Mission Control |
| C6 | Logs | `perms.screen.*`, `widget.menuAction` (legacy event names may persist) |

---

## Phase D — Chunk 3 (capture)

| # | Action | Pass when |
|---|--------|-----------|
| D1 | No region set, right-click | Capture now / Toggle auto-capture **disabled**; Set capture region **enabled** |
| D2 | Set capture region… | One picker per display; drag → mouse-up confirms; ESC cancels |
| D3 | Enable auto-capture (15s) | ~15s cadence; cyan **capturing** flash ~600ms |
| D4 | Settings slider → 10s | Next tick ~10s; one `capture.intervalChanged` in log |
| D5 | Capture now twice <500ms | Second debounced, no extra file |
| D6 | Dev: Recent captures panel | ≤5 thumbnails, newest first |
| D7 | Old file touch + wait 60s | Pruner removes stale JPEG |
| D8 | Revoke screen recording mid-loop | **permDenied** state; `capture.permissionLost` |
| D9 | JPEG in Preview | ≤1024px long edge, reasonable size at q85 |

*Optional / destructive:* display disconnect, electron-store migration, production build without Recent panel.

**Capture target:** region picker helper text should reference pointing at the **client's shared screen** in the meeting window, not the operator's own chart.

---

## Phase E — Knowledge bundle

| # | Action | Pass when |
|---|--------|-----------|
| E1 | `npm run dev` (fresh) | Knowledge bundle loads; no `no-harness` error on send |
| E2 | Settings → Knowledge | Bundle hash, ingest date, page count (~13), token total (~28.7k), `npm run ingest:docs` instructions |
| E3 | Algorithm picker (header) | Market Wave / Arbitrage / Intelligence / Apex / All; selection persists across relaunch |
| E4 | Change algorithm → send | Log shows updated `activeAlgorithm`; prompt cache invalidates |

Committed bundle: `knowledge/bundles/docs-*.json`. Corpus snapshots: `knowledge/docs-corpus/*.md`.

---

## Phase F — Chunk 5 (Gemini) — needs API key

### Setup

1. `npm run dev`
2. Right-click chat header → **Open Settings** → **AI** tab
3. Paste Gemini API key → **Save** (log: `ai.apiKeyUpdated`, key redacted)

### Core flow

| # | Action | Pass when |
|---|--------|-----------|
| F1 | No key: send attempt | **no-api-key** error; Send disabled |
| F2 | After Save: chat ready | Chat opens <300ms |
| F3 | Send: "Client wants fewer trades during chop" | Within ~12s: analysis markdown, suggestions with `parameter` / `current_value → suggested_value` / `rationale` / `doc_ref`, **talk track** block ("Say it to the client"), confidence, risk; log `gemini.callStarted` + `gemini.callCompleted` |
| F4 | Log fields | `promptHash`, `screenshotCount`, `screenshotIds` if captures exist |
| F5 | Multi-turn | First question then follow-up — second references first |
| F6 | Close chat (X) | Re-open → empty history |
| F7 | Quick prompt chips (6 call scenarios) | Prefill only, no auto-send |
| F8 | Copy on suggestion row | Clipboard has parameter + values + rationale; `chat.suggestionCopied` |
| F9 | Copy on talk track | Clipboard has talk-track text; `chat.talkTrackCopied` (or equivalent) |
| F10 | ESC during in-flight | Idle <100ms, no half message |
| F11 | Missing bundle (simulate) | **no-harness** error |
| F12 | Change model in AI settings | `ai.modelChanged`; next turn uses new model in log |
| F13 | Markdown | Tables, fenced code highlighted; no raw HTML injection on talk track / doc_ref |

### Reliability sweep (F14)

Send **20 varied prompts** (mix quick prompts + eval-bank scenarios from
`EXECUTION_PLAN_Internal_Copilot_Pivot.md` §Phase 6). Target: **≥19/20** parse
on first try (`jsonParseFailRate` < 0.05 in AI settings stats).

### Latency (F15)

Over the 20-question sweep, check AI Settings stats: **p50 ≤ 6s**, **p95 ≤ 12s**
end-to-end per send (PRD D-P8).

### Long session (F16)

~30 min: auto-capture on, ~10 chat turns — no crashes, quit cleanly.

### Already automated

Run: `node scripts/mac-acceptance.mjs` — preload namespaces, grep audits, renderer key masking.

After manual pass: `node scripts/mac-acceptance.mjs --logs`

---

## Phase G — Docs ingest verification

| Step | Command | Pass when |
|------|---------|-----------|
| G1 | `npm run ingest:docs` | All 13 `llms.txt` pages fetched; bundle hash printed; exit 0 |
| G2 | Spot-check corpus | Market Wave guide contains "$5 minimum" trade-size rule, seed-trade 3-days rule, edge-flip caution, full Input Reference table |
| G3 | Restart `npm run dev` | New bundle loads if hash changed |

Any page fetch failure must exit non-zero naming the URL — no partial silent bundles.

---

## Phase H — Call-simulation acceptance (internal demo gate)

Simulate a live client call before wide internal rollout.

### Setup

1. Join or start a Zoom/Meet call (solo test: share a TradingView tab or a static chart screenshot window).
2. `npm run dev` — grant screen recording.
3. Set capture region over the **shared screen area** showing TradingView Inputs tab.
4. Enable auto-capture; paste Gemini API key.

### Flow

| # | Action | Pass when |
|---|--------|-----------|
| H1 | Share TradingView with Inputs visible | Capture ring buffer fills; thumbnails show client settings |
| H2 | Algorithm picker → Market Wave | Persists after quit + relaunch |
| H3 | Quick prompt: "Read the client's current settings off the latest screenshot" | Response lists visible input values in `current_value` fields |
| H4 | Quick prompt: "Explain Scope in client-friendly terms" | Talk track is plain English, ≤3 sentences, no internal jargon |
| H5 | Free text: "Client wants to deploy cash faster" | Names correct inputs (Entry %, Long Threshold, etc.) with `doc_ref` |
| H6 | Talk track compliance | No performance promises; risks surfaced in `risk_notes` |
| H7 | Latency under conversation pace | p50 ≤ 6s over 5+ sends during simulated call |

### Eval bank (full gate — Phase 6)

Run all **20 scenarios** in `EXECUTION_PLAN_Internal_Copilot_Pivot.md` §Phase 6.
Each must: name correct inputs/directions, ground in docs (`doc_ref`), include a
talk track, and make no performance promises. Log results in `CLAUDE_HANDOFF.md`.

---

## Sign-off

When a chunk or pivot phase passes, tick its box in `project-state.md` and append
a short note to `CLAUDE_HANDOFF.md` (per `Role.md` template).

**Superseded sections (removed 2026-07-09):** Phase 0 red-team (`npm run red-team`,
`RED_TEAM.md` manual checklist), harness fixture browsing (Settings → Harness → Browse),
overlay pill drag/position tests. Archived in git history; see
`security-harness-PRD.md` superseded banner.
