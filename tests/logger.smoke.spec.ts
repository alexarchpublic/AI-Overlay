/**
 * @file tests/logger.smoke.spec.ts
 *
 * Why it exists: PRD §5.2 / §7 — prove the pino shape and redaction behavior
 * before any later chunk builds on top of them. Runs in pure Node (no Electron),
 * so `registerRendererLogBridge` is intentionally untouched here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLoggerOptions,
  wrapPino,
  createAppLogger,
  REDACT_PATHS,
  sanitizeLogContext,
  LOG_TRUNCATE_KEYS,
} from '../src/main/logger';
import { APP_NAME, REDACT_PLACEHOLDER, LOG_DIR_NAME } from '../src/shared/constants';

function collectLogs(): { stream: Writable; records: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  return {
    stream,
    records: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('AppLogger — shape and redaction', () => {
  it('emits a JSON line with the expected event + context fields', () => {
    const sink = collectLogs();
    const logger = wrapPino(pino(buildLoggerOptions(), sink.stream));

    logger.info('x', { k: 'v' });

    const records = sink.records();
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toBeDefined();
    expect(record?.event).toBe('x');
    expect(record?.k).toBe('v');
    expect(record?.app).toBe(APP_NAME);
    expect(typeof record?.time).toBe('string');
  });

  it('redacts apiKey values at top level and nested', () => {
    const sink = collectLogs();
    const logger = wrapPino(pino(buildLoggerOptions(), sink.stream));

    logger.info('gemini.call', {
      apiKey: 'sk-should-not-leak',
      nested: { apiKey: 'also-gone' },
      authorization: 'Bearer leaky-token',
    });

    const [record] = sink.records();
    const raw = JSON.stringify(record);

    expect(record?.apiKey).toBe(REDACT_PLACEHOLDER);
    expect((record?.nested as Record<string, unknown> | undefined)?.apiKey).toBe(
      REDACT_PLACEHOLDER,
    );
    expect(record?.authorization).toBe(REDACT_PLACEHOLDER);
    expect(raw).not.toContain('sk-should-not-leak');
    expect(raw).not.toContain('also-gone');
    expect(raw).not.toContain('Bearer leaky-token');
  });

  it('preserves non-sensitive context verbatim', () => {
    const sink = collectLogs();
    const logger = wrapPino(pino(buildLoggerOptions(), sink.stream));

    logger.warn('benign.event', { count: 42, note: 'hello' });

    const [record] = sink.records();
    expect(record?.event).toBe('benign.event');
    expect(record?.count).toBe(42);
    expect(record?.note).toBe('hello');
    // pino's default numeric level for `warn` is 40.
    expect(record?.level).toBe(40);
  });

  it('exposes redact paths that cover the known Chunk 5/6 secret surface', () => {
    // Meta-check — when Chunk 5 adds a Gemini-specific secret field, this test
    // will remind the author to extend REDACT_PATHS before it ships.
    expect(REDACT_PATHS).toContain('apiKey');
    expect(REDACT_PATHS).toContain('geminiApiKey');
    expect(REDACT_PATHS).toContain('authorization');
    expect(REDACT_PATHS).toContain('*.apiKey');
  });

  it('child loggers inherit the wrapper facade', () => {
    const sink = collectLogs();
    const logger = wrapPino(pino(buildLoggerOptions(), sink.stream));
    const child = logger.child({ module: 'unit-test' });

    child.info('child.event', { k: 'v' });

    const [record] = sink.records();
    expect(record?.event).toBe('child.event');
    expect(record?.module).toBe('unit-test');
    expect(record?.k).toBe('v');
  });

  it('truncates model-output fields before write', () => {
    const sink = collectLogs();
    const logger = wrapPino(pino(buildLoggerOptions(), sink.stream));
    const longText = `${'x'.repeat(300)} sensitive tail`;

    logger.warn('gemini.jsonParseFailed', {
      rawSnippet: longText,
      detail: { firstSnippet: longText },
    });

    const [record] = sink.records();
    const raw = JSON.stringify(record);

    expect(record?.rawSnippet).toMatch(/\[truncated\]$/);
    expect((record?.detail as Record<string, unknown>)?.firstSnippet).toMatch(/\[truncated\]$/);
    expect(raw).not.toContain('sensitive tail');
  });

  it('sanitizeLogContext passes benign model suggestions through', () => {
    const out = sanitizeLogContext({ rawSnippet: 'Try ~1.5× ATR on your chart.' });
    expect(out.rawSnippet).toBe('Try ~1.5× ATR on your chart.');
  });

  it('exposes truncate keys for model-output log fields', () => {
    expect(LOG_TRUNCATE_KEYS).toContain('rawSnippet');
    expect(LOG_TRUNCATE_KEYS).toContain('detail.firstSnippet');
  });
});

/**
 * Poll `logDir` until it contains a non-empty log file (the pino
 * `destination` write is async, so the file may not exist — or may be
 * empty — for a few ticks after the synchronous `logger.info()` call).
 */
async function waitForLogFileContent(logDir: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  for (;;) {
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir);
      const file = files[0];
      if (file) {
        const content = fs.readFileSync(path.join(logDir, file), 'utf8');
        if (content.trim().length > 0) return content;
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for a written log file in ${logDir}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('createAppLogger — pretty gating is fail-safe (Chunk 7 B3)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-pretty-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('pretty: false writes plain JSONL via pino.destination, never the dev transport', async () => {
    const logger = createAppLogger({ baseDir: tmp, pretty: false });
    expect(() => {
      logger.info('smoke.prettyFalse', { k: 'v' });
    }).not.toThrow();

    const content = await waitForLogFileContent(path.join(tmp, LOG_DIR_NAME));
    const [firstLine] = content.split('\n').filter((l) => l.trim().length > 0);
    const record = JSON.parse(firstLine as string) as Record<string, unknown>;
    expect(record.event).toBe('smoke.prettyFalse');
    expect(record.k).toBe('v');
  });

  it('pretty omitted (undefined) also writes plain JSONL — never inferred from NODE_ENV', async () => {
    const logger = createAppLogger({ baseDir: tmp });
    expect(() => {
      logger.info('smoke.prettyUndefined', { k: 'v2' });
    }).not.toThrow();

    const content = await waitForLogFileContent(path.join(tmp, LOG_DIR_NAME));
    const [firstLine] = content.split('\n').filter((l) => l.trim().length > 0);
    const record = JSON.parse(firstLine as string) as Record<string, unknown>;
    expect(record.event).toBe('smoke.prettyUndefined');
    expect(record.k).toBe('v2');
  });
});
