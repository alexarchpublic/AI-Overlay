/**
 * @file tests/geminiToolLoop.spec.ts
 *
 * Coverage for the bounded Gemini tool loop (PRD_Optimizer_MCP_Integration
 * D-M6/D-M7): 0/1/2 tool-call rounds, the round cap, malformed functionCall
 * parts, engine-error feedback, and — critically — that a disabled loop
 * leaves the send path byte-identical (prompt + single call, no tools).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createGeminiService,
  OPTIMIZER_TOOL_INSTRUCTIONS,
} from '../src/main/geminiService';
import type { GeminiSdkLike } from '../src/main/geminiService';
import { OPTIMIZER_MAX_TOOL_ROUNDTRIPS } from '../src/shared/optimizerTypes';
import type { OptimizerToolResult } from '../src/shared/optimizerTypes';
import type { DocChunk, KnowledgeStore } from '../src/shared/knowledgeTypes';
import type { AppLogger } from '../src/main/logger';

const SAMPLE_CHUNKS: DocChunk[] = [
  {
    id: 'test-chunk',
    pageSlug: 'market-wave-algorithm-setup-guide',
    pageTitle: 'Market Wave Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/x.md',
    sectionPath: ['Guide'],
    text: 'Behavioral summary for tool loop tests.',
    imageUrls: [],
    tokenEstimate: 20,
  },
];

function makeLogger(): AppLogger {
  const make = (): AppLogger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => make(),
    raw: {} as AppLogger['raw'],
  });
  return make();
}

function makeKnowledgeStore(): KnowledgeStore {
  return {
    init: async () => undefined,
    retrieve: async () => [...SAMPLE_CHUNKS],
    getAllChunks: async () => [...SAMPLE_CHUNKS],
    version: async () => 'hash',
    getBundleInfo: async () => ({
      contentHash: 'hash',
      fetchedAt: '2026-08-14T00:00:00.000Z',
      pageCount: 1,
      totalTokenEstimate: 100,
    }),
  };
}

function v3(): string {
  return JSON.stringify({
    schema_version: '3',
    analysis: 'computed answer',
    suggested_parameter_changes: [],
    talk_track: 'talk',
    confidence_score: 0.8,
    risk_notes: 'risk',
  });
}

interface Scripted {
  functionCalls?: Array<{ name?: string; args?: unknown }>;
  text?: string;
}

/**
 * Scriptable SDK: each generateContent call consumes the next scripted
 * response. Captures every getGenerativeModel params object and every
 * request so assertions can inspect prompts/tools/contents.
 */
function makeScriptedSdk(script: Scripted[]): {
  factory: (apiKey: string) => GeminiSdkLike;
  modelParams: Array<Record<string, unknown>>;
  requests: Array<{ contents: Array<Record<string, unknown>> }>;
} {
  const modelParams: Array<Record<string, unknown>> = [];
  const requests: Array<{ contents: Array<Record<string, unknown>> }> = [];
  const queue = [...script];
  const factory = (): GeminiSdkLike => ({
    getGenerativeModel: (params) => {
      modelParams.push(params as unknown as Record<string, unknown>);
      return {
        generateContent: async (request) => {
          requests.push(request as { contents: Array<Record<string, unknown>> });
          const next = queue.shift() ?? { text: v3() };
          const parts: Array<Record<string, unknown>> = [];
          for (const fc of next.functionCalls ?? []) {
            // Real Gemini 3.x responses carry a thoughtSignature on each
            // functionCall part; the loop must echo it back verbatim.
            parts.push({
              functionCall: fc,
              thoughtSignature: `sig-${typeof fc.name === 'string' ? fc.name : 'x'}`,
            });
          }
          if (next.text !== undefined) parts.push({ text: next.text });
          return {
            response: {
              candidates: [
                { content: { parts, role: 'model' }, finishReason: 'STOP', safetyRatings: [] },
              ],
            },
          } as never;
        },
      };
    },
  });
  return { factory, modelParams, requests };
}

const DECLS = [
  { name: 'list_capabilities', description: 'caps', parameters: { type: 'OBJECT', properties: { note: { type: 'STRING' } } } },
  { name: 'backtest', description: 'bt', parameters: { type: 'OBJECT', properties: { ticker: { type: 'STRING' } } } },
];

function makeOptimizer(
  results: Record<string, OptimizerToolResult>,
): {
  hooks: NonNullable<Parameters<typeof createGeminiService>[0]['optimizer']>;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    hooks: {
      getFunctionDeclarations: async () => DECLS,
      callTool: async (tool, args) => {
        calls.push({ tool, args });
        return (
          results[tool] ?? {
            ok: true,
            tool,
            raw: {},
            summary: { tool, label: `${tool}: NVDA 1d`, resultSummary: '{"sharpe":1.2}', durationMs: 5, ok: true },
          }
        );
      },
    },
  };
}

function makeService(
  sdk: { factory: (apiKey: string) => GeminiSdkLike },
  optimizer?: Parameters<typeof createGeminiService>[0]['optimizer'],
): ReturnType<typeof createGeminiService> {
  return createGeminiService({
    logger: makeLogger(),
    knowledgeStore: makeKnowledgeStore(),
    getApiKey: () => 'test-key',
    getModel: () => 'gemini-3.1-flash-lite-preview',
    recordCall: vi.fn(),
    ...(optimizer !== undefined ? { optimizer } : {}),
    sdkFactory: sdk.factory,
  });
}

const SEND_ARGS = {
  userText: 'backtest NVDA on 1d and tell me if it beat buy-and-hold',
  history: [],
  screenshots: [],
  knowledgeChunks: SAMPLE_CHUNKS,
  signal: new AbortController().signal,
} as const;

describe('gemini tool loop', () => {
  it('disabled (no optimizer dep): one call, no tools, unmodified prompt', async () => {
    const sdk = makeScriptedSdk([{ text: v3() }]);
    const svc = makeService(sdk);
    const result = await svc.send({ ...SEND_ARGS });
    expect(result.ok).toBe(true);
    expect(sdk.requests).toHaveLength(1);
    expect(sdk.modelParams).toHaveLength(1);
    expect(sdk.modelParams[0]?.tools).toBeUndefined();
    const sys = (sdk.modelParams[0]?.systemInstruction as { parts: Array<{ text: string }> }).parts[0]?.text ?? '';
    expect(sys).not.toContain('LIVE OPTIMIZER TOOLS');
    if (result.ok) expect(result.toolCalls).toBeUndefined();
  });

  it('disabled via null declarations: identical prompt bytes to no-dep path', async () => {
    const sdkA = makeScriptedSdk([{ text: v3() }]);
    const svcA = makeService(sdkA);
    await svcA.send({ ...SEND_ARGS });

    const sdkB = makeScriptedSdk([{ text: v3() }]);
    const svcB = makeService(sdkB, {
      getFunctionDeclarations: async () => null,
      callTool: async () => ({ ok: false, kind: 'not-configured' }),
    });
    await svcB.send({ ...SEND_ARGS });

    const sysA = (sdkA.modelParams[0]?.systemInstruction as { parts: Array<{ text: string }> }).parts[0]?.text;
    const sysB = (sdkB.modelParams[0]?.systemInstruction as { parts: Array<{ text: string }> }).parts[0]?.text;
    expect(sysB).toBe(sysA);
    expect(sdkB.requests).toHaveLength(1);
  });

  it('0 tool calls: model answers without tools, no attribution', async () => {
    // Round 1 (tools enabled) returns plain text → loop ends → final JSON.
    const sdk = makeScriptedSdk([{ text: 'no tools needed' }, { text: v3() }]);
    const optimizer = makeOptimizer({});
    const svc = makeService(sdk, optimizer.hooks);
    const result = await svc.send({ ...SEND_ARGS });
    expect(result.ok).toBe(true);
    expect(optimizer.calls).toHaveLength(0);
    expect(sdk.requests).toHaveLength(2);
    if (result.ok) expect(result.toolCalls).toBeUndefined();
    // The enabled path DOES carry the tool instructions.
    const sys = (sdk.modelParams[0]?.systemInstruction as { parts: Array<{ text: string }> }).parts[0]?.text ?? '';
    expect(sys).toContain('LIVE OPTIMIZER TOOLS');
    expect(sys.endsWith(OPTIMIZER_TOOL_INSTRUCTIONS)).toBe(true);
  });

  it('1 tool call: executes, injects results, attributes the turn', async () => {
    const sdk = makeScriptedSdk([
      { functionCalls: [{ name: 'backtest', args: { ticker: 'NVDA', timeframe: '1d' } }] },
      { text: 'done with tools' },
      { text: v3() },
    ]);
    const optimizer = makeOptimizer({});
    const svc = makeService(sdk, optimizer.hooks);
    const result = await svc.send({ ...SEND_ARGS });
    expect(result.ok).toBe(true);
    expect(optimizer.calls).toEqual([
      { tool: 'backtest', args: { ticker: 'NVDA', timeframe: '1d' } },
    ]);
    if (result.ok) {
      expect(result.toolCalls?.map((c) => c.label)).toEqual(['backtest: NVDA 1d']);
    }
    // Final schema-mode call carries the computed results as text.
    const finalRequest = sdk.requests.at(-1);
    const finalUserPart = JSON.stringify(finalRequest?.contents.at(-1));
    expect(finalUserPart).toContain('COMPUTED OPTIMIZER RESULTS');
    expect(finalUserPart).toContain('sharpe');
    // Tool model declared tools; final model did not.
    expect(sdk.modelParams[1]?.tools).toBeDefined();
    expect(sdk.modelParams[0]?.tools).toBeUndefined();
  });

  it('caps at 2 rounds and logs optimizer.loop.capped', async () => {
    const logger = makeLogger();
    const sdk = makeScriptedSdk([
      { functionCalls: [{ name: 'list_capabilities', args: {} }] },
      { functionCalls: [{ name: 'backtest', args: { ticker: 'NVDA' } }] },
      // Would be a 3rd round — must never be requested with tools again.
      { text: v3() },
    ]);
    const optimizer = makeOptimizer({});
    const svc = createGeminiService({
      logger,
      knowledgeStore: makeKnowledgeStore(),
      getApiKey: () => 'test-key',
      getModel: () => 'gemini-3.1-flash-lite-preview',
      recordCall: vi.fn(),
      sdkFactory: sdk.factory,
      optimizer: optimizer.hooks,
    });
    const result = await svc.send({ ...SEND_ARGS });
    expect(result.ok).toBe(true);
    expect(optimizer.calls).toHaveLength(OPTIMIZER_MAX_TOOL_ROUNDTRIPS);
    // 2 tool rounds + 1 final call.
    expect(sdk.requests).toHaveLength(3);
    expect(logger.info).toHaveBeenCalledWith(
      'optimizer.loop.capped',
      expect.objectContaining({ rounds: OPTIMIZER_MAX_TOOL_ROUNDTRIPS }),
    );
  });

  it('drops malformed functionCall parts and degrades gracefully', async () => {
    const sdk = makeScriptedSdk([
      { functionCalls: [{ args: { ticker: 'NVDA' } }, { name: '', args: {} }] },
      { text: v3() },
    ]);
    const optimizer = makeOptimizer({});
    const svc = makeService(sdk, optimizer.hooks);
    const result = await svc.send({ ...SEND_ARGS });
    expect(result.ok).toBe(true);
    expect(optimizer.calls).toHaveLength(0);
    if (result.ok) expect(result.toolCalls).toBeUndefined();
  });

  it('feeds engine errors back so the model can self-correct', async () => {
    const sdk = makeScriptedSdk([
      { functionCalls: [{ name: 'backtest', args: { ticker: 'ZZZ' } }] },
      { functionCalls: [{ name: 'backtest', args: { ticker: 'NVDA' } }] },
      { text: v3() },
    ]);
    const optimizer = makeOptimizer({
      backtest: { ok: false, kind: 'engine', detail: "Unknown ticker 'ZZZ'" },
    });
    const svc = makeService(sdk, optimizer.hooks);
    const result = await svc.send({ ...SEND_ARGS });
    expect(result.ok).toBe(true);
    // Both rounds executed; the second round's request contents carry the
    // error string from the first — AND the replayed model turn preserves
    // the functionCall part verbatim, thoughtSignature included (Gemini 3.x
    // rejects reconstructed parts with a 400).
    const round2 = JSON.stringify(sdk.requests[1]?.contents);
    expect(round2).toContain("Unknown ticker 'ZZZ'");
    expect(round2).toContain('sig-backtest');
    if (result.ok) {
      expect(result.toolCalls?.some((c) => !c.ok)).toBe(true);
    }
  });
});
