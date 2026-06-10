/**
 * @file tests/knowledge/d3Validator.spec.ts
 * PRD §10 — D-3 gate blocks leakage-shaped servable text; forward suggestions are out of scope here.
 */

import { describe, it, expect } from 'vitest';
import { validateD3 } from '../../src/shared/knowledge/d3Validator';

describe('validateD3', () => {
  it('accepts clean behavioral abstraction prose', () => {
    const text =
      'Try tightening the entry dip to roughly −1.5% on your chart if volatility is elevated; ' +
      'widen scope toward the macro end if you see envelope whipsaws.';
    expect(validateD3(text).ok).toBe(true);
  });

  it('blocks code fences', () => {
    const r = validateD3('Explain this:\n```\nlong x = 1;\n```');
    expect(r.ok).toBe(false);
    expect(r.hits.some((h) => h.rule === 'code-fence')).toBe(true);
  });

  it('blocks path:line citations', () => {
    const r = validateD3('See algorithm source code/foo.txt:42 for details.');
    expect(r.ok).toBe(false);
    expect(r.hits.some((h) => h.rule === 'path-line')).toBe(true);
  });

  it('blocks harness path references', () => {
    const r = validateD3('Loaded from arch-public-harness/docs/readme.');
    expect(r.ok).toBe(false);
    expect(r.hits.some((h) => h.rule === 'file-path')).toBe(true);
  });

  it('blocks Pine reconstructable tokens', () => {
    const r = validateD3('Uses strategy.entry when ta.sma crosses.');
    expect(r.ok).toBe(false);
    expect(r.hits.some((h) => h.rule === 'pine-source')).toBe(true);
  });

  it('blocks internal value disclosure framing', () => {
    const r = validateD3('The current value is 2.0 for the stop.');
    expect(r.ok).toBe(false);
    expect(r.hits.some((h) => h.rule === 'value-disclosure')).toBe(true);
  });

  it('blocks algorithm-uses disclosure', () => {
    const r = validateD3('The algorithm uses 2.0 for exits.');
    expect(r.ok).toBe(false);
    expect(r.hits.some((h) => h.rule === 'algo-uses')).toBe(true);
  });
});
