/**
 * @file src/shared/aiSchema.ts
 *
 * Why it exists: security-harness PRD §5.4 / D-9 — the locked structured-
 * output schema + natural-language schema reminder. Both live here (and only
 * here) so `geminiService.buildSystemPrompt()` is the only sanctioned composer.
 *
 * Schema v2 removes leakage-shaped fields (`current`, file/path citations) and
 * replaces them with forward-looking tuning fields (`suggested_value`,
 * `chart_context`, `direction`). `suggested_value` and `chart_context` are
 * typed as `string` in the JSON schema because Gemini's structured-output mode
 * treats numeric strings inconsistently across model versions.
 *
 * Reviewer grep contract: `responseSchema:` should appear in exactly one
 * place outside this file — `geminiService.send()`.
 */

/**
 * The Gemini SDK accepts schemas as a duck-typed object literal. We export
 * a `const` so TypeScript narrows the literal types; the SDK reads it as
 * `Schema` at the call site and is happy.
 */
export const OUTPUT_SCHEMA = {
  type: 'object',
  required: [
    'schema_version',
    'analysis',
    'suggested_parameter_changes',
    'confidence_score',
    'risk_notes',
  ],
  properties: {
    schema_version: { type: 'string', enum: ['2'] },
    analysis: {
      type: 'string',
      description:
        'Behavior/regime-level markdown analysis. No code, paths, formulas, or disclosures of algorithm default/internal values.',
    },
    suggested_parameter_changes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['parameter', 'direction', 'suggested_value', 'chart_context', 'rationale'],
        properties: {
          parameter: {
            type: 'string',
            description:
              'Named parameter role, e.g. volatility_filter — not a file or variable reference.',
          },
          direction: { type: 'string', enum: ['increase', 'decrease', 'set'] },
          suggested_value: {
            type: 'string',
            description:
              'A value or range to TRY (forward-looking, rounded), e.g. ~1.5× ATR or 1.4–1.6× ATR.',
          },
          chart_context: {
            type: 'string',
            description:
              "What is visible on the user's chart or what they last tried — never the proprietary default.",
          },
          rationale: {
            type: 'string',
            description: 'Regime/behavior reasoning — no formulas.',
          },
        },
      },
    },
    confidence_score: { type: 'number', minimum: 0, maximum: 1 },
    risk_notes: { type: 'string' },
  },
} as const;

/** Leakage-shaped field names that must never appear in schema v2. */
export const SCHEMA_V2_FORBIDDEN_FIELDS = [
  'current',
  'proposed',
  'path',
  'line',
  'file',
  'source',
  'citation',
] as const;

/**
 * Natural-language reminder appended to the system prompt. The schema is
 * also passed to the SDK via `responseSchema`, but JSON-mode output drift
 * is the most common failure mode, so we restate the contract in prose.
 *
 * Trailing `.trim()` removes the leading newline introduced by template-
 * literal indentation; the composed prompt's whitespace must stay stable
 * across edits so `promptHash` is deterministic.
 */
export const OUTPUT_SCHEMA_INSTRUCTIONS = `
Respond with a single JSON object matching the schema. Do not wrap it in markdown fences.
Keep 'analysis' at behavior/regime level — no source code, file paths, path:line citations, formulas, or statements of the algorithm's default or internal parameter values.
For each suggested_parameter_changes row: name the parameter role (not a file or variable); set direction to increase, decrease, or set; give suggested_value as a rounded value or range to TRY; ground chart_context in what the user sees on their chart or last tried — never proprietary defaults.
If you have no parameter changes to suggest, return an empty array — do not invent suggestions.
'confidence_score' must be a number between 0 and 1 reflecting your confidence given the available screenshots and retrieved strategy knowledge.
'risk_notes' must call out conditions that would invalidate your analysis (low-quality screenshot, missing context, regime change, etc.).
`.trim();

/**
 * Reminder appended to the second-attempt user message when the first
 * response failed JSON parse (PRD D8). Kept short so the retry doesn't
 * push the request over the budget that the first attempt fit inside.
 */
export const JSON_RETRY_REMINDER =
  'Your previous response was not valid JSON. Respond with valid JSON only, matching the schema exactly. No markdown fences. No prose outside the JSON object.';
