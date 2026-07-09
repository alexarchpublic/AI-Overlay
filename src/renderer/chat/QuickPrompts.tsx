/**
 * @file src/renderer/chat/QuickPrompts.tsx
 *
 * PRD §3.6 — six call-scenario quick prompts for internal sales/CS.
 * Clicking a chip prefills the draft; it never auto-sends.
 */

import { type ReactElement } from 'react';
import { useChatStore } from './chatStore';

const QUICK_PROMPTS: readonly string[] = [
  'Client wants fewer trades during chop',
  'Client wants to deploy cash faster',
  "Why isn't the client's algo trading?",
  'Explain Scope in client-friendly terms',
  'Client is worried about buying into a falling market',
  "Read the client's current settings off the latest screenshot",
];

export interface QuickPromptsProps {
  /** When `true`, chips are visually disabled and clicks are no-ops. */
  disabled?: boolean;
}

export default function QuickPrompts(props: QuickPromptsProps): ReactElement {
  const setDraft = useChatStore((s) => s.setDraft);
  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {QUICK_PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          disabled={props.disabled === true}
          onClick={() => {
            setDraft(p);
          }}
          className="rounded-full border border-white/20 bg-ap-muted px-3 py-1 text-xs text-ap-fg transition hover:border-ap-gold/60 hover:bg-ap-elevated disabled:cursor-not-allowed disabled:opacity-40"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
