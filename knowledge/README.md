# Two-tier knowledge base (secure harness Phase 0 + Phase 1)

This directory implements PRD §5.1: raw IP stays in the **deep tier**; only D-3-valid **servable** abstractions ship to the runtime bundle.

## Tiers

| Tier | Path | Live retrieval | In git |
|------|------|----------------|--------|
| **Deep** | `knowledge/deep/` → `arch-public-harness/` | Never | Deep content gitignored via harness rules |
| **Servable** | `knowledge/servable/**/*.abstraction.json` | Yes (via bundle) | Committed |

The deep tier symlink/manifest points at `arch-public-harness/` for offline authoring. The build pipeline inventories deep files for audit only — **no deep text is copied into the bundle**.

## Authoring workflows

### Phase 0 — hand-curated (still supported)

1. Read strategy behavior from the deep tier (Pine Script / docs) offline.
2. Write or edit `*.abstraction.json` under `knowledge/servable/<strategy-id>/`.
3. Set `review.d3Pass: true` only after a human confirms PRD D-3 (no code, paths, formulas, proprietary defaults).
4. Run `npm run build:knowledge` to validate D-3 and emit a content-hashed bundle under `knowledge/bundles/`.

### Phase 1 — automated pipeline (less human curation)

The offline generator reads deep-tier source, LLM-authors abstractions, validates D-3 deterministically (with auto-retry on violations), and auto-attests `review.d3Pass` when publish checks pass.

**Prerequisites:** `GEMINI_API_KEY` in the environment (same key as the app; not read from the Electron keychain).

```bash
# Generate all strategies in knowledge/deep/GENERATION_MANIFEST.json
npm run generate:abstractions

# One strategy, overwrite existing hand-curated files
npm run generate:abstractions -- --strategy market-wave --force

# Validate generation path without writing servable files
npm run generate:abstractions -- --dry-run
```

Then publish:

```bash
npm run build:knowledge
```

**What is automated vs human:**

| Step | Phase 0 | Phase 1 |
|------|---------|---------|
| Read deep source | Human | `loadDeepTierSources()` |
| Write abstraction prose | Human | Gemini (`generate:abstractions`) |
| D-3 validation | Build gate | Build gate + generation retry loop |
| `review.d3Pass` sign-off | Human reviewer | `automated-pipeline` after D-3 pass |
| Bundle + fingerprints | `build:knowledge` | `build:knowledge` (unchanged) |

Chunk plans live in `knowledge/deep/GENERATION_MANIFEST.json` (strategy → deep includes + D-4 split). Human curation remains available for spot edits or strategies not yet in the manifest.

## Build artifact

- `knowledge/bundles/servable-<hash>.json` — full bundle (`manifest` + `chunks`)
- `knowledge/bundles/servable-<hash>.manifest.json` — manifest only

The runtime store loads the servable bundle from `knowledge/bundles/` at init
(see `LocalKnowledgeStore` in `src/main/knowledgeStore.ts`). One plaintext
representation ships in the packaged app (`extraResources`); see security PRD
§12 D-12 for the at-rest decision.

`deep-fingerprints.json` (repo root under `knowledge/`) is produced by `npm run build:knowledge` from the deep tier. The runtime deterministic gate uses it to block verbatim source leaks (task 5).

## Chunking (D-4)

Parameter roles are split across multiple `param-role` chunks so no single chunk — and ideally no casual combination — reconstructs a full proprietary parameter set. The generation manifest encodes this split explicitly.
