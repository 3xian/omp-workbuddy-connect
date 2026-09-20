# OMP 18.2.6 Model Modifier Behavior

Verified: 2026-09-20

Host contract: `@oh-my-pi/pi-ai@18.2.6` and `@oh-my-pi/pi-coding-agent@18.2.6`, corresponding to OMP tag commit `78b753124d11f8dd3ae73e2524125890ff7c977e`.

## Probe boundary

The probe registered a synthetic OAuth provider with one model and `oauth.modifyModels()`, using an isolated AuthStorage database and fake A/B identities. No provider request or live WorkBuddy credential was used.

## Six required observations

| Evidence point | Runtime observation |
|---|---|
| Catalog scope | The modifier received 5,112 models spanning 70 providers. It is a full-catalog hook; the callback must return foreign-provider rows unchanged. |
| Rebuild behavior | Catalog composition is lazy. A credential-generation change invalidated lookup state, but `login()`, the official post-login `refreshProvider(provider, "online")`, and `reapplyModelPolicies()` did not themselves execute the callback. The next `find(provider, modelId)` executed it and returned a rebuilt model. Repeating refresh/reapply without a generation change did not execute it. |
| Credential-change timing | A and B logins did not invoke the modifier directly. The first subsequent registry lookup invoked it with the new OAuth credential. |
| Exception behavior | A thrown modifier exception was swallowed by the registry; the provider model remained present but its prior identity projection was not retained (`X-Probe-Account` became absent). Fail-closed validation must therefore remain in `oauth.getApiKey()` and must not rely on modifier exceptions blocking use. |
| Old model reference | After A→B, the old A `Model` object remained unchanged while a new registry lookup returned a distinct B-projected object. Existing references are stale, not mutated in place. |
| Probe-only child construction | A fresh `registry.find()` returned the B-projected object, and a child-shaped headless `createAgentSession({ model: freshModel })` started with B. This was not the actual OMP Task executor and is not a sanctioned rebind pattern. |

Production consequence: invalid or ambiguous identity should make the modifier return only foreign-provider rows, so WorkBuddy disappears from the projected catalog. Request-boundary authentication must still reject independently because a modifier exception serves the unprojected WorkBuddy catalog.

## Request-boundary atomicity follow-up

A final isolated probe installed a WorkBuddy-only `resolveHeaders` through `modifyModels()`, explicitly composing the model's existing resolver with lifecycle-captured `AuthStorage.getOAuthAccess()`. It then used the built-in `openai-completions` transport against a local HTTP server, with `AuthStorage.resolver()` supplying the host Bearer.

Captured outbound attempts kept Bearer and identity on one durable row:

- normal A: `access-a1`, `account-a`, `org-a`, row 1;
- forced refresh A: `access-a2`, `account-a`, `org-a`, row 1;
- 401 attempt/retry: `access-a2` then `access-a3`, both with A identity and row 1;
- logout A → login B through a retained old model object: `access-b1`, B identity, row 2;
- abort during header resolution: B was selected, but zero requests reached transport.

This verifies resolver preservation, fixed-header composition, lifecycle AuthStorage capture, host refresh/retry interaction, dynamic account switching, and abort-before-transport under the v1 single-stored-account invariant.

## Selected public path

- Request-boundary materialization: `Model.resolveHeaders(signal)`.
- Token plus identity from one OAuth selection: `AuthStorage.getOAuthAccess(provider, sessionId, options)`.
- Catalog installation point: WorkBuddy-only `oauth.modifyModels()`.
- Host Bearer and 401 retry: `AuthStorage.resolver(provider, context)`.
- `ExtensionAPI.setModel(model)` remains a fallback if future OMP behavior invalidates resolver preservation; it is not needed for the selected path.
- Static catalog refresh and lookup remain useful evidence paths, but old `Model` objects are not mutated.

## M0 result

**Request-boundary credential atomicity is proven for task 1.5.** Static identity values in a retained A `Model` remain rejected. The accepted path is:

```text
modifyModels -> compose resolveHeaders -> getOAuthAccess -> identity headers at dispatch
```

The separate Task executor experiment remains task 1.6b. Live authenticated WorkBuddy Chat and production fail-closed implementation remain later gates. See `adr-request-identity-binding.md`.
