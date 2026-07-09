/**
 * @file tests/chatOrchestrator.spec.ts
 *
 * Milestone 0 T0.3 + Milestone 1 — tests for `createChatOrchestrator`.
 * Covers trimmed/post-truncation history sent to `gemini.send`, error variants,
 * and FSM recovery when a dependency throws.
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
import type { DocChunk, KnowledgeStore } from '../src/shared/knowledgeTypes';
import type { ChatError, ChatState, ChatTurn, Screenshot } from '../src/shared/types';
import type { ChatOrchestratorDeps } from '../src/main/chatOrchestrator';

const SAMPLE_CHUNKS: DocChunk[] = [
  {
    id: 'test-about',
    pageSlug: 'market-wave-algorithm-setup-guide',
    pageTitle: 'Market Wave Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
    sectionPath: ['Market Wave Algorithm Setup Guide', 'About This Guide'],
    text: 'Behavioral summary for orchestrator tests.',
    imageUrls: [],
    tokenEstimate: 20,
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
  chunks: readonly DocChunk[] = SAMPLE_CHUNKS,
  retrieveImpl?: KnowledgeStore['retrieve'],
): KnowledgeStore {
  return {
    init: async () => {
      await Promise.resolve();
    },
    retrieve:
      retrieveImpl ??
      (async () => [...chunks]),
    getAllChunks: async () => [...chunks],
    version: async () => 'test-content-hash',
    getBundleInfo: async () => ({
      contentHash: 'test-content-hash',
      fetchedAt: '2026-07-09T00:00:00.000Z',
      pageCount: 1,
      totalTokenEstimate: 100,
    }),
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
  getActiveAlgorithm?: () => import('../src/shared/knowledgeTypes').ActiveAlgorithm;
  knowledgeStore?: KnowledgeStore;
  sendResult?: GeminiSendResult | ((args: GeminiSendArgs) => Promise<GeminiSendResult>);
  summarize?: (turns: readonly ChatTurn[]) => Promise<string | null>;
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
    chatInflight: { current: null },
    getActiveAlgorithm: overrides.getActiveAlgorithm ?? (() => 'market-wave'),
    emit: {
      turnAppended: (t) => {
        turns.push(t);
      },
      turnDropped: () => {},
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

describe('chatOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces no-api-key when the key is unset', async () => {
    const h = makeHarness({ getApiKey: () => null });
    await h.run('hello');
    expect(h.errors).toEqual([{ variant: 'no-api-key' }]);
    expect(h.sendCalls).toHaveLength(0);
  });

  it('loads corpus via getAllChunks and sends knowledgeBlocks to gemini', async () => {
    const getAllSpy = vi.fn(async () => [...SAMPLE_CHUNKS]);
    const store = makeKnowledgeStore(SAMPLE_CHUNKS);
    store.getAllChunks = getAllSpy;
    const h = makeHarness({ knowledgeStore: store });
    h.deps.conversationStore.appendAssistant({
      text: 'Try widening Sell Buffer.',
      structured: {
        schema_version: '3',
        analysis: 'Chop is elevated.',
        suggested_parameter_changes: [
          {
            parameter: 'Sell Buffer (%)',
            current_value: '0',
            suggested_value: '2',
            rationale: 'Widen no-action zone.',
            doc_ref: 'Market Wave → Buffers, Scope, and Timeframe',
          },
        ],
        talk_track: 'We can widen the sell buffer so it waits through chop.',
        confidence_score: 0.7,
        risk_notes: 'None.',
      },
      latencyMs: 10,
      modelUsed: 'test',
    });
    await h.run('I applied the change — screenshot attached');
    expect(getAllSpy).toHaveBeenCalled();
    expect(h.sendCalls[0]?.knowledgeBlocks).toBeDefined();
    expect(h.sendCalls[0]?.activeAlgorithm).toBe('market-wave');
  });

  it('passes persisted activeAlgorithm from getActiveAlgorithm()', async () => {
    const h = makeHarness({ getActiveAlgorithm: () => 'arbitrage' });
    await h.run('hello');
    expect(h.sendCalls[0]?.activeAlgorithm).toBe('arbitrage');
  });

  it('completes when structured output is absent', async () => {
    const h = makeHarness({
      sendResult: async () => makeSuccessSendResult('plain reply without structured block'),
    });
    await h.run('hello');
    expect(h.errors).toHaveLength(0);
    expect(h.turns).toHaveLength(2);
  });

  it('surfaces no-harness when knowledge getAllChunks throws', async () => {
    const store = makeKnowledgeStore(SAMPLE_CHUNKS);
    store.getAllChunks = async () => {
      throw new Error('disk missing');
    };
    const h = makeHarness({ knowledgeStore: store });
    await h.run('hello');
    expect(h.errors).toEqual([{ variant: 'no-harness' }]);
    expect(h.sendCalls).toHaveLength(0);
  });

  it('surfaces no-harness when corpus is empty', async () => {
    const h = makeHarness({
      knowledgeStore: makeKnowledgeStore([], async () => []),
    });
    await h.run('hello');
    expect(h.errors).toEqual([{ variant: 'no-harness' }]);
    expect(h.sendCalls).toHaveLength(0);
  });

  it('surfaces token-ceiling when the hard ceiling is exceeded', async () => {
    const hugeChunk: DocChunk = {
      ...SAMPLE_CHUNKS[0]!,
      text: 'x'.repeat(400_000),
      tokenEstimate: Math.ceil(400_000 / 3.8),
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

  describe('H1 fix — token-budget trims applied to send', () => {
    it('passes fitResult.history (trimmed) to gemini.send', async () => {
      // Stay under HARD_CEILING (80k) but over SOFT_CEILING (40k) so trim runs.
      const longText = 'x'.repeat(3_000);
      const history: ChatTurn[] = [];
      for (let i = 0; i < 30; i++) {
        history.push(userTurn(`u${String(i)}`, longText));
        history.push(assistantTurn(`a${String(i)}`, longText));
      }

      // Knowledge floor under soft ceiling; long history forces oldest-pair trims.
      const knowledgeChunks = SAMPLE_CHUNKS;
      const knowledgeApproxTokens = estimateKnowledgeContextTokens(knowledgeChunks);
      const fitResult = fitTokenBudget({
        knowledgeApproxTokens,
        history,
        screenshots: [],
        userText: 'go',
      });
      expect(fitResult.ok).toBe(true);
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
      // Orchestrator must apply token-budget trims (not the full pre-send history).
      expect(h.sendCalls[0]?.history.length).toBeLessThan(history.length);
      expect(h.sendCalls[0]?.history.length).toBeLessThanOrEqual(fitResult.history.length);
    });
  });

  describe('H2 fix — post-truncation history sent', () => {
    it('passes post-maybeTruncate history to gemini.send', async () => {
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
      // Send uses pre-append history (this turn's user + assistant are not included).
      const historyAtSendTime = postSendHistory.length - 2;
      expect(h.sendCalls[0]?.history.length).toBeLessThanOrEqual(historyAtSendTime);
      expect(h.sendCalls[0]?.history[0]?.role).toBe('system-summary');
    });
  });

  describe('H4 fix — orchestrator never wedges the FSM', () => {
    it('surfaces fatal and returns to idle when gemini.send throws a non-Error value', async () => {
      const dropped: string[] = [];
      const h = makeHarness({
        sendResult: async () => {
          throw 'string failure';
        },
      });
      h.deps.emit.turnDropped = (id) => {
        dropped.push(id);
      };
      await h.run('hello');
      expect(dropped).toHaveLength(1);
      expect(h.errors).toEqual([
        {
          variant: 'fatal',
          reason: 'orchestrator',
          detail: { message: 'string failure' },
        },
      ]);
    });

    it('surfaces no-harness when knowledge getAllChunks throws a non-Error value', async () => {
      const store = makeKnowledgeStore(SAMPLE_CHUNKS);
      store.getAllChunks = async () => {
        throw 'disk missing';
      };
      const h = makeHarness({ knowledgeStore: store });
      await h.run('hello');
      expect(h.errors).toEqual([{ variant: 'no-harness' }]);
    });

    it('surfaces fatal and returns to idle when gemini.send throws', async () => {
      const dropped: string[] = [];
      const h = makeHarness({
        sendResult: async () => {
          throw new Error('unexpected sdk failure');
        },
      });
      h.deps.emit.turnDropped = (id) => {
        dropped.push(id);
      };
      await h.run('hello');
      expect(dropped).toHaveLength(1);
      expect(h.errors).toEqual([
        {
          variant: 'fatal',
          reason: 'orchestrator',
          detail: { message: 'unexpected sdk failure' },
        },
      ]);
      expect(h.states[h.states.length - 1]).toBe('idle');
      expect(h.deps.conversationStore.getHistory()).toHaveLength(0);
    });

    it('surfaces fatal when screenshot resolution throws before send', async () => {
      const h = makeHarness({
        screenshots: [fakeScreenshot('cap-1')],
      });
      h.deps.screenshotService.getRecent = () => {
        throw new Error('capture service failed');
      };
      await h.run('hello');
      expect(h.errors[0]?.variant).toBe('fatal');
      expect(h.states[h.states.length - 1]).toBe('idle');
      expect(h.sendCalls).toHaveLength(0);
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

    it('surfaces fatal without detail when omitted', async () => {
      const h = makeHarness({
        sendResult: async () => ({
          ok: false,
          kind: 'fatal',
          reason: 'safety',
          latencyMs: 200,
        }),
      });
      await h.run('hello');
      expect(h.errors).toEqual([{ variant: 'fatal', reason: 'safety' }]);
    });
  });

  it('logs tuning metrics when structured suggestions are returned', async () => {
    const h = makeHarness({
      sendResult: async () => ({
        ...makeSuccessSendResult(),
        turn: {
          ...makeSuccessSendResult().turn,
          structured: {
            schema_version: '3',
            analysis: 'Try raising Sell Buffer on the Inputs tab.',
            suggested_parameter_changes: [
              {
                parameter: 'Sell Buffer (%)',
                current_value: null,
                suggested_value: '2',
                rationale: 'Widen no-action zone.',
                doc_ref: 'Market Wave → Buffers, Scope, and Timeframe',
              },
            ],
            talk_track: 'We can widen the sell buffer so it waits through chop.',
            confidence_score: 0.8,
            risk_notes: 'None.',
          },
        },
      }),
    });
    await h.run('tighten stop');
    expect(h.turns).toHaveLength(2);
  });

  it('broadcasts turnDropped when send fails after the user turn was appended', async () => {
    const dropped: string[] = [];
    const h = makeHarness({
      sendResult: async () => ({ ok: false, kind: 'timeout', latencyMs: 30_000 }),
    });
    h.deps.emit.turnDropped = (id) => {
      dropped.push(id);
    };
    await h.run('hello');
    expect(dropped).toHaveLength(1);
    expect(h.turns).toHaveLength(1);
    expect(h.deps.conversationStore.getHistory()).toHaveLength(0);
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
