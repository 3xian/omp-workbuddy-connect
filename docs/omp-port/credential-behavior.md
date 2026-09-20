# OMP 18.2.6 Credential Behavior

Verified: 2026-09-20

Host contract: `@oh-my-pi/pi-ai@18.2.6` and `@oh-my-pi/pi-coding-agent@18.2.6`, corresponding to OMP tag commit `78b753124d11f8dd3ae73e2524125890ff7c977e`.

## Probe boundary

The runtime probe used `AuthStorage.create()` with a new SQLite database under a disposable temporary directory, a synthetic provider ID, and fake OAuth credentials. It did not read or write the user's OMP database, home-directory credentials, Desktop credentials, or a live WorkBuddy account.

The official `/login` controller delegates to `session.modelRegistry.authStorage.login(providerId, controller)` and then calls `session.modelRegistry.refreshProvider(providerId, "online")`. The probe exercised that public AuthStorage login protocol directly, including the controller `AbortSignal`; it did not automate the TUI or claim a live WorkBuddy OAuth exchange.

## Observed lifecycle

| Operation | Public host path | Runtime result |
|---|---|---|
| First login as A | `AuthStorage.login()` | One OAuth row stored |
| Repeated login as A | `AuthStorage.login()` | Existing identity row replaced; latest access token stored; row count remained one |
| Login as B | `AuthStorage.login()` | A second OAuth row appended; row count became two |
| Detect multiple accounts | `listOAuthAccounts(provider)` | Returned both durable credential IDs and identities; this is the supported fail-closed detector |
| Select an account for a session | `pinSessionOAuthAccount(provider, sessionId, credentialId)` | Marked B active for that session |
| Restart | `close()`, `AuthStorage.create()`, `reload()` | Both OAuth rows and identity fields survived reopening the SQLite database |
| Forced refresh | `getApiKey(provider, sessionId, { forceRefresh: true, signal })` | Refresh callbacks received both eligible stored identities during candidate resolution; identity fields omitted by refresh responses remained attached to their respective durable rows |
| Resolve token plus identity | `getOAuthAccess(provider, sessionId, options)` | Returns `accessToken`, durable `credentialId`, and identity metadata from one OAuth selection; candidate for request-boundary identity resolution |
| Delete one account | `removeCredential(provider, credentialId)` | Removed only the selected provider credential |
| Provider logout | `remove(provider)` | Removed every credential for that provider |
| Cancel login | `AuthStorage.login(..., { signal })` | Signal reached the OAuth login callback, the promise rejected, and no credential row was written |

## Rotation and active-account semantics

`listOAuthAccounts(provider, sessionId)` reports `active` from the session's durable credential pin. `active` is not the stored credential count. In the forced-refresh probe, B was pinned, but the host refreshed both expired/forced candidates (B then A). Implementations must validate every candidate and must not assume the final refresh callback corresponds only to the pinned account.

The v1 rule uses `listOAuthAccounts("workbuddy").length`: zero rows means logged out, one row is admissible, and more than one stored OAuth credential must fail closed. It must never silently choose, rotate, or delete one of several rows.

`getOAuthCredential(provider)` is not session-aware and must not be used as the request identity source. `getOAuthAccess(provider, sessionId, options)` is the accepted public source for token and identity metadata from one selected row; the separate request-boundary probe demonstrated alignment with host Bearer resolution across normal, refresh, retry, sequential account switch, and abort. See `adr-request-identity-binding.md`.

## Public deletion and restart paths

- One-account removal: `authStorage.removeCredential("workbuddy", credentialId)`.
- Provider-scoped logout: `authStorage.remove("workbuddy")`.
- Durable reload: `await authStorage.reload()` or a newly created `AuthStorage` bound to the same SQLite path.
- Session-specific selection: `authStorage.pinSessionOAuthAccount("workbuddy", sessionId, credentialId)`.
- Request-bound token plus identity: `authStorage.getOAuthAccess("workbuddy", sessionId, { signal })`.

These paths are provider-scoped. No global credential deletion or private database mutation is required.

## Result

Credential storage, same-identity replacement, different-identity append, durable restart, refresh-field preservation, cancellation, and provider-scoped deletion are supported by public OMP APIs. This is protocol evidence only; it does not prove a live WorkBuddy OAuth server exchange.
