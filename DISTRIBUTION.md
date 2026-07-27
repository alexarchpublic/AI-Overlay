# Distribution Runbook — Arch Public AI Overlay

Operator guide for cutting releases, provisioning the shared Gemini key, and rolling back. End-user install steps live in [`INSTALL_WINDOWS.md`](./INSTALL_WINDOWS.md).

## Version scheme

- Format: `MAJOR.MINOR.PATCH-alpha.N` (currently `0.2.0-alpha.1`).
- Bump: `npm version prerelease --preid=alpha` → commit + tag → `git push --follow-tags`.
- Single source of truth: `package.json`. Never hardcode a version in source.
- Every GitHub release is a **prerelease**. Do not set an updater `channel` (see Chunk 7 D11).

## Cutting a release

1. Ensure `chunk-7/packaging-windows` (or mainline after merge) is green: `npm run typecheck && npm run lint && npm test`.
2. Bump with `npm version prerelease --preid=alpha`.
3. `git push --follow-tags`.
4. Phase 5 CI (`.github/workflows/release.yml`) builds Windows + macOS and publishes artifacts to the public binaries repo `alexarchpublic/AI-Overlay-releases`.
5. Confirm the release page has: `.exe`, `.dmg`, `.zip`, `latest.yml`, `latest-mac.yml`.

Until Phase 5 lands, produce local artifacts with `npm run package:win` / `npm run package:mac` on native runners.

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

- Windows: unsigned for alpha (SmartScreen expected). When an OV/EV cert exists, set Actions secrets `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` — no `electron-builder.yml` change required.
- macOS: unsigned / un-notarized → notify-only updates; first launch needs right-click → Open.

## Reading a diagnostics bundle

Settings → About → **Copy diagnostics** puts the log directory path, version, and platform on the clipboard. Ask the user to paste that path (or the latest `logs/app-*.jsonl`) into the Slack support thread. Logs are local only — no telemetry.

## Manual wipe (reinstall keeping vs clearing key)

- Reinstalling the NSIS app **preserves** `%APPDATA%\arch-public-ai-overlay` (provisioned key survives).
- To wipe: quit the app, delete `%APPDATA%\arch-public-ai-overlay` (Windows) or `~/Library/Application Support/arch-public-ai-overlay` (macOS).
