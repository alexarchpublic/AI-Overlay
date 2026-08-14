/**
 * @file src/renderer/chat/AssistantMessage.tsx
 *
 * PRD §3.4–3.5 — assistant turn with talk track, suggestions table, and
 * always-visible risk notes for internal CS compliance.
 */

import { type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatTurn } from '../../shared/types';
import ApplySuggestion from './ApplySuggestion';
import TalkTrack from './TalkTrack';

export interface AssistantMessageProps {
  turn: ChatTurn;
}

function confidenceBucket(score: number): { label: string; klass: string } {
  if (score >= 0.75) return { label: 'High', klass: 'bg-emerald-500/20 text-emerald-200' };
  if (score >= 0.4) return { label: 'Medium', klass: 'bg-ap-gold/20 text-ap-gold' };
  return { label: 'Low', klass: 'bg-amber-500/20 text-amber-200' };
}

function formatCurrentValue(current: string | null): string {
  if (current === null || current.trim().length === 0) return '—';
  return current;
}

export default function AssistantMessage(props: AssistantMessageProps): ReactElement {
  const { turn } = props;
  const structured = turn.structured;
  return (
    <div className="px-4">
      <div
        className={
          turn.role === 'system-summary'
            ? 'rounded-xl border border-white/15 bg-ap-muted p-3 text-[12px] text-white/85'
            : 'rounded-2xl rounded-tl-md bg-ap-muted px-3 py-2 text-sm text-ap-fg ring-1 ring-white/15'
        }
      >
        {turn.role === 'system-summary' && (
          <div className="mb-1 text-[10px] uppercase tracking-wide text-white/55">
            Earlier in this session
          </div>
        )}

        <div className="prose prose-invert max-w-none text-sm leading-relaxed [&_code]:rounded [&_code]:bg-ap-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-ap-elevated [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {turn.text}
          </ReactMarkdown>
        </div>

        {structured && structured.talk_track.trim().length > 0 && (
          <TalkTrack text={structured.talk_track} />
        )}

        {structured && structured.suggested_parameter_changes.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-md border border-white/15">
            <table className="w-full text-[12px]">
              <thead className="bg-ap-elevated text-left text-[10px] uppercase tracking-wide text-white/65">
                <tr>
                  <th className="px-2 py-1.5">Parameter</th>
                  <th className="px-2 py-1.5">Change</th>
                  <th className="px-2 py-1.5">Rationale</th>
                  <th className="px-2 py-1.5">Doc</th>
                  <th className="px-2 py-1.5">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {structured.suggested_parameter_changes.map((row, idx) => (
                  <tr
                    key={`${row.parameter}-${String(idx)}`}
                    className="border-t border-white/10 align-top"
                  >
                    <td className="px-2 py-1.5 font-mono text-ap-fg">
                      {row.parameter}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-ap-green">
                      {formatCurrentValue(row.current_value)} → {row.suggested_value}
                    </td>
                    <td className="px-2 py-1.5 text-white/85">{row.rationale}</td>
                    <td className="px-2 py-1.5 text-white/85">{row.doc_ref}</td>
                    <td className="px-2 py-1.5 text-right">
                      <ApplySuggestion suggestion={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-white/10 bg-ap-elevated px-2 py-1 text-[10px] text-white/60">
              Have the client apply the change on TradingView, capture a fresh
              screenshot, and send an update to continue.
            </div>
          </div>
        )}

        {structured && (
          <div className="mt-3 rounded-md border border-amber-400/40 bg-ap-warning px-3 py-2 text-[12px] text-amber-100">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-amber-200/80">
              Risk
            </div>
            {structured.risk_notes.trim().length > 0
              ? structured.risk_notes
              : 'None noted for this change.'}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 text-[10px] text-white/60">
          {structured && (
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${confidenceBucket(structured.confidence_score).klass}`}
            >
              {confidenceBucket(structured.confidence_score).label} confidence ·{' '}
              {(structured.confidence_score * 100).toFixed(0)}%
            </span>
          )}
          {turn.modelUsed && <span>{turn.modelUsed}</span>}
          {typeof turn.latencyMs === 'number' && (
            <span>{(turn.latencyMs / 1000).toFixed(1)}s</span>
          )}
          {(turn.toolAttributions ?? []).map((label) => (
            // Attribution chip (PRD_Optimizer_MCP_Integration D-M6): this
            // answer was computed by the optimizer, not recalled from docs.
            <span
              key={label}
              className="rounded bg-ap-gold/20 px-1.5 py-0.5 font-medium text-ap-gold"
              data-testid="tool-attribution"
            >
              ran {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
