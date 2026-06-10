/**
 * @file src/renderer/chat/AssistantMessage.tsx
 *
 * Why it exists: PRD §3.5 — renders an assistant turn. Markdown via
 * `react-markdown` + `remark-gfm` (D23). The structured suggestions table
 * is rendered separately (not as part of the markdown body) so the
 * per-row "Copy" button can be a real React component instead of a
 * post-render DOM hack.
 *
 * `confidence_score` renders as a small badge with three buckets
 * (low/med/high). `risk_notes` lives in an amber callout under the table.
 *
 * XSS smoke: `react-markdown` is configured with no HTML allowed (its
 * default `skipHtml` is `false` but we don't pass a `rehype-raw` plugin,
 * so raw HTML in the markdown source is dropped).
 */

import { type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatTurn } from '../../shared/types';
import ApplySuggestion from './ApplySuggestion';

export interface AssistantMessageProps {
  turn: ChatTurn;
}

function confidenceBucket(score: number): { label: string; klass: string } {
  if (score >= 0.75) return { label: 'High', klass: 'bg-emerald-500/20 text-emerald-200' };
  if (score >= 0.4) return { label: 'Medium', klass: 'bg-ap-gold/20 text-ap-gold' };
  return { label: 'Low', klass: 'bg-amber-500/20 text-amber-200' };
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

        {structured && structured.suggested_parameter_changes.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-md border border-white/15">
            <table className="w-full text-[12px]">
              <thead className="bg-ap-elevated text-left text-[10px] uppercase tracking-wide text-white/65">
                <tr>
                  <th className="px-2 py-1.5">Parameter</th>
                  <th className="px-2 py-1.5">Direction</th>
                  <th className="px-2 py-1.5">Try</th>
                  <th className="px-2 py-1.5">Chart</th>
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
                    <td className="px-2 py-1.5 font-mono capitalize text-white/85">
                      {row.direction}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-ap-green">
                      {row.suggested_value}
                    </td>
                    <td className="px-2 py-1.5 text-white/85">
                      {row.chart_context}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <ApplySuggestion suggestion={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-white/10 bg-ap-elevated px-2 py-1 text-[10px] text-white/60">
              Apply a suggestion on TradingView, capture a fresh screenshot with
              the camera button, and send an update to continue tuning.
            </div>
          </div>
        )}

        {structured && structured.risk_notes.trim().length > 0 && (
          <div className="mt-3 rounded-md border border-amber-400/40 bg-ap-warning px-3 py-2 text-[12px] text-amber-100">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-amber-200/80">
              Risk
            </div>
            {structured.risk_notes}
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
        </div>
      </div>
    </div>
  );
}
