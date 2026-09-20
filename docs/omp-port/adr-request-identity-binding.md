# ADR: WorkBuddy Request Identity Binding

Status: Accepted for M1 implementation — Task executor E2E remains a separate gate

Verified host: OMP 18.2.6 at `78b753124d11f8dd3ae73e2524125890ff7c977e`

Date: 2026-09-20

## Context

Every WorkBuddy Chat request must bind three values to one OAuth credential generation:

- host-provided Bearer token;
- `X-User-Id` from `accountId`;
- `X-Enterprise-Id` from `orgId`.

The first modifier probe proved that static identity values in `model.headers` become stale when an existing session retains an A model object after login B. That rules out long-lived static credential snapshots, but it does not prove that current-session model rebinding is the only supported solution.

OMP 18.2.6 exposes three relevant public capabilities:

1. `Model.resolveHeaders(signal)`, awaited by `stream()` / `streamSimple()` immediately before provider dispatch;
2. `AuthStorage.getOAuthAccess(provider, sessionId, options)`, which returns `accessToken`, durable `credentialId`, and identity metadata from one OAuth selection;
3. `ExtensionAPI.setModel(model)`, a possible explicit rebind fallback.

`before_provider_headers` remains unsupported and must not be restored.

## Runtime evidence

The first isolated probe established capability preservation: `modifyModels()` installed a WorkBuddy-only resolver, composed the model's existing fixed-header resolver, and `stream()` awaited it exactly once before transport.

The final probe used the built-in `openai-completions` transport against a local HTTP server, an actual headless extension session, public `AuthStorage.resolver()` for host Bearer retries, and a resolver backed by lifecycle-captured `context.modelRegistry.authStorage.getOAuthAccess()`.

Captured outbound attempts:

| Scenario | Bearer | User ID | Enterprise ID | Durable row |
|---|---|---|---|---:|
| normal A | `access-a1` | `account-a` | `org-a` | 1 |
| forced refresh A | `access-a2` | `account-a` | `org-a` | 1 |
| 401 first attempt | `access-a2` | `account-a` | `org-a` | 1 |
| 401 retry after host force-refresh | `access-a3` | `account-a` | `org-a` | 1 |
| logout A → login B using retained old model object | `access-b1` | `account-b` | `org-b` | 2 |

The abort scenario resolved B row 2, then aborted inside `resolveHeaders`; zero HTTP requests reached the transport. The old A model object safely produced B identity because it retained a dynamic resolver rather than static account headers.

This proves request-boundary account identity remains aligned with the host Bearer across normal, forced refresh, one 401 retry, sequential account switch, and abort under the v1 single-stored-account invariant.

## Decision

Prefer request-boundary identity resolution over static credential headers:

```text
modifyModels()
  -> preserve/compose the model's existing resolveHeaders
  -> install WorkBuddy-only identity resolver
  -> AuthStorage.getOAuthAccess(provider, request sessionId, { signal })
  -> validate exactly one stored WorkBuddy OAuth credential
  -> materialize X-User-Id and X-Enterprise-Id immediately before dispatch
```

The resolver must compose, not replace, the existing resolver because Provider fixed headers may already be represented by `resolveHeaders` rather than `model.headers`.

`getOAuthCredential(provider)` is not session-aware and is unsuitable as the request identity source.

## Extension binding

`ExtensionContext.modelRegistry` is public inside handlers, and `ModelRegistry.authStorage` is public. `ExtensionAPI` itself does not expose `modelRegistry`. The final probe captured the shared AuthStorage during an actual headless `session_start`; the resolver then used that closure successfully before every request. Production must keep the closure extension-instance-local and fail closed before transport if session initialization has not supplied it.

## Atomicity boundary

`resolveHeaders` runs before the provider resolves its initial Bearer. Both calls use the same session ID and AuthStorage selection. On 401, the host may force-refresh the same durable row without rerunning headers; under the v1 invariant there is no sibling row to rotate to, and accountId/orgId remain attached to that row. The captured retry changed A2 to A3 while retaining row 1 and A identity.

Sequential A→B switching deletes A before storing B. Even a retained model object resolves B dynamically on its next request. More than one stored WorkBuddy OAuth credential must be rejected before Chat dispatch.

Actual OMP Task executor lifecycle remains task 1.6b, and live authenticated WorkBuddy Task E2E remains a release gate. Those gates validate extension loading and live protocol behavior; they do not reopen the request-binding mechanism selected here unless contrary evidence appears.

## Rejected fallback

`ExtensionAPI.setModel(freshModel)` is public but is not required for identity correctness with the selected dynamic resolver. Rebinding every main/child/resume/task/headless model would add a broader lifecycle surface while still requiring request-boundary validation. Keep `setModel` only as a documented fallback if future OMP behavior invalidates resolver preservation.

## Consequences

- M0 task 1.5 is complete; request-boundary `resolveHeaders` plus session-aware `getOAuthAccess` is the selected mechanism.
- Static identity injection into long-lived `model.headers` is prohibited.
- The resolver must compose the model's existing resolver so fixed provider headers survive.
- `getOAuthCredential(provider)` remains unsuitable because it is not session-aware.
- Modifier exceptions cannot enforce safety: invalid or ambiguous identity should remove WorkBuddy rows from the projected catalog, while `getApiKey` and the request resolver independently fail closed.
- M1 may implement this ADR, but M0 as a whole remains gated by the other incomplete M0 tasks.
- No OMP patch, private API, custom Chat transport, or global fetch interception is needed.
