/**
 * @file tests/aiSchema.spec.ts
 * Schema v3 — talk_track + current_value/doc_ref (PRD D-P6).
 */

import { describe, it, expect } from 'vitest';
import {
  OUTPUT_SCHEMA,
  OUTPUT_SCHEMA_INSTRUCTIONS,
} from '../src/shared/aiSchema';

describe('OUTPUT_SCHEMA v3', () => {
  it('uses schema_version 3', () => {
    expect(OUTPUT_SCHEMA.properties.schema_version.enum).toEqual(['3']);
  });

  it('requires talk_track at the top level', () => {
    expect(OUTPUT_SCHEMA.required).toContain('talk_track');
    expect(OUTPUT_SCHEMA.properties.talk_track.type).toBe('string');
  });

  it('requires v3 fields on each suggestion row', () => {
    const items = OUTPUT_SCHEMA.properties.suggested_parameter_changes.items;
    expect(items.required).toEqual([
      'parameter',
      'current_value',
      'suggested_value',
      'rationale',
      'doc_ref',
    ]);
    expect(items.properties.current_value.type).toBe('string');
    expect(items.properties.current_value.nullable).toBe(true);
  });

  it('does not define leakage-era v2 fields', () => {
    const items = OUTPUT_SCHEMA.properties.suggested_parameter_changes.items;
    expect(items.properties).not.toHaveProperty('direction');
    expect(items.properties).not.toHaveProperty('chart_context');
  });
});

describe('OUTPUT_SCHEMA_INSTRUCTIONS', () => {
  it('requires schema_version 3 and talk_track', () => {
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/schema_version.*3/i);
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/talk_track/i);
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/doc_ref/i);
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/current_value/i);
  });

  it('forbids performance promises in talk tracks', () => {
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/no performance or returns promises/i);
  });
});
