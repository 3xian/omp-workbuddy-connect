# ADR: WorkBuddy Request Identity Binding

Status: Blocked for publication — OMP 18.2.6 does not expose the current request session to `Model.resolveHeaders`

Verified host: OMP 18.2.6 at `78b753124d11f8dd3ae73e2524125890ff7c977e`

Date: 2026-09-20
Updated: 2026-09-21 — multi-session review rejected global `sessionId`/`active` as request proof

## Context

Every WorkBuddy Chat request must bind the following to one durable OAuth credential identity:

- host-provided Bearer token, which may refresh between retry attempts;
- `X-User-Id` from the same durable row's `accountId`;
- exactly one enterprise semantic from that row: `X-Enterprise-Id` when optional `orgId` exists, otherwise `X-No-Enterprise-Id: 1`.

The first modifier probe proved that static identity values in `model.headers` become stale when an existing session retains an A model object after login B. That rules out long-lived static credential snapshots, but it does not prove that current-session model rebinding is the only supported solution.

OMP 18.2.6 exposes relevant pieces but not their correlation:

1. production `streamSimple()` resolves `AuthStorage.resolver(model, requestSessionId)` before each transport attempt;
2. `AuthStorage` records the selected credential as active for that request session;
3. `Model.resolveHeaders(signal)` then runs, including on a 401 retry, but receives no session ID or request-attempt ID;
4. extension `session_start` / `session_switch` contexts are lifecycle events, not a request-scoped identity channel.

`before_provider_headers` remains unsupported and must not be restored.

## Runtime evidence

The first isolated probe established capability preservation: `modifyModels()` installed a WorkBuddy-only resolver, composed the model's existing fixed-header resolver, and `stream()` awaited it exactly once before transport.

The isolated transport probe confirms Bearer-before-Header order and per-retry Header resolution. The 2026-09-21 cutover removed duplicate `getOAuthAccess()`. A proposed follow-up stored the last lifecycle `sessionId` and checked its active row, but that row may belong to a different main/Task/child request; the unit fake also ignored the `sessionId` argument and made the proof vacuous. That implementation was removed.

Captured outbound attempts:

| Scenario | Bearer | User ID | Enterprise ID | Durable row |
|---|---|---|---|---:|
| normal A | `access-a1` | `account-a` | `org-a` | 1 |
| forced refresh A | `access-a2` | `account-a` | `org-a` | 1 |
| 401 first attempt | `access-a2` | `account-a` | `org-a` | 1 |
| 401 retry after host force-refresh | `access-a3` | `account-a` | `org-a` | 1 |
| logout A → login B using retained old model object | `access-b1` | `account-b` | `org-b` | 2 |

The abort scenario resolved B row 2, then aborted inside `resolveHeaders`; zero HTTP requests reached the transport. The old A model object safely produced B identity because it retained a dynamic resolver rather than static account headers.

These observations prove identity alignment for the exercised serial attempts. They do not prove AUTH-04 when account storage changes after Bearer selection but before Headers, or when another session owns the latest lifecycle binding. A 401 retry reruns Headers, but the Header callback still cannot identify the retry's request session.

## Decision

Keep the portable checks that are valid without request identity:

```text
AuthStorage resolver
  -> select/refresh one OAuth credential for the real request session
  -> WorkBuddy getApiKey(credentials) validates it against the sole stored row

Model.resolveHeaders()
  -> capture the sole stored credentialId/accountId/orgId
  -> compose the previous resolver
  -> re-read and compare credentialId/accountId/orgId
  -> materialize identity Headers
```

The pre/post comparison rejects a stored-row switch during asynchronous Header composition. Rebinding a second session that shares the same `AuthStorage` is intentionally idempotent and does not invalidate an in-flight request.

Do not use `listOAuthAccounts(provider, lastLifecycleSessionId).active` as current-request proof. `resolveHeaders()` cannot know whether the current request is from main, Task, child, resume, or another in-process session. Do not add a global pending-row queue or lock: aborted requests and concurrent attempts cannot be correlated safely without a host request ID.

## Extension binding and lifecycle

`ExtensionContext.modelRegistry` is public inside handlers, and `ModelRegistry.authStorage` is public. Provider registration can occur before `session_start`; lack of a runtime binding must not hide a valid persisted model. `bindContext()` therefore retains only the shared `AuthStorage` authority and is idempotent when another session binds that same store.

Every retained model resolver reads the current sole row and rechecks the same storage object plus row identity after asynchronous composition. Scope revision, caller/logout/shutdown abort, zero/multiple rows, and storage replacement still fail before HTTP.

## Durable identity boundary

The intended boundary remains one durable OAuth credential row: Bearer, `accountId`, and optional `orgId` must come from that row; refresh may rotate only the access token. `getApiKey(credentials)` validates the selected credential against the sole stored row. Header resolution independently captures and rechecks that row.

The normative invariant is per transport attempt, not a lifetime lock for the whole logical Chat. After an explicit account replacement, a later 401 retry MAY bind to the newly selected durable row only if that retry's Bearer and identity Headers are atomically from the new row; mixing rows within one attempt is prohibited. OMP 18.2.6's missing request identity prevents proving that atomicity, so this semantic clarification does not unblock publication.

The real transport contract covers first request, same-row forced refresh, 401 retry with per-attempt Headers, optional enterprise, ambiguity rejection, and retained-model A→B where B uses a second request session while the provider remains bound to the original lifecycle session. The provider regression covers two sessions sharing one `AuthStorage` without binding clobber and a stored-row change during a paused Header resolver.

These tests do not make the independent Bearer and Header lookups atomic. The remaining gap requires OMP to pass the current request session/attempt to `resolveHeaders`, expose the selected credential to Header resolution, or atomically return Bearer plus Headers.

## Rejected fallbacks

Static model Headers cannot survive account changes. Duplicate `getOAuthAccess()` remains raceable with the later host selection. The last lifecycle session's `active` row is not the current request row. `ExtensionAPI.setModel(freshModel)` cannot repair an in-flight attempt. Global pending state cannot handle concurrency and aborts safely.

## Consequences

- AUTH-04 and a new publication tag remain blocked on a request-scoped host identity contract.
- Serial request, refresh, retry, optional-enterprise, ambiguity, and cross-session retained-model behavior remain covered.
- A stored-row change during asynchronous Header composition fails before HTTP.
- Same-row token rotation passes because `credentialId`, `accountId`, and optional `orgId` remain stable.
- Header resolution performs zero `getOAuthAccess()` calls.
- The extension must not claim session `active` as request proof or add global correlation state.
