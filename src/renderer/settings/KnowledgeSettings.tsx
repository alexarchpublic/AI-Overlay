/**
 * @file src/renderer/settings/KnowledgeSettings.tsx
 *
 * PRD §3.7 — docs bundle metadata and refresh instructions for internal CS.
 */

import { useEffect, useState, type ReactElement } from 'react';
import type { KnowledgeBundleInfo } from '../../shared/knowledgeTypes';

function formatIngestDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTokenCount(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function KnowledgeSettings(): ReactElement {
  const [info, setInfo] = useState<KnowledgeBundleInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const bundle = await window.api.knowledge.getBundleInfo();
        if (!cancelled) setInfo(bundle);
      } catch (err) {
        window.api.log.error('knowledgeSettings.loadFailed', { message: String(err) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-md border border-white/10 bg-ap-bg p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-ap-fg">Knowledge</h2>
        <p className="mt-1 text-xs text-white/60">
          Published docs from docs.archpublic.com, ingested verbatim for grounded answers.
        </p>
      </header>

      {loading ? (
        <div className="text-xs text-white/50">Loading bundle info…</div>
      ) : info ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-white/50">Bundle version</dt>
          <dd className="font-mono text-ap-fg">{info.contentHash.slice(0, 12)}…</dd>
          <dt className="text-white/50">Ingest date</dt>
          <dd className="text-ap-fg">{formatIngestDate(info.fetchedAt)}</dd>
          <dt className="text-white/50">Pages</dt>
          <dd className="text-ap-fg">{info.pageCount}</dd>
          <dt className="text-white/50">Corpus tokens</dt>
          <dd className="font-mono text-ap-fg">{formatTokenCount(info.totalTokenEstimate)}</dd>
        </dl>
      ) : (
        <div className="rounded border border-amber-400/30 bg-ap-warning px-3 py-2 text-xs text-amber-100">
          No docs bundle loaded. Run <code className="font-mono">npm run ingest:docs</code> from
          the repo, then restart the app.
        </div>
      )}

      <div className="mt-4 rounded border border-white/10 bg-black/20 p-3 text-xs text-white/70">
        <div className="mb-1 font-medium text-ap-fg">Refresh the corpus</div>
        <p>
          From the project root, run{' '}
          <code className="rounded bg-ap-elevated px-1 py-0.5 font-mono text-[11px]">
            npm run ingest:docs
          </code>
          . Committed snapshots under <code className="font-mono">knowledge/docs-corpus/</code>{' '}
          make each refresh a reviewable diff. Restart the app after a new bundle lands.
        </p>
      </div>
    </section>
  );
}
