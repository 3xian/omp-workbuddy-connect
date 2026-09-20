# M2 Model Catalog Gate

Date: 2026-09-20

Baseline: OMP 18.2.6 / `78b753124d11f8dd3ae73e2524125890ff7c977e`

Decision: **PASS for M2 tasks 3.1–3.10.** M3–M5 and their live Gateway/release cases remain open.

## Directory source evidence

The selected D6 Path B implementation reports exactly:

- `desktop-cache` for a valid Desktop product document, including literal `models: []`;
- `builtin-fallback` plus one exact reason: `missing`, `unreadable`, `invalid-json`, `invalid-schema`, or `no-valid-models`.

The authorized local metadata source was `~/.workbuddy-ai/cache/acc-product-config-v3.json`. It contained 22 model rows at inspection time. No Desktop credential file was read. A redacted metadata-only sample is retained at `test/fixtures/desktop-product-config-real-sample.json`.

Cache-derived IDs used by the permanent M2 contract:

| ID | Name | Credits evidence | Context | Raw/effective output | Vision | Thinking evidence |
|---|---|---:|---:|---:|---|---|
| `deepseek-v4.1-flash` | Deepseek-V4.1-Flash | `x0.00` | 1,000,000 | 128,000 / 16,384 safety clamp | yes | reasoning; no supported-effort list in current row |
| `hy4-preview-f` | Hy4 preview | `x0.00` | 1,000,000 | 64,000 / 64,000 | yes | required `high` |
| `hy3` | Hy3 | `x0.00` | 192,000 | 64,000 / 64,000 | yes | required `low`, `high` |
| `fast-model` | Fast | `x0.34 credits` | 200,000 | 32,000 / 32,000 | yes | reasoning; no supported-effort list in current row |

The fixture preserves only non-secret product metadata. It contains no Token, credential, account ID, organization ID, or Authorization value.

## Scope and transaction evidence

`test/contract/model-scope-lifecycle.test.mts` uses the real OMP `ModelRegistry` and isolated `AuthStorage` to prove:

1. `free → all` exposes the cache-derived catalog and persists `all`.
2. Registration failure restores the previous Provider and leaves the committed setting unchanged.
3. Setting-write failure restores the previous Provider and leaves the committed setting unchanged.
4. `all → fast-model → free` against a paid-only valid catalog yields an authoritative empty result.
5. Explicit `unregisterProvider` before `registerProvider({ models: [] })` removes stale runtime rows.
6. The removed current model produces a reselect warning; no automatic model selection occurs.
7. A retained `fast-model` object fails in the extension payload hook before the real OMP `openai-completions` transport invokes `fetch`; observed WorkBuddy Chat request count is zero.
8. Restart reloads persisted `free` and keeps the paid-only free projection empty.
9. The isolated OMP credential row is semantically identical before scope changes, after failures, after successful empty transition, and after restart.

`test/settings.test.mts` separately proves the public OMP agent-directory rule, `PI_CODING_AGENT_DIR`, safe `free` default, scope-only JSON, restart loading, and file mode `0600`.

## Verification run

The following gate completed with exit code 0:

```text
bun extensions/workbuddy.ts --self-check
bun test/model-catalog.test.mts
bun test/model-transport.test.mts
bun test/settings.test.mts
bun test/scope.test.mts
bun test/session-start.test.mts
bun test/oauth-protocol.test.mts
bun test/auth.test.mts
bun test/provider.test.mts
bun test/contract/model-scope-lifecycle.test.mts
bun test/contract/provider-logout.test.mts
bun test/contract/persisted-credential-restart.test.mts
bun test/contract/request-identity-binding.test.mts
bun test/contract/task-runtime-contract.test.mts
tsc --noEmit
```

Observed M2 lifecycle result:

```text
OK: M2 real catalog metadata, transactional scope, retained-model guard, restart, and credential invariants
```

## Evidence boundary

The local OMP AuthStorage contained no enabled WorkBuddy credential for a new live validation session. No new live Gateway Chat was attempted for this gate. Therefore this record does **not** claim live requests across three models, live Vision, live supported-effort/off encoding, live pricing, or interactive selector behavior. Those remain explicit M3/M5 gates in the requirement matrix; the M2 pass is based on real Desktop catalog metadata, real OMP registration/transport contracts, isolated credential invariants, and zero-request negative proof.
