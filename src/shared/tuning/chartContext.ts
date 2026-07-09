/**
 * @file src/shared/tuning/chartContext.ts
 *
 * Build retrieval chart context from session history and augment user
 * messages for the vision-grounded call loop (PRD D-P9).
 */
import type { ChatTurn } from '../types';
import { VISION_CHART_READ_INSTRUCTIONS } from './constants';

/**
 * Collect grounding from the most recent assistant structured output for
 * scoped retrieval (`RetrievalQuery.chartContext`). Uses parameter labels,
 * known current values, and doc refs from schema v3 suggestions.
 */
export function extractChartContextForRetrieval(
  history: readonly ChatTurn[],
  userText: string,
): string | undefined {
  const parts: string[] = [];

  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.role !== 'assistant' || !turn.structured) continue;
    for (const row of turn.structured.suggested_parameter_changes) {
      const bits: string[] = [row.parameter];
      if (row.current_value !== null && row.current_value.trim().length > 0) {
        bits.push(`current=${row.current_value.trim()}`);
      }
      if (row.doc_ref.trim().length > 0) {
        bits.push(row.doc_ref.trim());
      }
      parts.push(bits.join(' '));
    }
    if (parts.length > 0) break;
  }

  const trimmedUser = userText.trim();
  if (
    trimmedUser.length > 0 &&
    /\b(applied|tried|set|changed|updated|screenshot|after adjusting)\b/i.test(trimmedUser)
  ) {
    parts.push(trimmedUser.slice(0, 240));
  }

  if (parts.length === 0) return undefined;
  return parts.join(' · ').slice(0, 512);
}

/**
 * When screenshots are attached, prepend vision read instructions so the
 * model grounds suggestions in the client's visible Inputs / chart state.
 *
 * The returned string is sent to the model only — the UI transcript keeps
 * the raw user text.
 */
export function buildVisionAugmentedUserText(
  userText: string,
  screenshotCount: number,
  priorChartContext?: string,
): string {
  if (screenshotCount <= 0) return userText;

  const sections = [VISION_CHART_READ_INSTRUCTIONS];
  if (priorChartContext !== undefined && priorChartContext.trim().length > 0) {
    sections.push(`Prior chart context from this session: ${priorChartContext.trim()}`);
  }
  sections.push(`Employee message: ${userText}`);
  return sections.join('\n\n');
}

/** True when the assistant turn included parameter suggestions. */
export function isTuningAssistantTurn(turn: ChatTurn): boolean {
  return (
    turn.role === 'assistant' &&
    (turn.structured?.suggested_parameter_changes.length ?? 0) > 0
  );
}
