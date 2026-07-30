/**
 * @file tests/chatRaiseGate.spec.ts
 *
 * Locks the raise-suppression flag used so the Windows chat blur→moveTop
 * keep-alive yields to the region picker.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetChatRaiseSuppressedForTests,
  isChatRaiseSuppressed,
  setChatRaiseSuppressed,
} from '../src/main/chatRaiseGate';

describe('chatRaiseGate', () => {
  beforeEach(() => {
    __resetChatRaiseSuppressedForTests();
  });

  it('defaults to not suppressed', () => {
    expect(isChatRaiseSuppressed()).toBe(false);
  });

  it('setChatRaiseSuppressed(true) flips the gate on', () => {
    setChatRaiseSuppressed(true);
    expect(isChatRaiseSuppressed()).toBe(true);
  });

  it('setChatRaiseSuppressed(false) clears the gate', () => {
    setChatRaiseSuppressed(true);
    setChatRaiseSuppressed(false);
    expect(isChatRaiseSuppressed()).toBe(false);
  });

  it('reset hook clears a suppressed gate', () => {
    setChatRaiseSuppressed(true);
    __resetChatRaiseSuppressedForTests();
    expect(isChatRaiseSuppressed()).toBe(false);
  });
});
