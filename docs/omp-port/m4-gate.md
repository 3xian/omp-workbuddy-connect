# M4 Commands, Credits, and Optional UI Gate

Recorded: 2026-09-20  
Host: OMP 18.2.6  
Status: **PASS**

## Implementation result

Tasks 5.1–5.7 are complete:

- `src/credits.ts` implements the WorkBuddy `UsageProvider` with `retainLastGoodOnFailure: false` and strict Billing response parsing;
- `src/workbuddy-api.ts` owns the sole Billing HTTP adapter and uses only the host-supplied OAuth access token and accountId;
- Billing sends `X-User-Id`, does not send unevidenced `X-Enterprise-Id`, and has no credential lookup or refresh path of its own;
- valid zero credits remain available, while negative/incoherent quantities, empty package lists, HTTP failure, timeout, malformed data, missing identity, and ambiguous stored accounts are unavailable;
- `validatesCredentials: false` accurately states that Billing is optional usage data, not an evidenced credential-health probe;
- `/workbuddy`, `/workbuddy free`, `/workbuddy all`, and `/workbuddy logout` expose the required management operations;
- `src/ui.ts` owns Widget/status rendering and the display-only `stateGeneration` guard;
- account replacement, scope changes, model departure, logout, session switch, and session teardown invalidate old asynchronous results;
- every Widget/status/notify operation is guarded by `ctx.hasUI` and contained so optional UI failure cannot enter the Chat plane;
- `session_start` and `turn_start` schedule optional Billing without awaiting it.

No legacy credential file, Desktop credential, environment credential, plugin refresh loop, Chat transport, or global fetch interceptor was added.

## Credits contract

`test/credits.test.mts` uses an isolated real OMP `AuthStorage` and registered provider to verify:

1. host OAuth access and accountId become Billing `Authorization` and `X-User-Id`;
2. orgId remains report scope only and does not become Billing `X-Enterprise-Id`;
3. account, pack, plan, remaining, limit, and used data normalize into `UsageReport`;
4. genuine numeric zero remains a successful report;
5. negative remaining/used/limit, remaining or used above limit, and an empty package list are unavailable;
6. a successful report followed by 5xx becomes unavailable instead of serving last-good data;
7. malformed responses and timeout become unavailable;
8. two stored WorkBuddy rows produce zero Billing HTTP requests.

The parser requires a successful envelope, a non-empty structurally valid `Accounts` array, and coherent non-negative numeric quantities. It never clamps malformed values into a zero-credit report.

## Commands and UI lifecycle

`test/ui.test.mts` verifies the management surface through the actual extension entry and real OMP `ModelRegistry`/`AuthStorage`:

- `/workbuddy` renders login, account, credits, plan, scope, model count, model source, and Provider state;
- account A's pending response cannot repaint after switching to B;
- a pending old-scope response cannot repaint after `/workbuddy free`;
- leaving WorkBuddy clears Widget/status and rejects the pending result;
- UI method exceptions are contained;
- a headless context performs no Widget/status/notify access and starts no optional Billing request.

`test/contract/model-scope-lifecycle.test.mts` retains transactional free/all registration, persistence, rollback, current-model removal warning, empty-scope display, unchanged credentials, and restart behavior. `test/contract/provider-logout.test.mts` retains failed-delete truthfulness, successful provider-scoped deletion, pending-credit invalidation, old resolver rejection, and unchanged Desktop-owned data.

`test/session-start.test.mts` now uses a host OAuth row and registered UsageProvider. Its Billing request remains unresolved while `session_start` returns, proving the optional plane does not block startup.

## Known limitation

OMP 18.2.6 exposes `session_start` and `turn_start`, not a required `model_select` event for this extension. A model switch may therefore update the WorkBuddy Widget/status on the next `turn_start`. Authentication, model resolution, and Chat routing do not wait for or depend on that display refresh.

OMP 18.2.6 publicly exposes aggregate `fetchUsageReports()` but no provider-scoped fetch. The Widget filters the aggregate result after host-managed fetching; another configured provider may also be refreshed when its usage cache expires. This preserves host refresh/cache/timeout/single-flight ownership and is included in the M5 network audit.

## Verification

The final verification completed with exit code 0:

```text
npx bun test test
  -> 19 executable contract scripts, 19 explicit OK results, 0 failures
npx bun extensions/workbuddy.ts --self-check
  -> ok
npx tsc --noEmit
  -> no diagnostics
npx openspec validate adapt-workbuddy-international-omp --strict
  -> valid
```

These repository tests are executable `.test.mts` scripts rather than `bun:test` declarations; Bun's summary therefore reports zero formal test cases. The nineteen explicit `OK:` contracts and process exit status are the acceptance signal.

M4 validated the management protocol and lifecycle locally against OMP 18.2.6 without fabricating the then-pending live results. The subsequent authenticated Billing and complete release matrix passed at M5 and are archived in `release-evidence.md`.
