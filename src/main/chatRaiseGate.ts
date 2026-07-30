/**
 * @file src/main/chatRaiseGate.ts
 *
 * Module-scoped gate that lets the Windows chat always-on-top keep-alive
 * (blur→moveTop) yield to a higher-priority overlay such as the region
 * picker. Kept free of Electron imports so Vitest can cover the flag.
 */

let raiseSuppressed = false;

/** Suppress (or restore) the chat window's Windows raise-on-blur behavior. */
export function setChatRaiseSuppressed(on: boolean): void {
  raiseSuppressed = on;
}

/** Whether chat raise-on-blur is currently suppressed. */
export function isChatRaiseSuppressed(): boolean {
  return raiseSuppressed;
}

/** Test/reset hook. */
export function __resetChatRaiseSuppressedForTests(): void {
  raiseSuppressed = false;
}
