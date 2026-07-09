/**
 * @file src/renderer/chat/ChatPanel.tsx
 *
 * Why it exists: PRD §3.5 / §3.3 — top-level chat layout (header + error
 * banner + message list + quick prompts + input bar). Boots by pulling
 * the existing history (in-process), the active model name, and the
 * harness/api-key prerequisite states; subscribes to all push events for
 * the rest of its lifetime.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ChatError, ChatTurn } from '../../shared/types';
import 'highlight.js/styles/atom-one-dark.css';
import { useChatStore } from './chatStore';
import MessageList from './MessageList';
import InputBar from './InputBar';
import QuickPrompts from './QuickPrompts';
import ChatErrorView from './ChatError';
import ChatHeader from './ChatHeader';

export default function ChatPanel(): ReactElement {
  const turns = useChatStore((s) => s.turns);
  const state = useChatStore((s) => s.state);
  const error = useChatStore((s) => s.error);
  const model = useChatStore((s) => s.model);
  const setTurns = useChatStore((s) => s.setTurns);
  const appendTurn = useChatStore((s) => s.appendTurn);
  const removeTurn = useChatStore((s) => s.removeTurn);
  const setState = useChatStore((s) => s.setState);
  const setError = useChatStore((s) => s.setError);
  const setModel = useChatStore((s) => s.setModel);
  const setActiveAlgorithm = useChatStore((s) => s.setActiveAlgorithm);
  const clear = useChatStore((s) => s.clear);

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [hasKnowledge, setHasKnowledge] = useState<boolean | null>(null);

  // -------------------------------------------------------------------------
  // Boot — initial pulls + subscriptions
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      try {
        const [history, modelName, apiKey, knowledgeReady, activeAlgorithm] = await Promise.all([
          window.api.chat.getHistory(),
          window.api.ai.getModel(),
          window.api.ai.getApiKey(),
          window.api.chat.getKnowledgeReady().catch(() => false),
          window.api.knowledge.getActiveAlgorithm(),
        ]);
        if (cancelled) return;
        setTurns([...history]);
        setModel(modelName);
        setActiveAlgorithm(activeAlgorithm);
        setHasApiKey(apiKey.present);
        setHasKnowledge(knowledgeReady);
        // Surface implicit error states even before the user types.
        if (!apiKey.present) {
          setError({ variant: 'no-api-key' });
        } else if (!knowledgeReady) {
          setError({ variant: 'no-harness' });
        }
        window.api.log.debug('chat.bootSnapshot', {
          turnCount: history.length,
          model: modelName,
          apiKeyPresent: apiKey.present,
          knowledgeReady,
        });
      } catch (err) {
        window.api.log.error('chat.bootFailed', { message: String(err) });
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [setTurns, setModel, setActiveAlgorithm, setError]);

  useEffect(() => {
    const offTurn = window.api.chat.onTurnAppended((t: ChatTurn) => {
      appendTurn(t);
    });
    const offDropped = window.api.chat.onTurnDropped((turnId: string) => {
      removeTurn(turnId);
    });
    const offState = window.api.chat.onStateChanged((s) => {
      setState(s);
    });
    const offError = window.api.chat.onError((e: ChatError) => {
      setError(e);
    });
    const offCleared = window.api.chat.onHistoryCleared(() => {
      clear();
    });
    return () => {
      offTurn();
      offDropped();
      offState();
      offError();
      offCleared();
    };
  }, [appendTurn, removeTurn, setState, setError, clear]);

  // Track api-key + knowledge readiness so the gate dynamically dismisses
  // once the user fixes them in another window.
  useEffect(() => {
    const poll = (): void => {
      void window.api.chat.getKnowledgeReady().then((ready) => {
        setHasKnowledge(ready);
        if (ready && error?.variant === 'no-harness') setError(null);
      });
    };
    const id = window.setInterval(poll, 5_000);
    return () => {
      window.clearInterval(id);
    };
  }, [error, setError]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const handleOpenSettings = useCallback(() => {
    void window.api.chat.openSettings();
  }, []);

  const handleRetry = useCallback(() => {
    // The last user turn lives in `turns` — re-send its text. If the user
    // turn was already dropped (token-ceiling / fatal cases), there's
    // nothing to retry; the user can re-type.
    const lastUser = [...turns].reverse().find((t) => t.role === 'user');
    if (!lastUser) {
      setError(null);
      return;
    }
    setError(null);
    const ids =
      lastUser.attachedScreenshotIds.length > 0
        ? [...lastUser.attachedScreenshotIds]
        : undefined;
    void window.api.chat.send(lastUser.text, ids);
  }, [turns, setError]);

  const showQuickPrompts = turns.length === 0 && state === 'idle';
  const showTyping = state === 'awaiting' || state === 'sending';
  const sendBlocked =
    hasApiKey !== true || hasKnowledge !== true || state !== 'idle';

  return (
    <div className="flex h-screen flex-col bg-ap-bg text-ap-fg shadow-2xl ring-1 ring-white/20">
      <ChatHeader
        model={model}
        onClose={() => {
          void window.api.chat.close();
        }}
      />

      {error && (
        <ChatErrorView
          error={error}
          onOpenSettings={handleOpenSettings}
          onRetry={handleRetry}
        />
      )}

      {turns.length === 0 && error === null && (
        <div className="px-4 py-3 text-xs text-white/70">
          Help the client on a live call — ask which inputs to change, why, and
          what to say. Point the capture region at the client&apos;s shared screen
          in Zoom or Meet so answers reflect their chart and settings.
        </div>
      )}

      <MessageList turns={turns} showTyping={showTyping} />

      {showQuickPrompts && <QuickPrompts disabled={sendBlocked} />}

      <InputBar disabled={sendBlocked} />
    </div>
  );
}
