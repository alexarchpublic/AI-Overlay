/**
 * @file src/renderer/chat/TalkTrack.tsx
 *
 * PRD §3.4 — client-safe phrasing block with copy-to-clipboard for live calls.
 */

import { useCallback, useState, type ReactElement } from 'react';

export interface TalkTrackProps {
  text: string;
}

export default function TalkTrack(props: TalkTrackProps): ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void window.api.chat.copyTalkTrack(props.text).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  }, [props.text]);

  return (
    <div className="mt-3 rounded-md border border-sky-400/35 bg-sky-950/40 px-3 py-2 text-[12px] text-sky-50">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-sky-200/80">
          Say it to the client
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy talk track"
          className="rounded border border-sky-300/25 bg-sky-900/50 px-2 py-0.5 text-[10px] text-sky-50 transition hover:border-sky-200/50 hover:bg-sky-900/80"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="leading-relaxed">{props.text}</p>
    </div>
  );
}
