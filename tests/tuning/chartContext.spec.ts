/**
 * @file tests/tuning/chartContext.spec.ts
 *
 * Vision-grounded chart context for retrieval + user turns (schema v3).
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
  it('returns parameter + current_value + doc_ref from the latest assistant turn', () => {
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
          schema_version: '3',
          analysis: 'analysis',
          suggested_parameter_changes: [
            {
              parameter: 'Sell Buffer (%)',
              current_value: '0',
              suggested_value: '2',
              rationale: 'widen no-action zone',
              doc_ref: 'Market Wave → Buffers, Scope, and Timeframe',
            },
          ],
          talk_track: 'We can widen the sell buffer so it waits through chop.',
          confidence_score: 0.7,
          risk_notes: '',
        },
      },
    ];
    const ctx = extractChartContextForRetrieval(history, 'follow up');
    expect(ctx).toContain('Sell Buffer (%)');
    expect(ctx).toContain('current=0');
    expect(ctx).toContain('Market Wave → Buffers');
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
    expect(out).toContain('Employee message: tighten stops');
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
        schema_version: '3',
        analysis: 'x',
        suggested_parameter_changes: [
          {
            parameter: 'Scope',
            current_value: null,
            suggested_value: '1.0',
            rationale: 'r',
            doc_ref: 'Market Wave → Scope',
          },
        ],
        talk_track: 'Scope controls how tightly the wave hugs price.',
        confidence_score: 0.5,
        risk_notes: '',
      },
    };
    expect(isTuningAssistantTurn(turn)).toBe(true);
  });
});
