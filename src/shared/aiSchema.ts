/**
 * @file src/shared/aiSchema.ts
 *
 * Why it exists: PRD D-P6 — the locked structured-output schema + natural-
 * language schema reminder. Both live here (and only here) so
 * `geminiService.buildSystemPrompt()` is the only sanctioned composer.
 *
 * Schema v3 adds `talk_track` and per-suggestion `current_value` / `doc_ref`
 * for the internal sales/CS co-pilot. Leakage-oriented v2 fields
 * (`direction`, `chart_context`) and `SCHEMA_V2_FORBIDDEN_FIELDS` are gone.
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
    'talk_track',
    'confidence_score',
    'risk_notes',
  ],
  properties: {
    schema_version: { type: 'string', enum: ['3'] },
    analysis: {
      type: 'string',
      description:
        'Concise markdown analysis grounded in the product docs and screenshots. Cite doc sections when relevant.',
    },
    suggested_parameter_changes: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'parameter',
          'current_value',
          'suggested_value',
          'rationale',
          'doc_ref',
        ],
        properties: {
          parameter: {
            type: 'string',
            description:
              'Exact TradingView Inputs-tab label, e.g. "Sell Buffer (%)".',
          },
          current_value: {
            type: 'string',
            nullable: true,
            description:
              "Value from the client's screenshot or what the employee stated; null when unknown.",
          },
          suggested_value: {
            type: 'string',
            description: 'Concrete value or direction to try on the Inputs tab.',
          },
          rationale: {
            type: 'string',
            description: 'Why this change aligns with the client objective.',
          },
          doc_ref: {
            type: 'string',
            description:
              'Doc section path, e.g. "Market Wave → Buffers, Scope, and Timeframe".',
          },
        },
      },
    },
    talk_track: {
      type: 'string',
      description:
        'One to three plain-English sentences the employee can say to the client. No jargon, no performance promises.',
    },
    confidence_score: { type: 'number', minimum: 0, maximum: 1 },
    risk_notes: {
      type: 'string',
      description:
        'Material risks to surface (edge-flip, zero trades, auto-sizing, fees/slippage). Always populate when relevant.',
    },
  },
} as const;

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
'schema_version' must be "3".
Keep 'analysis' concise and grounded in the product documentation and screenshots; cite section paths when you draw from the docs.
For each suggested_parameter_changes row: use the exact TradingView input label for 'parameter'; set 'current_value' from the screenshot or employee statement (or null if unknown); give 'suggested_value' as the concrete value or direction to try; explain 'rationale'; set 'doc_ref' to the section path (e.g. "Market Wave → Sell Buffer").
'talk_track' must be 1–3 plain-English sentences the employee can read aloud to the client — no internal jargon, no performance or returns promises.
If you have no parameter changes to suggest, return an empty array — do not invent suggestions.
'confidence_score' must be a number between 0 and 1 reflecting your confidence given the available screenshots and documentation.
'risk_notes' must call out material risks (pinched buffers / edge-flip, Trend Filter + tight Scope producing few or no trades, auto-sized last trades, fee/slippage headroom) or note when context is insufficient.
`.trim();

/**
 * Reminder appended to the second-attempt user message when the first
 * response failed JSON parse (PRD D8). Kept short so the retry doesn't
 * push the request over the budget that the first attempt fit inside.
 */
export const JSON_RETRY_REMINDER =
  'Your previous response was not valid JSON. Respond with valid JSON only, matching the schema exactly. No markdown fences. No prose outside the JSON object.';
