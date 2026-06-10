# Deep tier (build-time only)

**Never indexed for live retrieval. Never shipped in the servable bundle.**

This folder documents where the offline abstraction pipeline reads raw Arch Public IP:

- **Primary deep root:** `../../arch-public-harness/` (proprietary algorithm source + docs; mostly gitignored)
- **Purpose:** human curation or Phase 1 automated generation (`npm run generate:abstractions`) of servable abstractions under `../servable/`
- **Generation manifest:** `GENERATION_MANIFEST.json` maps strategies → deep sources + D-4 chunk plan

The `npm run build:knowledge` script calls `inventoryDeepTier()` on this path for a build-time file count only. No deep-tier bytes are written into `knowledge/bundles/`.
