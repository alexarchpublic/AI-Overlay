/**
 * @file src/main/ipc/typeGuards.ts
 *
 * Narrow runtime type guards for untrusted IPC payloads.
 */

import type { SuggestedParameterChange, WidgetPosition } from '../../shared/types';

export function isPoint(v: unknown): v is { x: number; y: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.x === 'number' && typeof o.y === 'number';
}

export function isWidgetPosition(v: unknown): v is WidgetPosition {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== 'number' || typeof o.y !== 'number') return false;
  if (o.displayId !== null && typeof o.displayId !== 'number') return false;
  return true;
}

export function isSuggestedChange(v: unknown): v is SuggestedParameterChange {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.parameter === 'string' &&
    typeof o.rationale === 'string' &&
    typeof o.suggested_value === 'string' &&
    typeof o.doc_ref === 'string' &&
    (typeof o.current_value === 'string' || o.current_value === null)
  );
}
