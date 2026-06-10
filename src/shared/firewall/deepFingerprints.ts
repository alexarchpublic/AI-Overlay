/**
 * @file src/shared/firewall/deepFingerprints.ts
 *
 * Verbatim deep-tier source detection (PRD §5.5a). Fingerprints are built
 * offline from the deep tier and shipped as `knowledge/deep-fingerprints.json`.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { FirewallHit } from './types';

export interface DeepFingerprintManifest {
  schemaVersion: 1;
  builtAt: string;
  /** Normalized substrings (min length enforced at build) from deep-tier sources. */
  spans: string[];
}

const MIN_SPAN_LEN = 32;
const MAX_SPANS = 2_000;

/** Normalize text before substring comparison (NFKC + collapsed whitespace). */
export function normalizeForFingerprintMatch(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Extract candidate verbatim spans from deep-tier file text for the offline
 * fingerprint manifest. Not used at runtime.
 */
export function extractDeepSpansFromSource(raw: string): string[] {
  const spans = new Set<string>();
  const normalizedFile = normalizeForFingerprintMatch(raw);
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < MIN_SPAN_LEN) continue;
    if (trimmed.startsWith('//') && !trimmed.includes('strategy')) continue;
    spans.add(normalizeForFingerprintMatch(trimmed));
  }
  for (let i = 0; i + MIN_SPAN_LEN <= normalizedFile.length && spans.size < MAX_SPANS; i += 12) {
    const slice = normalizedFile.slice(i, i + MIN_SPAN_LEN);
    if (slice.length >= MIN_SPAN_LEN && /[a-z]{4,}/.test(slice)) {
      spans.add(slice);
    }
  }
  return [...spans].slice(0, MAX_SPANS);
}

/** Walk deep-tier tree and collect spans (build-time only). */
export async function buildDeepFingerprintManifest(deepTierRoot: string): Promise<DeepFingerprintManifest> {
  const spans = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(txt|md|pine|ts|js)$/i.test(ent.name)) continue;
      const raw = await fsp.readFile(full, 'utf8');
      for (const span of extractDeepSpansFromSource(raw)) {
        spans.add(span);
        if (spans.size >= MAX_SPANS) return;
      }
    }
  }
  await walk(deepTierRoot);
  return {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    spans: [...spans],
  };
}

export function matchDeepFingerprints(
  text: string,
  manifest: DeepFingerprintManifest | null,
): FirewallHit | null {
  if (manifest === null || manifest.spans.length === 0) return null;
  const normalized = normalizeForFingerprintMatch(text);
  for (const span of manifest.spans) {
    if (span.length < MIN_SPAN_LEN) continue;
    const idx = normalized.indexOf(span);
    if (idx !== -1) {
      return {
        rule: 'deep-verbatim',
        message: 'Verbatim span matches known deep-tier source (§5.5a).',
        index: idx,
      };
    }
  }
  return null;
}

export async function loadDeepFingerprintManifest(
  manifestPath: string,
): Promise<DeepFingerprintManifest | null> {
  try {
    const raw = await fsp.readFile(manifestPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isDeepFingerprintManifest(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isDeepFingerprintManifest(v: unknown): v is DeepFingerprintManifest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.schemaVersion === 1 && Array.isArray(o.spans);
}
