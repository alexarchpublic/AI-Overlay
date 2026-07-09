/**
 * @file src/main/chatOrchestrator.ts
 *
 * Why it exists: Extract `runChatSend` from the main bootstrap so the
 * chat orchestration path can be unit-tested with injected fakes (Milestone 0
 * T0.3). The Electron entrypoint wires real singletons into `createChatOrchestrator`.
 */

import type { AppLogger } from './logger';
import type { AiStateStore } from './aiStore';
import type { ConversationStore } from './conversationStore';
import type { GeminiService } from './geminiService';
import type { ScreenshotService } from './screenshotService';
import type { KnowledgeStore } from '../shared/knowledgeTypes';
import {
  buildVisionAugmentedUserText,
  extractChartContextForRetrieval,
} from '../shared/tuning/chartContext';
import { fit as fitTokenBudget } from './tokenBudget';
import {
  DEFAULT_RETRIEVAL_K,
  DEFAULT_RETRIEVAL_TOKEN_BUDGET,
} from '../shared/knowledgeConstants';
import { estimateKnowledgeContextTokens } from '../shared/knowledge/promptContext';
import { SCREENSHOTS_PER_TURN } from '../shared/aiConstants';
import type { ChatError, ChatState, ChatTurn, Screenshot } from '../shared/types';

export interface ChatOrchestratorEmit {
  turnAppended(turn: ChatTurn): void;
  turnDropped(turnId: string): void;
  stateChanged(state: ChatState): void;
  error(err: ChatError): void;
}

export interface ChatOrchestratorDeps {
  logger: AppLogger;
  aiStore: Pick<AiStateStore, 'getApiKey'>;
  conversationStore: ConversationStore;
  geminiService: GeminiService;
  knowledgeStore: KnowledgeStore;
  screenshotService: ScreenshotService;
  emit: ChatOrchestratorEmit;
  /** Mutable ref shared with the IPC cancel handler. */
  chatInflight: { current: AbortController | null };
}

export interface ChatOrchestrator {
  runChatSend(text: string, requestedScreenshotIds?: readonly string[]): Promise<void>;
}

/**
 * Drive one user turn end-to-end. See the docblock on the original
 * `runChatSend` in `index.ts` for the step list.
 */
export function createChatOrchestrator(deps: ChatOrchestratorDeps): ChatOrchestrator {
  const {
    logger: log,
    aiStore: ai,
    conversationStore: conv,
    geminiService: gemini,
    knowledgeStore: store,
    screenshotService: captureService,
    emit,
    chatInflight,
  } = deps;

  async function runChatSend(
    text: string,
    requestedScreenshotIds?: readonly string[],
  ): Promise<void> {
    const pendingUserTurnId: { value: string | null } = { value: null };

    try {
      await runChatSendInner(text, requestedScreenshotIds, (turn) => {
        pendingUserTurnId.value = turn.id;
      });
    } catch (err) {
      if (pendingUserTurnId.value !== null) {
        conv.dropTurn(pendingUserTurnId.value);
        emit.turnDropped(pendingUserTurnId.value);
      }
      log.error('chat.orchestratorFatal', {
        message: err instanceof Error ? err.message : String(err),
      });
      emit.error({
        variant: 'fatal',
        reason: 'orchestrator',
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      emit.stateChanged('idle');
    }
  }

  async function runChatSendInner(
    text: string,
    requestedScreenshotIds: readonly string[] | undefined,
    onUserTurnAppended: (turn: ChatTurn) => void,
  ): Promise<void> {
    log.info('chat.messageSent', { length: text.length });

    if (ai.getApiKey() === null) {
      emit.error({ variant: 'no-api-key' });
      return;
    }

    const preTruncateHistory = conv.getHistory();
    const chartContext = extractChartContextForRetrieval(preTruncateHistory, text);

    let knowledgeChunks;
    try {
      knowledgeChunks = await store.retrieve({
        text,
        ...(chartContext !== undefined ? { chartContext } : {}),
        k: DEFAULT_RETRIEVAL_K,
        tokenBudget: DEFAULT_RETRIEVAL_TOKEN_BUDGET,
      });
    } catch (err) {
      log.warn('chat.knowledgeRetrieveFailed', {
        message: err instanceof Error ? err.message : String(err),
      });
      emit.error({ variant: 'no-harness' });
      return;
    }
    if (knowledgeChunks.length === 0) {
      emit.error({ variant: 'no-harness' });
      return;
    }

    const knowledgeApproxTokens = estimateKnowledgeContextTokens(knowledgeChunks);

    await conv.maybeTruncate((older) => gemini.summarize(older));

    const history = conv.getHistory();

    let screenshotsOldestFirst: readonly Screenshot[];
    if (requestedScreenshotIds !== undefined && requestedScreenshotIds.length > 0) {
      const resolved = requestedScreenshotIds
        .slice(0, SCREENSHOTS_PER_TURN)
        .map((id) => captureService.getById(id))
        .filter((s): s is Screenshot => s !== null);
      screenshotsOldestFirst = resolved;
    } else {
      const recentNewestFirst = captureService.getRecent(SCREENSHOTS_PER_TURN);
      screenshotsOldestFirst = [...recentNewestFirst].reverse();
    }

    const fitResult = fitTokenBudget({
      knowledgeApproxTokens,
      history,
      screenshots: screenshotsOldestFirst,
      userText: text,
    });

    for (const trim of fitResult.trims) {
      log.info('gemini.tokenBudgetTrim', {
        what: trim.what,
        id: trim.id,
        reclaimedTokens: trim.reclaimedTokens,
        remainingEstimate: trim.remainingEstimate,
      });
    }

    if (!fitResult.ok) {
      emit.error({
        variant: 'token-ceiling',
        approxTokens: fitResult.estimatedTokens,
        ceiling: fitResult.ceiling ?? 0,
      });
      return;
    }

    const userTurn = conv.appendUser({
      text,
      attachedScreenshotIds: fitResult.screenshots.map((s) => s.id),
      promptTokenEstimate: fitResult.estimatedTokens,
    });
    onUserTurnAppended(userTurn);
    emit.turnAppended(userTurn);

    emit.stateChanged('sending');
    emit.stateChanged('awaiting');

    const modelUserText = buildVisionAugmentedUserText(
      text,
      fitResult.screenshots.length,
      chartContext,
    );

    const ctrl = new AbortController();
    chatInflight.current = ctrl;

    let result;
    try {
      result = await gemini.send({
        userText: modelUserText,
        history: fitResult.history,
        screenshots: fitResult.screenshots,
        knowledgeChunks,
        signal: ctrl.signal,
      });
    } finally {
      if (chatInflight.current === ctrl) chatInflight.current = null;
    }

    if (result.ok) {
      const suggestionCount =
        result.turn.structured?.suggested_parameter_changes.length ?? 0;
      log.info('chat.tuningTurn', {
        suggestionCount,
        screenshotCount: fitResult.screenshots.length,
        chartContextUsed: chartContext !== undefined,
      });
      const assistantTurn = conv.appendAssistant({
        text: result.turn.text,
        ...(result.turn.structured !== undefined ? { structured: result.turn.structured } : {}),
        latencyMs: result.latencyMs,
        modelUsed: result.turn.modelUsed ?? '',
      });
      emit.turnAppended(assistantTurn);
      emit.stateChanged('idle');
      return;
    }

    conv.dropTurn(userTurn.id);
    emit.turnDropped(userTurn.id);
    switch (result.kind) {
      case 'no-api-key':
        emit.error({ variant: 'no-api-key' });
        return;
      case 'aborted':
        emit.stateChanged('idle');
        return;
      case 'timeout':
        emit.error({ variant: 'transient', reason: 'timeout', retryable: true });
        return;
      case 'transient':
        emit.error({ variant: 'transient', reason: result.reason, retryable: true });
        return;
      case 'fatal':
        emit.error({
          variant: 'fatal',
          reason: result.reason,
          ...(result.detail !== undefined ? { detail: result.detail } : {}),
        });
        return;
    }
  }

  return { runChatSend };
}
