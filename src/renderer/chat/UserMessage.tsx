/**
 * @file src/renderer/chat/UserMessage.tsx
 *
 * Why it exists: PRD §3.5 — renders a user turn. Plain text + an
 * "attached screenshots" indicator chip when the turn carried frames.
 */

import { type ReactElement } from 'react';
import type { ChatTurn } from '../../shared/types';

export interface UserMessageProps {
  turn: ChatTurn;
}

export default function UserMessage(props: UserMessageProps): ReactElement {
  const { turn } = props;
  return (
    <div className="flex justify-end px-4">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-ap-user-bubble px-3 py-2 text-sm text-ap-fg ring-1 ring-ap-green/40">
        <div className="whitespace-pre-wrap break-words">{turn.text}</div>
        {turn.attachedScreenshotIds.length > 0 && (
          <div className="mt-1 text-[10px] uppercase tracking-wide text-white/65">
            {turn.attachedScreenshotIds.length} screenshot
            {turn.attachedScreenshotIds.length === 1 ? '' : 's'} attached
          </div>
        )}
      </div>
    </div>
  );
}
