/**
 * @file tests/geminiService.spec.ts
 *
 * Why it exists: PRD §5 DoD #25 — `buildSystemPrompt` composition order +
 * determinism (mocked SDK), and the JSON-mode parse / retry / fatal paths.
 *
 * The Gemini SDK is injected via `sdkFactory` so no network call is made.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGeminiService } from '../src/main/geminiService';
import { PERSONA_PROMPT } from '../src/shared/persona';
import { KNOWLEDGE_CONTEXT_OPENER } from '../src/shared/knowledgeConstants';
import { OUTPUT_SCHEMA_INSTRUCTIONS } from '../src/shared/aiSchema';
import type { DocChunk, KnowledgeStore } from '../src/shared/knowledgeTypes';
import type { ChatTurn } from '../src/shared/types';

const SAMPLE_CHUNKS: DocChunk[] = [
  {
    id: 'test-about',
    pageSlug: 'market-wave-algorithm-setup-guide',
    pageTitle: 'Market Wave Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
    sectionPath: ['Market Wave Algorithm Setup Guide', 'About This Guide'],
    text: 'Behavioral summary for gemini tests.',
    imageUrls: [],
    tokenEstimate: 20,
  },
];

function makeLogger(): {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  child: () => ReturnType<typeof makeLogger>;
  raw: object;
} {
  const make = (): ReturnType<typeof makeLogger> => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => make(),
    raw: {},
  });
  return make();
}

function makeKnowledgeStore(chunks: readonly DocChunk[] = SAMPLE_CHUNKS): KnowledgeStore {
  return {
    init: async () => {
      await Promise.resolve();
    },
    retrieve: async () => [...chunks],
    getAllChunks: async () => [...chunks],
    version: async () => 'test-content-hash',
  };
}

function makeFakeSdk(
  responseText: string,
  options: { throwOnce?: Error } = {},
): { factory: Parameters<typeof createGeminiService>[0]['sdkFactory']; calls: { count: number } } {
  const calls = { count: 0 };
  let thrown = false;
  const factory: Parameters<typeof createGeminiService>[0]['sdkFactory'] = () => ({
    getGenerativeModel: () => ({
      generateContent: async () => {
        calls.count++;
        if (options.throwOnce && !thrown) {
          thrown = true;
          throw options.throwOnce;
        }
        return Promise.resolve({
          response: {
            candidates: [
              {
                content: { parts: [{ text: responseText }], role: 'model' },
                finishReason: 'STOP' as never,
                safetyRatings: [],
              },
            ],
            text: () => responseText,
            functionCall: () => undefined,
            functionCalls: () => undefined,
          },
        });
      },
    }),
  });
  return { factory, calls };
}

function makeService(
  overrides: Partial<Parameters<typeof createGeminiService>[0]> = {},
): ReturnType<typeof createGeminiService> {
  return createGeminiService({
    logger: makeLogger(),
    knowledgeStore: makeKnowledgeStore(),
    getApiKey: () => 'test-key',
    getModel: () => 'gemini-3.1-flash-lite-preview',
    recordCall: vi.fn(),
    ...overrides,
  });
}

function v3Payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: '3',
    analysis: 'looks bullish',
    suggested_parameter_changes: [
      {
        parameter: 'Sell Buffer (%)',
        current_value: '0',
        suggested_value: '2',
        rationale: 'widen no-action zone in chop',
        doc_ref: 'Market Wave → Buffers, Scope, and Timeframe',
      },
    ],
    talk_track: 'We can widen the sell buffer so the algo waits through chop.',
    confidence_score: 0.82,
    risk_notes: 'pinched buffers can flip edges',
    ...overrides,
  });
}

describe('geminiService.buildSystemPrompt', () => {
  it('composes persona + scoped knowledge + schema instructions in PRD D4 order', () => {
    const svc = makeService();
    const prompt = svc.buildSystemPrompt(SAMPLE_CHUNKS);
    const personaIdx = prompt.indexOf(PERSONA_PROMPT);
    const knowledgeIdx = prompt.indexOf(KNOWLEDGE_CONTEXT_OPENER);
    const schemaIdx = prompt.indexOf(OUTPUT_SCHEMA_INSTRUCTIONS);
    expect(personaIdx).toBe(0);
    expect(knowledgeIdx).toBeGreaterThan(personaIdx);
    expect(schemaIdx).toBeGreaterThan(knowledgeIdx);
    expect(prompt).toContain('Behavioral summary for gemini tests.');
  });

  it('snapshots the composed system prompt for review drift detection', () => {
    const svc = makeService();
    const prompt = svc.buildSystemPrompt(SAMPLE_CHUNKS);
    expect(prompt).toMatchSnapshot();
  });

  it('embeds the internal co-pilot persona (no zero-leakage boundary)', () => {
    const svc = makeService();
    const prompt = svc.buildSystemPrompt(SAMPLE_CHUNKS);
    expect(prompt).toContain('internal sales and customer-success');
    expect(prompt).toContain('never promise returns or performance');
    expect(prompt).not.toContain('Zero-leakage boundary');
  });

  it('returns deterministic output for the same chunks', () => {
    const svc = makeService();
    const a = svc.buildSystemPrompt(SAMPLE_CHUNKS);
    const b = svc.buildSystemPrompt(SAMPLE_CHUNKS);
    expect(svc.hashPrompt(a)).toBe(svc.hashPrompt(b));
  });

  it('changes when retrieved chunks change', () => {
    const svc = makeService();
    const before = svc.hashPrompt(svc.buildSystemPrompt(SAMPLE_CHUNKS));
    const after = svc.hashPrompt(
      svc.buildSystemPrompt([
        {
          ...SAMPLE_CHUNKS[0]!,
          text: 'Updated behavioral summary.',
        },
      ]),
    );
    expect(after).not.toBe(before);
  });

  it('invalidateSystemPromptCache clears the bundle/algorithm cache', () => {
    const svc = makeService();
    const before = svc.buildSystemPrompt(SAMPLE_CHUNKS, {
      bundleVersion: 'v1',
      activeAlgorithm: 'market-wave',
    });
    svc.invalidateSystemPromptCache();
    const after = svc.buildSystemPrompt(SAMPLE_CHUNKS, {
      bundleVersion: 'v1',
      activeAlgorithm: 'market-wave',
    });
    expect(after).toBe(before);
  });
});

describe('geminiService.send', () => {
  it('returns no-api-key when getApiKey returns null', async () => {
    const svc = makeService({ getApiKey: () => null });
    const result = await svc.send({
      userText: 'hi',
      history: [],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('no-api-key');
  });

  it('parses a happy-path JSON response into AnalysisResponse', async () => {
    const recordCall = vi.fn();
    const { factory, calls } = makeFakeSdk(v3Payload());
    const svc = makeService({ recordCall, sdkFactory: factory });
    const result = await svc.send({
      userText: 'current signal?',
      history: [],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.turn.structured?.confidence_score).toBeCloseTo(0.82);
      expect(result.turn.structured?.talk_track).toContain('sell buffer');
      expect(result.turn.structured?.suggested_parameter_changes).toHaveLength(1);
      expect(result.turn.structured?.suggested_parameter_changes[0]?.doc_ref).toContain(
        'Buffers',
      );
    }
    expect(calls.count).toBe(1);
    expect(recordCall).toHaveBeenCalledWith(expect.objectContaining({ jsonOk: true }));
  });

  it('strips a leading ```json fence before parsing', async () => {
    const fenced = '```json\n' + v3Payload({ analysis: 'OK', suggested_parameter_changes: [] }) + '\n```';
    const { factory } = makeFakeSdk(fenced);
    const svc = makeService({ sdkFactory: factory });
    const result = await svc.send({
      userText: 'q',
      history: [],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
  });

  it('retries once with the JSON reminder on parse failure', async () => {
    let attempt = 0;
    const factory: Parameters<typeof createGeminiService>[0]['sdkFactory'] = () => ({
      getGenerativeModel: () => ({
        generateContent: async () => {
          attempt++;
          const text =
            attempt === 1
              ? 'sorry, no JSON for you'
              : v3Payload({
                  analysis: 'now valid',
                  suggested_parameter_changes: [],
                  confidence_score: 0.4,
                  risk_notes: 'low confidence',
                });
          return Promise.resolve({
            response: {
              candidates: [
                {
                  content: { parts: [{ text }], role: 'model' },
                  finishReason: 'STOP' as never,
                  safetyRatings: [],
                },
              ],
              text: () => text,
              functionCall: () => undefined,
              functionCalls: () => undefined,
            },
          });
        },
      }),
    });
    const recordCall = vi.fn();
    const svc = makeService({ recordCall, sdkFactory: factory });
    const result = await svc.send({
      userText: 'hi',
      history: [] as ChatTurn[],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    expect(attempt).toBe(2);
    expect(recordCall).toHaveBeenCalledWith(expect.objectContaining({ jsonOk: true }));
  });

  it('returns fatal invalid-json after both retries fail', async () => {
    const { factory } = makeFakeSdk('still not json');
    const svc = makeService({ sdkFactory: factory });
    const result = await svc.send({
      userText: 'q',
      history: [],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('fatal');
      if (result.kind === 'fatal') expect(result.reason).toBe('invalid-json');
    }
  });

  it('rejects legacy schema v2 responses', async () => {
    const legacy = JSON.stringify({
      schema_version: '2',
      analysis: 'legacy',
      suggested_parameter_changes: [
        {
          parameter: 'volatility_filter',
          direction: 'increase',
          suggested_value: '0.7',
          chart_context: 'choppy',
          rationale: 'old shape',
        },
      ],
      confidence_score: 0.5,
      risk_notes: 'none',
    });
    const { factory } = makeFakeSdk(legacy);
    const svc = makeService({ sdkFactory: factory });
    const result = await svc.send({
      userText: 'q',
      history: [],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('fatal');
      if (result.kind === 'fatal') expect(result.reason).toBe('invalid-json');
    }
  });

  it('returns model output directly without output gating', async () => {
    const toxic = v3Payload({
      analysis: 'The algorithm default Sell Buffer is 0.',
      suggested_parameter_changes: [],
    });
    const { factory, calls } = makeFakeSdk(toxic);
    const recordCall = vi.fn();
    const svc = makeService({ recordCall, sdkFactory: factory });
    const result = await svc.send({
      userText: 'what is the sell buffer default?',
      history: [],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    expect(calls.count).toBe(1);
    if (result.ok) {
      expect(result.turn.text).toContain('Sell Buffer');
      expect(recordCall).toHaveBeenCalledWith(
        expect.objectContaining({ jsonOk: true }),
      );
    }
  });

  it('aborts when the caller signal is aborted before send', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { factory } = makeFakeSdk(v3Payload({ analysis: 'a', suggested_parameter_changes: [] }));
    const svc = makeService({ sdkFactory: factory });
    const result = await svc.send({
      userText: 'q',
      history: [],
      screenshots: [],
      knowledgeChunks: SAMPLE_CHUNKS,
      signal: ctrl.signal,
    });
    if (!result.ok) expect(result.kind).toBe('aborted');
  });
});
