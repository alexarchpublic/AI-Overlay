/**
 * @file src/renderer/chat/ChatError.tsx
 *
 * Why it exists: PRD D25 — five-variant error banner. Sits above the
 * message list. `'no-api-key'` and `'no-harness'` carry CTAs that route
 * the user to settings; `'transient'` carries a Retry button; `'fatal'`
 * surfaces the underlying reason and (optionally) detail JSON.
 */

import { type ReactElement } from 'react';
import type { ChatError } from '../../shared/types';

export interface ChatErrorProps {
  error: ChatError;
  /** Triggered by the "Retry" button on transient errors. */
  onRetry?: () => void;
  /** Settings shortcut for the no-key / no-harness paths. */
  onOpenSettings?: () => void;
}

export default function ChatErrorView(props: ChatErrorProps): ReactElement {
  const { error } = props;
  const baseClass =
    'mx-3 my-2 rounded-md border border-amber-400/50 bg-ap-warning px-3 py-2 text-xs text-amber-100';

  switch (error.variant) {
    case 'no-api-key':
      return (
        <div role="alert" className={baseClass}>
          <div className="font-semibold">No Gemini API key set.</div>
          <div className="mt-1 text-amber-50/80">
            Add a key in AI Settings to start chatting.
          </div>
          <button
            type="button"
            onClick={props.onOpenSettings}
            className="mt-2 rounded bg-ap-muted px-2 py-1 text-[11px] text-ap-fg hover:bg-ap-elevated"
          >
            Open AI Settings
          </button>
        </div>
      );
    case 'no-harness':
      return (
        <div role="alert" className={baseClass}>
          <div className="font-semibold">No knowledge bundle loaded.</div>
          <div className="mt-1 text-amber-50/80">
            Run <code className="font-mono">npm run ingest:docs</code> from the
            project repo, then restart the app so the AI can ground answers in
            the published documentation.
          </div>
          <button
            type="button"
            onClick={props.onOpenSettings}
            className="mt-2 rounded bg-ap-muted px-2 py-1 text-[11px] text-ap-fg hover:bg-ap-elevated"
          >
            Open Knowledge Settings
          </button>
        </div>
      );
    case 'token-ceiling':
      return (
        <div role="alert" className={baseClass}>
          <div className="font-semibold">Request too large to send.</div>
          <div className="mt-1 text-amber-50/80">
            Approx tokens: {error.approxTokens.toLocaleString()} · Ceiling:{' '}
            {error.ceiling.toLocaleString()}. Close + reopen the chat to clear
            history, or send a shorter message.
          </div>
        </div>
      );
    case 'transient':
      return (
        <div role="alert" className={baseClass}>
          <div className="font-semibold">Taking longer than expected.</div>
          <div className="mt-1 text-amber-50/80">
            {error.reason === 'timeout'
              ? 'The model did not respond within 30 seconds.'
              : `Network or upstream error: ${error.reason}`}
          </div>
          {props.onRetry && (
            <button
              type="button"
              onClick={props.onRetry}
              className="mt-2 rounded bg-ap-muted px-2 py-1 text-[11px] text-ap-fg hover:bg-ap-elevated"
            >
              Retry
            </button>
          )}
        </div>
      );
    case 'fatal':
      return (
        <div
          role="alert"
          className="mx-3 my-2 rounded-md border border-red-400/50 bg-ap-error px-3 py-2 text-xs text-red-100"
        >
          <div className="font-semibold">
            {fatalHeadline(error.reason)}
          </div>
          <div className="mt-1 text-red-50/80">
            {fatalSubtext(error.reason)}
          </div>
          {error.detail && (
            <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-ap-elevated p-2 font-mono text-[10px] leading-snug text-red-50/85">
              {JSON.stringify(error.detail, null, 2)}
            </pre>
          )}
        </div>
      );
  }
}

function fatalHeadline(reason: string): string {
  switch (reason) {
    case 'invalid-api-key':
      return 'API key rejected.';
    case 'invalid-json':
      return 'Model returned invalid JSON twice.';
    case 'safety':
      return 'Response blocked by safety filter.';
    default:
      return 'Unrecoverable error.';
  }
}

function fatalSubtext(reason: string): string {
  switch (reason) {
    case 'invalid-api-key':
      return 'Re-enter your Gemini key in AI Settings.';
    case 'invalid-json':
      return 'The model failed JSON-mode parsing twice in a row. Check the log line gemini.jsonParseFailed.';
    case 'safety':
      return 'Gemini blocked the response. See safetyRatings below.';
    default:
      return 'See the log line gemini.callFailed for details.';
  }
}
