/**
 * @file src/main/enumerationMonitor.ts
 *
 * Phase 0 task 6 — per-session enumeration monitoring + rate limiting for
 * the vision-grounded tuning loop (PRD §6 D-13, §7 `enumerationScore`).
 */
import type { ChatTurn } from '../shared/types';
import {
  ENUMERATION_BLOCK_SCORE,
  ENUMERATION_COOLDOWN_MS,
  ENUMERATION_PROBE_PATTERNS,
  ENUMERATION_PROBE_SCORE,
  ENUMERATION_RATE_SCORE,
  ENUMERATION_RATE_SEND_THRESHOLD,
  ENUMERATION_RATE_WINDOW_MS,
  ENUMERATION_TUNING_OVERAGE_SCORE,
  ENUMERATION_TUNING_SOFT_LIMIT,
} from '../shared/tuning/constants';
import type { AppLogger } from './logger';

export interface EnumerationAssessment {
  /** Session score after applying this send's penalties. */
  score: number;
  blocked: boolean;
  reasons: readonly string[];
  cooldownMs: number;
}

export interface EnumerationMonitor {
  reset(): void;
  assessBeforeSend(args: {
    userText: string;
    now?: number;
  }): EnumerationAssessment;
  /** Call once a send is approved and queued — records rate + probe hits. */
  recordSendStarted(args: { userText: string; now?: number }): void;
  /** Call after a successful assistant response with structured suggestions. */
  recordTuningResponse(args: { suggestionCount: number; now?: number }): void;
  getScore(): number;
}

interface SendEvent {
  ts: number;
}

export function createEnumerationMonitor(deps: { logger: AppLogger }): EnumerationMonitor {
  let score = 0;
  let tuningIterationCount = 0;
  let blockedUntilTs = 0;
  const recentSends: SendEvent[] = [];

  function pruneSends(now: number): void {
    const cutoff = now - ENUMERATION_RATE_WINDOW_MS;
    while (recentSends.length > 0 && recentSends[0].ts < cutoff) {
      recentSends.shift();
    }
  }

  function probeHits(text: string): boolean {
    return ENUMERATION_PROBE_PATTERNS.some((pattern) => pattern.test(text));
  }

  function tuningOverageScore(): number {
    if (tuningIterationCount <= ENUMERATION_TUNING_SOFT_LIMIT) return 0;
    return (tuningIterationCount - ENUMERATION_TUNING_SOFT_LIMIT) * ENUMERATION_TUNING_OVERAGE_SCORE;
  }

  function maybeExpireCooldown(now: number): void {
    if (blockedUntilTs > 0 && now >= blockedUntilTs) {
      blockedUntilTs = 0;
      score = Math.floor(score / 2);
    }
  }

  return {
    reset() {
      score = 0;
      tuningIterationCount = 0;
      blockedUntilTs = 0;
      recentSends.length = 0;
      deps.logger.debug('enumeration.sessionReset');
    },
    assessBeforeSend(args) {
      const now = args.now ?? Date.now();
      maybeExpireCooldown(now);
      if (now < blockedUntilTs) {
        return {
          score,
          blocked: true,
          reasons: ['cooldown-active'],
          cooldownMs: blockedUntilTs - now,
        };
      }

      if (probeHits(args.userText)) {
        blockedUntilTs = now + ENUMERATION_COOLDOWN_MS;
        score = Math.max(score + ENUMERATION_PROBE_SCORE, ENUMERATION_BLOCK_SCORE);
        deps.logger.warn('enumeration.blocked', {
          score,
          reasons: ['enumeration-probe'],
          cooldownMs: ENUMERATION_COOLDOWN_MS,
        });
        return {
          score,
          blocked: true,
          reasons: ['enumeration-probe'],
          cooldownMs: ENUMERATION_COOLDOWN_MS,
        };
      }

      const reasons: string[] = [];
      let projected = score;

      pruneSends(now);
      if (recentSends.length >= ENUMERATION_RATE_SEND_THRESHOLD) {
        projected += ENUMERATION_RATE_SCORE;
        reasons.push(`send-rate:${String(recentSends.length)}`);
      }

      const tuningPenalty = tuningOverageScore();
      if (tuningPenalty > 0) {
        projected += 0; // already folded into score via recordTuningResponse
        reasons.push(`tuning-iterations:${String(tuningIterationCount)}`);
      }

      if (projected >= ENUMERATION_BLOCK_SCORE) {
        blockedUntilTs = now + ENUMERATION_COOLDOWN_MS;
        score = projected;
        deps.logger.warn('enumeration.blocked', {
          score: projected,
          reasons,
          cooldownMs: ENUMERATION_COOLDOWN_MS,
        });
        return {
          score: projected,
          blocked: true,
          reasons,
          cooldownMs: ENUMERATION_COOLDOWN_MS,
        };
      }

      if (reasons.length > 0) {
        deps.logger.info('enumeration.scored', { score: projected, reasons });
      }

      return {
        score: projected,
        blocked: false,
        reasons,
        cooldownMs: 0,
      };
    },
    recordSendStarted(args) {
      const now = args.now ?? Date.now();
      pruneSends(now);
      recentSends.push({ ts: now });

      if (probeHits(args.userText)) {
        score += ENUMERATION_PROBE_SCORE;
      }
      if (recentSends.length > ENUMERATION_RATE_SEND_THRESHOLD) {
        score += ENUMERATION_RATE_SCORE;
      }
    },
    recordTuningResponse(args) {
      if (args.suggestionCount <= 0) return;
      tuningIterationCount += 1;
      if (tuningIterationCount > ENUMERATION_TUNING_SOFT_LIMIT) {
        score += ENUMERATION_TUNING_OVERAGE_SCORE;
      }
    },
    getScore() {
      return score;
    },
  };
}

/** @internal Exported for tests — count tuning assistant turns in history. */
export function countTuningTurnsInHistory(history: readonly ChatTurn[]): number {
  return history.filter(
    (t) =>
      t.role === 'assistant' &&
      (t.structured?.suggested_parameter_changes.length ?? 0) > 0,
  ).length;
}
