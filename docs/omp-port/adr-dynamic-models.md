# ADR: WorkBuddy Dynamic Model Source

Status: Accepted and implemented for M2

Decision date: 2026-09-20

Applies to: OMP 18.2.6 (`78b753124d11f8dd3ae73e2524125890ff7c977e`), change `adapt-workbuddy-international-omp`

## Decision

Choose D6 Path B: **Desktop product cache → builtin catalog fallback**.

M2 reads product metadata from `~/.workbuddy-ai/cache/acc-product-config-v3.json` (or the existing test override), labels a valid read `desktop-cache`, and uses the maintained builtin catalog only when that file is missing, unreadable, malformed, or contains a non-empty model array with no valid rows, labelled `builtin-fallback`. A literal valid `models: []` remains an authoritative empty Desktop catalog. The implementation does not read Desktop credentials.

Path A (`fetchDynamicModels`) is not selected for v1. No stable, documented authenticated WorkBuddy international product/model endpoint with a response contract and lifecycle suitable for this extension was found in the current upstream implementation, repository documentation, or authorized local product artifacts. Endpoint guessing is prohibited.

## Evidence

### Available WorkBuddy product evidence

- `extensions/workbuddy.ts:95-98` resolves only the Desktop product cache path.
- `extensions/workbuddy.ts:147-166` parses that local document and falls back to builtins.
- Repository search found no implemented or documented remote product/model request. The only current product source described by `README.md:44` is the same Desktop cache.
- The known authenticated Chat and Billing protocols do not establish a product-catalog endpoint. Billing is `POST https://www.workbuddy.ai/v2/billing/meter/get-user-resource`; it is not a model-catalog contract.

This is negative evidence, not proof that WorkBuddy has no internal endpoint. It is sufficient to reject an unaudited v1 dependency on one.

### OMP native dynamic discovery

OMP 18.2.6 supports `ProviderConfigInput.fetchDynamicModels(apiKey)` in `config/model-registry.ts:3151-3158`. Its runtime manager is authoritative and uses the native SQLite model cache with a 24-hour TTL (`model-registry.ts:3001-3044`).

The callback receives only a resolved API key, not accountId, orgId, durable credential id, session id, or the OAuth credential object. This is an integration cost and cache-safety risk, not a proof that identity-aware discovery is impossible: an extension closure could use public ModelRegistry/AuthStorage under the single-account invariant. That extra path is unjustified without a documented endpoint and identity contract.

The native cache is keyed as provider discovery state, not by WorkBuddy free/all scope or account/org identity. A future Path A design would need explicit cache-key and invalidation evidence to prevent replaying one account or scope's catalog into another.

## Scope and fallback invariants

Path B does not permit broadening a valid catalog:

1. A valid Desktop cache is authoritative for its rows and pricing evidence.
2. Known paid and unknown-price rows are excluded from `free`.
3. A valid catalog whose free projection is empty remains empty. Builtin IDs MUST NOT refill it.
4. Builtins are used only when the product cache itself is unavailable or invalid, and `builtin-fallback` is not by itself evidence that a row is currently free.
5. `all` means all models recognized in the selected source, not an assertion that the server exposes no others.

The implementation enforces these invariants in `src/models.ts`; `test/model-catalog.test.mts` permanently covers paid, unknown, literal-empty, missing, unreadable, invalid JSON/schema, and non-empty-without-valid-row cases.

## Empty-catalog feasibility

OMP static `registerProvider({ models: [] })` is not a clearing operation: 18.2.6 processes static overlays only when `config.models.length > 0` (`model-registry.ts:2931`). M2 therefore MUST explicitly remove the previous provider registration/overlay before registering an empty projection, or use another verified host operation that demonstrably removes stale rows. Merely re-registering an empty array is insufficient.

`fetchDynamicModels` would support an authoritative empty dynamic result, but it remains unselected because no trustworthy endpoint/response contract was found. Identity and cache integration are secondary implementation risks.

## Source presentation

The UI and diagnostics will use exactly these source values for the selected path:

- `desktop-cache`: valid Desktop product metadata file;
- `builtin-fallback`: cache missing, unreadable, malformed, or non-empty without a valid model row; the UI also presents the exact fallback reason.

`remote` remains reserved for a future ADR revision backed by an official authenticated endpoint and identity/cache evidence.

## Rejected alternative

Path A was rejected for v1 decisively because adopting it would require inventing or trusting an undocumented endpoint. Its API-key-only callback and provider-wide cache add identity/scope integration work, but are not claimed to make a future official endpoint theoretically unusable.

## Consequences and M2 acceptance

- No network product discovery in v1.
- Product-cache access remains a non-secret metadata boundary; Desktop credential access remains forbidden.
- Permanent missing/unreadable/malformed/no-valid-row/valid-paid/valid-unknown/valid-empty tests, accurate source labels, and a real `ModelRegistry` stale-row clearing integration check are recorded in `test/model-catalog.test.mts` and `test/contract/model-scope-lifecycle.test.mts`.
- A future move to Path A requires a new accepted ADR with endpoint provenance, schema, bearer/account/org requirements, cache key/invalidation behavior, empty-result behavior, and live evidence.
