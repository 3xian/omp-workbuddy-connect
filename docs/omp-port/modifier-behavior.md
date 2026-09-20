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
| New child session | A task-style fresh registry resolution returned the B-projected object, and a new headless child `createAgentSession()` started with `workbuddy-m0-modifier/probe-model` carrying B. |

## Public paths

- Registration/invalidation owner: `ModelRegistry.registerProvider()`.
- Normal provider refresh used by `/login`: `ModelRegistry.refreshProvider(provider, "online")`.
- Policy invalidation: `ModelRegistry.reapplyModelPolicies()`.
- Fresh projection lookup: `ModelRegistry.find(provider, modelId)`.
- Child task model selection: OMP's task executor resolves the model from `ModelRegistry` before `createAgentSession()`; the probe exercised the equivalent fresh-resolution/session-construction boundary.

## M0 blocking result

**M0 remains blocked on current-session identity consistency.** The official `/login` controller persists credentials and calls `refreshProvider(provider, "online")`, but does not rebind `session.model`. The probe observed:

1. current A model reference retained A after login B;
2. official post-login refresh did not execute the modifier or mutate that reference;
3. a fresh registry lookup produced a distinct B model;
4. a newly constructed child could use B only after fresh resolution.

Therefore a current WorkBuddy session can hold stale A identity headers after the Bearer credential generation changes to B. Public primitives exist to obtain the correct new model, but the official login sequence does not atomically install it into the existing session. Tasks after the M0 gate must not start until the design identifies a supported current-session rebind path and proves A→B Bearer/header atomicity. No private host API or patched OMP behavior is acceptable.
