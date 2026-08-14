# Operator Windows Acceptance (Internal Co-Pilot)

Use this runbook on **Windows 10/11 x64** with a **Gemini API key** (via `team-config.json` or Settings → AI).
Automated slice: `node scripts/win-acceptance.mjs` (add `--logs` after exercising a packaged or `npm run dev` session).

**Node:** Node 20.x (`.nvmrc`). Use `nvm use` if nvm-windows is installed.

**Audience:** operator validating Chunk 7 before / during the S1 pilot (`INSTALL_WINDOWS.md` is the CS-facing guide).

**Artifacts:** install from [AI-Overlay-releases](https://github.com/alexarchpublic/AI-Overlay-releases) — `ArchPublicAIOverlay-Setup-*.exe` + optional `team-config.json` beside it.

**Hardware matrix (Gate 6.5):** run Phases A–H on **at least two physically distinct machines** — ideally one Intel iGPU laptop and one discrete-GPU desktop, at different display scalings (100% / 125% / 150%; 175% may be unit-tested if no hardware supports it — record which in `CLAUDE_HANDOFF.md`).

---

## Phase A — Install / first-run / provisioning

| # | Action | Pass when |
|---|--------|-----------|
| A0 | `node scripts/win-acceptance.mjs` from a clean clone | All automated checks green; exit 0 |
| A1 | Download `ArchPublicAIOverlay-Setup-0.2.0-alpha.*.exe` + `team-config.json` into the **same folder** | Both files present |
| A2 | Double-click the `.exe` | SmartScreen may show **Windows protected your PC** |
| A3 | SmartScreen bypass | **More info** → **Run anyway** (see `INSTALL_WINDOWS.md`) |
| A4 | Installer | Per-user install completes with **no UAC / admin prompt** |
| A5 | Desktop / Start Menu shortcut created | Shortcut name: **Arch Public AI Overlay** |
| A6 | First launch with `team-config.json` discoverable (same dir as exe, `%APPDATA%\arch-public-ai-overlay\`, or `%PROGRAMDATA%\ArchPublic\`) | Chat window opens; **no** API-key prompt; log has `provisioning.applied` with `provisionedBy` — **never** the key |
| A7 | First launch **without** `team-config.json` (optional negative path) | Falls through to Settings → AI paste flow; log `provisioning.absent` |
| A8 | Tray icon | Present in notification area (check ^ overflow); menu includes Show Overlay / Toggle auto-capture / Settings / Exit |
| A9 | Packaged logging | `%APPDATA%\arch-public-ai-overlay\logs\app-YYYY-MM-DD.jsonl` is created and growing (proves B3) |

---

## Phase B — Settings & key storage

| # | Action | Pass when |
|---|--------|-----------|
| B1 | Open Settings (tray or header context menu) | Single 640×480 window; **no** File/Edit/View menu bar inside the window |
| B2 | Settings → About | Shows version matching the installer (e.g. `0.2.0-alpha.1`), Check for updates, Copy diagnostics |
| B3 | Copy diagnostics | Clipboard has log directory path + version + platform |
| B4 | Quit and relaunch | Provisioned / saved key still works — chat send does not show **no-api-key** |
| B5 | Corrupt-key recovery (optional) | If keychain decrypt fails, app re-prompts rather than crashing; log `secrets.decryptFailed` |
| B6 | Manual key path | Clear key in AI settings, paste a key, Save → `ai.apiKeyUpdated` (redacted); chat works |

---

## Phase C — Always-on-top (Zoom / Teams)

Confirm **right-click in the drag header** still opens the app capture menu (not only the Windows system menu) — `preventDefault` on the header context menu.

| # | Action | Pass when |
|---|--------|-----------|
| C1 | Join Zoom (windowed). Place chat over the meeting window | Chat stays visible above Zoom |
| C2 | Start Zoom **screen share** (any window/screen) | Chat remains above Zoom’s floating share control bar |
| C3 | Repeat C1–C2 with **Microsoft Teams** | Same: visible over meeting + share bar |
| C4 | Click into Zoom/Teams until chat loses focus | Within ~500ms chat re-asserts topmost (`blur` → `moveTop`), or tray → **Show Overlay** recovers it |
| C5 | Minimize / lose the overlay deliberately | Tray → **Show Overlay** → `setAlwaysOnTop` + `moveTop` + focus restores it |
| C6 | GPU note | Record GPU (Intel iGPU vs discrete) in handoff — no black corner / black-rectangle artifacts (B6) |

---

## Phase D — Region picker (single- & dual-monitor, mixed DPI)

| # | Action | Pass when |
|---|--------|-----------|
| D1 | Single monitor @ 100% — Set capture region… | Picker covers the **full** monitor; drag confirms; **Esc** cancels; on-screen **Cancel** cancels |
| D2 | Same machine @ 125% or 150% (Display settings → Scale) | Picker still full-bleed; crop on next capture is pixel-correct |
| D3 | Dual monitor, mixed DPI (e.g. 100% + 150%) | Open picker on **each** display; full coverage on both; no undrawable strips / taskbar over picker |
| D4 | Confirm region on secondary monitor | First auto-capture tick crops correctly (no `extract_area` / `no source returned` errors) |
| D5 | Reboot or replug monitor (optional) | Saved region survives via bounds+label fingerprint, or user is prompted to re-set without a crash |

---

## Phase E — Capture loop (30 minutes)

| # | Action | Pass when |
|---|--------|-----------|
| E1 | Enable auto-capture (default ~15s) | Cadence holds; cyan **capturing** flash ~600ms each tick |
| E2 | Run ≥30 minutes continuous | No crash; temp JPEG ring buffer pruned; disk not filling |
| E3 | Force a black/empty capture path if available (DRM window, locked session) | After 3 consecutive bad frames → amber **captureUnhealthy** in header (not `permDenied`) |
| E4 | Restore a valid region / frame | Health clears on a good capture |
| E5 | Logs | `capture.*` events present; no flood of `capture.sourceUnresolved` / `thumbnailMismatch` |

---

## Phase F — Gemini round-trip + latency

Requires a working key (provisioned or pasted).

| # | Action | Pass when |
|---|--------|-----------|
| F1 | Send: "Client wants fewer trades during chop" | Within budget: analysis + suggestions (`parameter` / values / `rationale` / `doc_ref`) + **talk track** + confidence + risk |
| F2 | Log fields | `gemini.callStarted` + `gemini.callCompleted` with `promptHash` / screenshot metadata when captures exist |
| F3 | Quick prompts (6) | Prefill only, no auto-send |
| F4 | Copy suggestion / talk track | Clipboard correct; copy events in log |
| F5 | Latency sweep | Over ≥20 sends (eval bank / quick prompts mix): **p50 ≤ 6s**, **p95 ≤ 12s** (`Context.md §8`) — record in handoff |
| F6 | Parse reliability | ≥19/20 first-try structured parses |

Optional: `GEMINI_API_KEY=... npm run eval:bank` from a Windows checkout.

---

## Phase G — Update apply

This is the live Gate 5.7 / 5.8 proof on operator hardware.

| # | Action | Pass when |
|---|--------|-----------|
| G1 | Install `0.2.0-alpha.N` from Releases | About shows that version |
| G2 | Operator publishes `0.2.0-alpha.(N+1)` | Release has `.exe` + `latest.yml` |
| G3 | Keep app running (or relaunch) ≤4h | Update detected; slim non-modal banner — **never** focus-stealing / mid-call quit |
| G4 | Banner copy | "Update … ready — installs when you close the app" (+ Restart now optional) |
| G5 | Quit normally after call | Update installs on quit (`autoInstallOnAppQuit`) |
| G6 | Relaunch | About / `app.getVersion()` shows **alpha.(N+1)** |
| G7 | Signature path | Unsigned NSIS accepted (or `verifyUpdateCodeSignature: false` recorded as alpha-only concession) |
| G8 | Logs | `update.checkStarted`, `update.available`, `update.downloaded`, `update.installScheduled` (and progress throttled) |

---

## Phase H — Live call simulation

| # | Action | Pass when |
|---|--------|-----------|
| H1 | Real or internal Zoom/Teams call; client (or self) shares TradingView | Capture region on shared screen; ring buffer shows client Inputs / chart |
| H2 | Algorithm picker → Market Wave | Persists across quit + relaunch |
| H3 | Ask settings / Scope / deploy-cash style questions | Correct inputs + `doc_ref` + talk track; no performance promises |
| H4 | Mid-call update banner (if G3 overlapped) | Does **not** interrupt the call |
| H5 | Tray recovery once during the call | Overlay recoverable without ending the meeting |

---

## Phase I — Optimizer integration (PRD_Optimizer_MCP_Integration)

Needs a v2 `team-config.json` (with the `optimizer` block) provisioned.

| # | Action | Pass when |
|---|--------|-----------|
| I1 | Provision v2 config → launch | Log has `provisioning.optimizerApplied` with `mcpUrl` — **never** the team key; Settings shows the Optimizer panel populated with server tickers/timeframes |
| I2 | Chat: “backtest NVDA on 1d with default settings and tell me if it beat buy-and-hold” | Answer cites computed numbers; “ran backtest: NVDA 1d” chip on the turn; log has `optimizer.tool.call` with `durationMs`/`resultTokensEst` |
| I3 | Panel: start a 50-trial NVDA 1d optimization | Progress advances on ~2 s polls (`optimizer.job.poll`); `optimizer.job.done`; TradingView card renders exact Pine input labels |
| I4 | Copy settings card → paste into TradingView Inputs | Labels match the TV dialog; values apply cleanly |
| I5 | “Use in chat” → ask “walk me through this result” | Answer references the run’s numbers (`chat.optimizerGroundingInjected` logged) |
| I6 | Remove the `optimizer` block → re-provision → relaunch | Panel shows “not provisioned”; chat behaves exactly as v1 (no tool chips, no optimizer log events) |

---

## Sign-off matrix (Gate 6.5)

| Machine | GPU | Scaling | Phases A–H | Owner | Date |
|---------|-----|---------|------------|-------|------|
| *(laptop)* | Intel iGPU / other | | ☐ | | |
| *(desktop)* | Discrete / other | | ☐ | | |

Failures → tracked issues with owners in `CLAUDE_HANDOFF.md` / Slack; do not tick Chunk 7 DoD until both machines pass or exceptions are signed off.

## Pilot (Gate 6.7 / Rollout S1)

| User | Installed | ≥1 real client call | Feedback thread |
|------|-----------|---------------------|-----------------|
| CS pilot 1 | ☐ | ☐ | |
| CS pilot 2 | ☐ | ☐ | |

Collect feedback in **one** Slack thread. One week clean + one applied update + zero P0 → advance to full CS team (`DISTRIBUTION.md` / PRD §8).

---

When a phase passes, tick status in `project-state.md` and append evidence to `CLAUDE_HANDOFF.md` (per `Role.md`).
