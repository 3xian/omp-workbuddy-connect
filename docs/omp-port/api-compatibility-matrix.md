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
| Account identity headers | Bearer and identity must belong to the sole stored OAuth account; Bearer may refresh within that account | Host resolver remains the only Bearer authority; `getApiKey()` validates the selected credential against the sole row, while request headers read that row without another OAuth resolution | `test/contract/request-identity-binding.test.mts`: normal/refresh/401/A→B/two-row attempts; provider regression proves zero header-path `getOAuthAccess()` calls |
| `Model.resolveHeaders(signal)` | Public request-boundary header resolver awaited by `stream()` / `streamSimple()` before initial provider dispatch; not rerun for the observed 401 retry | Compose with the existing resolver, then read and validate the sole stored account; preserve scope, session-binding, abort, logout, and shutdown guards | Provider regression covers composition, scope/session races, account cardinality, optional org, and zero `getOAuthAccess()` calls |
| `AuthStorage.getOAuthAccess()` | Public session-aware OAuth selection returning access token, credential ID, and identity | Available to the host, but no longer called by WorkBuddy header resolution because the host Bearer resolver already performs authoritative OAuth selection | Regression fake counts zero `getOAuthAccess()` calls during header resolution |
| `ExtensionAPI.setModel()` | Public current-session model mutation API | Documented fallback only; unnecessary for the accepted resolver path | Exact type/source verified; retained old model safely resolved B dynamically |
| `listOAuthAccounts()` | Public stored OAuth row enumeration; `active` means session sticky selection | Enforce exactly one row, validate `accountId`, compare selected `getApiKey()` credentials, and source per-request identity headers without token resolution | Provider and real-AuthStorage contracts cover zero/one/multiple rows, mismatch, A→B, and optional org |
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
- Request-boundary identity contract under Bun: host Bearer resolution plus lightweight sole-account headers passed normal request, forced refresh, 401 retry, A→B through a retained model, scope/session races, abort protection, and zero duplicate `getOAuthAccess()` calls.
- Actual `runSubprocess()` Task executor probe: `@task` resolved `workbuddy/hy3`; three independent extension bindings; headless sessions; post-hook `stream=true`; required `yield`; cancellation; shutdown; two-account fail-closed with zero transport attempts.

## Current implementation boundary

The final implementation is authenticated-runtime ready on the verified OMP 18.2.6 boundary. M0 established the host mechanisms; M1–M5 added canonical Thinking, production single-account enforcement, official OAuth/Chat/Refresh/Billing, main/Task/headless execution, and the complete release matrix.

The accepted architecture remains: request-boundary resolver for identity, Desktop cache → builtin fallback for model metadata, host UsageProvider for Billing, and native `openai-completions` for Chat. See the ADRs and `release-evidence.md`.
