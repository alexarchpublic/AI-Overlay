/**
 * @file src/main/optimizerMcpService.ts
 *
 * The ONLY sanctioned MCP wrapper (PRD_Optimizer_MCP_Integration D-M5) —
 * plays the role for the hosted optimizer that `geminiService.ts` plays for
 * Gemini. Electron main process only; the renderer never talks to the
 * network. Owns:
 *   - the streamable-HTTP client (URL + key from `optimizerStore`, D-M8),
 *   - lazy connect + reconnect-with-backoff,
 *   - the per-tool timeout (D-M7, 15 s),
 *   - the result summarizer/truncator (D-M7, ≤ 2,000 estimated tokens),
 *   - the Gemini function-declaration cache derived from the server's
 *     tools/list — never hand-maintained (D-M6).
 *
 * The team key is attached as the `X-Arch-Team-Key` header here and appears
 * nowhere else in this repo except `optimizerTypes.ts` (§5 grep contract).
 * It must never reach a log line.
 *
 * Injectable deps — no `electron` import at module scope.
 */

import type { AppLogger } from './logger';
import {
  OPTIMIZER_GEMINI_TOOLS,
  OPTIMIZER_PANEL_TOOLS,
  OPTIMIZER_TEAM_KEY_HEADER,
  OPTIMIZER_TOOL_RESULT_MAX_TOKENS,
  OPTIMIZER_TOOL_TIMEOUT_MS,
  type OptimizerCapabilities,
  type OptimizerTeamConfig,
  type OptimizerToolCallSummary,
  type OptimizerToolError,
  type OptimizerToolResult,
  type OptimizerToolsInfo,
} from '../shared/optimizerTypes';
import { CHARS_PER_TOKEN, estimateTokensFromChars } from '../shared/tokenEstimate';

// ---------------------------------------------------------------------------
// Injectable client surface (duck-typed slice of @modelcontextprotocol/sdk,
// mirroring geminiService's GeminiSdkLike pattern so tests need no network)
// ---------------------------------------------------------------------------

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallToolResultLike {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolDescriptor[] }>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    resultSchema?: undefined,
    options?: { timeout?: number },
  ): Promise<McpCallToolResultLike>;
  close(): Promise<void>;
}

export type McpClientFactory = (config: OptimizerTeamConfig) => Promise<McpClientLike>;

export interface OptimizerMcpServiceDeps {
  logger: AppLogger;
  /** Main-only config read; `null` ⇒ feature disabled (D-M8). */
  getConfig: () => OptimizerTeamConfig | null;
  /** Injectable for tests; production default builds the real SDK client. */
  clientFactory?: McpClientFactory;
  toolTimeoutMs?: number;
  /** Injectable clock for backoff tests. */
  now?: () => number;
}

/** Structural Gemini function declaration (cast to the SDK type at use). */
export interface OptimizerFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OptimizerMcpService {
  isConfigured(): boolean;
  /** True after the last tool call round-tripped successfully. */
  isConnected(): boolean;
  listTools(): Promise<OptimizerToolsInfo>;
  /**
   * Call an allowlisted tool. Anything outside the Gemini + panel sets is
   * rejected here, which is what keeps blocked tools unreachable no matter
   * what the model hallucinates (Non-Goal 4).
   */
  callTool(
    tool: string,
    args: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<OptimizerToolResult>;
  /**
   * Gemini declarations for the D-M6 read-only subset, derived from the
   * server's tools/list and cached. `null` until a listTools succeeds.
   */
  getFunctionDeclarations(): Promise<readonly OptimizerFunctionDeclaration[] | null>;
  /** Cached `list_capabilities` subset for panel selects; fetches once. */
  getCapabilities(): Promise<OptimizerCapabilities | null>;
  /** Drop the client so the next call reconnects (and stop reconnects). */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Default production client factory (lazy require, CJS build of the SDK)
// ---------------------------------------------------------------------------

const MCP_CLIENT_NAME = 'arch-public-ai-overlay';

async function defaultClientFactory(config: OptimizerTeamConfig): Promise<McpClientLike> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js') as
    typeof import('@modelcontextprotocol/sdk/client/index.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js') as
    typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const transport = new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
    requestInit: {
      headers: { [OPTIMIZER_TEAM_KEY_HEADER]: config.teamKey },
    },
  });
  const client = new Client({ name: MCP_CLIENT_NAME, version: '1.0.0' });
  await client.connect(transport);
  return client as unknown as McpClientLike;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function isUnauthorizedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  return code === 401 || /\b401\b|unauthorized/i.test(message);
}

function readableDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Result summarization (D-M7)
// ---------------------------------------------------------------------------

const MAX_SUMMARY_CHARS = Math.floor(OPTIMIZER_TOOL_RESULT_MAX_TOKENS * CHARS_PER_TOKEN);
/** Keys that are always noise for an LLM (bulk arrays / plumbing). */
const PRUNED_KEYS = new Set(['equity_curve', 'benchmark_curves', 'trades', 'endpoints', 'trials']);
const MAX_ARRAY_ITEMS = 20;

/** Deep-prune bulk data so JSON.stringify stays within the token budget. */
function pruneForSummary(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY_ITEMS).map((v) => pruneForSummary(v, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) kept.push(`…(${value.length - MAX_ARRAY_ITEMS} more)`);
    return kept;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (PRUNED_KEYS.has(k)) continue;
      out[k] = pruneForSummary(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2_000) {
    return `${value.slice(0, 2_000)}…`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 12+ decimal floats eat tokens for nothing.
    return Number.isInteger(value) ? value : Number(value.toFixed(4));
  }
  return value;
}

/** Extract the text payload from an MCP tool result's content parts. */
export function extractToolResultText(result: McpCallToolResultLike): string {
  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent);
    } catch {
      /* fall through to content parts */
    }
  }
  if (Array.isArray(result.content)) {
    const texts = result.content
      .map((part) => {
        if (typeof part === 'object' && part !== null &&
            (part as { type?: unknown }).type === 'text' &&
            typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter((t) => t.length > 0);
    if (texts.length > 0) return texts.join('\n');
  }
  return '';
}

/**
 * Summarize + truncate one tool result to ≤ OPTIMIZER_TOOL_RESULT_MAX_TOKENS
 * estimated tokens (D-M7). Optimize leaderboards and equity curves are large;
 * the pruner drops bulk arrays first, the char cap is the hard stop.
 */
export function summarizeToolResult(rawText: string): string {
  let summaryText = rawText;
  try {
    const parsed: unknown = JSON.parse(rawText);
    summaryText = JSON.stringify(pruneForSummary(parsed));
  } catch {
    // Not JSON — fall through to the raw text with the char cap.
  }
  if (summaryText.length > MAX_SUMMARY_CHARS) {
    summaryText = `${summaryText.slice(0, MAX_SUMMARY_CHARS)}…[truncated]`;
  }
  return summaryText;
}

/** Compact chip label, e.g. `backtest: NVDA 1d`. */
export function toolCallLabel(tool: string, args: Record<string, unknown>): string {
  const ticker = typeof args.ticker === 'string' ? args.ticker : '';
  const timeframe = typeof args.timeframe === 'string'
    ? args.timeframe
    : Array.isArray(args.timeframes) ? args.timeframes.join('/') : '';
  const suffix = [ticker, timeframe].filter((s) => s.length > 0).join(' ');
  return suffix.length > 0 ? `${tool}: ${suffix}` : tool;
}

// ---------------------------------------------------------------------------
// Gemini declaration derivation (D-M6): MCP JSON Schema → Gemini schema
// ---------------------------------------------------------------------------

/**
 * Convert one MCP tool inputSchema (JSON Schema draft, with FastMCP's
 * `anyOf: [T, null]` optionals) into the OpenAPI-style schema object the
 * legacy `@google/generative-ai` SDK accepts. Unknown constructs degrade to
 * a permissive STRING/OBJECT rather than failing the declaration.
 */
export function toGeminiSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) return { type: 'STRING' };
  const s = schema as Record<string, unknown>;

  if (Array.isArray(s.anyOf)) {
    const firstNonNull = (s.anyOf as unknown[]).find(
      (v) => typeof v === 'object' && v !== null && (v as { type?: unknown }).type !== 'null',
    );
    const converted = toGeminiSchema(firstNonNull ?? { type: 'string' });
    converted.nullable = true;
    if (typeof s.description === 'string') converted.description = s.description;
    return converted;
  }

  const type = typeof s.type === 'string' ? s.type : 'string';
  const out: Record<string, unknown> = {};
  if (typeof s.description === 'string') out.description = s.description;

  switch (type) {
    case 'object': {
      out.type = 'OBJECT';
      const props = s.properties;
      if (typeof props === 'object' && props !== null) {
        const converted: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) converted[k] = toGeminiSchema(v);
        // Gemini rejects OBJECT schemas with empty properties; degrade to a
        // free-form object description instead.
        if (Object.keys(converted).length > 0) {
          out.properties = converted;
          if (Array.isArray(s.required)) out.required = s.required;
        } else {
          out.description = [out.description, 'JSON object'].filter(Boolean).join(' — ');
          out.properties = { note: { type: 'STRING', description: 'unused' } };
        }
      } else {
        out.properties = { note: { type: 'STRING', description: 'unused' } };
      }
      return out;
    }
    case 'array':
      out.type = 'ARRAY';
      out.items = toGeminiSchema(s.items ?? { type: 'string' });
      return out;
    case 'integer':
      out.type = 'INTEGER';
      return out;
    case 'number':
      out.type = 'NUMBER';
      return out;
    case 'boolean':
      out.type = 'BOOLEAN';
      return out;
    default:
      out.type = 'STRING';
      if (Array.isArray(s.enum)) out.enum = s.enum;
      return out;
  }
}

// ---------------------------------------------------------------------------
// Capabilities extraction
// ---------------------------------------------------------------------------

function parseCapabilities(raw: unknown): OptimizerCapabilities | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  const tickers = strings(o.tickers);
  const timeframes = strings(o.timeframes);
  const objectives = strings(o.objectives);
  if (tickers.length === 0 || timeframes.length === 0) return null;
  const objectiveDescriptions: Record<string, string> = {};
  if (typeof o.objective_details === 'object' && o.objective_details !== null) {
    for (const [k, v] of Object.entries(o.objective_details)) {
      const desc = (v as { description?: unknown } | null)?.description;
      if (typeof desc === 'string') objectiveDescriptions[k] = desc;
    }
  }
  return { tickers, timeframes, objectives, objectiveDescriptions };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...OPTIMIZER_GEMINI_TOOLS,
  ...OPTIMIZER_PANEL_TOOLS,
]);

const GEMINI_TOOL_SET: ReadonlySet<string> = new Set(OPTIMIZER_GEMINI_TOOLS);

/** Reconnect backoff: 1s → 2s → 4s → … capped at 30s. */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

export function createOptimizerMcpService(deps: OptimizerMcpServiceDeps): OptimizerMcpService {
  const log = deps.logger;
  const clientFactory = deps.clientFactory ?? defaultClientFactory;
  const toolTimeoutMs = deps.toolTimeoutMs ?? OPTIMIZER_TOOL_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());

  let client: McpClientLike | null = null;
  let connecting: Promise<McpClientLike> | null = null;
  let connected = false;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;
  let disposed = false;

  let cachedTools: McpToolDescriptor[] | null = null;
  let cachedDeclarations: OptimizerFunctionDeclaration[] | null = null;
  let cachedCapabilities: OptimizerCapabilities | null = null;

  async function connect(): Promise<McpClientLike> {
    if (client) return client;
    if (connecting) return connecting;

    const config = deps.getConfig();
    if (!config) throw new NotConfiguredError();
    if (disposed) throw new Error('optimizer service disposed');

    const t = now();
    if (t < nextAttemptAt) {
      throw new Error(
        `optimizer reconnect backing off (${Math.ceil((nextAttemptAt - t) / 1000)}s)`);
    }

    connecting = (async () => {
      const started = now();
      try {
        const c = await clientFactory(config);
        client = c;
        connected = true;
        consecutiveFailures = 0;
        log.info('optimizer.connect', { mcpUrl: config.mcpUrl, durationMs: now() - started });
        return c;
      } catch (err) {
        consecutiveFailures += 1;
        const backoff = Math.min(
          BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1));
        nextAttemptAt = now() + backoff;
        connected = false;
        log.warn('optimizer.connect.failed', {
          mcpUrl: config.mcpUrl,
          message: readableDetail(err),
          consecutiveFailures,
          backoffMs: backoff,
        });
        throw err;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  function dropClient(): void {
    const c = client;
    client = null;
    connected = false;
    if (c) void c.close().catch(() => undefined);
  }

  async function ensureTools(): Promise<McpToolDescriptor[]> {
    if (cachedTools) return cachedTools;
    const c = await connect();
    const listed = await withTimeout(c.listTools(), toolTimeoutMs);
    cachedTools = listed.tools;
    return cachedTools;
  }

  function classifyError(tool: string, err: unknown, durationMs: number): OptimizerToolError {
    if (err instanceof NotConfiguredError) return { ok: false, kind: 'not-configured' };
    if (err instanceof ToolTimeoutError) {
      log.warn('optimizer.tool.timeout', { tool, durationMs });
      dropClient();
      return { ok: false, kind: 'timeout', tool, durationMs };
    }
    if (isUnauthorizedError(err)) {
      log.warn('optimizer.tool.unauthorized', { tool });
      dropClient();
      return { ok: false, kind: 'unauthorized' };
    }
    const detail = readableDetail(err);
    if (!client) {
      return { ok: false, kind: 'connect-failed', reason: detail };
    }
    return { ok: false, kind: 'engine', detail };
  }

  return {
    isConfigured() {
      return deps.getConfig() !== null;
    },
    isConnected() {
      return connected;
    },

    async listTools(): Promise<OptimizerToolsInfo> {
      try {
        const tools = await ensureTools();
        const capabilities = await this.getCapabilities();
        return { toolNames: tools.map((t) => t.name), capabilities };
      } catch (err) {
        log.warn('optimizer.listToolsFailed', { message: readableDetail(err) });
        return { toolNames: [], capabilities: null };
      }
    },

    async callTool(tool, args, opts = {}): Promise<OptimizerToolResult> {
      if (!ALLOWED_TOOLS.has(tool)) {
        return { ok: false, kind: 'engine', detail: `tool not available: ${tool}` };
      }
      const timeoutMs = opts.timeoutMs ?? toolTimeoutMs;
      const started = now();
      try {
        const c = await connect();
        const result = await withTimeout(
          c.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs }),
          timeoutMs,
        );
        const durationMs = now() - started;
        const rawText = extractToolResultText(result);
        if (result.isError) {
          // Engine 422s etc. come back as isError text — a single readable
          // detail string the loop can feed back to the model (§6 risk).
          log.info('optimizer.tool.call', {
            tool, durationMs, ok: false,
            resultTokensEst: estimateTokensFromChars(rawText.length),
          });
          return { ok: false, kind: 'engine', detail: rawText || 'tool call failed' };
        }
        connected = true;
        const resultSummary = summarizeToolResult(rawText);
        const summary: OptimizerToolCallSummary = {
          tool,
          label: toolCallLabel(tool, args),
          resultSummary,
          durationMs,
          ok: true,
        };
        log.info('optimizer.tool.call', {
          tool,
          durationMs,
          ok: true,
          resultTokensEst: estimateTokensFromChars(resultSummary.length),
        });
        let raw: unknown = rawText;
        try {
          raw = JSON.parse(rawText);
        } catch {
          /* keep text */
        }
        return { ok: true, tool, raw, summary };
      } catch (err) {
        return classifyError(tool, err, now() - started);
      }
    },

    async getFunctionDeclarations() {
      if (cachedDeclarations) return cachedDeclarations;
      try {
        const tools = await ensureTools();
        cachedDeclarations = tools
          .filter((t) => GEMINI_TOOL_SET.has(t.name))
          .map((t) => ({
            name: t.name,
            description: t.description ?? t.name,
            parameters: toGeminiSchema(t.inputSchema ?? { type: 'object' }),
          }));
        return cachedDeclarations;
      } catch {
        return null;
      }
    },

    async getCapabilities() {
      if (cachedCapabilities) return cachedCapabilities;
      const result = await this.callTool('list_capabilities', {});
      if (!result.ok) return null;
      cachedCapabilities = parseCapabilities(result.raw);
      return cachedCapabilities;
    },

    async dispose() {
      disposed = true;
      dropClient();
    },
  };
}

class NotConfiguredError extends Error {
  constructor() {
    super('optimizer not configured');
  }
}

class ToolTimeoutError extends Error {
  constructor() {
    super('tool call timed out');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolTimeoutError());
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
