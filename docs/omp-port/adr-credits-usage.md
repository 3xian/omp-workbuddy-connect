# ADR: WorkBuddy Credits through OMP UsageProvider

Status: Accepted for M4

Decision date: 2026-09-20

Applies to: OMP 18.2.6 (`78b753124d11f8dd3ae73e2524125890ff7c977e`), change `adapt-workbuddy-international-omp`

## Decision

Implement WorkBuddy credits as a provider-scoped OMP `UsageProvider`, registered through `pi.registerProvider("workbuddy", { usage })`.

Do not create an independent Billing authentication client or refresher. The UsageProvider will own the single WorkBuddy Billing request/response adapter; `/workbuddy` and optional UI will render the normalized host usage report plus current host credential identity metadata.

## Host capability evidence

OMP 18.2.6 expresses the required data:

- `UsageAmount.remaining`, `limit`, and `used`, with `unit: "credits"` (`pi-ai/src/usage.ts:31-45`);
- accountId, orgId, tier, model/window scope (`usage.ts:47-59`);
- per-limit label, status, and notes (`usage.ts:61-72`);
- report metadata and raw protocol evidence (`usage.ts:105-120`);
- OAuth access/refresh/expiry/accountId/orgId in `UsageCredential` (`usage.ts:318-335`);
- request cancellation through `UsageFetchParams.signal` and host fetch/retry utilities (`usage.ts:337-352`).

`ProviderConfigInput.usage` installs a runtime provider in AuthStorage (`config/model-registry.ts:2918-2923`, `3139-3142`). The host resolves a normalized credential and owns refresh, credential selection, timeout/cache, and fetch lifecycle before calling `fetchUsage`.

This is sufficient to represent account, remaining credits, plan/tier, identity scope, and unavailable results without a second credential authority.

## WorkBuddy protocol mapping

The existing protocol evidence is:

- `POST https://www.workbuddy.ai/v2/billing/meter/get-user-resource`;
- authenticated with the host-resolved OAuth access token;
- account packs contain package name, capacity, and remaining capacity;
- current parser derives an aggregate total plus individual packs.

M4 will move this protocol into the UsageProvider boundary and map each pack to a `UsageLimit`:

| WorkBuddy value | Usage value |
|---|---|
| package identifier/name | `id`, `label` |
| capacity size | `amount.limit` |
| capacity remaining | `amount.remaining` |
| derived consumed amount | `amount.used` when both inputs are valid |
| credit quantity | `amount.unit = "credits"` |
| account/org | `scope.accountId`, `scope.orgId` from `UsageCredential` |
| plan/package description | `scope.tier`, `label`, and/or `metadata` according to the actual response |
| full response | redacted `raw` or `metadata`; never Token/Authorization |

The aggregate report may include a total limit only when the response supports a mathematically valid sum. Parse failure, 5xx, timeout, or missing required fields returns `null`/unavailable; it MUST NOT produce a zero-credit report.

## Authentication and lifecycle

- `fetchUsage` consumes only the `UsageCredential` supplied by OMP.
- It does not call `current()`, `resolveCred()`, Desktop files, `.workbuddy-auth.json`, or environment credential files.
- It does not refresh a token. OMP AuthStorage owns refresh and retry lifecycle.
- It honors `params.signal` for the HTTP request and any host-provided wait.
- The provider enforces the same single-stored-account and required accountId/orgId invariant selected by the M1 authentication boundary. Ambiguity or missing identity yields unavailable with zero Billing requests.
- Logout/account replacement invalidates cached/displayed results using the M4 UI generation guard; Usage data never restores authentication state.

Therefore there is exactly one refresh implementation: the OAuth provider callback registered in M1.

## Critical-plane isolation

Usage is optional management data. Session startup and Chat do not await it. `/workbuddy` may explicitly await a refresh for command output, but background widget/status refresh remains non-blocking. Host usage timeout/cache behavior and UI generation checks prevent Billing latency or failure from entering the Chat critical path.

States remain distinct:

- not queried;
- available (including a genuine numeric zero returned by a valid response);
- unavailable (auth ambiguity, network/HTTP/timeout/parse failure).

## Rejected alternative

An independent `credits.ts` Billing client with its own credential lookup/refresh was rejected. It duplicates host refresh and selection, can race Chat identity, and recreates the legacy `current()/resolveCred()` authority that AUTH-01 removes. A thin response parser may still live in `src/credits.ts`; request authentication and lifecycle remain the UsageProvider's.

## Consequences and M4 acceptance

M4 must verify normalized account/org/plan/packs, success with genuine zero, 5xx, timeout, slow response, malformed response, abort, ambiguous credentials, logout with a pending result, and non-blocking startup/Chat. `/workbuddy` must report unavailable rather than zero when no valid report exists. Live Billing evidence remains an M4/M5 gate; this ADR does not claim it has run.
