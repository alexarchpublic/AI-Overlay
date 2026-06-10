/**
 * @file tests/chatStore.spec.ts
 *
 * Why it exists: PRD §5 DoD #25 — covers Zustand transitions including
 * cancel + error variants. Pure store logic (no DOM).
 */

import { beforeEach, describe, it, expect } from 'vitest';
import { useChatStore } from '../src/renderer/chat/chatStore';
import type { ChatTurn } from '../src/shared/types';

function userTurn(id: string, text: string): ChatTurn {
  return {
    id,
    role: 'user',
    text,
    attachedScreenshotIds: [],
    createdAt: 1,
  };
}

beforeEach(() => {
  useChatStore.getState().clear();
  useChatStore.getState().setIsOpen(false);
  useChatStore.getState().setStats(null);
  useChatStore.getState().setModel('');
});

describe('chatStore', () => {
  it('appends turns in order', () => {
    useChatStore.getState().appendTurn(userTurn('u1', 'a'));
    useChatStore.getState().appendTurn(userTurn('u2', 'b'));
    expect(useChatStore.getState().turns.map((t) => t.id)).toEqual(['u1', 'u2']);
  });

  it('clears turns + draft + pending screenshots on clear()', () => {
    useChatStore.getState().setDraft('typing…');
    useChatStore.getState().addPendingScreenshot({
      id: 's1',
      timestamp: 0,
      filepath: '/tmp/x.jpg',
      regionId: 'r1',
      width: 100,
      height: 100,
      bytes: 1024,
    });
    useChatStore.getState().setError({ variant: 'no-api-key' });
    useChatStore.getState().appendTurn(userTurn('u1', 'a'));
    useChatStore.getState().clear();
    const s = useChatStore.getState();
    expect(s.turns).toEqual([]);
    expect(s.draft).toBe('');
    expect(s.pendingScreenshots).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.state).toBe('idle');
  });

  it('setError flips state to error and clears on null', () => {
    useChatStore.getState().setError({ variant: 'no-harness' });
    expect(useChatStore.getState().state).toBe('error');
    useChatStore.getState().setError(null);
    expect(useChatStore.getState().state).toBe('idle');
  });

  it('setState clears stale errors on non-error transitions', () => {
    useChatStore.getState().setError({
      variant: 'transient',
      reason: 'timeout',
      retryable: true,
    });
    useChatStore.getState().setState('idle');
    expect(useChatStore.getState().error).toBeNull();
  });

  it('setState preserves error when transitioning back to error', () => {
    useChatStore.getState().setError({ variant: 'no-api-key' });
    useChatStore.getState().setState('error');
    expect(useChatStore.getState().error).toEqual({ variant: 'no-api-key' });
  });
});
