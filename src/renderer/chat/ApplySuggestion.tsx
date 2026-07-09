/**
 * @file src/renderer/chat/ApplySuggestion.tsx
 *
 * Why it exists: each `suggested_parameter_changes` row gets a "Copy" button
 * that writes the deterministic plain-text representation to the clipboard.
 * **No** TradingView mutation occurs (auto-apply is Post-MVP).
 *
 * Format (schema v3): `<parameter>: <current|—> → <suggested_value> (<doc_ref>)
 * — <rationale>`. Locked here + in `formatSuggestionForClipboard` in
 * `registerChatAiIpc.ts`; both must stay byte-equivalent.
 */

import { useCallback, useState, type ReactElement } from 'react';
import type { SuggestedParameterChange } from '../../shared/types';

export interface ApplySuggestionProps {
  suggestion: SuggestedParameterChange;
}

export default function ApplySuggestion(props: ApplySuggestionProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void window.api.chat.copySuggestion(props.suggestion).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  }, [props.suggestion]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy suggestion for ${props.suggestion.parameter}`}
      className="rounded border border-white/15 bg-ap-muted px-2 py-0.5 text-[11px] text-ap-fg transition hover:border-ap-gold/60 hover:bg-ap-elevated"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
