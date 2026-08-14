/**
 * @file tests/optimizerMcpService.spec.ts
 *
 * Coverage for the sanctioned MCP wrapper (PRD_Optimizer_MCP_Integration
 * D-M5/D-M7): connect lifecycle, per-tool timeout, unauthorized surfaced as
 * a typed error, summarizer/truncator caps, schema conversion, and the
 * Gemini-subset declaration derivation. Pure DI — a fake client factory,
 * no vi.mock, mirroring the geminiService sdkFactory pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createOptimizerMcpService,
  extractToolResultText,
  summarizeToolResult,
  toGeminiSchema,
  toolCallLabel,
  type McpClientLike,
  type OptimizerMcpServiceDeps,
} from '../src/main/optimizerMcpService';
import {
  OPTIMIZER_GEMINI_TOOLS,
  OPTIMIZER_TOOL_RESULT_MAX_TOKENS,
} from '../src/shared/optimizerTypes';
import { CHARS_PER_TOKEN } from '../src/shared/tokenEstimate';
import type { AppLogger } from '../src/main/logger';

function fakeLogger(): AppLogger {
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

const CONFIG = { mcpUrl: 'https://x.example/mcp', teamKey: 'tk' };

function textResult(payload: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function fakeClient(overrides: Partial<McpClientLike> = {}): McpClientLike & {
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  return {
    calls,
    listTools: async () => ({
      tools: [
        { name: 'list_capabilities', description: 'caps', inputSchema: { type: 'object', properties: {} } },
        {
          name: 'backtest',
          description: 'run one backtest',
          inputSchema: {
            type: 'object',
            properties: {
              ticker: { type: 'string' },
              timeframe: { type: 'string', default: '1d' },
              start: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              params: { anyOf: [{ type: 'object' }, { type: 'null' }] },
              capital: { type: 'number' },
            },
            required: ['ticker'],
          },
        },
        { name: 'compare_timeframes', description: 'tf', inputSchema: { type: 'object', properties: { timeframes: { type: 'array', items: { type: 'string' } } } } },
        { name: 'detect_regimes', description: 'regimes', inputSchema: { type: 'object', properties: { sensitivity: { type: 'number' } } } },
        { name: 'start_optimization', description: 'start', inputSchema: { type: 'object', properties: { trials: { type: 'integer' } } } },
      ],
    }),
    callTool: async (params) => {
      calls.push(params as { name: string; arguments: Record<string, unknown> });
      return textResult({ ok: true, echo: params.name });
    },
    close: async () => undefined,
    ...overrides,
  };
}

function build(overrides: Partial<OptimizerMcpServiceDeps> = {}): {
  service: ReturnType<typeof createOptimizerMcpService>;
  logger: AppLogger;
} {
  const logger = fakeLogger();
  const service = createOptimizerMcpService({
    logger,
    getConfig: () => CONFIG,
    clientFactory: async () => fakeClient(),
    ...overrides,
  });
  return { service, logger };
}

describe('optimizerMcpService.callTool', () => {
  it('returns not-configured without config', async () => {
    const { service } = build({ getConfig: () => null });
    const result = await service.callTool('backtest', { ticker: 'NVDA' });
    expect(result).toEqual({ ok: false, kind: 'not-configured' });
  });

  it('rejects tools outside the allowlists without touching the network', async () => {
    const factory = vi.fn(async () => fakeClient());
    const { service } = build({ clientFactory: factory });
    const result = await service.callTool('refresh_data', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('engine');
    expect(factory).not.toHaveBeenCalled();
  });

  it('round-trips a tool call with summary + logging', async () => {
    const { service, logger } = build();
    const result = await service.callTool('backtest', { ticker: 'NVDA', timeframe: '1d' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.label).toBe('backtest: NVDA 1d');
      expect(result.summary.ok).toBe(true);
      expect((result.raw as { echo: string }).echo).toBe('backtest');
    }
    expect(logger.info).toHaveBeenCalledWith(
      'optimizer.connect', expect.objectContaining({ mcpUrl: CONFIG.mcpUrl }));
    expect(logger.info).toHaveBeenCalledWith(
      'optimizer.tool.call',
      expect.objectContaining({ tool: 'backtest', ok: true }));
    expect(service.isConnected()).toBe(true);
  });

  it('times out slow tools with a typed error', async () => {
    const never = new Promise<never>(() => undefined);
    const { service, logger } = build({
      clientFactory: async () => fakeClient({ callTool: () => never }),
      toolTimeoutMs: 20,
    });
    const result = await service.callTool('backtest', { ticker: 'NVDA' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('timeout');
    expect(logger.warn).toHaveBeenCalledWith(
      'optimizer.tool.timeout', expect.objectContaining({ tool: 'backtest' }));
  });

  it('surfaces 401 as a distinct unauthorized error', async () => {
    const { service, logger } = build({
      clientFactory: async () => {
        throw new Error('Error POSTing to endpoint (HTTP 401): unauthorized');
      },
    });
    const result = await service.callTool('backtest', { ticker: 'NVDA' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('unauthorized');
    expect(logger.warn).toHaveBeenCalledWith(
      'optimizer.tool.unauthorized', expect.objectContaining({ tool: 'backtest' }));
  });

  it('maps isError results to a readable engine detail', async () => {
    const { service } = build({
      clientFactory: async () =>
        fakeClient({
          callTool: async () => ({
            isError: true,
            content: [{ type: 'text', text: "Unknown ticker 'ZZZ'" }],
          }),
        }),
    });
    const result = await service.callTool('backtest', { ticker: 'ZZZ' });
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'engine') {
      expect(result.detail).toContain('Unknown ticker');
    } else {
      expect.fail('expected engine error');
    }
  });

  it('backs off between failed connects', async () => {
    let t = 0;
    const factory = vi.fn(async (): Promise<McpClientLike> => {
      throw new Error('ECONNREFUSED');
    });
    const { service } = build({ clientFactory: factory, now: () => t });
    const first = await service.callTool('backtest', { ticker: 'NVDA' });
    expect(first.ok).toBe(false);
    // Immediately after a failure the next attempt is suppressed by backoff.
    t += 100;
    const second = await service.callTool('backtest', { ticker: 'NVDA' });
    expect(second.ok).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    // After the backoff window it tries again.
    t += 2_000;
    await service.callTool('backtest', { ticker: 'NVDA' });
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('summarizer/truncator (D-M7)', () => {
  const MAX_CHARS = Math.floor(OPTIMIZER_TOOL_RESULT_MAX_TOKENS * CHARS_PER_TOKEN);

  it('caps oversized results at the token budget', () => {
    // Many distinct medium-sized fields survive the per-string pruner, so
    // the final char cap must still bite.
    const wide: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) wide[`field_${i}`] = 'x'.repeat(1_500);
    const summary = summarizeToolResult(JSON.stringify(wide));
    expect(summary.length).toBeLessThanOrEqual(MAX_CHARS + 20);
    expect(summary.endsWith('…[truncated]')).toBe(true);
  });

  it('drops bulk arrays (equity curves, trades) before truncating', () => {
    const payload = {
      metrics: { sharpe_ratio: 1.2 },
      equity_curve: Array.from({ length: 5_000 }, (_, i) => i),
      trades: Array.from({ length: 500 }, (_, i) => ({ i })),
      leaderboard: Array.from({ length: 100 }, (_, i) => ({ rank: i })),
    };
    const summary = summarizeToolResult(JSON.stringify(payload));
    const parsed = JSON.parse(summary) as Record<string, unknown>;
    expect(parsed.equity_curve).toBeUndefined();
    expect(parsed.trades).toBeUndefined();
    expect((parsed.leaderboard as unknown[]).length).toBeLessThanOrEqual(21);
    expect((parsed.metrics as { sharpe_ratio: number }).sharpe_ratio).toBe(1.2);
  });

  it('extracts text content parts', () => {
    expect(extractToolResultText({ content: [{ type: 'text', text: 'abc' }] })).toBe('abc');
    expect(extractToolResultText({ structuredContent: { a: 1 } })).toBe('{"a":1}');
    expect(extractToolResultText({})).toBe('');
  });

  it('labels tool calls compactly', () => {
    expect(toolCallLabel('backtest', { ticker: 'NVDA', timeframe: '1d' })).toBe('backtest: NVDA 1d');
    expect(toolCallLabel('compare_timeframes', { ticker: 'AAPL', timeframes: ['1h', '1d'] }))
      .toBe('compare_timeframes: AAPL 1h/1d');
    expect(toolCallLabel('list_capabilities', {})).toBe('list_capabilities');
  });
});

describe('Gemini declaration derivation (D-M6)', () => {
  it('converts FastMCP anyOf-optionals and primitive types', () => {
    const schema = toGeminiSchema({
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 't' },
        start: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        trials: { type: 'integer' },
        deep: { type: 'array', items: { type: 'number' } },
      },
      required: ['ticker'],
    });
    expect(schema.type).toBe('OBJECT');
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.ticker.type).toBe('STRING');
    expect(props.start.nullable).toBe(true);
    expect(props.start.type).toBe('STRING');
    expect(props.trials.type).toBe('INTEGER');
    expect(props.deep.type).toBe('ARRAY');
    expect(schema.required).toEqual(['ticker']);
  });

  it('derives declarations for exactly the Gemini-visible subset', async () => {
    const { service } = build();
    const decls = await service.getFunctionDeclarations();
    expect(decls).not.toBeNull();
    const names = (decls ?? []).map((d) => d.name).sort();
    // The fake server advertises start_optimization too — it must be
    // filtered out (panel tool, never Gemini's).
    expect(names).toEqual([...OPTIMIZER_GEMINI_TOOLS].sort());
    expect(names).not.toContain('start_optimization');
  });
});
