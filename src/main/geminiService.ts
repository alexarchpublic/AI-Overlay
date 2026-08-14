/**
 * @file src/main/geminiService.ts
 *
 * Why it exists: PRD §3.2 / D5 — the **only** sanctioned wrapper around
 * `@google/generative-ai`. Owns:
 *
 *   - `buildSystemPrompt()` — the **only** code path permitted to compose
 *     persona → active-doc / full corpus → retrieved chunks → schema
 *     instructions (PRD D-P4 / D-P5 / D-P6).
 *   - `send()` — single-shot JSON-mode generation with abort signal,
 *     30s timeout, one auto-retry on transient errors, one auto-retry on
 *     JSON parse failure (D8 / D20 / D21).
 *   - `summarize()` — Flash-model conversation summarizer used by the
 *     truncation path (D12).
 *   - `invalidateSystemPromptCache()` — drops the cached system prompt when
 *     the bundle version or active algorithm changes.
 *   - `cancelAll()` — called from `app.before-quit` so no in-flight call
 *     writes a stray `gemini.callCompleted` after `app.quit`.
 *
 * What it does NOT own:
 *   - The chat window or its render tree (`chatWindow.ts` + renderer/chat)
 *   - Conversation memory (`conversationStore.ts`)
 *   - Token-budget math (`tokenBudget.ts`)
 *   - API key persistence (`aiStore.ts`)
 *   - Logging redaction (lives in `logger.ts`)
 *
 * SDK fact-check (`@google/generative-ai@0.20`):
 *   - `generateContent(request, { signal })` — abort signal is honored.
 *   - `responseMimeType: 'application/json'` + `responseSchema` are part
 *     of `generationConfig` (NOT the request). Schema is duck-typed.
 *   - The SDK's `text()` accessor throws if the prompt was blocked; we
 *     re-route through `candidates[0].content.parts` with a fallback so
 *     safety blocks land in the typed error path instead of crashing.
 */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  GoogleGenerativeAI,
  type Content,
  type GenerateContentResult,
  type Part,
} from '@google/generative-ai';
import { ulid } from 'ulid';
import type { AppLogger } from './logger';
import type {
  ActiveAlgorithm,
  DocChunk,
  KnowledgeStore,
} from '../shared/knowledgeTypes';
import type {
  AnalysisResponse,
  ChatTurn,
  Screenshot,
  SuggestedParameterChange,
} from '../shared/types';
import { PERSONA_PROMPT } from '../shared/persona';
import {
  composeSystemPrompt,
  flattenPromptKnowledge,
  type PromptKnowledgeBlocks,
} from '../shared/knowledge/promptContext';
import {
  GEMINI_MAX_AUTO_RETRIES,
  GEMINI_RETRY_BACKOFF_MS,
  GEMINI_TIMEOUT_MS,
  PER_IMAGE_TOKEN_ESTIMATE,
  SUMMARY_MAX_OUTPUT_TOKENS,
  SUMMARY_MODEL,
} from '../shared/aiConstants';
import {
  estimateTokensFromChars,
} from '../shared/tokenEstimate';
import {
  JSON_RETRY_REMINDER,
  OUTPUT_SCHEMA,
  OUTPUT_SCHEMA_INSTRUCTIONS,
} from '../shared/aiSchema';
import {
  OPTIMIZER_MAX_TOOL_ROUNDTRIPS,
  type OptimizerToolCallSummary,
  type OptimizerToolResult,
} from '../shared/optimizerTypes';
import type { OptimizerFunctionDeclaration } from './optimizerMcpService';
import { truncateLogSnippet } from './logger';

/**
 * Appended to the system prompt ONLY when the optimizer tool loop is enabled
 * (PRD_Optimizer_MCP_Integration D-M6/D-M7). With the feature disabled the
 * composed prompt is byte-identical to the pre-integration app — enforced by
 * the prompt-composition snapshot tests.
 */
export const OPTIMIZER_TOOL_INSTRUCTIONS = `

### LIVE OPTIMIZER TOOLS

You can call functions that run REAL computations on the Arch Public optimizer: single backtests, timeframe comparisons, market-regime detection, and a capability lookup. Use them whenever the employee asks what specific settings would have returned, how timeframes compare, or what regimes occurred — never guess numbers a tool can compute. Rules:
- At most ${String(OPTIMIZER_MAX_TOOL_ROUNDTRIPS)} tool rounds per turn; prefer one.
- Only call list_capabilities when you need the valid tickers/timeframes/objectives.
- If a tool returns an error string, fix your arguments once or answer from the documentation without it.
- After tool results arrive, give your final answer in the required JSON schema, citing the computed numbers, and note in risk_notes that backtested performance does not guarantee future results.`;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface GeminiSendArgs {
  userText: string;
  /** Conversation history in chronological order (oldest → newest). */
  history: readonly ChatTurn[];
  /** Already capped at D9 by the caller; oldest-first ordering preserved. */
  screenshots: readonly Screenshot[];
  /**
   * Pre-selected prompt knowledge for this turn. Prefer this over
   * `knowledgeChunks` when the orchestrator has already run
   * `selectPromptKnowledge`.
   */
  knowledgeBlocks?: PromptKnowledgeBlocks;
  /**
   * Flat docs-corpus chunks for this turn (legacy / tests). When
   * `knowledgeBlocks` is omitted, treated as retrieved-only knowledge.
   */
  knowledgeChunks?: readonly DocChunk[];
  /** Active algorithm for cache keying when composing from the store. */
  activeAlgorithm?: ActiveAlgorithm;
  /** Caller's abort signal (chat-side ESC / window close / quit). */
  signal: AbortSignal;
}

export interface GeminiSendOk {
  ok: true;
  /** Constructed assistant turn (caller appends to `conversationStore`). */
  turn: ChatTurn;
  /** Raw SDK response — kept for log/debug; never persisted. */
  raw: GenerateContentResult;
  /** Stable hash of the composed system prompt for the log line. */
  promptHash: string;
  /** Estimated request size at send time. */
  promptTokenEstimate: number;
  /** End-to-end latency including the retry path. */
  latencyMs: number;
  /** Optimizer tool calls that grounded this answer (D-M6); absent/empty
   *  when the loop is disabled or the model answered without tools. */
  toolCalls?: readonly OptimizerToolCallSummary[];
}

export type GeminiSendError =
  | { ok: false; kind: 'no-api-key' }
  | { ok: false; kind: 'aborted' }
  | { ok: false; kind: 'timeout'; latencyMs: number }
  | { ok: false; kind: 'transient'; reason: string; latencyMs: number }
  | {
      ok: false;
      kind: 'fatal';
      reason: 'invalid-api-key' | 'invalid-json' | 'safety' | 'unknown';
      detail?: Record<string, unknown>;
      latencyMs: number;
    };

export type GeminiSendResult = GeminiSendOk | GeminiSendError;

export interface GeminiServiceDeps {
  logger: AppLogger;
  /** Docs-corpus retrieval (local bundle or future remote backend). */
  knowledgeStore: KnowledgeStore;
  /** Read the current API key. Returns `null` when unset. */
  getApiKey(): string | null;
  /** Read the active model id. */
  getModel(): string;
  /** Persistence hook so a completed call can update the rolling stats. */
  recordCall(args: {
    ts: number;
    latencyMs: number;
    promptTokenEstimate: number;
    jsonOk: boolean;
  }): void;
  /** Injected for deterministic ULIDs in tests. */
  newId?: () => string;
  /** Injected for deterministic timestamps in tests. */
  now?: () => number;
  /**
   * Injected SDK constructor so tests can stub the network. Defaults to
   * the real `GoogleGenerativeAI`. Keep this typed `unknown` here and
   * narrow at the call site to avoid leaking SDK internals.
   */
  sdkFactory?: (apiKey: string) => GeminiSdkLike;
  /**
   * Optimizer tool-loop hooks (PRD_Optimizer_MCP_Integration D-M6/D-M7).
   * Touching this file for a real tool loop is the sanctioned exception to
   * the "only wrapper" rule (Chunk 7 §2 warning acknowledged). Absent — or
   * declarations resolving to null/empty (unconfigured, endpoint down) —
   * disables the loop and zero new tokens enter the prompt (D-M8).
   */
  optimizer?: {
    getFunctionDeclarations(): Promise<readonly OptimizerFunctionDeclaration[] | null>;
    callTool(
      tool: string,
      args: Record<string, unknown>,
    ): Promise<OptimizerToolResult>;
  };
}

/**
 * Narrow slice of `GoogleGenerativeAI` we depend on. Exported so tests can
 * implement it; production wraps the real class via `defaultSdkFactory`.
 */
export interface GeminiSdkLike {
  getGenerativeModel(modelParams: {
    model: string;
    systemInstruction?: { parts: { text: string }[] };
    generationConfig?: {
      responseMimeType?: string;
      responseSchema?: unknown;
      maxOutputTokens?: number;
    };
    /** Gemini function declarations (tool-loop calls only — JSON mode and
     *  tools are mutually exclusive in the API). Duck-typed like the schema. */
    tools?: unknown;
  }): GeminiModelLike;
}

export interface GeminiModelLike {
  generateContent(
    request: { contents: Content[] } | string,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<GenerateContentResult>;
}

export interface GeminiService {
  buildSystemPrompt(
    chunksOrBlocks: readonly DocChunk[] | PromptKnowledgeBlocks,
    options?: { activeAlgorithm?: ActiveAlgorithm; bundleVersion?: string },
  ): string;
  send(args: GeminiSendArgs): Promise<GeminiSendResult>;
  summarize(turns: readonly ChatTurn[]): Promise<string | null>;
  invalidateSystemPromptCache(): void;
  cancelAll(): void;
  /** Convenience for tests + the chat orchestrator: stable hash of a string. */
  hashPrompt(text: string): string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const defaultSdkFactory = (apiKey: string): GeminiSdkLike => {
  const sdk = new GoogleGenerativeAI(apiKey);
  return {
    getGenerativeModel(params) {
      return sdk.getGenerativeModel(
        params as unknown as Parameters<typeof sdk.getGenerativeModel>[0],
      );
    },
  };
};

export function createGeminiService(deps: GeminiServiceDeps): GeminiService {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? ulid;
  const sdkFactory = deps.sdkFactory ?? defaultSdkFactory;

  /** Cache keyed on bundle version + active algorithm (PRD D-P4 / D-P10). */
  let cachedPrompt: {
    key: string;
    prompt: string;
  } | null = null;

  function hashPrompt(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  function cacheKey(
    bundleVersion: string | undefined,
    activeAlgorithm: ActiveAlgorithm | undefined,
    knowledgeFingerprint: string,
  ): string {
    return `${bundleVersion ?? 'unknown'}|${activeAlgorithm ?? 'market-wave'}|${knowledgeFingerprint}`;
  }

  function isPromptBlocks(
    value: readonly DocChunk[] | PromptKnowledgeBlocks,
  ): value is PromptKnowledgeBlocks {
    return !Array.isArray(value) && 'activeDocChunks' in value;
  }

  function knowledgeFingerprint(
    chunksOrBlocks: readonly DocChunk[] | PromptKnowledgeBlocks,
  ): string {
    const chunks = isPromptBlocks(chunksOrBlocks)
      ? flattenPromptKnowledge(chunksOrBlocks)
      : chunksOrBlocks;
    return hashPrompt(
      chunks.map((c) => `${c.id}:${String(c.tokenEstimate)}:${c.text}`).join('|'),
    );
  }

  function buildSystemPrompt(
    chunksOrBlocks: readonly DocChunk[] | PromptKnowledgeBlocks,
    options: { activeAlgorithm?: ActiveAlgorithm; bundleVersion?: string } = {},
  ): string {
    const key = cacheKey(
      options.bundleVersion,
      options.activeAlgorithm,
      knowledgeFingerprint(chunksOrBlocks),
    );
    if (cachedPrompt?.key === key) {
      return cachedPrompt.prompt;
    }
    const prompt = composeSystemPrompt(
      PERSONA_PROMPT,
      chunksOrBlocks,
      OUTPUT_SCHEMA_INSTRUCTIONS,
    );
    cachedPrompt = { key, prompt };
    return prompt;
  }

  /** Per-call AbortControllers so `cancelAll()` can abort the in-flight set. */
  const inflight = new Set<AbortController>();

  /**
   * Read a screenshot file off disk and return the base64 inlineData part.
   * Returns `null` if the file is missing — caller logs `gemini.screenshotMissing`
   * and continues without that frame (PRD §3.10).
   */
  async function screenshotToPart(s: Screenshot): Promise<Part | null> {
    try {
      const buf = await fsp.readFile(s.filepath);
      const ext = path.extname(s.filepath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      const part: Part = {
        inlineData: { mimeType, data: buf.toString('base64') },
      };
      return part;
    } catch {
      return null;
    }
  }

  /**
   * Convert a `ChatTurn[]` into Gemini `Content[]`. `'user'` and
   * `'system-summary'` map to `'user'` and `'model'` roles respectively
   * — Gemini does not have a system role inside `contents` (system goes
   * via `systemInstruction`); the truncation summary is best surfaced
   * as an assistant `'model'` turn so the model treats it as recall.
   */
  function historyToContents(history: readonly ChatTurn[]): Content[] {
    const out: Content[] = [];
    for (const t of history) {
      const role = t.role === 'user' ? 'user' : 'model';
      out.push({ role, parts: [{ text: t.text }] });
    }
    return out;
  }

  /**
   * Decide whether a thrown error should be retried once on the auto path.
   * 5xx + network errors + RESOURCE_EXHAUSTED are transient (PRD D21).
   */
  function isTransient(err: unknown): boolean {
    if (err === null || typeof err !== 'object') return false;
    const e = err as { status?: number; code?: string; message?: string };
    if (typeof e.status === 'number' && e.status >= 500 && e.status < 600) return true;
    const msg = (e.message ?? '').toLowerCase();
    if (msg.includes('resource_exhausted')) return true;
    if (msg.includes('econn') || msg.includes('etimedout') || msg.includes('network')) return true;
    if (msg.includes('socket hang up')) return true;
    return false;
  }

  function isAuthError(err: unknown): boolean {
    if (err === null || typeof err !== 'object') return false;
    const e = err as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403) return true;
    const msg = (e.message ?? '').toLowerCase();
    return msg.includes('api key') && (msg.includes('invalid') || msg.includes('unauthorized'));
  }

  /**
   * Race a promise against a timeout. Resolves with the original value or
   * rejects with `'timeout'` after `GEMINI_TIMEOUT_MS`.
   */
  function withTimeout<T>(p: Promise<T>, controller: AbortController): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, GEMINI_TIMEOUT_MS);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (err: unknown) => {
          clearTimeout(t);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  /**
   * Inspect a result for a safety block. Returns the block reason if the
   * response was filtered, or `null` if it's a normal response.
   */
  function safetyBlockOf(result: GenerateContentResult): {
    reason: string;
    safetyRatings?: unknown;
  } | null {
    const promptFeedback = result.response.promptFeedback;
    if (promptFeedback?.blockReason !== undefined) {
      return {
        reason: promptFeedback.blockReason,
        safetyRatings: promptFeedback.safetyRatings,
      };
    }
    const cand = result.response.candidates?.[0];
    const finishReason = cand?.finishReason as string | undefined;
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      return { reason: finishReason, safetyRatings: cand?.safetyRatings };
    }
    return null;
  }

  /**
   * Pull the candidate text without going through `result.response.text()`
   * (which throws on safety blocks). Empty string on missing candidates.
   */
  function rawTextOf(result: GenerateContentResult): string {
    const cand = result.response.candidates?.[0];
    if (!cand?.content.parts) return '';
    return cand.content.parts
      .map((p) => (typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join('');
  }

  /**
   * Strip a leading ```json fence if Gemini ignored the "no fences" rule.
   * Defense-in-depth — JSON mode rarely produces them, but logs from
   * Chunk 4 dev runs show ~1 in 50 responses do.
   */
  function stripFences(s: string): string {
    const trimmed = s.trim();
    if (trimmed.startsWith('```')) {
      const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, '');
      return withoutOpen.replace(/```\s*$/i, '').trim();
    }
    return trimmed;
  }

  function parseAnalysis(raw: string): AnalysisResponse | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (o.schema_version !== '3') return null;
    if (typeof o.analysis !== 'string') return null;
    if (typeof o.talk_track !== 'string') return null;
    if (typeof o.confidence_score !== 'number') return null;
    if (typeof o.risk_notes !== 'string') return null;
    if (!Array.isArray(o.suggested_parameter_changes)) return null;
    const suggestions: SuggestedParameterChange[] = [];
    for (const row of o.suggested_parameter_changes) {
      if (typeof row !== 'object' || row === null) return null;
      const r = row as Record<string, unknown>;
      if (
        typeof r.parameter !== 'string' ||
        typeof r.rationale !== 'string' ||
        typeof r.suggested_value !== 'string' ||
        typeof r.doc_ref !== 'string' ||
        !(typeof r.current_value === 'string' || r.current_value === null)
      ) {
        return null;
      }
      suggestions.push({
        parameter: r.parameter,
        current_value: r.current_value,
        suggested_value: r.suggested_value,
        rationale: r.rationale,
        doc_ref: r.doc_ref,
      });
    }
    return {
      schema_version: '3',
      analysis: o.analysis,
      suggested_parameter_changes: suggestions,
      talk_track: o.talk_track,
      confidence_score: o.confidence_score,
      risk_notes: o.risk_notes,
    };
  }

  // -------------------------------------------------------------------------
  // The send loop
  // -------------------------------------------------------------------------

  async function send(args: GeminiSendArgs): Promise<GeminiSendResult> {
    const apiKey = deps.getApiKey();
    if (apiKey === null) {
      return { ok: false, kind: 'no-api-key' };
    }

    const startTs = now();
    const knowledgeInput: readonly DocChunk[] | PromptKnowledgeBlocks =
      args.knowledgeBlocks ??
      ({
        fullCorpus: false,
        activeDocChunks: [],
        retrievedChunks: args.knowledgeChunks ?? [],
      } satisfies PromptKnowledgeBlocks);
    const systemPrompt = buildSystemPrompt(knowledgeInput, {
      ...(args.activeAlgorithm !== undefined
        ? { activeAlgorithm: args.activeAlgorithm }
        : {}),
    });

    // Optimizer tool loop (D-M6): resolve the cached declarations first — a
    // null/empty result (feature unconfigured, endpoint unreachable) disables
    // the loop, and everything below behaves exactly as the pre-integration
    // single-shot path, including the composed prompt bytes (D-M8).
    let declarations: readonly OptimizerFunctionDeclaration[] | null = null;
    if (deps.optimizer !== undefined) {
      try {
        declarations = await deps.optimizer.getFunctionDeclarations();
      } catch {
        declarations = null;
      }
    }
    const toolLoopEnabled = declarations !== null && declarations.length > 0;
    const effectiveSystemPrompt = toolLoopEnabled
      ? systemPrompt + OPTIMIZER_TOOL_INSTRUCTIONS
      : systemPrompt;
    const promptHash = hashPrompt(effectiveSystemPrompt);
    const model = deps.getModel();

    // Build the inlineData parts from disk reads. Missing files are logged
    // and skipped (PRD §3.10) — never fatal.
    const imageParts: Part[] = [];
    for (const s of args.screenshots) {
      const part = await screenshotToPart(s);
      if (part === null) {
        deps.logger.warn('gemini.screenshotMissing', { id: s.id, filepath: s.filepath });
        continue;
      }
      imageParts.push(part);
    }

    const promptTokenEstimate = estimatePromptTokens({
      systemPrompt,
      history: args.history,
      imageCount: imageParts.length,
      userText: args.userText,
    });

    deps.logger.info('gemini.callStarted', {
      model,
      promptHash,
      promptTokenEstimate,
      screenshotCount: imageParts.length,
      screenshotIds: args.screenshots.map((s) => s.id),
      historyTurnCount: args.history.length,
    });

    // Compose the request contents. History first, then the user turn with
    // the image parts attached. Image parts come AFTER the user text per
    // Gemini guidance (text-then-image is more reliable for vision tasks).
    const baseContents: Content[] = [
      ...historyToContents(args.history),
    ];

    function buildUserContent(text: string): Content {
      const parts: Part[] = [{ text }];
      for (const ip of imageParts) parts.push(ip);
      return { role: 'user', parts };
    }

    const sdk = sdkFactory(apiKey);
    const generativeModel = sdk.getGenerativeModel({
      model,
      systemInstruction: { parts: [{ text: effectiveSystemPrompt }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: OUTPUT_SCHEMA,
      },
    });

    /**
     * One attempt — wraps the SDK call in the per-call timeout + abort
     * propagation. Returns the raw result on success or throws.
     */
    async function attempt(userText: string): Promise<GenerateContentResult> {
      const ctrl = new AbortController();
      // Forward the caller's signal too — either side aborts the request.
      if (args.signal.aborted) ctrl.abort();
      const onAbort = (): void => {
        ctrl.abort();
      };
      args.signal.addEventListener('abort', onAbort);
      inflight.add(ctrl);
      try {
        const contents: Content[] = [...baseContents, buildUserContent(userText)];
        const result = await withTimeout(
          generativeModel.generateContent(
            { contents },
            { signal: ctrl.signal },
          ),
          ctrl,
        );
        return result;
      } finally {
        inflight.delete(ctrl);
        args.signal.removeEventListener('abort', onAbort);
      }
    }

    /**
     * Drive the attempt with the auto-retry policy. Returns the raw result
     * on success or a typed `GeminiSendError`.
     */
    async function runWithRetry(
      userText: string,
    ): Promise<GenerateContentResult | GeminiSendError> {
      let attemptCount = 0;
      // GEMINI_MAX_AUTO_RETRIES is 1; total attempts cap is 2.
      // Loop bound matches PRD D21 — the only exits are `return` paths.
      for (;;) {
        attemptCount++;
        try {
          const result = await attempt(userText);
          const block = safetyBlockOf(result);
          if (block !== null) {
            return {
              ok: false,
              kind: 'fatal',
              reason: 'safety',
              detail: { reason: block.reason, safetyRatings: block.safetyRatings as Record<string, unknown> | undefined },
              latencyMs: now() - startTs,
            };
          }
          return result;
        } catch (err) {
          if (args.signal.aborted) {
            return { ok: false, kind: 'aborted' };
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'timeout') {
            deps.logger.warn('gemini.timeout', { attempt: attemptCount });
            // Timeout is treated as transient at retry-decision time but
            // surfaces as its own error variant so the chat banner shows
            // the right copy.
            if (attemptCount > GEMINI_MAX_AUTO_RETRIES) {
              return { ok: false, kind: 'timeout', latencyMs: now() - startTs };
            }
            await sleep(GEMINI_RETRY_BACKOFF_MS);
            continue;
          }
          if (isAuthError(err)) {
            return {
              ok: false,
              kind: 'fatal',
              reason: 'invalid-api-key',
              detail: { message: msg },
              latencyMs: now() - startTs,
            };
          }
          if (isTransient(err) && attemptCount <= GEMINI_MAX_AUTO_RETRIES) {
            deps.logger.warn('gemini.callFailed', {
              attempt: attemptCount,
              reason: msg,
              willRetry: true,
            });
            await sleep(GEMINI_RETRY_BACKOFF_MS);
            continue;
          }
          if (isTransient(err)) {
            return {
              ok: false,
              kind: 'transient',
              reason: msg,
              latencyMs: now() - startTs,
            };
          }
          return {
            ok: false,
            kind: 'fatal',
            reason: 'unknown',
            detail: { message: msg },
            latencyMs: now() - startTs,
          };
        }
      }
    }

    // ── Optimizer tool phase (D-M6/D-M7) ────────────────────────────────
    // Bounded loop: generateContent with tools → execute via the optimizer
    // service → append summarized results → re-call, at most
    // OPTIMIZER_MAX_TOOL_ROUNDTRIPS times — then the final schema-mode call
    // below produces the locked v3 JSON. Any failure inside the loop
    // degrades to a docs-grounded answer instead of failing the turn (§6).
    const toolCalls: OptimizerToolCallSummary[] = [];
    let finalUserText = args.userText;
    if (toolLoopEnabled && deps.optimizer !== undefined) {
      const optimizer = deps.optimizer;
      const toolModel = sdk.getGenerativeModel({
        model,
        systemInstruction: { parts: [{ text: effectiveSystemPrompt }] },
        // No JSON mode here — responseSchema and tools are mutually
        // exclusive in the Gemini API.
        tools: [{ functionDeclarations: declarations }],
      });
      const toolContents: Content[] = [];
      for (let round = 0; round < OPTIMIZER_MAX_TOOL_ROUNDTRIPS; round++) {
        if (args.signal.aborted) break;
        let roundResult: GenerateContentResult;
        const ctrl = new AbortController();
        const onAbort = (): void => {
          ctrl.abort();
        };
        args.signal.addEventListener('abort', onAbort);
        inflight.add(ctrl);
        try {
          roundResult = await withTimeout(
            toolModel.generateContent(
              {
                contents: [
                  ...baseContents,
                  buildUserContent(args.userText),
                  ...toolContents,
                ],
              },
              { signal: ctrl.signal },
            ),
            ctrl,
          );
        } catch (err) {
          deps.logger.warn('optimizer.loop.roundFailed', {
            round,
            message: err instanceof Error ? err.message : String(err),
          });
          break;
        } finally {
          inflight.delete(ctrl);
          args.signal.removeEventListener('abort', onAbort);
        }
        const calls = functionCallsOf(roundResult);
        if (calls.length === 0) break;

        const responseParts: Part[] = [];
        for (const call of calls) {
          const execution = await optimizer.callTool(call.name, call.args);
          if (execution.ok) {
            toolCalls.push(execution.summary);
            responseParts.push({
              functionResponse: {
                name: call.name,
                response: { result: execution.summary.resultSummary },
              },
            });
          } else {
            // Engine 422s carry a readable detail the model can self-correct
            // from — feed it back once within the round cap (§6 risk table).
            const detail =
              execution.kind === 'engine'
                ? execution.detail
                : `optimizer unavailable (${execution.kind})`;
            toolCalls.push({
              tool: call.name,
              label: call.name,
              resultSummary: detail,
              durationMs: 0,
              ok: false,
            });
            responseParts.push({
              functionResponse: {
                name: call.name,
                response: { error: detail },
              },
            });
          }
        }
        // Replay the model's own parts verbatim (thoughtSignature included —
        // Gemini 3.x 400s if it's stripped from an echoed functionCall).
        toolContents.push({
          role: 'model',
          parts: calls.map((c) => c.part),
        });
        toolContents.push({ role: 'user', parts: responseParts });
        if (round === OPTIMIZER_MAX_TOOL_ROUNDTRIPS - 1) {
          deps.logger.info('optimizer.loop.capped', {
            rounds: OPTIMIZER_MAX_TOOL_ROUNDTRIPS,
            toolCallCount: toolCalls.length,
          });
        }
      }
      if (toolCalls.length > 0) {
        // D-M7: summarized results ride the final schema-mode call as plain
        // text — functionResponse parts are invalid without declared tools,
        // and text survives the JSON-retry path unchanged.
        const resultsBlock = toolCalls
          .map((c) => `- ${c.label}${c.ok ? '' : ' (FAILED)'}: ${c.resultSummary}`)
          .join('\n');
        finalUserText =
          `${args.userText}\n\n[COMPUTED OPTIMIZER RESULTS — ground your answer in these real numbers]\n${resultsBlock}`;
      }
    }

    // First attempt + transient retry policy.
    const firstResult = await runWithRetry(finalUserText);
    if (!isContentResult(firstResult)) {
      // Some non-success path won — record stats with `jsonOk: false`
      // so the rolling rate captures it accurately.
      deps.recordCall({
        ts: startTs,
        latencyMs: 'latencyMs' in firstResult ? firstResult.latencyMs : now() - startTs,
        promptTokenEstimate,
        jsonOk: false,
      });
      deps.logger.warn('gemini.callFailed', {
        kind: firstResult.kind,
        reason: 'reason' in firstResult ? firstResult.reason : undefined,
      });
      return firstResult;
    }

    let parsed = parseAnalysis(rawTextOf(firstResult));
    let attemptedJsonRetry = false;
    let raw: GenerateContentResult = firstResult;
    const firstRawText = rawTextOf(firstResult);
    if (parsed === null) {
      // PRD D8 — one auto-retry with the JSON reminder appended.
      attemptedJsonRetry = true;
      deps.logger.warn('gemini.jsonParseFailed', {
        promptHash,
        attempt: 1,
        rawSnippet: truncateLogSnippet(firstRawText),
      });
      const reminderText = `${finalUserText}\n\n${JSON_RETRY_REMINDER}`;
      const second = await runWithRetry(reminderText);
      if (!isContentResult(second)) {
        deps.recordCall({
          ts: startTs,
          latencyMs: 'latencyMs' in second ? second.latencyMs : now() - startTs,
          promptTokenEstimate,
          jsonOk: false,
        });
        return second;
      }
      raw = second;
      const secondText = rawTextOf(second);
      parsed = parseAnalysis(secondText);
      if (parsed === null) {
        deps.logger.error('gemini.jsonParseFailed', {
          promptHash,
          attempt: 2,
          rawSnippet: truncateLogSnippet(secondText),
        });
        deps.recordCall({
          ts: startTs,
          latencyMs: now() - startTs,
          promptTokenEstimate,
          jsonOk: false,
        });
        return {
          ok: false,
          kind: 'fatal',
          reason: 'invalid-json',
          detail: {
            firstSnippet: truncateLogSnippet(firstRawText),
            secondSnippet: truncateLogSnippet(secondText),
          },
          latencyMs: now() - startTs,
        };
      }
    }

    const latencyMs = now() - startTs;
    deps.recordCall({
      ts: startTs,
      latencyMs,
      promptTokenEstimate,
      jsonOk: true,
    });
    deps.logger.info('gemini.callCompleted', {
      model,
      promptHash,
      promptTokenEstimate,
      latencyMs,
      jsonOk: true,
      jsonRetryAttempted: attemptedJsonRetry,
      suggestionCount: parsed.suggested_parameter_changes.length,
      confidenceScore: parsed.confidence_score,
    });

    const turn: ChatTurn = {
      id: newId(),
      role: 'assistant',
      text: parsed.analysis,
      attachedScreenshotIds: [],
      structured: parsed,
      createdAt: now(),
      latencyMs,
      modelUsed: model,
    };

    return {
      ok: true,
      turn,
      raw,
      promptHash,
      promptTokenEstimate,
      latencyMs,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Summarize — used by `conversationStore.maybeTruncate` (D12)
  // -------------------------------------------------------------------------

  async function summarize(turns: readonly ChatTurn[]): Promise<string | null> {
    const apiKey = deps.getApiKey();
    if (apiKey === null) return null;
    if (turns.length === 0) return null;
    const sdk = sdkFactory(apiKey);
    const summaryModel = sdk.getGenerativeModel({
      model: SUMMARY_MODEL,
      generationConfig: { maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS },
    });
    const transcript = turns
      .map((t) => `${t.role === 'user' ? 'USER' : 'ASSISTANT'}: ${t.text}`)
      .join('\n\n');
    const ctrl = new AbortController();
    inflight.add(ctrl);
    try {
      const result = await withTimeout(
        summaryModel.generateContent(
          {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      `Summarize the following conversation between an Arch Public employee ` +
                      `and the co-pilot in a single short paragraph (max 120 words). Preserve ` +
                      `client objectives, input changes discussed, visible settings from ` +
                      `screenshots, and open questions. Do not add new information.\n\n${transcript}`,
                  },
                ],
              },
            ],
          },
          { signal: ctrl.signal },
        ),
        ctrl,
      );
      const text = rawTextOf(result).trim();
      if (text.length === 0) return null;
      return text;
    } catch (err) {
      deps.logger.warn('gemini.summaryFailed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      inflight.delete(ctrl);
    }
  }

  // -------------------------------------------------------------------------
  // Cancel-all + cache invalidation
  // -------------------------------------------------------------------------

  function cancelAll(): void {
    for (const c of inflight) {
      try {
        c.abort();
      } catch {
        /* noop */
      }
    }
    inflight.clear();
  }

  function invalidateSystemPromptCache(): void {
    cachedPrompt = null;
  }

  return {
    buildSystemPrompt,
    send,
    summarize,
    invalidateSystemPromptCache,
    cancelAll,
    hashPrompt,
  };
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function isContentResult(
  v: GenerateContentResult | GeminiSendError,
): v is GenerateContentResult {
  return (v as { ok?: boolean }).ok !== false;
}

/**
 * Pull well-formed functionCall parts from a tool-round response. Malformed
 * entries (missing name, non-object args) are dropped — a round with zero
 * usable calls ends the loop and the turn degrades to a docs-grounded answer.
 *
 * `part` is the ORIGINAL response part, kept verbatim for the replay turn:
 * Gemini 3.x attaches a `thoughtSignature` to functionCall parts and rejects
 * follow-up requests that echo the call without it (400, "missing a
 * thought_signature"), so the model turn must be rebuilt from these exact
 * parts, never reconstructed from name + args.
 */
function functionCallsOf(
  result: GenerateContentResult,
): { name: string; args: Record<string, unknown>; part: Part }[] {
  const cand = result.response.candidates?.[0];
  const parts = cand?.content.parts ?? [];
  const out: { name: string; args: Record<string, unknown>; part: Part }[] = [];
  for (const p of parts) {
    const fc = (p as { functionCall?: { name?: unknown; args?: unknown } }).functionCall;
    if (fc !== undefined && typeof fc.name === 'string' && fc.name.length > 0) {
      const fnArgs =
        typeof fc.args === 'object' && fc.args !== null && !Array.isArray(fc.args)
          ? (fc.args as Record<string, unknown>)
          : {};
      out.push({ name: fc.name, args: fnArgs, part: p });
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function estimatePromptTokens(args: {
  systemPrompt: string;
  history: readonly ChatTurn[];
  imageCount: number;
  userText: string;
}): number {
  const sysT = estimateTokensFromChars(args.systemPrompt.length);
  const histT = args.history.reduce(
    (sum, t) => sum + estimateTokensFromChars(t.text.length),
    0,
  );
  const userT = estimateTokensFromChars(args.userText.length);
  const imgT = args.imageCount * PER_IMAGE_TOKEN_ESTIMATE;
  return sysT + histT + userT + imgT;
}
