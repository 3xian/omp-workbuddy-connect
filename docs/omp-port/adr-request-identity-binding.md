# ADR: WorkBuddy Request Identity Binding

Status: Accepted — session-selected durable row is captured and revalidated for every transport attempt

Verified host: OMP 18.2.6 at `78b753124d11f8dd3ae73e2524125890ff7c977e`

Date: 2026-09-20
Updated: 2026-09-21 — post-merge hardening binds Headers to the host-selected session row without duplicate OAuth resolution

## Context

Every WorkBuddy Chat request must bind the following to one durable OAuth credential identity:

- host-provided Bearer token, which may refresh between retry attempts;
- `X-User-Id` from the same durable row's `accountId`;
- exactly one enterprise semantic from that row: `X-Enterprise-Id` when optional `orgId` exists, otherwise `X-No-Enterprise-Id: 1`.

The first modifier probe proved that static identity values in `model.headers` become stale when an existing session retains an A model object after login B. That rules out long-lived static credential snapshots, but it does not prove that current-session model rebinding is the only supported solution.

OMP 18.2.6 exposes four relevant public capabilities:

1. production `streamSimple()` resolves the `AuthStorage` API-key callback before each transport attempt;
2. `AuthStorage` records that selected credential as the session's active row before the attempt continues;
3. `Model.resolveHeaders(signal)` then runs for that attempt, including a 401 retry;
4. `AuthStorage.listOAuthAccounts(provider, sessionId)` exposes the selected durable `credentialId`, account identity, and `active` marker without another token resolution.

`before_provider_headers` remains unsupported and must not be restored.

## Runtime evidence

The first isolated probe established capability preservation: `modifyModels()` installed a WorkBuddy-only resolver, composed the model's existing fixed-header resolver, and `stream()` awaited it exactly once before transport.

The isolated probe uses the built-in `openai-completions` transport, public `AuthStorage.resolver()` for host Bearer selection/retry, and the production Header resolver. The 2026-09-21 cutover removed the second `getOAuthAccess()` call; post-merge hardening restores `sessionId`, requires the one stored row to be active for that session, captures its durable identity before composing prior Headers, and revalidates it afterward.

Captured outbound attempts:

| Scenario | Bearer | User ID | Enterprise ID | Durable row |
|---|---|---|---|---:|
| normal A | `access-a1` | `account-a` | `org-a` | 1 |
| forced refresh A | `access-a2` | `account-a` | `org-a` | 1 |
| 401 first attempt | `access-a2` | `account-a` | `org-a` | 1 |
| 401 retry after host force-refresh | `access-a3` | `account-a` | `org-a` | 1 |
| logout A → login B using retained old model object | `access-b1` | `account-b` | `org-b` | 2 |

The abort scenario resolved B row 2, then aborted inside `resolveHeaders`; zero HTTP requests reached the transport. The old A model object safely produced B identity because it retained a dynamic resolver rather than static account headers.

These observations prove the supported production order: the host selects Bearer A, marks A active, and only then resolves A identity Headers. A concurrent switch to B changes the active durable row; the in-flight A Header resolver detects that change and fails before HTTP. A 401 retry resolves its Bearer and reruns identity Headers as a new attempt.

## Decision

Use the host-selected session row as the request-attempt binding:

```text
AuthStorage resolver
  -> select/refresh one OAuth credential
  -> WorkBuddy getApiKey(credentials) validates the sole stored identity
  -> record the selected durable row as active for sessionId

Model.resolveHeaders()
  -> require exactly one stored row and require that row active for sessionId
  -> capture credentialId/accountId/orgId
  -> compose the previous resolver
  -> re-read and compare credentialId/accountId/orgId
  -> materialize X-User-Id and one enterprise semantic
```

This avoids duplicate token selection while preserving a request-attempt durable-row proof. The pre/post comparison is required because the composed resolver is asynchronous and another request may select a different row while it is pending. No module-global pending cache or lock is needed.

## Extension binding and lifecycle

`ExtensionContext.modelRegistry` is public inside handlers, and `ModelRegistry.authStorage` is public. `ExtensionAPI` itself does not expose `modelRegistry`. Provider registration and catalog projection can occur before `session_start`; lack of a runtime binding at that point is not an invalid credential and must not remove a valid persisted-account model. `modifyModels()` therefore installs the capability resolver after validating the supplied credential, and only performs the stored-row count optimization when a runtime binding already exists.

`session_start` installs the initial binding and `session_switch` replaces it. Every retained model resolver calls `requireBinding()` at request time instead of capturing the projection-time session. It verifies the same binding after reading the sole account, and scope revision plus the combined caller/logout/shutdown signal are checked around asynchronous resolver composition. An unbound, switched, logged-out, or aborted request fails before transport.

## Durable identity boundary

The boundary is one durable OAuth credential row: Bearer, `accountId`, and optional `orgId` come from that row; refresh may rotate only the access token. `getApiKey(credentials)` validates the host-selected credential against the sole stored row. The subsequent Header resolver requires that same row to be active for the bound session and rechecks its durable ID and identity after every asynchronous Header step.

The real transport contract covers first request, same-row forced refresh, 401 retry with per-attempt Header resolution, sequential A→B, optional enterprise, and multiple-row rejection. The provider regression covers an A resolver paused after capture while a concurrent B request selects B: B succeeds and A fails before transport.

Directly invoking `resolveHeaders()` without a preceding host credential selection is intentionally rejected. Production authenticated Chat must use the host `AuthStorage.resolver()` path.

## Rejected fallbacks

Static model Headers cannot survive account changes. A second `getOAuthAccess()` inside `resolveHeaders()` repeats OAuth work and is unnecessary after the host has selected and pinned the attempt's row. `ExtensionAPI.setModel(freshModel)` cannot protect an already retained model. Module-global pending-row correlation is unnecessary and would add concurrency risk.

## Consequences

- AUTH-04 is enforced at the supported `streamSimple()` attempt boundary with the session-selected durable row.
- First request and every 401 retry must select Bearer before resolving identity Headers; permanent real-transport assertions protect this order.
- A selected row change during asynchronous Header composition fails before HTTP.
- Same-row token rotation passes because `credentialId`, `accountId`, and optional `orgId` remain stable.
- Header resolution performs zero `getOAuthAccess()` calls.
- Static identity caches, private host APIs, global fetch interception, and a custom Chat transport remain prohibited.
