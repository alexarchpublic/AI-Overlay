/**
 * @file tests/aiSchema.spec.ts
 * Phase 0 task 4 — schema v2 rejects leakage-shaped fields (PRD §5.4, §10).
 */

import { describe, it, expect } from 'vitest';
import {
  OUTPUT_SCHEMA,
  OUTPUT_SCHEMA_INSTRUCTIONS,
  SCHEMA_V2_FORBIDDEN_FIELDS,
} from '../src/shared/aiSchema';

function collectPropertyKeys(obj: unknown, keys: string[] = []): string[] {
  if (typeof obj !== 'object' || obj === null) return keys;
  const record = obj as Record<string, unknown>;
  if (record.properties && typeof record.properties === 'object') {
    for (const [name, value] of Object.entries(record.properties as Record<string, unknown>)) {
      keys.push(name);
      collectPropertyKeys(value, keys);
    }
  }
  if (record.items) {
    collectPropertyKeys(record.items, keys);
  }
  if (record.required && Array.isArray(record.required)) {
    for (const name of record.required) {
      if (typeof name === 'string') keys.push(name);
    }
  }
  return keys;
}

describe('OUTPUT_SCHEMA v2', () => {
  it('uses schema_version 2', () => {
    expect(OUTPUT_SCHEMA.properties.schema_version.enum).toEqual(['2']);
  });

  it('requires tuning-loop fields on each suggestion row', () => {
    const items = OUTPUT_SCHEMA.properties.suggested_parameter_changes.items;
    expect(items.required).toEqual([
      'parameter',
      'direction',
      'suggested_value',
      'chart_context',
      'rationale',
    ]);
    expect(items.properties.direction.enum).toEqual(['increase', 'decrease', 'set']);
  });

  it('does not define leakage-shaped fields anywhere in the schema', () => {
    const keys = collectPropertyKeys(OUTPUT_SCHEMA);
    for (const forbidden of SCHEMA_V2_FORBIDDEN_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('OUTPUT_SCHEMA_INSTRUCTIONS', () => {
  it('forbids path:line citations and proprietary value disclosures', () => {
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/path:line/i);
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/default or internal parameter/i);
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).not.toMatch(/Cite harness files/i);
  });

  it('instructs forward suggestions grounded in chart context', () => {
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/suggested_value/i);
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/chart_context/i);
    expect(OUTPUT_SCHEMA_INSTRUCTIONS).toMatch(/never proprietary defaults/i);
  });
});
