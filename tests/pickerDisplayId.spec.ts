/**
 * @file tests/pickerDisplayId.spec.ts
 *
 * Covers the argv fallback that packaged Windows pickers use when the
 * loadFile hash does not round-trip `displayId`.
 */

import { describe, it, expect } from 'vitest';
import { parsePickerDisplayIdFromArgv } from '../src/shared/pickerDisplayId';

describe('parsePickerDisplayIdFromArgv', () => {
  it('returns null when the switch is absent', () => {
    expect(parsePickerDisplayIdFromArgv(['electron', '.'])).toBeNull();
  });

  it('parses a positive display id', () => {
    expect(
      parsePickerDisplayIdFromArgv([
        'electron',
        '--region-picker-display-id=2779098405',
      ]),
    ).toBe(2779098405);
  });

  it('parses zero', () => {
    expect(parsePickerDisplayIdFromArgv(['--region-picker-display-id=0'])).toBe(0);
  });

  it('returns null for an empty value', () => {
    expect(parsePickerDisplayIdFromArgv(['--region-picker-display-id='])).toBeNull();
  });

  it('returns null for a non-numeric value', () => {
    expect(parsePickerDisplayIdFromArgv(['--region-picker-display-id=abc'])).toBeNull();
  });
});
