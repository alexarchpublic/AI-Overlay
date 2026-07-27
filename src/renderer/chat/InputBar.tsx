/**
 * @file src/renderer/chat/InputBar.tsx
 *
 * Why it exists: PRD §3.5 — multi-line textarea + Send + ESC cancel.
 * Cmd-Enter (or Ctrl-Enter) sends. ESC cancels in-flight when the chat
 * is awaiting a response.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { SCREENSHOTS_PER_TURN } from '../../shared/aiConstants';
import { useChatStore } from './chatStore';
import PendingScreenshot from './PendingScreenshot';

const MAX_ROWS = 6;
const COUNTER_THRESHOLD = 500;
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.userAgent);
const SEND_MODIFIER_KEY = IS_MAC ? '⌘' : 'Ctrl';

export interface InputBarProps {
  /** When `true`, send button + textarea are disabled. */
  disabled?: boolean;
}

function CameraIcon(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M1 8.25a1.5 1.5 0 0 1 1.5-1.5h1.372a1.5 1.5 0 0 0 1.059-.44l1.059-1.06a1.5 1.5 0 0 1 1.06-.44h2.908a1.5 1.5 0 0 1 1.06.44l1.06 1.06a1.5 1.5 0 0 0 1.059.44H17.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 0 15.75V8.25Zm8.75 6.25a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM10 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function InputBar(props: InputBarProps): ReactElement {
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const state = useChatStore((s) => s.state);
  const pendingScreenshots = useChatStore((s) => s.pendingScreenshots);
  const addPendingScreenshot = useChatStore((s) => s.addPendingScreenshot);
  const removePendingScreenshot = useChatStore((s) => s.removePendingScreenshot);
  const clearPendingScreenshots = useChatStore((s) => s.clearPendingScreenshots);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [regionValid, setRegionValid] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.api.capture.getLoopState().then((ls) => {
      if (!cancelled) setRegionValid(ls.regionValid);
    });
    const off = window.api.capture.onLoopStateChanged((ls) => {
      setRegionValid(ls.regionValid);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Auto-grow up to MAX_ROWS lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '20');
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${String(Math.min(el.scrollHeight, maxHeight))}px`;
  }, [draft]);

  // Focus on mount so the cursor lands in the input the moment chat opens.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    if (state !== 'idle') return;
    const screenshotIds =
      pendingScreenshots.length > 0
        ? pendingScreenshots.map((s) => s.id)
        : undefined;
    setDraft('');
    clearPendingScreenshots();
    void window.api.chat.send(text, screenshotIds);
  }, [draft, state, setDraft, pendingScreenshots, clearPendingScreenshots]);

  const handleCapture = useCallback(async (): Promise<void> => {
    if (props.disabled === true || state !== 'idle' || !regionValid || isCapturing) {
      return;
    }
    if (pendingScreenshots.length >= SCREENSHOTS_PER_TURN) return;
    setIsCapturing(true);
    try {
      const shot = await window.api.capture.captureNow();
      if (shot !== null) {
        addPendingScreenshot(shot);
      }
    } finally {
      setIsCapturing(false);
    }
  }, [
    props.disabled,
    state,
    regionValid,
    isCapturing,
    pendingScreenshots.length,
    addPendingScreenshot,
  ]);

  const handleCancel = useCallback(() => {
    void window.api.chat.cancelInFlight();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
        return;
      }
      if (e.key === 'Escape') {
        if (state === 'awaiting' || state === 'sending') {
          e.preventDefault();
          handleCancel();
          return;
        }
        // Otherwise let parent handle ESC (close window).
      }
    },
    [handleSend, handleCancel, state],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>): void => {
      setDraft(e.target.value);
    },
    [setDraft],
  );

  const sendDisabled =
    props.disabled === true || state !== 'idle' || draft.trim().length === 0;

  const captureDisabled =
    props.disabled === true ||
    state !== 'idle' ||
    !regionValid ||
    isCapturing ||
    pendingScreenshots.length >= SCREENSHOTS_PER_TURN;

  const captureTitle = !regionValid
    ? 'Set a capture region in Settings first'
    : pendingScreenshots.length >= SCREENSHOTS_PER_TURN
      ? `At most ${String(SCREENSHOTS_PER_TURN)} screenshots per message`
      : 'Capture current region and attach to this message';

  return (
    <div className="border-t border-white/15 bg-ap-elevated px-3 pb-3 pt-2">
      <div className="rounded-xl border border-white/15 bg-ap-muted px-3 py-2 focus-within:border-ap-gold/60">
        {pendingScreenshots.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingScreenshots.map((shot) => (
              <PendingScreenshot
                key={shot.id}
                screenshot={shot}
                onRemove={() => {
                  removePendingScreenshot(shot.id);
                }}
              />
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the current signal, risk, or settings…"
          disabled={props.disabled === true}
          aria-label="Chat input"
          className="block w-full resize-none bg-transparent text-sm text-ap-fg placeholder:text-white/50 focus:outline-none disabled:opacity-40"
        />
        <div className="mt-2 flex items-center justify-between text-[10px] text-white/60">
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCapture()}
              disabled={captureDisabled}
              title={captureTitle}
              aria-label="Capture region"
              className="flex items-center justify-center rounded p-1 text-white/70 hover:bg-ap-elevated hover:text-ap-green disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CameraIcon />
            </button>
            <span>
              <kbd className="rounded bg-ap-elevated px-1 font-mono">{SEND_MODIFIER_KEY}</kbd>{' '}
              <kbd className="rounded bg-ap-elevated px-1 font-mono">↵</kbd> send ·{' '}
              <kbd className="rounded bg-ap-elevated px-1 font-mono">Esc</kbd> cancel
            </span>
          </span>
          <span className="flex items-center gap-2">
            {draft.length > COUNTER_THRESHOLD && <span>{draft.length} chars</span>}
            {state === 'awaiting' || state === 'sending' ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded bg-ap-muted px-2 py-1 text-[11px] text-ap-fg hover:bg-ap-elevated"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={sendDisabled}
                className="rounded bg-ap-green-action px-3 py-1 text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
