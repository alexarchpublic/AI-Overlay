# Distribution Runbook — Arch Public AI Overlay

Operator guide for cutting releases, provisioning the shared Gemini key, and rolling back. End-user install steps live in [`INSTALL_WINDOWS.md`](./INSTALL_WINDOWS.md).

## Version scheme

- Format: `MAJOR.MINOR.PATCH-alpha.N` (currently `0.2.0-alpha.1`).
- Bump: `npm version prerelease --preid=alpha` → commit + tag → `git push --follow-tags`.
- Single source of truth: `package.json`. Never hardcode a version in source.
- Alpha status is carried by the **version suffix**, not the GitHub “prerelease” flag.
  Publish with `releaseType: release` so `/releases/latest` and the repo sidebar
  “Latest” widget resolve (GitHub-prerelease-only publishes hide Latest and 404
  `…/releases/latest/download/latest.yml`). Do not set an updater `channel`
  (see Chunk 7 D11).

## Cutting a release

1. Ensure `chunk-7/packaging-windows` (or mainline after merge) is green: `npm run typecheck && npm run lint && npm test`.
2. Bump with `npm version prerelease --preid=alpha` (creates commit + `v*` tag).
3. `git push --follow-tags`.
4. Tag-triggered CI (`.github/workflows/release.yml`) builds on `macos-14` + `windows-latest` and publishes to the public binaries repo [`alexarchpublic/AI-Overlay-releases`](https://github.com/alexarchpublic/AI-Overlay-releases).
5. Confirm the release page shows **Latest** (not only Pre-release) and has:
   `.exe`, `.dmg`, `.zip`, `latest.yml`, `latest-mac.yml`.
   Also verify `https://github.com/alexarchpublic/AI-Overlay-releases/releases/latest`
   resolves to the new tag.

Local-only packaging (no publish): `npm run package:win` / `npm run package:mac` on native runners.

### CI secrets (source repo `alexarchpublic/AI-Overlay`)

| Secret | Required | Purpose |
|--------|----------|---------|
| `RELEASES_TOKEN` | **yes** | Fine-grained PAT with **`contents: write` on `AI-Overlay-releases` only**. Used as `GH_TOKEN` by electron-builder. Do **not** use the default `GITHUB_TOKEN` — it cannot write to the other repo. |
| `WIN_CSC_LINK` | no | Base64-encoded Windows code-signing cert (or file path CI can read). Empty → unsigned build (alpha default, D2). |
| `WIN_CSC_KEY_PASSWORD` | no | Password for `WIN_CSC_LINK`. |

Rotate `RELEASES_TOKEN` if the creating credential was a broad OAuth/`repo`-scoped token — replace with a fine-grained PAT scoped to the releases repo only.

## Rollback

- **No automatic downgrade** (`allowDowngrade: false`).
- Publish a *higher* version that contains the previous known-good code.
- Do not delete a release clients may already have downloaded — an unpublish alone strands them.
- Optional: mark the bad release notes clearly in Slack so pilots skip it until the forward fix ships.

## Key provisioning (`team-config.json`)

The shipped binary is world-downloadable (public releases repo). **No Gemini key is compiled into the app.**

1. Copy [`team-config.example.json`](./team-config.example.json) → `team-config.json`.
2. Fill `geminiApiKey` with the shared team key. Optional: `defaultAlgorithm`, `captureIntervalMs`, `provisionedBy`, `provisionedAt`.
3. Place the file where first launch can find it (search order):
   1. Directory containing the running executable (install dir)
   2. App `userData` (`%APPDATA%\arch-public-ai-overlay` on Windows)
   3. Shared drop folder: `%PROGRAMDATA%\ArchPublic\` (Windows) or `/Library/Application Support/ArchPublic/` (macOS)
4. Recommended for CS rollout: put `team-config.json` in `%PROGRAMDATA%\ArchPublic\` via IT, **or** ship it next to the installer on the internal share and have users copy it into that shared folder before first launch.
5. On first launch the app writes the key to DPAPI (Windows) / Keychain (macOS), sets `provisioning.completed`, and leaves the JSON file on disk.

If the file is absent or invalid, the app falls through to Settings → AI (paste key manually). Malformed JSON never crashes boot.

### Schema

| Field | Required | Notes |
|-------|----------|-------|
| `geminiApiKey` | yes | Non-empty string |
| `defaultAlgorithm` | no | `market-wave` \| `arbitrage` \| `intelligence` \| `apex` \| `all` |
| `captureIntervalMs` | no | Finite number; clamped by the capture store |
| `provisionedBy` | no | Logged on apply — never the key |
| `provisionedAt` | no | Free-form date string |

Unknown keys are rejected (`provisioning.invalid`).

## Key Rotation

**Owner:** *(operator to name — §11 Q1)*  
**Quota / model restrictions:** configure in Google AI Studio (minimum model set + quota cap).  
**Rotation cadence:** *(operator to set)*

Procedure:

1. Create a new Gemini key in Google AI Studio; restrict models + set quota.
2. Publish a new `team-config.json` (updated `geminiApiKey`, bump `provisionedAt`, note `provisionedBy`) to the internal share / `%PROGRAMDATA%\ArchPublic\`.
3. On each machine, either:
   - Delete the `provisioning.completed` flag so first-launch logic runs again, **or**
   - Paste the new key in Settings → AI (overwrites the keychain entry).
4. To clear the flag without a full wipe: remove the `provisioning.completed` key from the electron-store config at `%APPDATA%\arch-public-ai-overlay\config.json` (Windows) / `~/Library/Application Support/arch-public-ai-overlay/config.json` (macOS), then relaunch with the new `team-config.json` visible.
5. Revoke the old key in Google AI Studio after pilots confirm chat works.
6. Record rotation date + owner in this section / Slack.

**Never** put the key in `package.json`, CI logs, GitHub Releases, or the public binaries repo.

## Code signing (later)

- Windows: unsigned for alpha (SmartScreen expected). When an OV/EV cert exists, set Actions secrets `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` — **no `electron-builder.yml` change required** (D2). `release.yml` already forwards those env vars; electron-builder signs when they are non-empty and skips when empty.
- macOS: unsigned / un-notarized → notify-only updates; first launch needs right-click → Open.
- **Unsigned update verification (task 5.8):** with no `publisherName` configured, electron-updater is expected to skip Win code-signature checks. If a live Windows update fails with a signature error, set `verifyUpdateCodeSignature: false` on the updater in `bootstrap.ts` as an **alpha-only** concession and remove it when a cert lands.

## Reading a diagnostics bundle

Settings → About → **Copy diagnostics** puts the log directory path, version, and platform on the clipboard. Ask the user to paste that path (or the latest `logs/app-*.jsonl`) into the Slack support thread. Logs are local only — no telemetry.

## Manual wipe (reinstall keeping vs clearing key)

- Reinstalling the NSIS app **preserves** `%APPDATA%\arch-public-ai-overlay` (provisioned key survives).
- To wipe: quit the app, delete `%APPDATA%\arch-public-ai-overlay` (Windows) or `~/Library/Application Support/arch-public-ai-overlay` (macOS).

## Acceptance & pilot rollout

| Doc | Audience |
|-----|----------|
| [`INSTALL_WINDOWS.md`](./INSTALL_WINDOWS.md) | CS end users |
| [`WIN_ACCEPTANCE.md`](./WIN_ACCEPTANCE.md) | Operator hardware matrix (Phases A–H) |
| [`scripts/win-acceptance.mjs`](./scripts/win-acceptance.mjs) | Automated Windows slice (`node scripts/win-acceptance.mjs`) |
| [`MAC_ACCEPTANCE.md`](./MAC_ACCEPTANCE.md) | macOS regression (D14 — not a Chunk 7 hard gate) |

### S1 pilot (PRD §8)

1. Operator completes `WIN_ACCEPTANCE.md` on **two** distinct Windows machines (record GPU + scaling in `CLAUDE_HANDOFF.md`).
2. Drop `ArchPublicAIOverlay-Setup-*.exe` + `team-config.json` on the internal share.
3. Pilot with **exactly two** CS users for one week — one Slack feedback thread, no SLA language.
4. Gate to full CS team: ≥1 real client call each, one applied auto-update, zero P0 bugs, `INSTALL_WINDOWS.md` validated by a non-technical reader.
5. Never publish a release on a Friday.

### Support model (alpha)

- One Slack channel, one owner.
- Users paste **Copy diagnostics** output (Settings → About) into the thread.
- No telemetry / crash reporter (D15).
