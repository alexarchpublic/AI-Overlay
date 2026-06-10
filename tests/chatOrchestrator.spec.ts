/**
 * @file tests/chatOrchestrator.spec.ts
 *
 * Milestone 0 T0.3 — characterization tests for `createChatOrchestrator`.
 * Pins current behavior, including the known H1/H2 defects (untrimmed and
 * pre-truncation history sent to `gemini.send`). Milestone 1 flips these
 * assertions after the fixes land.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatOrchestrator } from '../src/main/chatOrchestrator';
import { createConversationStore } from '../src/main/conversationStore';
import { fit as fitTokenBudget } from '../src/main/tokenBudget';
import {
  HARD_CEILING_TOKENS,
  HISTORY_TRUNCATE_AT_PAIRS,
  SOFT_CEILING_TOKENS,
} from '../src/shared/aiConstants';
import { estimateKnowledgeContextTokens } from '../src/shared/knowledge/promptContext';
import type { GeminiSendArgs, GeminiSendResult } from '../src/main/geminiService';
import type { AbstractionChunk, KnowledgeStore } from '../src/shared/knowledgeTypes';
import type { ChatError, ChatState, ChatTurn, Screenshot } from '../src/shared/types';
import type { ChatOrchestratorDeps } from '../src/main/chatOrchestrator';

const SAMPLE_CHUNKS: AbstractionChunk[] = [
  {
    id: 'test-contract',
    strategyId: 'test-strategy',
    kind: 'contract',
    text: 'Behavioral summary for orchestrator tests.',
    version: '1',
  },
];

function makeLogger(): ChatOrchestratorDeps['logger'] {
  const make = (): ChatOrchestratorDeps['logger'] => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => make(),
    raw: {},
  });
  return make();
}

function userTurn(id: string, text: string): ChatTurn {
  return {
    id,
    role: 'user',
    text,
    attachedScreenshotIds: [],
    createdAt: 0,
  };
}

function assistantTurn(id: string, text: string): ChatTurn {
  return {
    id,
    role: 'assistant',
    text,
    attachedScreenshotIds: [],
    createdAt: 0,
    latencyMs: 0,
    modelUsed: 'test-model',
  };
}

function fakeScreenshot(id: string): Screenshot {
  return {
    id,
    timestamp: 0,
    filepath: `/tmp/${id}.jpg`,
    regionId: 'region',
    width: 1024,
    height: 768,
    bytes: 50_000,
  };
}

function makeKnowledgeStore(
  chunks: readonly AbstractionChunk[] = SAMPLE_CHUNKS,
  retrieveImpl?: KnowledgeStore['retrieve'],
): KnowledgeStore {
  return {
    init: async () => {
      await Promise.resolve();
    },
    retrieve:
      retrieveImpl ??
      (async () => [...chunks]),
    version: async () => 'test-content-hash',
  };
}

function makeSuccessSendResult(text = 'assistant reply'): GeminiSendResult {
  const turn: ChatTurn = {
    id: 'asst-1',
    role: 'assistant',
    text,
    attachedScreenshotIds: [],
    createdAt: 1,
    latencyMs: 42,
    modelUsed: 'gemini-test',
  };
  return {
    ok: true,
    turn,
    raw: {} as GeminiSendResult extends { ok: true; raw: infer R } ? R : never,
    promptHash: 'hash',
    promptTokenEstimate: 100,
    latencyMs: 42,
  };
}

interface Harness {
  deps: ChatOrchestratorDeps;
  states: ChatState[];
  errors: ChatError[];
  turns: ChatTurn[];
  sendCalls: GeminiSendArgs[];
  run: (text: string, screenshotIds?: readonly string[]) => Promise<void>;
}

function makeHarness(overrides: {
  getApiKey?: () => string | null;
  knowledgeStore?: KnowledgeStore;
  sendResult?: GeminiSendResult | ((args: GeminiSendArgs) => Promise<GeminiSendResult>);
  summarize?: (turns: readonly ChatTurn[]) => Promise<string | null>;
  enumerationBlocked?: boolean;
  screenshots?: readonly Screenshot[];
} = {}): Harness {
  const logger = makeLogger();
  const conversationStore = createConversationStore({ logger });
  conversationStore.startSession();

  const states: ChatState[] = [];
  const errors: ChatError[] = [];
  const turns: ChatTurn[] = [];
  const sendCalls: GeminiSendArgs[] = [];

  const sendImpl =
    typeof overrides.sendResult === 'function'
      ? overrides.sendResult
      : async () => overrides.sendResult ?? makeSuccessSendResult();

  const deps: ChatOrchestratorDeps = {
    logger,
    aiStore: { getApiKey: overrides.getApiKey ?? (() => 'test-key') },
    conversationStore,
    geminiService: {
      send: async (args) => {
        sendCalls.push(args);
        return sendImpl(args);
      },
      summarize: overrides.summarize ?? (async () => 'summary'),
      buildSystemPrompt: () => 'prompt',
      invalidateSystemPromptCache: () => undefined,
      cancelAll: () => undefined,
      hashPrompt: () => 'hash',
    },
    knowledgeStore: overrides.knowledgeStore ?? makeKnowledgeStore(),
    screenshotService: {
      getRecent: () => overrides.screenshots ?? [],
      getById: (id) => overrides.screenshots?.find((s) => s.id === id) ?? null,
    } as ChatOrchestratorDeps['screenshotService'],
    enumerationMonitor: {
      assessBeforeSend: () =>
        overrides.enumerationBlocked
          ? { blocked: true, score: 80, reasons: ['probe'], cooldownMs: 60_000 }
          : { blocked: false, score: 0, reasons: [], cooldownMs: 0 },
      recordSendStarted: vi.fn(),
      recordTuningResponse: vi.fn(),
      getScore: () => 0,
      reset: vi.fn(),
    },
    chatInflight: { current: null },
    emit: {
      turnAppended: (t) => {
        turns.push(t);
      },
      stateChanged: (s) => {
        states.push(s);
      },
      error: (e) => {
        errors.push(e);
      },
    },
  };

  const { runChatSend } = createChatOrchestrator(deps);
  return {
    deps,
    states,
    errors,
    turns,
    sendCalls,
    run: runChatSend,
  };
}

describe('chatOrchestrator characterization (Milestone 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces no-api-key when the key is unset', async () => {
    const h = makeHarness({ getApiKey: () => null });
    await h.run('hello');
    expect(h.errors).toEqual([{ variant: 'no-api-key' }]);
    expect(h.sendCalls).toHaveLength(0);
  });

  it('surfaces enumeration-throttled when the monitor blocks', async () => {
    const h = makeHarness({ enumerationBlocked: true });
    await h.run('hello');
    expect(h.errors).toEqual([
      { variant: 'enumeration-throttled', score: 80, cooldownMs: 60_000 },
    ]);
    expect(h.sendCalls).toHaveLength(0);
  });

  it('surfaces no-harness when knowledge retrieve throws', async () => {
    const h = makeHarness({
      knowledgeStore: makeKnowledgeStore(SAMPLE_CHUNKS, async () => {
        throw new Error('disk missing');
      }),
    });
    await h.run('hello');
    expect(h.errors).toEqual([{ variant: 'no-harness' }]);
    expect(h.sendCalls).toHaveLength(0);
  });

  it('surfaces no-harness when retrieve returns zero chunks', async () => {
    const h = makeHarness({
      knowledgeStore: makeKnowledgeStore([], async () => []),
    });
    await h.run('hello');
    expect(h.errors).toEqual([{ variant: 'no-harness' }]);
    expect(h.sendCalls).toHaveLength(0);
  });

  it('surfaces token-ceiling when the hard ceiling is exceeded', async () => {
    const hugeChunk: AbstractionChunk = {
      ...SAMPLE_CHUNKS[0],
      text: 'x'.repeat(6_000_000),
    };
    const h = makeHarness({
      knowledgeStore: makeKnowledgeStore([hugeChunk]),
    });
    await h.run('hello');
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.variant).toBe('token-ceiling');
    if (h.errors[0]?.variant === 'token-ceiling') {
      expect(h.errors[0].ceiling).toBe(HARD_CEILING_TOKENS);
    }
    expect(h.sendCalls).toHaveLength(0);
  });

  it('happy path appends turns and returns to idle', async () => {
    const h = makeHarness();
    await h.run('what is the signal?');
    expect(h.errors).toHaveLength(0);
    expect(h.sendCalls).toHaveLength(1);
    expect(h.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(h.states).toContain('sending');
    expect(h.states).toContain('awaiting');
    expect(h.states[h.states.length - 1]).toBe('idle');
  });

  describe('known defect H1 — token-budget trims logged but not sent', () => {
    it('passes the pre-trim history snapshot to gemini.send', async () => {
      const longText = 'x'.repeat(40_000);
      const history: ChatTurn[] = [];
      for (let i = 0; i < 20; i++) {
        history.push(userTurn(`u${String(i)}`, longText));
        history.push(assistantTurn(`a${String(i)}`, longText));
      }

      const knowledgeChunks = [
        {
          ...SAMPLE_CHUNKS[0],
          text: 'k'.repeat(100),
        },
      ];
      const knowledgeApproxTokens = estimateKnowledgeContextTokens(knowledgeChunks);
      const fitResult = fitTokenBudget({
        knowledgeApproxTokens: SOFT_CEILING_TOKENS - 100_000,
        history,
        screenshots: [],
        userText: 'go',
      });
      expect(fitResult.trims.length).toBeGreaterThan(0);
      expect(fitResult.history.length).toBeLessThan(history.length);

      const h = makeHarness({
        knowledgeStore: makeKnowledgeStore(knowledgeChunks),
      });
      for (const turn of history) {
        if (turn.role === 'user') {
          h.deps.conversationStore.appendUser({
            text: turn.text,
            attachedScreenshotIds: [],
            promptTokenEstimate: 0,
          });
        } else {
          h.deps.conversationStore.appendAssistant({
            text: turn.text,
            latencyMs: 0,
            modelUsed: 'test',
          });
        }
      }

      await h.run('go');

      expect(h.sendCalls).toHaveLength(1);
      // Defect: send receives the full pre-trim history, not fitResult.history.
      expect(h.sendCalls[0]?.history.length).toBe(history.length);
      expect(h.sendCalls[0]?.history.length).toBeGreaterThan(fitResult.history.length);
    });
  });

  describe('known defect H2 — stale pre-truncation history sent', () => {
    it('passes the pre-maybeTruncate history snapshot to gemini.send', async () => {
      const h = makeHarness({
        summarize: async (older) => `summary of ${String(older.length)} turns`,
      });

      for (let i = 0; i < HISTORY_TRUNCATE_AT_PAIRS + 1; i++) {
        h.deps.conversationStore.appendUser({
          text: `u${String(i)}`,
          attachedScreenshotIds: [],
          promptTokenEstimate: 0,
        });
        h.deps.conversationStore.appendAssistant({
          text: `a${String(i)}`,
          latencyMs: 0,
          modelUsed: 'test',
        });
      }

      const preSendHistory = h.deps.conversationStore.getHistory();
      expect(preSendHistory.length).toBe(2 * (HISTORY_TRUNCATE_AT_PAIRS + 1));

      await h.run('next question');

      const postSendHistory = h.deps.conversationStore.getHistory();
      expect(postSendHistory[0]?.role).toBe('system-summary');
      expect(postSendHistory.length).toBeLessThan(preSendHistory.length);

      expect(h.sendCalls).toHaveLength(1);
      // Defect: send still carries the stale pre-truncation snapshot.
      expect(h.sendCalls[0]?.history.length).toBe(preSendHistory.length);
      expect(h.sendCalls[0]?.history[0]?.role).toBe('user');
    });
  });

  describe('gemini.send error variants', () => {
    it('surfaces no-api-key from the send result', async () => {
      const h = makeHarness({
        sendResult: async () => ({ ok: false, kind: 'no-api-key' }),
      });
      await h.run('hello');
      expect(h.errors).toEqual([{ variant: 'no-api-key' }]);
      // User turn was pushed to the UI before send; dropTurn clears main history.
      expect(h.deps.conversationStore.getHistory()).toHaveLength(0);
    });

    it('returns to idle on aborted without surfacing an error', async () => {
      const h = makeHarness({
        sendResult: async () => ({ ok: false, kind: 'aborted' }),
      });
      await h.run('hello');
      expect(h.errors).toHaveLength(0);
      expect(h.states[h.states.length - 1]).toBe('idle');
    });

    it('surfaces transient timeout', async () => {
      const h = makeHarness({
        sendResult: async () => ({ ok: false, kind: 'timeout', latencyMs: 30_000 }),
      });
      await h.run('hello');
      expect(h.errors).toEqual([
        { variant: 'transient', reason: 'timeout', retryable: true },
      ]);
    });

    it('surfaces transient with the SDK reason', async () => {
      const h = makeHarness({
        sendResult: async () => ({
          ok: false,
          kind: 'transient',
          reason: '503 unavailable',
          latencyMs: 100,
        }),
      });
      await h.run('hello');
      expect(h.errors).toEqual([
        { variant: 'transient', reason: '503 unavailable', retryable: true },
      ]);
    });

    it('surfaces fatal with reason and detail', async () => {
      const h = makeHarness({
        sendResult: async () => ({
          ok: false,
          kind: 'fatal',
          reason: 'invalid-json',
          detail: { parseError: true },
          latencyMs: 200,
        }),
      });
      await h.run('hello');
      expect(h.errors).toEqual([
        {
          variant: 'fatal',
          reason: 'invalid-json',
          detail: { parseError: true },
        },
      ]);
    });
  });

  it('honors explicit screenshot attachments over the ring buffer', async () => {
    const attached = fakeScreenshot('attached-1');
    const recent = fakeScreenshot('recent-1');
    const h = makeHarness({
      screenshots: [attached, recent],
      sendResult: async (args) => {
        expect(args.screenshots.map((s) => s.id)).toEqual(['attached-1']);
        return makeSuccessSendResult();
      },
    });
    await h.run('with attachment', ['attached-1', 'missing-id']);
    expect(h.sendCalls).toHaveLength(1);
  });
});
