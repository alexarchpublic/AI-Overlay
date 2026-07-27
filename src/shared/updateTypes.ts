/**
 * @file src/shared/updateTypes.ts
 *
 * Why it exists: Chunk 7 Phase 3 — shared UpdateState union and IPC payload
 * types for the electron-updater wrapper. Main owns the state machine;
 * renderer switches exhaustively on `state`.
 */

/** Finite set of updater UI/service states (PRD §3.2 task 3.3). */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'notify-only';

/**
 * Snapshot pushed over `update:stateChanged` and returned by
 * `update:getState`. All optional payload fields are nullable so the
 * renderer never has to discriminate further than `state`.
 */
export interface UpdateStateSnapshot {
  state: UpdateState;
  /** Latest available / downloaded version, when known. */
  version: string | null;
  /** GitHub release page URL (macOS notify-only download target). */
  releaseNotesUrl: string | null;
  /** Download progress 0–100 while `state === 'downloading'`. */
  percent: number | null;
  /** Redacted error message when `state === 'error'`. */
  error: string | null;
  /** ISO timestamp of the last completed check (available or not). */
  lastCheckedAt: string | null;
  /** Running app version (`app.getVersion()`). */
  currentVersion: string;
  /**
   * Display channel label. Always `'default'` for this chunk — we never set
   * `autoUpdater.channel` (D11).
   */
  channel: string;
}

/** Build the public releases-repo URL for a given version tag. */
export function buildReleaseNotesUrl(version: string): string {
  return `https://github.com/alexarchpublic/AI-Overlay-releases/releases/tag/v${version}`;
}

/** Default channel label shown in Settings → About (D11). */
export const UPDATE_CHANNEL_LABEL = 'default';
