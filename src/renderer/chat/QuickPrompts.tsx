/**
 * @file src/renderer/chat/QuickPrompts.tsx
 *
 * Why it exists: PRD D16 — three preset chips above the input bar that
 * prefill the textarea. Verbatim text from `MVP_Chunking_Plan.md §2 — Chunk 5`.
 * Clicking a chip prefills, never auto-sends.
 */

import { type ReactElement } from 'react';
import { useChatStore } from './chatStore';

const QUICK_PROMPTS: readonly string[] = [
  'Current signal?',
  'Risk right now?',
  'More conservative settings?',
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
