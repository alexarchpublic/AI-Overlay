/**
 * @file src/renderer/chat/TypingIndicator.tsx
 *
 * Why it exists: PRD §3.5 — visible only while `chatState === 'awaiting'`.
 * Three-dot pulse, monospace.
 */

import { type ReactElement } from 'react';

export default function TypingIndicator(): ReactElement {
  return (
    <div
      className="flex items-center gap-1 rounded-md bg-ap-muted px-3 py-2 font-mono text-xs text-white/85"
      role="status"
      aria-live="polite"
      aria-label="Assistant is thinking"
    >
      <span className="animate-pulse">•</span>
      <span className="animate-pulse" style={{ animationDelay: '120ms' }}>
        •
      </span>
      <span className="animate-pulse" style={{ animationDelay: '240ms' }}>
        •
      </span>
    </div>
  );
}
