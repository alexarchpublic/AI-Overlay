/**
 * @file src/main/logger.ts
 *
 * Why it exists: Single source of truth for structured logging across main and
 * renderer. All records land in `logs/app-YYYY-MM-DD.jsonl` via pino. Renderer
 * code calls `window.api.log.*` (wired in preload) which forwards to the
 * `log:message` IPC channel; `registerRendererLogBridge` in this file is the
 * only main-side consumer.
 *
 * Chunk 1 intentionally locks the pino shape, the `(event, context)` facade,
 * and the redaction paths so Chunk 5 (Gemini integration) and Chunk 6 (rich
 * logging / handoff) inherit a stable format without retrofitting.
 *
 * Phase 0 task 7 extends redaction: model-output fields (`rawSnippet`, etc.)
 * pass through the deterministic firewall gate via `sanitizeLogContext`.
 */

import fs from 'node:fs';
import path from 'node:path';
import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';
import {
  APP_NAME,
  LOG_DIR_NAME,
  LOG_FILENAME_FORMAT,
  REDACT_PLACEHOLDER,
} from '../shared/constants';
import { redactLogSnippet } from '../shared/firewall/deterministicGate';
import type { LogContext, LogLevel, RendererLogMessage } from '../shared/types';

/**
 * Project-wide logging contract: `(event, context)` rather than raw pino calls.
 * Every record carries a stable `event` field so Chunk 6 can index on it.
 */
export interface AppLogger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  /** Fork a child logger that pre-binds additional fields on every record. */
  child(bindings: LogContext): AppLogger;
  /** Escape hatch — direct access to the underlying pino instance. */
  readonly raw: Logger;
}

/**
 * Redact-path list. Anything matching these keys at any supported depth is
 * replaced with `REDACT_PLACEHOLDER` before the record reaches the stream.
 *
 * Seeded broadly now so Gemini API keys (Chunk 5), auth headers (Chunk 6), and
 * any incidental secret smuggled into a log payload are covered from day one.
 */
export const REDACT_PATHS: readonly string[] = [
  'apiKey',
  'api_key',
  'geminiApiKey',
  'authorization',
  'secret',
  'token',
  '*.apiKey',
  '*.api_key',
  '*.geminiApiKey',
  '*.authorization',
  '*.secret',
  '*.token',
  'headers.authorization',
];

/**
 * Context keys whose string values may carry model output — sanitized via the
 * deterministic firewall gate before the record is written (PRD §5.8).
 */
export const LOG_FIREWALL_SANITIZE_KEYS: readonly string[] = [
  'rawSnippet',
  'firstSnippet',
  'secondSnippet',
  'analysis',
  'modelOutput',
  'summary',
  'detail.firstSnippet',
  'detail.secondSnippet',
];

const FIREWALL_SANITIZE_KEY_SET = new Set(LOG_FIREWALL_SANITIZE_KEYS);

/** Walk log context and firewall-sanitize known model-output string fields. */
export function sanitizeLogContext(context: LogContext | undefined): LogContext {
  if (!context) return {};

  const out: LogContext = { ...context };

  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string' && FIREWALL_SANITIZE_KEY_SET.has(key)) {
      out[key] = redactLogSnippet(value);
      continue;
    }

    if (key === 'detail' && typeof value === 'object' && value !== null) {
      const detail = { ...(value as Record<string, unknown>) };
      for (const [detailKey, detailValue] of Object.entries(detail)) {
        const path = `detail.${detailKey}`;
        if (typeof detailValue === 'string' && FIREWALL_SANITIZE_KEY_SET.has(path)) {
          detail[detailKey] = redactLogSnippet(detailValue);
        }
      }
      out.detail = detail;
    }
  }

  return out;
}

/**
 * Format today's JSONL filename. UTC date so the filename remains stable during
 * timezone changes across a single session (the record timestamps are ISO).
 */
export function formatLogFilename(now: Date): string {
  const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return LOG_FILENAME_FORMAT.replace('YYYY', yyyy).replace('MM', mm).replace('DD', dd);
}

/** Build the pino options shared by prod and test instantiations. */
export function buildLoggerOptions(): LoggerOptions {
  return {
    base: { app: APP_NAME, platform: process.platform },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACT_PLACEHOLDER,
    },
  };
}

/** Ensure the log directory exists under `baseDir` and return its path. */
function resolveLogDir(baseDir: string): string {
  const dir = path.resolve(baseDir, LOG_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Wrap a raw pino logger in the `(event, context)` facade. Exported so tests
 * exercise the exact same adapter the running app uses.
 */
export function wrapPino(base: Logger): AppLogger {
  const toPayload = (event: string, context?: LogContext): Record<string, unknown> => ({
    event,
    ...sanitizeLogContext(context),
  });
  return {
    debug(event, context) {
      base.debug(toPayload(event, context));
    },
    info(event, context) {
      base.info(toPayload(event, context));
    },
    warn(event, context) {
      base.warn(toPayload(event, context));
    },
    error(event, context) {
      base.error(toPayload(event, context));
    },
    child(bindings) {
      return wrapPino(base.child(bindings));
    },
    get raw() {
      return base;
    },
  };
}

export interface CreateAppLoggerInput {
  /**
   * Root directory for the `logs/` folder. In Electron this is `app.getPath('userData')`;
   * tests pass `process.cwd()` or a tempdir.
   */
  baseDir?: string;
  /** Inject a stream — used by tests to capture JSONL output in memory. */
  destination?: DestinationStream;
  /** Override the pretty-print dev transport gating (defaults to `NODE_ENV !== 'production'`). */
  pretty?: boolean;
}

/**
 * Create a fresh `AppLogger`. Idempotency is the caller's responsibility — in
 * main we call this exactly once; tests mint a new one per spec.
 */
export function createAppLogger(input: CreateAppLoggerInput = {}): AppLogger {
  const opts = buildLoggerOptions();
  const baseDir = input.baseDir ?? process.cwd();

  if (input.destination) {
    // Test path — inject the capture stream.
    return wrapPino(pino(opts, input.destination));
  }

  const logFilePath = path.join(resolveLogDir(baseDir), formatLogFilename(new Date()));
  const shouldPretty = input.pretty ?? process.env.NODE_ENV !== 'production';

  if (shouldPretty) {
    // Dev transport: JSONL file is always authoritative; pretty-print mirrors
    // to the terminal for developer ergonomics only.
    return wrapPino(
      pino({
        ...opts,
        transport: {
          targets: [
            {
              target: 'pino/file',
              level: 'debug',
              options: { destination: logFilePath, mkdir: true },
            },
            {
              target: 'pino-pretty',
              level: 'debug',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
          ],
        },
      }),
    );
  }

  return wrapPino(
    pino(
      opts,
      pino.destination({ dest: logFilePath, sync: false, mkdir: true }),
    ),
  );
}

/**
 * Wire the `log:message` IPC channel that the preload bridge forwards to.
 * Called once from `main/index.ts` after the logger is initialized.
 *
 * Electron is imported lazily so this module stays importable from Vitest
 * (which has no Electron binary on its classpath).
 */
export function registerRendererLogBridge(logger: AppLogger): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcMain } = require('electron') as typeof import('electron');

  ipcMain.on('log:message', (_event, msg: unknown): void => {
    if (!isRendererLogMessage(msg)) return;
    const payload: LogContext = {
      source: 'renderer',
      ...(msg.context ?? {}),
    };
    writeLevel(logger, msg.level, msg.event, payload);
  });
}

function writeLevel(logger: AppLogger, level: LogLevel, event: string, context: LogContext): void {
  switch (level) {
    case 'debug':
      logger.debug(event, context);
      return;
    case 'warn':
      logger.warn(event, context);
      return;
    case 'error':
      logger.error(event, context);
      return;
    case 'info':
    default:
      logger.info(event, context);
  }
}

function isRendererLogMessage(value: unknown): value is RendererLogMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.event !== 'string') return false;
  if (typeof v.level !== 'string') return false;
  if (!['debug', 'info', 'warn', 'error'].includes(v.level)) return false;
  if (v.context !== undefined && (typeof v.context !== 'object' || v.context === null)) return false;
  return true;
}
