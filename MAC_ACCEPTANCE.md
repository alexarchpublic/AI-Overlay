# Operator Mac Acceptance (Chunks 1–5)

Use this runbook on **macOS 14+** with **screen recording** and a **Gemini API key**.
Automated steps: `node scripts/mac-acceptance.mjs` (add `--logs` after a dev session).

**Node:** `nvm use` (Node 20). Current machine reported Node 22 — works for CI here but PRD targets 20.

---

## Phase A — Automated (no GUI)

| Step | Command | Pass when |
|------|---------|-----------|
| A1 | `nvm use && npm install` | No errors; sharp loads |
| A2 | `node scripts/mac-acceptance.mjs` | All checks green |
| A3 | Spot-check `dist/` exists after build | `dist/main`, `dist/renderer`, `dist/preload` |

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

1. `npm run dev` — overlay pill appears (top-right).
2. Open `logs/app-YYYY-MM-DD.jsonl` — see `app.ready`, `renderer.ready`.
3. Quit app (context menu → Quit) — last line `app.quit`.
4. Confirm `CLAUDE_HANDOFF.md` and `project-state.md` exist at repo root.

---

## Phase C — Chunk 2 (widget)

| # | Action | Pass when |
|---|--------|-----------|
| C1 | Observe pill | 48×48 transparent pill, default top-right |
| C2 | Drag pill, restart app | Position restored |
| C3 | First run / reset perms | Modal once → Continue → macOS prompt → grant → **ready** (green) |
| C4 | Deny path (optional) | "Open System Settings" → grant → **ready** without restart |
| C5 | Right-click pill | Capture now · Toggle auto-capture · Open Settings · Quit |
| C6 | Open Settings twice | Single 640×480 window, second call focuses |
| C7 | Spaces / fullscreen | Widget returns after Mission Control |
| C8 | Logs | `widget.shown`, `widget.click`, `perms.screen.*`, `widget.menuAction`, `widget.positionPersisted` |

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
| D8 | Revoke screen recording mid-loop | Widget **permDenied**; `capture.permissionLost` |
| D9 | JPEG in Preview | ≤1024px long edge, reasonable size at q85 |

*Optional / destructive:* display disconnect (D10), electron-store migration (D11), production build without Recent panel (D12).

---

## Phase E — Chunk 4 (harness)

Point harness at fixtures via **Settings → Harness → Browse** (or `HARNESS_ROOT` if supported):

| Fixture | Expect |
|---------|--------|
| `tests/fixtures/harness-fixture-a` | 20 files, 12 algorithms, 8 docs; `harness.loaded` |
| `harness-fixture-empty` | Yellow empty banner; `harness.empty` |
| `harness-fixture-mixed` | 1 file loaded; security warnings |
| `harness-fixture-manifested` | Manifest order; `manifestUsed` |
| `harness-fixture-oversize` | `TOKEN_CEILING_EXCEEDED` banner |

Dev: edit a file under root → ~700ms → single `harness.reloaded`.

---

## Phase F — Chunk 5 (Gemini) — needs API key

### Setup

1. `npm run dev`
2. Right-click pill → **Open Settings** → **AI** tab
3. Paste Gemini API key → **Save** (log: `ai.apiKeyUpdated`, key redacted)

### Core flow

| # | Action | Pass when |
|---|--------|-----------|
| F1 | No key: click pill | Chat opens; **no-api-key** error; Send disabled |
| F2 | After Save: click pill | Chat opens <300ms |
| F3 | Send: "What's the current signal and why?" | Within ~10s: analysis markdown, suggestions table + Copy, confidence, risk; log `gemini.callStarted` + `gemini.callCompleted` |
| F4 | Log fields | `promptHash`, `screenshotCount`, `screenshotIds` if captures exist |
| F5 | Multi-turn | "Current signal?" then "Be more conservative." — second references first |
| F6 | Close chat (X or second pill click) | Re-open → empty history |
| F7 | Quick prompt chips | Prefill only, no auto-send |
| F8 | Copy on suggestion row | Clipboard `param: current → proposed # rationale`; `chat.suggestionCopied` |
| F9 | ESC during in-flight | Idle <100ms, no half message |
| F10 | Harness oversize fixture | **token-ceiling** error |
| F11 | Harness empty fixture | **no-harness** error |
| F12 | Change model in AI settings | `ai.modelChanged`; next turn uses new model in log |
| F13 | Toggle chat via pill | Second click closes; third opens fresh |
| F14 | Markdown | Tables, fenced code highlighted; no raw HTML injection |

### Reliability sweep (F15)

Send **20 varied prompts** (mix quick prompts + free text). Target: **≥19/20** parse on first try (`jsonParseFailRate` < 0.05 in AI settings stats).

### Long session (F16)

~30 min: auto-capture on, ~10 chat turns, 2 harness reloads — no crashes, quit cleanly.

### Already automated (Chunk 5 §20–22)

Run: `node scripts/mac-acceptance.mjs` — preload namespaces, grep audits, renderer key masking.

After manual pass: `node scripts/mac-acceptance.mjs --logs`

---

## Phase G — Secure harness red-team (Phase 0 task 8)

| Step | Command | Pass when |
|------|---------|-----------|
| G1 | `npm run red-team` | Scripted LLM02/LLM07 gate + structural checks green |
| G2 | `node scripts/red-team-smoke.mjs --manual` | Operator completes live prompts in `RED_TEAM.md` sign-off table |

Before any external demo, all **G2** manual cases must PASS (PRD §11.1).

---

## Sign-off

When a chunk passes, tick its box in `project-state.md` and append a short note to `CLAUDE_HANDOFF.md` (per `Role.md` template).
