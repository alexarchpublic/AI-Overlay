/**
 * @file tests/tuning/chartContext.spec.ts
 *
 * Phase 0 task 6 — vision-grounded chart context for retrieval + user turns.
 */
import { describe, it, expect } from 'vitest';
import {
  buildVisionAugmentedUserText,
  extractChartContextForRetrieval,
  isTuningAssistantTurn,
} from '../../src/shared/tuning/chartContext';
import type { ChatTurn } from '../../src/shared/types';
import { VISION_CHART_READ_INSTRUCTIONS } from '../../src/shared/tuning/constants';

describe('extractChartContextForRetrieval', () => {
  it('returns chart_context from the latest assistant structured turn', () => {
    const history: ChatTurn[] = [
      {
        id: 'u1',
        role: 'user',
        text: 'hello',
        attachedScreenshotIds: [],
        createdAt: 0,
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'analysis',
        attachedScreenshotIds: [],
        createdAt: 1,
        structured: {
          schema_version: '2',
          analysis: 'analysis',
          suggested_parameter_changes: [
            {
              parameter: 'volatility_filter',
              direction: 'increase',
              suggested_value: '~1.5× ATR',
              chart_context: 'Wide envelopes on 5m chart',
              rationale: 'noisy regime',
            },
          ],
          confidence_score: 0.7,
          risk_notes: '',
        },
      },
    ];
    expect(extractChartContextForRetrieval(history, 'follow up')).toBe(
      'Wide envelopes on 5m chart',
    );
  });

  it('includes user follow-up when they mention applying a change', () => {
    const history: ChatTurn[] = [];
    const ctx = extractChartContextForRetrieval(history, 'I applied 1.5 ATR on the chart');
    expect(ctx).toContain('applied');
  });

  it('returns undefined when no grounding exists', () => {
    expect(extractChartContextForRetrieval([], 'generic question')).toBeUndefined();
  });
});

describe('buildVisionAugmentedUserText', () => {
  it('passes through plain text when no screenshots', () => {
    expect(buildVisionAugmentedUserText('hello', 0)).toBe('hello');
  });

  it('prepends vision instructions when screenshots are attached', () => {
    const out = buildVisionAugmentedUserText('tighten stops', 1, 'prior ctx');
    expect(out.startsWith(VISION_CHART_READ_INSTRUCTIONS)).toBe(true);
    expect(out).toContain('Prior chart context from this session: prior ctx');
    expect(out).toContain('Trader message: tighten stops');
  });
});

describe('isTuningAssistantTurn', () => {
  it('detects assistant turns with suggestions', () => {
    const turn: ChatTurn = {
      id: 'a',
      role: 'assistant',
      text: 'x',
      attachedScreenshotIds: [],
      createdAt: 0,
      structured: {
        schema_version: '2',
        analysis: 'x',
        suggested_parameter_changes: [
          {
            parameter: 'p',
            direction: 'set',
            suggested_value: '1',
            chart_context: 'c',
            rationale: 'r',
          },
        ],
        confidence_score: 0.5,
        risk_notes: '',
      },
    };
    expect(isTuningAssistantTurn(turn)).toBe(true);
  });
});
