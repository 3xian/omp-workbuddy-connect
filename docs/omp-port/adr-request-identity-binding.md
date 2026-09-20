# ADR: WorkBuddy Request Identity Binding

Status: Accepted — M0–M5 gates passed; Task, headless, tool/reasoning, and release E2E evidence is archived in `release-evidence.md`

Verified host: OMP 18.2.6 at `78b753124d11f8dd3ae73e2524125890ff7c977e`

Date: 2026-09-20
Updated: 2026-09-21 — header identity now uses the sole stored account and no longer performs a second OAuth access resolution

## Context

Every WorkBuddy Chat request must bind the following to one durable OAuth credential identity:

- host-provided Bearer token, which may refresh between retry attempts;
- `X-User-Id` from the same durable row's `accountId`;
- exactly one enterprise semantic from that row: `X-Enterprise-Id` when optional `orgId` exists, otherwise `X-No-Enterprise-Id: 1`.

The first modifier probe proved that static identity values in `model.headers` become stale when an existing session retains an A model object after login B. That rules out long-lived static credential snapshots, but it does not prove that current-session model rebinding is the only supported solution.

OMP 18.2.6 exposes four relevant public capabilities:

1. `Model.resolveHeaders(signal)`, awaited by `stream()` / `streamSimple()` immediately before provider dispatch;
2. the host `AuthStorage` resolver, which owns the request's Bearer selection and invokes WorkBuddy `getApiKey(credentials)`;
3. `AuthStorage.listOAuthAccounts(provider)`, which returns the current stored row identities without running OAuth selection;
4. `ExtensionAPI.setModel(model)`, a possible explicit rebind fallback.

`before_provider_headers` remains unsupported and must not be restored.

## Runtime evidence

The first isolated probe established capability preservation: `modifyModels()` installed a WorkBuddy-only resolver, composed the model's existing fixed-header resolver, and `stream()` awaited it exactly once before transport.

The original probe used the built-in `openai-completions` transport against a local HTTP server, an actual headless extension session, public `AuthStorage.resolver()` for host Bearer retries, and a header resolver backed by `getOAuthAccess()`. The 2026-09-21 cutover retained the same real-AuthStorage transport contract while replacing that second OAuth resolution with a sole-account lookup; `test/provider.test.mts` additionally proves that `resolveHeaders()` never calls `getOAuthAccess()`.

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

Use one host-owned OAuth resolution for Bearer and a lightweight request-boundary lookup for identity headers:

```text
AuthStorage resolver
  -> select/refresh the sole OAuth credential
  -> WorkBuddy getApiKey(credentials)
  -> validate selected accountId/orgId against the sole stored account

modifyModels()
  -> preserve/compose the model's existing resolveHeaders
  -> listOAuthAccounts(workbuddy)
  -> require exactly one row with accountId
  -> materialize X-User-Id and exactly one of X-Enterprise-Id / X-No-Enterprise-Id
```

The resolver must compose, not replace, the existing resolver because Provider fixed headers may already be represented by `resolveHeaders` rather than `model.headers`. It must read the stored identity for every request; a long-lived module-level account cache remains prohibited.

`getOAuthAccess(provider, sessionId, options)` remains a valid host API, but WorkBuddy does not call it from `resolveHeaders()`. Doing so would repeat credential selection, external-change checks, preparation, persistence bookkeeping, and session-sticky updates after the host already resolved the Bearer.

## Extension binding and lifecycle

`ExtensionContext.modelRegistry` is public inside handlers, and `ModelRegistry.authStorage` is public. `ExtensionAPI` itself does not expose `modelRegistry`. Provider registration and catalog projection can occur before `session_start`; lack of a runtime binding at that point is not an invalid credential and must not remove a valid persisted-account model. `modifyModels()` therefore installs the capability resolver after validating the supplied credential, and only performs the stored-row count optimization when a runtime binding already exists.

`session_start` installs the initial binding and `session_switch` replaces it. Every retained model resolver calls `requireBinding()` at request time instead of capturing the projection-time session. It verifies the same binding after reading the sole account, and scope revision plus the combined caller/logout/shutdown signal are checked around asynchronous resolver composition. An unbound, switched, logged-out, or aborted request fails before transport.

## Durable identity boundary

The host resolves Bearer through its canonical `AuthStorage` path. WorkBuddy `getApiKey(credentials)` validates that selected credential's `accountId` and optional `orgId` against the sole stored row before returning access. Header resolution independently requires that same sole row and does not perform another token selection. On 401, the host may refresh the row's Bearer without rerunning headers; the captured retry changed A2 to A3 while retaining account A and org A. Therefore the invariant is the sole durable credential identity, not access-token generation.

Sequential A→B switching deletes A before storing B. Even a retained model object reads B dynamically on its next request. Zero or multiple stored WorkBuddy OAuth credentials are rejected before Chat dispatch.

The actual OMP Task executor lifecycle contract is verified by the synthetic host/runtime harness in `test/contract/task-runtime-contract.test.mts` and summarized in `headless-behavior.md`. `test/contract/persisted-credential-restart.test.mts` follows restart order—persist A → register → `session_start` bind → fresh `find()` → request-boundary resolution—and separately asserts that the pre-bind projection remains visible with its resolver installed; it then emits `session_switch` and resolves B from the retained model. `test/contract/request-identity-binding.test.mts` exercises the same register → bind → find → built-in `openai-completions` order through normal, forced-refresh, 401-retry, retained-model A→B, and two-row fail-closed paths. The M1 live gate additionally configured `modelRoles.task = workbuddy/hy3` and completed a non-canned request in a fresh authenticated B subagent. Full Task tool calling, reasoning, streaming-detail, and release-matrix E2E remain M5.

## Rejected fallback

`ExtensionAPI.setModel(freshModel)` is public but is not required for identity correctness with the selected dynamic resolver. Rebinding every main/child/resume/task/headless model would add a broader lifecycle surface while still requiring request-boundary validation. Keep `setModel` only as a documented fallback if future OMP behavior invalidates resolver preservation.

## Consequences

- M0 task 1.5 established the request-boundary identity contract; the 2026-09-21 optimization keeps host `AuthStorage` as the sole Bearer authority and removes WorkBuddy's duplicate `getOAuthAccess()` call.
- Static identity injection into long-lived `model.headers` and long-lived plugin identity caches are prohibited.
- The resolver must compose the model's existing resolver so fixed provider headers survive.
- `getApiKey()` and `resolveHeaders()` independently enforce the sole-account boundary; the former validates the selected credential, while the latter reads the current stored identity.
- Modifier exceptions cannot enforce safety: invalid or ambiguous identity should remove WorkBuddy rows from the projected catalog, while `getApiKey` and the request resolver independently fail closed.
- No OMP patch, private API, custom Chat transport, or global fetch interception is needed.
