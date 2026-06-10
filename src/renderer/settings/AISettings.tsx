/**
 * @file src/renderer/settings/AISettings.tsx
 *
 * Why it exists: PRD §3.3 step 15 — the AI pane in the Settings shell.
 * Three blocks:
 *
 *   - Model picker (allowlist via `window.api.ai.listModels`)
 *   - API key field (password input + Show toggle + Save + Clear)
 *   - 7-day stats (call count, p50/p95 latency, JSON parse fail rate)
 *
 * Raw key never crosses IPC: `getApiKey` returns `{ present, masked }`.
 * Save sends the raw value one-way via `setApiKey(raw)`. PRD §5 DoD #24
 * is enforced by reviewer grep — this component must not store the raw
 * value back into state once the user clicks Save.
 */

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import type { ApiKeyPresence, GeminiCallStats } from '../../shared/types';

export default function AISettings(): ReactElement {
  const [models, setModels] = useState<readonly string[]>([]);
  const [model, setModel] = useState<string>('');
  const [keyPresence, setKeyPresence] = useState<ApiKeyPresence>({
    present: false,
    masked: '',
  });
  const [draft, setDraft] = useState<string>('');
  const [show, setShow] = useState<boolean>(false);
  const [stats, setStats] = useState<GeminiCallStats | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [m, mList, key, s] = await Promise.all([
        window.api.ai.getModel(),
        window.api.ai.listModels(),
        window.api.ai.getApiKey(),
        window.api.ai.getStats(),
      ]);
      setModel(m);
      setModels(mList);
      setKeyPresence(key);
      setStats(s);
    } catch (err) {
      window.api.log.error('aiSettings.refreshFailed', { message: String(err) });
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleSelectModel = useCallback(
    (e: ChangeEvent<HTMLSelectElement>): void => {
      const next = e.target.value;
      setModel(next);
      void window.api.ai.setModel(next).then((applied) => {
        setModel(applied);
      });
    },
    [],
  );

  const handleSaveKey = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    void window.api.ai.setApiKey(trimmed).then(() => {
      setDraft('');
      setShow(false);
      void refreshAll();
    });
  }, [draft, refreshAll]);

  const handleClearKey = useCallback(() => {
    void window.api.ai.clearApiKey().then(() => {
      setDraft('');
      setShow(false);
      void refreshAll();
    });
  }, [refreshAll]);

  const handleRefreshStats = useCallback(() => {
    void window.api.ai.getStats().then((s) => {
      setStats(s);
    });
  }, []);

  return (
    <section className="rounded-md border border-white/10 bg-ap-bg p-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ap-fg">AI</h2>
        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">
          Gemini
        </span>
      </header>

      {/* Model picker */}
      <div className="mb-5">
        <label
          htmlFor="ai-model-picker"
          className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-white/60"
        >
          <span>Model</span>
          <span className="font-mono text-ap-fg">{model || '—'}</span>
        </label>
        <select
          id="ai-model-picker"
          value={model}
          onChange={handleSelectModel}
          className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-ap-fg"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* API key */}
      <div className="mb-5 rounded border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-white/60">
          <span>API key</span>
          <span
            className={
              keyPresence.present
                ? 'rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200'
                : 'rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200'
            }
          >
            {keyPresence.present ? 'Set' : 'Not set'}
          </span>
        </div>
        {keyPresence.present && (
          <div className="mb-2 font-mono text-xs text-white/60">
            {keyPresence.masked || '••••••••'}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type={show ? 'text' : 'password'}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            placeholder="Paste new Gemini API key"
            aria-label="Gemini API key"
            className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-ap-fg placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={() => {
              setShow((v) => !v);
            }}
            className="rounded bg-white/10 px-2 py-1.5 text-[11px] text-ap-fg hover:bg-white/15"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleSaveKey}
            disabled={draft.trim().length === 0}
            className="rounded bg-ap-green/30 px-3 py-1 text-[11px] font-medium text-ap-fg hover:bg-ap-green/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleClearKey}
            disabled={!keyPresence.present}
            className="rounded bg-white/10 px-3 py-1 text-[11px] text-ap-fg hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
          <span className="ml-auto self-center text-[10px] text-white/40">
            Stored in OS keychain (encrypted).
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="rounded border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-white/60">
          <span>Last 7 days</span>
          <button
            type="button"
            onClick={handleRefreshStats}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-ap-fg hover:bg-white/15"
          >
            Refresh
          </button>
        </div>
        {stats ? (
          <div className="grid grid-cols-2 gap-2 font-mono text-[12px] text-ap-fg">
            <div>
              <span className="text-white/40">Calls:</span> {stats.callCount}
            </div>
            <div>
              <span className="text-white/40">JSON fail:</span>{' '}
              {(stats.jsonParseFailRate * 100).toFixed(1)}%
            </div>
            <div>
              <span className="text-white/40">p50:</span> {stats.p50LatencyMs}ms
            </div>
            <div>
              <span className="text-white/40">p95:</span> {stats.p95LatencyMs}ms
            </div>
            <div className="col-span-2 text-[10px] text-white/40">
              Last call:{' '}
              {stats.lastCallTs === null
                ? 'never'
                : new Date(stats.lastCallTs).toLocaleString()}
            </div>
          </div>
        ) : (
          <div className="text-xs text-white/50">Loading…</div>
        )}
      </div>
    </section>
  );
}
