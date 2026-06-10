/**
 * @file src/shared/knowledge/abstractionGenerationSchema.ts
 *
 * Structured-output schema for the Phase 1 offline abstraction generator.
 */

export const GENERATED_ABSTRACTIONS_SCHEMA = {
  type: 'object',
  required: ['documents'],
  properties: {
    documents: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'fileName', 'text'],
        properties: {
          id: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['contract', 'param-role', 'tuning', 'risk'],
          },
          fileName: { type: 'string' },
          text: {
            type: 'string',
            description:
              'Natural-language abstraction body — must pass D-3 (no code, paths, formulas, proprietary defaults).',
          },
        },
      },
    },
  },
} as const;

export interface GeneratedAbstractionDraft {
  id: string;
  kind: 'contract' | 'param-role' | 'tuning' | 'risk';
  fileName: string;
  text: string;
}

export interface GeneratedAbstractionsPayload {
  documents: GeneratedAbstractionDraft[];
}

export function parseGeneratedAbstractions(raw: string): GeneratedAbstractionsPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const docs = (parsed as { documents?: unknown }).documents;
  if (!Array.isArray(docs) || docs.length === 0) return null;

  const out: GeneratedAbstractionDraft[] = [];
  for (const item of docs) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (
      typeof o.id !== 'string' ||
      typeof o.fileName !== 'string' ||
      typeof o.text !== 'string' ||
      !['contract', 'param-role', 'tuning', 'risk'].includes(String(o.kind))
    ) {
      return null;
    }
    out.push({
      id: o.id,
      kind: o.kind as GeneratedAbstractionDraft['kind'],
      fileName: o.fileName,
      text: o.text.trim(),
    });
  }
  return { documents: out };
}
