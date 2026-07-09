# Knowledge corpus (internal sales/CS co-pilot)

Published Arch Public documentation is the knowledge source of truth
(`PRD_Internal_Copilot_Pivot.md` D-P2 / D-P3). There is no deep/servable
abstraction split — the model answers from the full docs corpus.

## Layout

| Path | Role | In git |
|------|------|--------|
| `knowledge/docs-corpus/*.md` | Verbatim page snapshots (Agent Instructions stripped) | Yes — reviewable diffs on re-ingest |
| `knowledge/bundles/docs-<hash>.json` | Content-hashed chunk bundle loaded at runtime | Yes |

## Refresh workflow

```bash
npm run ingest:docs
```

1. Fetches `https://docs.archpublic.com/llms.txt` and every linked page's `.md` endpoint.
2. Snapshots each page into `knowledge/docs-corpus/<slug>.md`.
3. Chunks by heading (H2 primary; oversized sections split at H3/H4).
4. Emits `knowledge/bundles/docs-<contenthash>.json` and prints per-page + total token estimates.

A changed content hash means docs moved — review the corpus diff like any other PR.

Any page fetch failure aborts the run (no partial silent bundles).

## Runtime

`LocalKnowledgeStore` loads the newest `docs-*.json` from `knowledge/bundles/`
(dev: repo path; packaged: `extraResources/knowledge/bundles`). Retrieval is
lexical over chunk text + `sectionPath`, with an active-algorithm boost
(Market Wave / Arbitrage / Intelligence / Apex). When total corpus tokens are
≤ 50k, prompt composition may inject the full corpus (see
`FULL_CORPUS_INJECTION_THRESHOLD` / `USE_FULL_CORPUS_INJECTION` in
`src/shared/knowledgeConstants.ts`).
