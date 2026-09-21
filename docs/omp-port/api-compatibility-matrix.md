# OMP 18.2.6 API Compatibility Matrix

Verified: 2026-09-20

Host contract: `@oh-my-pi/pi-ai@18.2.6` and `@oh-my-pi/pi-coding-agent@18.2.6`, corresponding to OMP tag commit `78b753124d11f8dd3ae73e2524125890ff7c977e`.

| API or behavior | OMP 18.2.6 contract | Extension decision | Evidence in this batch |
|---|---|---|---|
| Extension manifest | Native package key is `omp.extensions` | Keep `./extensions`; do not add legacy `pi.extensions` | `package.json`; official 18.2.6 loader returned one extension and no errors |
| Package imports | Native types are exported by `@oh-my-pi/pi-ai` and `@oh-my-pi/pi-coding-agent` | Keep native imports and pin both packages to 18.2.6 | Exact manifest/lock entries; `npx tsc --noEmit` |
| Provider ID | Passed separately to `registerProvider` | Use `workbuddy` | Loader runtime recorded pending provider `workbuddy` |
| Provider top-level `name` | Not a `ProviderConfig` field | Do not set it | Typecheck and registered config |
| OAuth `name` | Valid OAuth display field | Keep `oauth.name = "WorkBuddy AI"`; it is not the removed Provider field | 18.2.6 OAuth type and typecheck |
| Provider `baseUrl` / `api` | Supported Provider fields | Use `https://www.workbuddy.ai/v2` and `openai-completions` | Registered config and typecheck |
| `refreshModels()` | Not a `ProviderConfig` field | Removed | 18.2.6 ProviderConfig type; typecheck |
| `before_provider_headers` | Not in the extension event union | Removed | 18.2.6 event type; typecheck; loader has no unknown-event failure |
| `model_select` | Not in the extension event union | Removed; use supported `turn_start` for deferred model-dependent UI refresh | 18.2.6 event type; typecheck; loader has no unknown-event failure |
| Marker header | No host contract; existed only to find requests for the removed header hook | Removed | Provider registration no longer emits `X-Pi-WorkBuddy` |
| Legacy `thinkingLevelMap` | Not part of OMP 18.2.6 `ProviderModelConfig` | Removed; replaced with OMP canonical `thinking: { mode: "effort", efforts, defaultLevel, requiresEffort }` metadata | M2 contract matrix and M5 live supported-effort validation passed |
| Account identity headers | `streamSimple()` resolves Bearer before Headers, but `resolveHeaders(signal)` receives no request session/attempt | Retain sole-row pre/post checks; do not claim atomic same-row proof | Real transport covers serial/cross-session scenarios; AUTH-04 publication remains blocked |
| `Model.resolveHeaders(signal)` | Runs after API-key resolution for each `streamSimple()` attempt, including 401 retry; no session ID argument | Compose existing Headers and reject row/lifecycle/scope changes observable inside the callback | Provider regression covers composition, shared-store multi-session binding, and mid-resolver row change |
| `AuthStorage.getOAuthAccess()` | Session-aware token-plus-identity selection | Header-path duplicate selection remains removed because it would still be separate from the host Bearer selection | Provider fake counts zero calls during Header resolution |
| `ExtensionAPI.setModel()` | Public current-session model mutation API | Cannot repair an in-flight request or provide request identity to Headers | Exact type/source verified |
| `listOAuthAccounts()` | `active` is meaningful only for the supplied session ID | Enforce stored-row cardinality and identity; never use the last lifecycle session's `active` marker as current-request proof | Real cross-session A→B contract exposes the distinction |
| `before_provider_request` | Supported payload hook; OMP 18.2.6 binds the exact request Model as `ctx.model`; handler exceptions are reported then swallowed | Gate compatibility transforms on `ctx.model.provider === "workbuddy"` only; keep fail-closed scope/transition checks in WorkBuddy `resolveHeaders`, never in the hook | `test/scope.test.mts` proves current/historical same-ID foreign isolation; `test/contract/before-provider-request-runtime.test.mts` proves request Model binding and swallowed failures |
| OAuth `login()` | Supported | Production OAuth entry; map the official international plugin flow into host credentials | OAuth protocol regressions plus fresh live login |
| OAuth `refreshToken()` | Supported | Preserve same-row identity, accept optional rotated refresh values, and fail closed on contradictions | refresh regressions plus forced-expiry live refresh |
| OAuth `getApiKey()` | Supported | Bearer source guarded by exactly-one-account and complete-identity validation | provider regressions plus missing-account live negative |
| OAuth `modifyModels()` | Supported; receives the full catalog and current credentials during lazy catalog composition | Keep foreign rows unchanged; install WorkBuddy request binding; invalid/ambiguous identity should remove WorkBuddy rows rather than throw | `modifier-behavior.md`: 5,112 rows/70 providers, exception fallback, stale static reference, resolver preservation |
| `fetchDynamicModels()` | Supported; callback directly receives only API key; native authoritative SQLite cache TTL is 24h | Do not use for v1 because no stable authenticated WorkBuddy model endpoint was found; identity/scope cache handling is secondary integration risk, not impossibility | `adr-dynamic-models.md`; source/type inspection; static `models: []` also confirmed not to clear overlays |
| `usage` / UsageProvider | Supported; normalized credential includes account/org and report supports remaining credits/tier/metadata | Select host UsageProvider; one Billing adapter, host OAuth refresh lifecycle, no second refresher | `adr-credits-usage.md`; `pi-ai/src/usage.ts`; ProviderConfig registration source |
| `session_start` | Supported in interactive, headless, and actual Task sessions | Clear stale WorkBuddy UI only; do not mount detail or request Billing; branch on `ctx.hasUI` | `test/session-start.test.mts`; `headless-behavior.md` SDK and actual Task evidence |
| `turn_start` | Supported in interactive and headless sessions | Dismiss command-scoped Widget and invalidate pending detail rendering; late Billing results cannot repaint UI; do not occupy status line | `test/ui.test.mts`; typecheck plus parent/child-shaped headless emission |
| Custom Chat transport/parser | Not required for the WorkBuddy OpenAI-compatible endpoint | Prohibited; continue using host `openai-completions` | Provider config contains no custom transport |

## Verification result

- `npx tsc --noEmit`: zero errors.
- Direct Node TypeScript module import: successful.
- Official OMP 18.2.6 `loadExtensions()` under Bun 1.3.14: one extension, zero errors, one pending provider named `workbuddy`.
- Extension self-check: `ok`.
- Foreign-provider payload isolation check: passed.
- Non-blocking `session_start` check: passed.
- Request-boundary serial contract under Bun passed Bearer-before-Header order, same-row refresh, per-attempt 401 Headers, retained-model A→B using a second request session, optional enterprise, ambiguity rejection, and zero duplicate `getOAuthAccess()` calls.
- Provider regression proves two lifecycle sessions sharing one AuthStorage do not clobber binding and that a stored-row change during Header composition fails closed. Atomic Bearer/Header correlation remains unavailable.

## Current implementation boundary

The implementation is functional on the verified OMP 18.2.6 serial and shared-store multi-session paths, but it is not publication-ready for AUTH-04. The host API-key resolver knows the request session; `Model.resolveHeaders(signal)` does not.

Required host change: pass request session/attempt identity to Header resolution, expose the selected credential there, or atomically return Bearer plus Headers. Until then, do not publish a new tag as fully same-row atomic.
