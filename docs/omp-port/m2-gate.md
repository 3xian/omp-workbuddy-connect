# M2 Model Catalog Gate

Date: 2026-09-20

Baseline: OMP 18.2.6 / `78b753124d11f8dd3ae73e2524125890ff7c977e`

Decision: **PASS for M2 tasks 3.1–3.10.** M3–M5 and their live Gateway/release cases remain open.

## Directory source evidence

The selected D6 Path B implementation reports exactly:

- `desktop-cache` for a valid Desktop product document, including literal `models: []`;
- `builtin-fallback` plus one exact reason: `missing`, `unreadable`, `invalid-json`, `invalid-schema`, or `no-valid-models`.

The authorized local metadata source was `~/.workbuddy-ai/cache/acc-product-config-v3.json`. It contained 22 model rows at inspection time. No Desktop credential file was read. Because redistribution authorization for raw product rows is not established by this repository, no copied product fixture is committed; the permanent runtime contract uses `test/fixtures/model-scope-contract.json`.

Cache-derived IDs observed during the authorized local inspection:

| ID | Name | Credits evidence | Context | Raw/effective output | Vision | Thinking evidence |
|---|---|---:|---:|---:|---|---|
| `deepseek-v4.1-flash` | Deepseek-V4.1-Flash | `x0.00` | 1,000,000 | 128,000 / 16,384 safety clamp | yes | reasoning; no supported-effort list in current row |
| `hy4-preview-f` | Hy4 preview | `x0.00` | 1,000,000 | 64,000 / 64,000 | yes | required `high` |
| `hy3` | Hy3 | `x0.00` | 192,000 | 64,000 / 64,000 | yes | required `low`, `high` |
| `fast-model` | Fast | `x0.34 credits` | 200,000 | 32,000 / 32,000 | yes | reasoning; no supported-effort list in current row |

The retained evidence is this non-secret summary only. It contains no Token, credential, account ID, organization ID, Authorization value, or copied raw product row.

## Scope and transaction evidence

`test/contract/model-scope-lifecycle.test.mts` uses a synthetic catalog with the real OMP `ModelRegistry` and isolated `AuthStorage` to prove:

1. `free → all` exposes all contract models and persists `all`.
2. Non-empty re-registration replaces the overlay without calling `unregisterProvider`, avoiding unnecessary OAuth/runtime teardown.
3. Registration failure restores the previous Provider and leaves the committed setting unchanged.
4. Atomic setting-write failure preserves the previous file bytes, restores the previous Provider, and leaves no temporary file.
5. `all → contract-paid → free` against a paid-only valid catalog yields an authoritative empty result.
6. The empty transition calls `unregisterProvider` before `registerProvider({ models: [] })` and removes stale runtime rows.
7. The removed current model produces a reselect warning; no automatic model selection occurs.
8. A retained `contract-paid` object fails in its WorkBuddy-bound `resolveHeaders` while the real OMP `openai-completions` transport is being constructed; neither the previous resolver nor `fetch` is reached, and the observed WorkBuddy Chat request count is zero.
9. Restart reloads persisted `free` and keeps the paid-only free projection empty.
10. The isolated OMP credential row is semantically identical before scope changes, after failures, after successful empty transition, and after restart.

`test/settings.test.mts` separately proves the public OMP agent-directory rule, explicit directory-cache refresh for test isolation, `PI_CODING_AGENT_DIR`, safe `free` default, atomic scope-only JSON replacement, failure-byte preservation, temporary-file cleanup, restart loading, and file mode `0600`.

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
OK: M2 synthetic metadata, transactional scope, retained-model guard, restart, and credential invariants
```

## Evidence boundary

The local OMP AuthStorage contained no enabled WorkBuddy credential for a new live validation session. No new live Gateway Chat was attempted for this gate. Therefore this record does **not** claim live requests across three models, live Vision, live supported-effort/off encoding, live pricing, or interactive selector behavior. Those remain explicit M5 gates in the requirement matrix; the M2 pass is based on real Desktop catalog metadata, real OMP registration/transport contracts, isolated credential invariants, and zero-request negative proof.

### Post-M3 request-bound correction

The original M2 implementation placed the retained-model guard in `before_provider_request`. OMP 18.2.6 `ExtensionRunner` reports and swallows ordinary hook exceptions, so that placement could not fail closed in production; the old zero-HTTP test invoked the handler directly and therefore did not prove the host path. The guard now lives in WorkBuddy-bound `Model.resolveHeaders`, with transition/revision checks before the previous resolver, after asynchronous boundaries, and before identity headers return. `test/contract/model-scope-lifecycle.test.mts` exercises the real `streamSimple` path and observes zero `fetch` calls. `test/contract/before-provider-request-runtime.test.mts` separately proves exact request-model context and the host's swallowed-hook behavior. Same-ID foreign Provider requests are isolated by `ctx.model.provider`, not cumulative IDs.
