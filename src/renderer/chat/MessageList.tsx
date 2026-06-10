/**
 * @file src/renderer/chat/MessageList.tsx
 *
 * Why it exists: PRD §3.5 — newest-at-bottom transcript with sticky-bottom
 * scroll behavior. Auto-scrolls only if the user is within 64px of the
 * bottom (preserves manual scroll otherwise).
 */

import { useEffect, useRef, type ReactElement } from 'react';
import type { ChatTurn } from '../../shared/types';
import AssistantMessage from './AssistantMessage';
import UserMessage from './UserMessage';
import TypingIndicator from './TypingIndicator';

const STICKY_THRESHOLD_PX = 64;

export interface MessageListProps {
  turns: readonly ChatTurn[];
  showTyping: boolean;
}

export default function MessageList(props: MessageListProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);

  // Track whether the user is "near the bottom" so we only auto-scroll on
  // new turns when they were already following along.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      wasNearBottomRef.current = distFromBottom < STICKY_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Auto-scroll on new turn only if the user was at the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!wasNearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [props.turns.length, props.showTyping]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto py-3"
      role="log"
      aria-live="polite"
      aria-label="Chat transcript"
    >
      <div className="flex flex-col gap-3">
        {props.turns.map((t) =>
          t.role === 'user' ? (
            <UserMessage key={t.id} turn={t} />
          ) : (
            <AssistantMessage key={t.id} turn={t} />
          ),
        )}
        {props.showTyping && (
          <div className="px-4">
            <TypingIndicator />
          </div>
        )}
      </div>
    </div>
  );
}
