/**
 * @file tests/conversationStore.spec.ts
 *
 * Why it exists: PRD §3.7 / §5 DoD #25 — covers session lifecycle,
 * turn append, drop-on-cancel, and the truncation+summary path. The
 * summarizer is injected (PRD §3.7) so we can drive both happy + failure
 * paths without touching the SDK.
 */

import { describe, it, expect, vi } from 'vitest';
import { createConversationStore } from '../src/main/conversationStore';
import { HISTORY_KEEP_PAIRS, HISTORY_TRUNCATE_AT_PAIRS } from '../src/shared/aiConstants';
import type { ChatTurn } from '../src/shared/types';

function makeLogger(): {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  child: (b: Record<string, unknown>) => ReturnType<typeof makeLogger>;
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

describe('conversationStore', () => {
  it('starts a new session and assigns a stable id', () => {
    let counter = 0;
    const store = createConversationStore({
      logger: makeLogger(),
      newId: () => `id-${String(counter++)}`,
      now: () => 1_700_000_000_000,
    });
    expect(store.getSessionId()).toBeNull();
    const sid = store.startSession();
    expect(sid).toBe('id-0');
    expect(store.getSessionId()).toBe('id-0');
    // Idempotent
    expect(store.startSession()).toBe('id-0');
  });

  it('clears history on endSession', () => {
    const store = createConversationStore({ logger: makeLogger() });
    store.startSession();
    store.appendUser({ text: 'hi', attachedScreenshotIds: [], promptTokenEstimate: 10 });
    expect(store.getHistory()).toHaveLength(1);
    store.endSession('close');
    expect(store.getHistory()).toEqual([]);
    expect(store.getSessionId()).toBeNull();
  });

  it('appendUser/appendAssistant produce monotonic turns', () => {
    let n = 0;
    const store = createConversationStore({
      logger: makeLogger(),
      newId: () => `t-${String(n++)}`,
    });
    store.startSession();
    const u = store.appendUser({ text: 'q', attachedScreenshotIds: ['s1'], promptTokenEstimate: 5 });
    const a = store.appendAssistant({ text: 'r', latencyMs: 1234, modelUsed: 'gemini-3.1-pro-preview' });
    expect(u.role).toBe('user');
    expect(a.role).toBe('assistant');
    expect(a.latencyMs).toBe(1234);
    expect(store.getHistory().map((t) => t.id)).toEqual([u.id, a.id]);
  });

  it('dropTurn removes the matching turn from history', () => {
    const store = createConversationStore({ logger: makeLogger() });
    store.startSession();
    const u = store.appendUser({ text: 'q', attachedScreenshotIds: [], promptTokenEstimate: 0 });
    store.dropTurn(u.id);
    expect(store.getHistory()).toEqual([]);
  });

  it('does not truncate below the threshold', async () => {
    const store = createConversationStore({ logger: makeLogger() });
    store.startSession();
    for (let i = 0; i < 5; i++) {
      store.appendUser({ text: `u${String(i)}`, attachedScreenshotIds: [], promptTokenEstimate: 0 });
      store.appendAssistant({ text: `a${String(i)}`, latencyMs: 0, modelUsed: 'flash' });
    }
    const summarize = vi.fn(async () => 'summary');
    await store.maybeTruncate(summarize);
    expect(summarize).not.toHaveBeenCalled();
    expect(store.getHistory()).toHaveLength(10);
  });

  it('truncates above the threshold and prepends a system-summary', async () => {
    const store = createConversationStore({ logger: makeLogger() });
    store.startSession();
    for (let i = 0; i < HISTORY_TRUNCATE_AT_PAIRS + 1; i++) {
      store.appendUser({ text: `u${String(i)}`, attachedScreenshotIds: [], promptTokenEstimate: 0 });
      store.appendAssistant({ text: `a${String(i)}`, latencyMs: 0, modelUsed: 'flash' });
    }
    const summarize = vi.fn(async (older: readonly ChatTurn[]) =>
      `summary of ${String(older.length)}`,
    );
    await store.maybeTruncate(summarize);
    expect(summarize).toHaveBeenCalledOnce();
    const after = store.getHistory();
    expect(after[0]?.role).toBe('system-summary');
    expect(after[0]?.text).toContain('summary of');
    // Should retain exactly 2 * HISTORY_KEEP_PAIRS recent turns.
    expect(after).toHaveLength(2 * HISTORY_KEEP_PAIRS + 1);
  });

  it('keeps raw turns when summary returns null (non-fatal)', async () => {
    const store = createConversationStore({ logger: makeLogger() });
    store.startSession();
    for (let i = 0; i < HISTORY_TRUNCATE_AT_PAIRS + 1; i++) {
      store.appendUser({ text: `u${String(i)}`, attachedScreenshotIds: [], promptTokenEstimate: 0 });
      store.appendAssistant({ text: `a${String(i)}`, latencyMs: 0, modelUsed: 'flash' });
    }
    const summarize = vi.fn(async () => null);
    const before = store.getHistory().length;
    await store.maybeTruncate(summarize);
    expect(summarize).toHaveBeenCalledOnce();
    expect(store.getHistory().length).toBe(before);
  });
});
