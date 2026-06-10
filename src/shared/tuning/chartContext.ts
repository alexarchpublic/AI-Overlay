/**
 * @file src/shared/tuning/chartContext.ts
 *
 * Phase 0 task 6 — build retrieval chart context from session history and
 * augment user messages for the vision-grounded tuning loop (PRD §5.6, §6).
 */
import type { ChatTurn } from '../types';
import { VISION_CHART_READ_INSTRUCTIONS } from './constants';

/**
 * Collect chart-visible grounding from the most recent assistant structured
 * output for scoped retrieval (`RetrievalQuery.chartContext`).
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
      const ctx = row.chart_context.trim();
      if (ctx.length > 0) parts.push(ctx);
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
 * model grounds suggestions in visible chart state (PRD §5.6).
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
  sections.push(`Trader message: ${userText}`);
  return sections.join('\n\n');
}

/** True when the assistant turn included forward parameter suggestions. */
export function isTuningAssistantTurn(turn: ChatTurn): boolean {
  return (
    turn.role === 'assistant' &&
    (turn.structured?.suggested_parameter_changes.length ?? 0) > 0
  );
}
