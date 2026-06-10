/**
 * @file src/shared/knowledge/geminiAbstractionAdapter.ts
 *
 * Gemini-backed LLM adapter for the offline abstraction generator.
 * Uses GEMINI_API_KEY from the environment — not the Electron keychain.
 */
/// <reference types="node" />

import { GoogleGenerativeAI, type Content } from '@google/generative-ai';
import { GENERATED_ABSTRACTIONS_SCHEMA } from './abstractionGenerationSchema';
import type { AbstractionLlmAdapter } from './abstractionGenerator';

export const DEFAULT_ABSTRACTION_GENERATION_MODEL = 'gemini-3.1-flash-lite-preview';

const GENERATION_TIMEOUT_MS = 120_000;

function rawJsonFromResponse(result: {
  response: { text: () => string; candidates?: { content?: { parts?: { text?: string }[] } }[] };
}): string {
  try {
    return result.response.text().trim();
  } catch {
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? '').join('').trim();
  }
}

export function createGeminiAbstractionAdapter(options?: {
  apiKey?: string;
  model?: string;
}): AbstractionLlmAdapter {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY ?? '';
  if (!apiKey.trim()) {
    throw new Error('GEMINI_API_KEY is required for automated abstraction generation');
  }
  const modelName =
    options?.model ?? process.env.ABSTRACTION_MODEL ?? DEFAULT_ABSTRACTION_GENERATION_MODEL;
  const client = new GoogleGenerativeAI(apiKey);

  return {
    async generate({ systemPrompt, userPrompt, signal }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, GENERATION_TIMEOUT_MS);
      const onAbort = (): void => {
        controller.abort();
      };
      signal?.addEventListener('abort', onAbort);

      const generativeModel = client.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GENERATED_ABSTRACTIONS_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0.2,
        },
      });

      const contents: Content[] = [{ role: 'user', parts: [{ text: userPrompt }] }];

      try {
        const result = await generativeModel.generateContent(
          { contents },
          { signal: controller.signal },
        );
        const rawJson = rawJsonFromResponse(result);
        if (!rawJson) {
          return { ok: false, reason: 'empty model response' };
        }
        return { ok: true, rawJson };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { ok: false, reason };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
