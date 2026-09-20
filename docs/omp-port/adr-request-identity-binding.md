# ADR: WorkBuddy Request Identity Binding

Status: Accepted — M0–M5 gates passed; Task, headless, tool/reasoning, and release E2E evidence is archived in `release-evidence.md`

Verified host: OMP 18.2.6 at `78b753124d11f8dd3ae73e2524125890ff7c977e`

Date: 2026-09-20

## Context

Every WorkBuddy Chat request must bind the following to one durable OAuth credential identity:

- host-provided Bearer token, which may refresh between retry attempts;
- `X-User-Id` from the same durable row's `accountId`;
- exactly one enterprise semantic from that row: `X-Enterprise-Id` when optional `orgId` exists, otherwise `X-No-Enterprise-Id: 1`.

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

This proves request-boundary account identity remains aligned with the host Bearer's durable OAuth row across normal, forced refresh, one 401 retry, sequential account switch, and abort under the v1 single-stored-account invariant. It does not claim the access token is unchanged across a retry.

## Decision

Prefer request-boundary identity resolution over static credential headers:

```text
modifyModels()
  -> preserve/compose the model's existing resolveHeaders
  -> install WorkBuddy-only identity resolver
  -> AuthStorage.getOAuthAccess(provider, request sessionId, { signal })
  -> validate exactly one stored WorkBuddy OAuth credential
  -> materialize X-User-Id and exactly one of X-Enterprise-Id / X-No-Enterprise-Id immediately before dispatch
```

The resolver must compose, not replace, the existing resolver because Provider fixed headers may already be represented by `resolveHeaders` rather than `model.headers`.

`getOAuthCredential(provider)` is not session-aware and is unsuitable as the request identity source.

## Extension binding and lifecycle

`ExtensionContext.modelRegistry` is public inside handlers, and `ModelRegistry.authStorage` is public. `ExtensionAPI` itself does not expose `modelRegistry`. Provider registration and catalog projection can occur before `session_start`; lack of a runtime binding at that point is not an invalid credential and must not remove a valid persisted-account model. `modifyModels()` therefore installs the capability resolver after validating the supplied credential, and only performs the stored-row count optimization when a runtime binding already exists.

`session_start` installs the initial binding and `session_switch` replaces it. Every retained model resolver calls `requireBinding()` at request time instead of capturing the projection-time session. An unbound request still fails before transport, while registration-before-bind and later resume/switch cannot stale the resolver's AuthStorage or session ID.

## Durable identity boundary

`resolveHeaders` runs before the provider resolves its initial Bearer. Both calls use the same session ID and AuthStorage selection. On 401, the host force-refreshes the same durable row without rerunning headers: the captured retry changed A2 to A3 while retaining row 1, account A, and org A. Therefore the invariant is durable credential identity, not access-token generation.

Sequential A→B switching deletes A before storing B. Even a retained model object resolves B dynamically on its next request. More than one stored WorkBuddy OAuth credential must be rejected before Chat dispatch.

The actual OMP Task executor lifecycle contract is verified by the synthetic host/runtime harness in `test/contract/task-runtime-contract.test.mts` and summarized in `headless-behavior.md`. `test/contract/persisted-credential-restart.test.mts` follows restart order—persist A → register → `session_start` bind → fresh `find()` → request-boundary resolution—and separately asserts that the pre-bind projection remains visible with its resolver installed; it then emits `session_switch` and resolves B from the retained model. `test/contract/request-identity-binding.test.mts` exercises the same register → bind → find → built-in `openai-completions` order through normal, forced-refresh, 401-retry, retained-model A→B, and two-row fail-closed paths. The M1 live gate additionally configured `modelRoles.task = workbuddy/hy3` and completed a non-canned request in a fresh authenticated B subagent. Full Task tool calling, reasoning, streaming-detail, and release-matrix E2E remain M5.

## Rejected fallback

`ExtensionAPI.setModel(freshModel)` is public but is not required for identity correctness with the selected dynamic resolver. Rebinding every main/child/resume/task/headless model would add a broader lifecycle surface while still requiring request-boundary validation. Keep `setModel` only as a documented fallback if future OMP behavior invalidates resolver preservation.

## Consequences

- M0 task 1.5 is complete; request-boundary `resolveHeaders` plus session-aware `getOAuthAccess` is the selected mechanism.
- Static identity injection into long-lived `model.headers` is prohibited.
- The resolver must compose the model's existing resolver so fixed provider headers survive.
- `getOAuthCredential(provider)` remains unsuitable because it is not session-aware.
- Modifier exceptions cannot enforce safety: invalid or ambiguous identity should remove WorkBuddy rows from the projected catalog, while `getApiKey` and the request resolver independently fail closed.
- M0 has passed. M1 implements this ADR; authenticated WorkBuddy identity and Task E2E remain later gates.
- No OMP patch, private API, custom Chat transport, or global fetch interception is needed.
