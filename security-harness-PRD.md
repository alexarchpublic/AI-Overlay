# PRD — Secure Chat Harness for the Arch Public AI Overlay

**Author:** Dr. Marcus Hale (secure-AI-agent architecture)
**Date:** May 29, 2026
**Status:** Approved to build (Phase 0 — internal MVP).
**Inputs:** `role.md`, `context.md` (secure target + Gap Register G1–G6), `phase-1-findings.md` (codebase security review + research synthesis + findings A1–A3).
**Source project under refactor:** `~/Documents/Claude/Projects/AP Agent Overlay/arch-public-ai-overlay`.

> **Reading guide.** This PRD specifies *what to build and why*, with enough interface detail to start. It is organized as: invariants (§1–2) → threat model (§3) → architecture (§4) → component specs (§5) → the tuning loop (§6) → data model (§7) → phasing (§8) → traceability (§9) → test/red-team (§10) → acceptance (§11) → decisions & open items (§12). Numbered decisions are written as `D-n` so they can be cited in code review, mirroring the source project's convention.

---

## 1. Mission & the zero-leakage invariant

Deliver a desktop AI co-pilot — an always-on-top widget over TradingView — that gives a trader expert, grounded, **actionable** guidance about the Arch Public algorithm on their chart (current signal and why, what-if scenarios, concrete values to try, risk posture) by reasoning from deep knowledge of the proprietary strategy, **while guaranteeing that raw source, file/line references, formulas, and the algorithm's actual proprietary parameter values never reach the user.**

**The invariant (non-negotiable):** *A model cannot leak what it was never given.* The primary control is architectural — raw IP never enters the model's context. Every guardrail downstream is defense-in-depth, because 2025 research shows all guardrails are bypassable.

### 1.1 The refined leakage boundary (governs every output decision)

The invariant is about **IP, not numbers.** Concrete value suggestions and an iterative tuning loop are *in scope and valuable* (stakeholder direction). The precise line:

- **FORBIDDEN — IP disclosure:** raw or paraphrased source code; file paths or `path:line` references; exact filter/entry/exit formulas; **the algorithm's actual configured or default value of any parameter** ("the algo currently uses a 2.0× ATR stop"); confirming or denying a user's guess at an internal value; anything sufficient to reconstruct strategy logic.
- **ALLOWED — actionable advice:** a concrete *proposed* value or range for the user to **try** on their own chart, framed as a forward recommendation grounded in the visible chart and market reasoning ("given the volatility you're showing, try tightening the stop to ~1.5× ATR and re-screenshot"); regime/behavior-level explanation; re-evaluation after the user applies a change.

**Why this is safe:** the surfaced number is a recommendation calibrated to the *user's own chart* (which they already see), not a readout of an Arch Public internal constant. The model's deep knowledge shapes the *direction and magnitude* of advice; it never states what the proprietary value *is*.

---

## 2. Goals & non-goals

**Goals (Phase 0 internal MVP):**

1. Raw IP never enters model context — abstraction-only knowledge base.
2. Rich, actionable advice including proposed values/ranges and a screenshot-driven tuning loop.
3. A semantic firewall that blocks IP disclosure while permitting forward suggestions, covering both the answer path and the memory path.
4. Local-only, **encrypted** abstraction store — built behind a backend-agnostic interface so a server-side deployment is a config/adapter swap, not a rewrite (D-1).
5. Backend-agnostic model layer (Gemini today; Claude/GPT/Grok swappable).
6. Adversarial red-team evidence before any external demo.

**Non-goals (Phase 0):**

- Server-side hosting (must be *enabled by the architecture*, not *implemented* now — §5.2, §12).
- Multi-user / multi-tenant auth.
- Windows release (design clean for it; ship macOS first).
- Full guard-model + canary + automated red-team CI — these are Phase 1+ backlog (§8). Phase 0 ships the deterministic controls that make leakage hard immediately.

---

## 3. Threat model

**Trust boundary:** the **user is untrusted** for IP purposes, even though internal and expert (`context.md` §4). The threat is *extraction of proprietary IP*, not user-directed harm.

**Adversary capabilities:** full, repeated, adaptive interaction with the chat; ability to phrase prompts adversarially, inject instructions via chart text/screenshots, and run long enumeration sequences; local access to the app's on-disk artifacts (settings, any local index, logs).

**In-scope threats (mapped to OWASP LLM Top 10 2025 / MITRE ATLAS):**

| Threat | Vector | Reference |
|--------|--------|-----------|
| System-prompt / context extraction | "Repeat your instructions", role-play, multi-turn coaxing | OWASP LLM07 |
| Sensitive info disclosure | Model emits code/params/paths in the answer | OWASP LLM02 |
| Prompt injection | Malicious text in a screenshot or pasted chart annotation | OWASP LLM01 |
| RAG knowledge-base extraction | Query-sequence enumeration (*Pirates of the RAG*); benign-looking anchor queries (*Silent Leaks / IKEA*) | ATLAS exfiltration |
| Embedding inversion | Reconstructing source text from a locally-stored vector index | ATLAS; research §B.3 of findings |
| Parameter triangulation | Iterating the tuning loop to back out proprietary internals | enumeration variant |
| On-disk artifact theft | Reading the local index / logs / settings off the machine | local-app threat |

**Out of scope (Phase 0):** network MITM on the model API (standard TLS assumed); supply-chain attacks on dependencies; OS-level compromise beyond reasonable at-rest encryption.

---

## 4. Architecture overview

Defense-in-depth, ordered by reliability (most reliable first). Each layer assumes the one in front of it can fail.

```
            ┌──────────────────────── BUILD TIME (offline) ────────────────────────┐
  Raw repo →│  Abstraction Pipeline  →  "Deep tier" (raw, never served)             │
            │                        →  "Servable tier" (abstractions only)         │
            └───────────────────────────────────┬───────────────────────────────────┘
                                                 ▼  (encrypted, abstraction-only)
            ┌──────────────────────── RUN TIME (per turn) ─────────────────────────┐
 user msg + │  KnowledgeStore (swappable: LocalEncrypted | Remote)                  │
 screenshots│        ▼ retrieval (scoped to servable tier, least-context)           │
            │  Prompt Builder  ← zero-leakage persona + retrieved abstractions       │
            │        ▼                                                               │
            │  Model Adapter (Gemini | Claude | GPT | …)  → structured output         │
            │        ▼                                                               │
            │  Semantic Firewall:  deterministic gate → [guard model] → canary scan   │
            │        ▼  (block / rewrite / allow)                                    │
            │  Memory (session + distilled profile, firewalled)  →  UI               │
            │  Monitor: per-session enumeration / rate-limit                          │
            └───────────────────────────────────────────────────────────────────────┘
```

Layer reliability ranking (from research): (1) abstraction at ingestion — *robust*; (2) scoped least-context retrieval — *robust*; (3) schema that makes IP disclosure unrepresentable — *strong*; (4) deterministic output gate — *strong (exact-match, not evadable by phrasing)*; (5) guard model — *~92–98%, evadable*; (6) canaries — *detection of verbatim only*. We do not rely on any single layer.

---

## 5. Component specifications

### 5.1 Offline abstraction pipeline + two-tier knowledge base

**Purpose:** convert the raw codebase into a servable representation that contains zero reconstructable IP. This is the load-bearing control (retires G1, A1, A2 at the source; redefines G3).

**Two tiers (D-2):**

- **Deep tier** — raw source + docs. Used *only* at build time by the pipeline to author abstractions. **Never indexed for live retrieval; never shipped to the client.**
- **Servable tier** — abstraction documents only. The *sole* corpus a live query can reach.

**An abstraction document contains (and only contains):**

- Strategy/behavioral contract in natural language: what it does, what regime it favors, how it responds to volatility/trend/liquidity shifts.
- Parameter **roles** and **safe operating ranges** expressed generically (e.g., "volatility filter — higher = fewer, higher-conviction signals; typical retail range ~1.0–2.5× ATR"), **never the proprietary default**.
- Directional tuning guidance ("to reduce drawdown sensitivity, widen the volatility filter and cut position size").
- Risk framing and trade-management reasoning.

**Hard exclusions from the servable tier (D-3):** raw code, pseudocode reconstructable to code, exact formulas, file paths / line numbers, proprietary default/configured parameter values, secrets of any kind.

**Authoring:** abstractions are generated semi-automatically (LLM-assisted summarization of the deep tier) **and human-reviewed before publication**. The reviewer signs off that each doc passes D-3. Authoring runs offline; its output is the only thing that crosses into the servable tier. (Pipeline automation depth is a Phase-1 enhancement; Phase 0 may author abstractions with heavy human curation.)

**Build artifact:** an encrypted, versioned servable-tier bundle (content-hashed) loaded by the runtime. Chunking ensures no single chunk — ideally no retrievable combination — reconstructs a complete parameter set (D-4).

### 5.2 Knowledge store & retrieval layer — swappable local/server backend (D-1, the explicit portability requirement)

**Requirement:** Phase 0 is **local-only and encrypted**; production *may* move retrieval server-side. The code must support **both with no rewrite** — selecting a backend is configuration, and only the adapter implementation differs.

**Design:** a single interface; two implementations.

```ts
/** The only way any runtime component reads knowledge. Backend-agnostic. */
interface KnowledgeStore {
  /** Returns the minimum relevant abstraction chunks for a query. */
  retrieve(query: RetrievalQuery): Promise<AbstractionChunk[]>;
  /** Servable-tier version/content hash for cache invalidation + audit. */
  version(): Promise<string>;
}

// Phase 0 — runs in-process on the user's machine.
class LocalEncryptedKnowledgeStore implements KnowledgeStore { /* … */ }

// Future — same interface, retrieval happens server-side over the network.
class RemoteKnowledgeStore implements KnowledgeStore { /* … */ }
```

**Selection (D-5):** a single config flag (`knowledge.backend = "local" | "remote"`) chosen at startup via a factory. No call site knows which backend it got. Everything above the interface (prompt builder, firewall, UI) is identical across deployments.

**LocalEncryptedKnowledgeStore (Phase 0) requirements:**

- **Stores abstractions only** — never raw source, never proprietary defaults. (Bounds the blast radius if the on-disk index is stolen.)
- **Encrypted at rest (D-6):** the index (including any embedding vectors) is encrypted; the key is held in the OS keychain (see §5.8), not on disk in plaintext. This directly addresses the embedding-inversion threat (§3): even local vectors must be treated as sensitive as plaintext.
- **Embedding choice:** vectors are computed over abstraction text only. Because even abstraction embeddings are inversion-targets, they are encrypted; and because the servable tier holds no raw IP, an inversion yields abstractions, not source. Local engine: **LanceDB** (embedded, in-process, disk-based, encryptable) is the recommended fit; final engine selection is an implementation detail behind the interface.
- **Retrieval is scoped (D-7):** the retriever can only ever address the servable tier. There is no code path from a live query to the deep tier or the raw repo. The current `harnessLoader` "walk the folder and inject everything" path is **removed** for live serving.

**RemoteKnowledgeStore (future) is enabled by, not built in, Phase 0:** the interface, the config switch, the serialization of `RetrievalQuery`/`AbstractionChunk`, and the firewall's independence from storage location are all designed now so the server implementation is additive (D-1).

**Context minimization (D-8):** every turn ships only the retrieved chunks needed for the current question plus persona + schema — never a full bundle. A per-turn context budget caps total tokens; retrieval returns top-k relevant chunks.

### 5.3 Persona redesign (replaces A1)

The current `PERSONA_PROMPT` mandates leakage ("always grounding your response in the actual source code") and must be **replaced wholesale** (it predates the secure framing). The new persona, stored in exactly one file (preserving the single-source-of-truth + grep-contract discipline already in the codebase):

- Frames the assistant as an expert Arch Public quant/trading-psychology co-pilot that reasons from deep strategy knowledge and the user's live chart.
- States the zero-leakage boundary in-prompt as a behavioral instruction (defense-in-depth — *not* relied upon, per §3): no source, no paths, no formulas, no statement of the algorithm's actual/default parameter values; offer proposed values/ranges to try, grounded in the visible chart.
- Encourages the iterative tuning loop and translation-over-revelation phrasing.

A snapshot test pins the composed system prompt so any drift surfaces in review (the codebase already does this).

### 5.4 Output schema redesign (replaces A2, refines G3)

Make **IP disclosure unrepresentable** while keeping advice rich. Replace the current schema (which mandates `path:line` citations and a proprietary `current` value).

```jsonc
{
  "schema_version": "2",
  "analysis": "string — behavior/regime-level. No code, paths, formulas, or 'the default is N' disclosures.",
  "suggested_parameter_changes": [
    {
      "parameter": "string — named role, e.g. 'volatility_filter' (NOT a file/variable reference)",
      "direction": "increase | decrease | set",
      "suggested_value": "string — a value OR RANGE to TRY (forward-looking; rounded), e.g. '~1.5× ATR' or '1.4–1.6× ATR'",
      "chart_context": "string — what's visible on the USER'S chart or what they last tried (NEVER the proprietary default)",
      "rationale": "string — regime/behavior reasoning; no formulas"
    }
  ],
  "confidence_score": "number 0..1",
  "risk_notes": "string — invalidating conditions"
}
```

Key changes (D-9):

- **No file/path/line field anywhere.** The "cite files" instruction is deleted.
- **No `current` proprietary value.** The old `current` field is replaced by `chart_context` (chart-visible / last-tried only).
- **`suggested_value` kept and encouraged** — this is the user's requested feature. Values are **rounded or expressed as ranges** to read as better advice and to introduce deliberate imprecision relative to any internal constant.
- Schema unit tests assert the absence of leakage-shaped fields.

### 5.5 Semantic firewall (new component — closes G5; covers the memory path per A3)

A mandatory layer between model output and **both** the UI and the memory store. Nothing reaches the user or persists to memory without passing it.

**(a) Deterministic gate (Phase 0, highest-value, exact-match — not evadable by phrasing):**

- Blocks: code fences / code-shaped spans; file-path and `path:line` patterns; secret/API-key shapes; verbatim spans matching known deep-tier source (hash/fingerprint check); and **disclosure framings** of internal values ("the current/default/actual value is N", "the algorithm uses N"). Implemented with curated regex + a secret/source scanner (LLM Guard "Secrets/Sensitive" + Microsoft Presidio with custom recognizers for our parameter/path/ticker formats).
- **Permits** forward suggestions: "try N", "set it to ~N", ranges, chart-grounded recommendations. The gate distinguishes *disclosure of an internal value* from a *forward recommendation* — this nuance is the core of reconciling the tuning loop with the invariant.
- On a hit: block and regenerate with a stricter reminder, or rewrite to the safe abstraction; never display the raw offending output. Every hit is logged (sanitized) and counted.

**(b) Guard-model review (Phase 1 backlog):** a second model inspects output for IP disclosure the deterministic gate's patterns missed. Sits *behind* the deterministic gate (expect ~92–98% catch; itself jailbreakable).

**(c) Canary tokens (Phase 1 backlog):** unguessable strings embedded in any internal context; output scanned for verbatim hits → hard-block + alert. Detects verbatim dumps only (not paraphrase), so it is detection, not prevention.

**Memory-path coverage (D-10, fixes A3):** the conversation summarizer prompt that currently says "preserve parameter values" is rewritten; summaries pass the same deterministic gate before persisting. The distilled user profile (§5.7) stores *user* facts only — never proprietary internals.

### 5.6 Vision pipeline

TradingView screenshots are resized (~1024px max edge), held in a small in-memory ring buffer, written only to OS temp, and pruned on a timer (per `context.md` §3 — never persisted to cloud). The vision step extracts pattern/regime-level signals and what the user has set on *their* chart, which becomes the `chart_context` grounding for suggestions. **Screenshot text is untrusted input** — any instruction-like content in a screenshot is treated as a prompt-injection attempt and ignored by policy (OWASP LLM01).

### 5.7 Memory architecture

- **Session memory:** in-process, cleared on chat close (already correct in the codebase — preserve).
- **Distilled long-term user profile (greenfield):** trading style, risk tolerance, knowledge level, recurring questions, evolving goals — stored as compressed summary state. **Firewalled:** stores user facts only; the distillation prompt and its output pass the deterministic gate (D-10). Encrypted at rest alongside the local store.

### 5.8 Secrets & local hardening (G4/G6 — secondary priority)

- **API key & local-store encryption key → OS keychain** (replaces the four plaintext `// TODO: secure storage` sites in `aiStore.ts`). (D-11)
- **Secrets categorically excluded from any context path** — the deep tier may contain secrets, but secrets never cross into the servable tier; the existing entropy/filename heuristics remain a backstop, not the primary control.
- **Logs:** extend redaction beyond key-name matching — model outputs and `rawSnippet` fields are passed through the deterministic gate / sanitized before logging, so logged content can't carry IP.

### 5.9 Model portability

All model interaction stays behind a single adapter interface and a single prompt-construction site (the codebase already enforces this). Persona, retrieved-context composition, output schema, and the firewall are model-independent. Swapping Gemini → Claude/GPT/Grok is confined to the adapter (D-12). The firewall and KnowledgeStore are *also* independent of both model and storage location, which is what makes the local→server move clean.

---

## 6. The iterative tuning loop (first-class flow)

This is a primary, valued use of the product. Sequence:

1. User asks about behavior or requests a more conservative/aggressive posture.
2. Retrieval pulls relevant abstractions (roles, ranges, regime behavior) — not source.
3. Model proposes a concrete `suggested_value` (or range) grounded in the **visible chart** + market reasoning, with rationale.
4. Firewall confirms the suggestion is a forward recommendation, not an internal-value disclosure; it passes to the UI.
5. User applies the value on TradingView, submits a **new screenshot**.
6. Vision extracts the updated chart state into `chart_context`; the model re-evaluates performance/behavior and proposes the next adjustment.
7. Repeat.

**Safety within the loop (D-13):**

- The model **never confirms or denies** whether a suggestion matches the algorithm's internal default.
- Suggestions are **rounded / ranged**, introducing deliberate imprecision vs. any internal constant.
- **Per-session monitoring + rate-limiting** on tuning iterations detects enumeration-style probing (the realistic way iteration could triangulate proprietary internals); excessive systematic probing throttles or escalates.

---

## 7. Data model (concrete)

- `AbstractionChunk { id, strategyId, kind: 'contract'|'param-role'|'tuning'|'risk', text, version }` — servable tier; no raw IP.
- `RetrievalQuery { text, chartContext?, k, tokenBudget }`.
- Output schema v2 — §5.4.
- `UserProfile { tradingStyle, riskTolerance, knowledgeLevel, recurringTopics[], goals[] }` — user facts only.
- `FirewallVerdict { action: 'allow'|'rewrite'|'block', hits: FirewallHit[] }` — logged (sanitized).
- `RecordedCall` (existing) extended with `firewallAction`, `enumerationScore`.

---

## 8. Phasing / roadmap

**Phase 0 — Minimum Viable Secure (this build):**

1. Offline abstraction pipeline (human-curated acceptable) + two-tier KB.
2. `KnowledgeStore` interface + `LocalEncryptedKnowledgeStore` + config-selected factory (server path stubbed via the interface).
3. Scoped least-context retrieval; remove the full-bundle injection path.
4. Persona rewrite + output schema v2 (with `suggested_value` / tuning loop).
5. Semantic firewall — **deterministic gate** (answer path + memory path).
6. Vision-grounded tuning loop + per-session enumeration monitoring.
7. OS-keychain secrets; sanitized logging.
8. Red-team smoke suite (manual + scripted) against OWASP LLM02/07.

**Phase 1+ — Defense-in-depth backlog:**

- Guard-model review layer; canary tokens + alerting.
- Automated abstraction pipeline (less human curation).
- Continuous red-team in CI; expanded ATLAS coverage.
- **Production server-side `RemoteKnowledgeStore`** (the interface is ready — §5.2, §12).
- Tauri/Rust footprint; Windows port.

---

## 9. Gap → control traceability

| Gap / finding | Control (§) | Phase |
|---|---|---|
| G1 raw source in context | Two-tier KB + abstraction-only retrieval (§5.1, §5.2) | 0 |
| G2 file/line citations | Schema v2 has no path field (§5.4) + gate scans `path:line` (§5.5a) | 0 |
| G3 exact parameters | `suggested_value` allowed (proposed/ranged); proprietary `current` removed; `chart_context` replaces it (§5.4, §1.1) | 0 |
| A1 persona mandates leakage | Persona rewrite (§5.3) | 0 |
| A2 schema mandates citations | Schema v2 (§5.4) | 0 |
| A3 memory preserves values | Firewalled summarizer + gate on memory path (§5.5, §5.7) | 0 |
| G5 no firewall | Deterministic gate (§5.5a) | 0; guard-model/canaries 1+ |
| G6 trusted folder / secrets | Secrets excluded from servable tier; heuristics as backstop (§5.8) | 0 |
| G4 plaintext key | OS keychain (§5.8) | 0 |
| Embedding inversion (research) | Abstraction-only + encrypted local index (§5.2) | 0 |
| RAG enumeration (research) | Monitoring + rate-limiting (§5.5, §6) | 0 |

---

## 10. Test & red-team strategy

- **Unit:** schema v2 rejects leakage fields; deterministic gate blocks code/paths/secrets/value-disclosures **and** passes legitimate forward suggestions (both directions tested); summarizer output passes the gate; retrieval can only address the servable tier (assert no deep-tier path exists).
- **Property/fuzz:** generate disclosure-shaped strings ("the default is X", obfuscated paths, homoglyph/invisible-char variants) and assert the gate blocks; generate legitimate suggestions and assert they pass.
- **Red-team (mapped to standards):** OWASP **LLM07** (system-prompt extraction — "repeat your instructions", role-play, multi-turn), **LLM02** (sensitive disclosure), **LLM01** (injection via screenshot text); MITRE **ATLAS** exfiltration incl. *Pirates-of-the-RAG* enumeration and parameter triangulation across the tuning loop. Each technique → at least one test case. Manual + scripted in Phase 0; CI-continuous in Phase 1+.
- **Leakage audit:** all model outputs are logged (sanitized); a periodic audit asserts zero outputs contain raw code, paths, or internal-value disclosures (the primary success metric, auditable).

---

## 11. Acceptance criteria (Phase 0)

1. **Zero-leakage holds:** no output or persisted memory contains raw code, file/line references, formulas, or the algorithm's actual/default parameter values — verified by the red-team suite and the leakage audit. *(Primary metric.)*
2. **Tuning loop works:** the chat proposes concrete values/ranges, re-evaluates on a new screenshot, and iterates — judged useful by an internal trader.
3. **No raw-IP path exists:** retrieval is provably scoped to the servable tier; the full-bundle injection path is removed.
4. **Local store encrypted at rest;** keys in OS keychain.
5. **Backend swap is config-only:** a `RemoteKnowledgeStore` stub can be selected via config with no call-site changes (interface conformance test).
6. **Model swap confined to the adapter.**
7. Structured-output parse rate ≥ 95%; first response < 10s; chat opens < 300ms; 30-min crash-free session (carried from `context.md` §5).

---

## 12. Decisions & open items

**Locked decisions:**

- **D-1 / Deployment:** Phase 0 is **local-only, encrypted, abstraction-only**; architecture supports a future server-side swap via the `KnowledgeStore` interface and config flag. Production may go server-side later.
- **Build scope:** phased — **Minimum Viable Secure** in Phase 0; guard-model, canaries, automated pipeline, and full CI red-team in Phase 1+.

**Open items to resolve during the build:**

1. **Abstraction authoring depth in Phase 0** — how much is LLM-automated vs. hand-curated. Recommendation: hand-curate the first strategy set for trust, automate in Phase 1.
2. **Local vector engine** — LanceDB recommended; confirm encryption approach (engine-level vs. encrypted volume) during spike.
3. **Enumeration thresholds** — tune rate-limit/monitoring sensitivity against real session data to avoid frustrating the legitimate tuning loop.
4. **Suggested-value imprecision policy** — exact rounding/range conventions per parameter type (set during abstraction authoring).

---

*Bottom line: the model reasons over abstractions and the user's live chart, gives concrete values to try and iterates with them, and is structurally unable to read out Arch Public's source or internal parameter values — with a deterministic firewall and adversarial red-teaming as defense-in-depth, because a model cannot leak what it was never given.*
