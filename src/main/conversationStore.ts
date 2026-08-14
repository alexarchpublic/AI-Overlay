/**
 * @file src/main/conversationStore.ts
 *
 * Why it exists: PRD §3.7 / D11 / D12 — session-scoped, in-process
 * conversation memory. Per the Chunk 5 PRD, history NEVER lands on disk;
 * closing the chat window clears the session. Truncation runs once per send
 * above 20 turns; the oldest 20 turns are summarized into a single
 * `'system-summary'` turn via a Flash call.
 *
 * The summary call lives behind an injected dependency so tests can drive
 * the truncation path deterministically without standing up the full
 * Gemini SDK. `geminiService` provides the production summarizer.
 */

import { ulid } from 'ulid';
import type { ChatRole, ChatTurn } from '../shared/types';
import {
  HISTORY_KEEP_PAIRS,
  HISTORY_TRUNCATE_AT_PAIRS,
} from '../shared/aiConstants';
import type { AppLogger } from './logger';

/**
 * Produce a one-paragraph summary of the older turns. The summarizer MUST
 * NOT include the harness or screenshots — `geminiService.summarize` uses
 * the Flash model with no system prompt.
 *
 * Returning `null` is the documented non-fatal failure path (PRD §3.7);
 * the store keeps the raw turns and logs `gemini.summaryFailed`.
 */
export type SummarizeFn = (older: readonly ChatTurn[]) => Promise<string | null>;

export interface ConversationStoreDeps {
  logger: AppLogger;
  /** Injected for deterministic timestamps in tests. */
  now?: () => number;
  /** Injected for deterministic ULIDs in tests. */
  newId?: () => string;
}

export interface ConversationStore {
  /** Begin a new session. Idempotent for a given id; reuses an existing one. */
  startSession(): string;
  /** Drop the active session (no-op when none). PRD D11 — clear-on-close. */
  endSession(reason: 'close' | 'cancel' | 'reset' | 'shutdown'): void;
  /** Currently-active session id, or `null` when none. */
  getSessionId(): string | null;
  /** Snapshot of the active session's turns (newest at the END). */
  getHistory(sessionId?: string): readonly ChatTurn[];
  /** Append a user turn. Returns the constructed turn. */
  appendUser(args: {
    text: string;
    attachedScreenshotIds: readonly string[];
    promptTokenEstimate: number;
  }): ChatTurn;
  /** Append an assistant turn. Returns the constructed turn. */
  appendAssistant(args: {
    text: string;
    structured?: ChatTurn['structured'];
    latencyMs: number;
    modelUsed: string;
    toolAttributions?: readonly string[];
  }): ChatTurn;
  /**
   * Drop the most recently appended turn whose `id` matches. Used to
   * unwind a cancelled-in-flight user turn (PRD §3.7 cancel-in-flight).
   */
  dropTurn(turnId: string): void;
  /**
   * Run truncation if the active session exceeds the threshold (PRD D12).
   * Pulls the summary text from the injected `summarize` function. Idempotent
   * within a single send (the loop in `geminiService` should call this once
   * per send attempt).
   */
  maybeTruncate(summarize: SummarizeFn): Promise<void>;
}

export function createConversationStore(
  deps: ConversationStoreDeps,
): ConversationStore {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? ulid;

  let sessionId: string | null = null;
  let turns: ChatTurn[] = [];

  function appendTurn(role: ChatRole, base: Partial<ChatTurn> & { text: string }): ChatTurn {
    sessionId ??= newId();
    const turn: ChatTurn = {
      id: base.id ?? newId(),
      role,
      text: base.text,
      attachedScreenshotIds: base.attachedScreenshotIds ?? [],
      createdAt: base.createdAt ?? now(),
      ...(base.structured !== undefined ? { structured: base.structured } : {}),
      ...(base.latencyMs !== undefined ? { latencyMs: base.latencyMs } : {}),
      ...(base.modelUsed !== undefined ? { modelUsed: base.modelUsed } : {}),
      ...(base.promptTokenEstimate !== undefined
        ? { promptTokenEstimate: base.promptTokenEstimate }
        : {}),
      ...(base.toolAttributions !== undefined
        ? { toolAttributions: base.toolAttributions }
        : {}),
    };
    turns.push(turn);
    return turn;
  }

  return {
    startSession() {
      if (sessionId !== null) return sessionId;
      sessionId = newId();
      turns = [];
      deps.logger.debug('conversation.sessionStarted', { sessionId });
      return sessionId;
    },
    endSession(reason) {
      const prev = sessionId;
      sessionId = null;
      turns = [];
      if (prev !== null) {
        deps.logger.debug('conversation.sessionEnded', { sessionId: prev, reason });
      }
    },
    getSessionId() {
      return sessionId;
    },
    getHistory(id) {
      if (id !== undefined && id !== sessionId) return [];
      return turns.slice();
    },
    appendUser({ text, attachedScreenshotIds, promptTokenEstimate }) {
      return appendTurn('user', {
        text,
        attachedScreenshotIds,
        promptTokenEstimate,
      });
    },
    appendAssistant({ text, structured, latencyMs, modelUsed, toolAttributions }) {
      return appendTurn('assistant', {
        text,
        ...(structured !== undefined ? { structured } : {}),
        ...(toolAttributions !== undefined && toolAttributions.length > 0
          ? { toolAttributions }
          : {}),
        latencyMs,
        modelUsed,
      });
    },
    dropTurn(turnId) {
      const idx = turns.findIndex((t) => t.id === turnId);
      if (idx === -1) return;
      turns.splice(idx, 1);
    },
    async maybeTruncate(summarize) {
      const pairCount = Math.floor(turns.length / 2);
      if (pairCount <= HISTORY_TRUNCATE_AT_PAIRS) return;
      // Take the OLDEST `2 * HISTORY_KEEP_PAIRS` turns to summarize; the
      // remaining recent turns survive verbatim.
      const summarizeCount = turns.length - 2 * HISTORY_KEEP_PAIRS;
      if (summarizeCount <= 0) return;
      const older = turns.slice(0, summarizeCount);
      const newer = turns.slice(summarizeCount);

      let summary: string | null;
      try {
        summary = await summarize(older);
      } catch (err) {
        deps.logger.warn('gemini.summaryFailed', {
          message: err instanceof Error ? err.message : String(err),
          turnCount: older.length,
        });
        summary = null;
      }
      if (summary === null) {
        // Non-fatal — keep the raw turns (PRD D12). The next send may try
        // again if we cross the threshold once more.
        return;
      }

      const summaryTurn: ChatTurn = {
        id: newId(),
        role: 'system-summary',
        text: summary,
        attachedScreenshotIds: [],
        createdAt: now(),
      };
      turns = [summaryTurn, ...newer];
      deps.logger.info('conversation.truncated', {
        sessionId,
        summarizedTurnCount: older.length,
        retainedTurnCount: newer.length,
      });
    },
  };
}
