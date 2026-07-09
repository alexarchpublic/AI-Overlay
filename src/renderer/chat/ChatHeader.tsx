/**
 * @file src/renderer/chat/ChatHeader.tsx
 *
 * Draggable chat header with capture-status indicator, algorithm picker (D-P10),
 * app menu, and close.
 */

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { ACTIVE_ALGORITHM_OPTIONS } from '../../shared/knowledgeConstants';
import type { ActiveAlgorithm } from '../../shared/knowledgeTypes';
import type { WidgetStatus } from '../../shared/types';
import { useChatStore } from './chatStore';

const STATUS_LABEL: Record<WidgetStatus, string> = {
  ready: 'Ready',
  paused: 'Paused',
  permDenied: 'Screen recording required',
  capturing: 'Capturing…',
};

function statusDotClass(status: WidgetStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-ap-green shadow-[0_0_6px_rgba(22,199,132,0.7)] animate-pulse';
    case 'paused':
      return 'bg-ap-gold';
    case 'permDenied':
      return 'bg-amber-500';
    case 'capturing':
      return 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]';
  }
}

export interface ChatHeaderProps {
  model: string;
  onClose: () => void;
}

export default function ChatHeader(props: ChatHeaderProps): ReactElement {
  const [status, setStatus] = useState<WidgetStatus>('ready');
  const activeAlgorithm = useChatStore((s) => s.activeAlgorithm);
  const setActiveAlgorithm = useChatStore((s) => s.setActiveAlgorithm);

  useEffect(() => {
    let cancelled = false;
    void window.api.widget.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    const off = window.api.widget.onStatusChanged((s) => {
      setStatus(s);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const openMenuAt = useCallback((x: number, y: number): void => {
    window.api.widget.openContextMenu({ x, y });
  }, []);

  const handleMenuClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>): void => {
      openMenuAt(e.clientX, e.clientY);
    },
    [openMenuAt],
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>): void => {
      e.preventDefault();
      openMenuAt(e.clientX, e.clientY);
    },
    [openMenuAt],
  );

  const handleAlgorithmChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>): void => {
      const next = e.target.value as ActiveAlgorithm;
      setActiveAlgorithm(next);
      void window.api.knowledge.setActiveAlgorithm(next);
    },
    [setActiveAlgorithm],
  );

  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
  const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties;

  return (
    <header
      className="flex items-center gap-2 border-b border-white/15 bg-ap-elevated px-3 py-2 text-[11px]"
      style={drag}
      onContextMenu={handleContextMenu}
    >
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(status)}`}
        title={STATUS_LABEL[status]}
        aria-label={STATUS_LABEL[status]}
      />
      <span className="min-w-0 flex-1 truncate text-white/80">Arch Public AI</span>
      <label className="flex items-center gap-1 text-white/50" style={noDrag}>
        <span className="sr-only">Active algorithm</span>
        <select
          aria-label="Active algorithm"
          value={activeAlgorithm}
          onChange={handleAlgorithmChange}
          className="max-w-[7.5rem] truncate rounded border border-white/15 bg-ap-muted px-1.5 py-0.5 font-mono text-[10px] text-ap-fg hover:border-ap-gold/40"
        >
          {ACTIVE_ALGORITHM_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <span className="hidden font-mono text-white/50 sm:inline">{props.model || '—'}</span>
      <button
        type="button"
        aria-label="Open menu"
        title="Capture, settings, and more"
        style={noDrag}
        onClick={handleMenuClick}
        className="rounded px-1.5 py-0.5 text-white/60 hover:bg-ap-muted hover:text-white"
      >
        ⋮
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        style={noDrag}
        onClick={props.onClose}
        className="rounded px-2 py-0.5 text-white/60 hover:bg-ap-muted hover:text-white"
      >
        ×
      </button>
    </header>
  );
}
