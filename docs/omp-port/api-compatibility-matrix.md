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
| Legacy `thinkingLevelMap` | Not part of OMP 18.2.6 `ProviderModelConfig` | Removed; OMP canonical `thinking` metadata is not implemented yet | M2 task 3.2 remains pending; no reasoning E2E capability is claimed |
| Account identity headers | Bearer and identity must share one credential generation | Use request-boundary binding; static credential snapshots in `model.headers` are rejected | Captured normal/refresh/401/A→B/abort attempts; `adr-request-identity-binding.md` |
| `Model.resolveHeaders(signal)` | Public request-boundary header resolver awaited by `stream()` / `streamSimple()` | Compose with the model's existing resolver for WorkBuddy rows | Built-in `openai-completions` probe preserved fixed headers and resolved identity before transport |
| `AuthStorage.getOAuthAccess()` | Public session-aware OAuth selection returning access token, credential ID, and identity | Selected identity source; do not use non-session-aware `getOAuthCredential()` for requests | Captured token/account/org/durable-row selection matched outbound Bearer generations |
| `ExtensionAPI.setModel()` | Public current-session model mutation API | Documented fallback only; unnecessary for the accepted resolver path | Exact type/source verified; retained old model safely resolved B dynamically |
| `listOAuthAccounts()` | Public stored OAuth row enumeration; `active` means session sticky selection | Reject when WorkBuddy row count exceeds one; never count `active` flags as stored accounts | Credential probe: A+B returned two rows with at most one active |
| `before_provider_request` | Supported payload hook | Retain, scoped by the current WorkBuddy model-ID set | Typecheck; `test/scope.test.mts` proves a foreign payload is byte-for-byte unchanged |
| OAuth `login()` | Supported | Retain for the M0 protocol probe; production credential-boundary hardening is M1 | Typecheck and loader binding |
| OAuth `refreshToken()` | Supported | Retain for M0; remove legacy credential fallback in M1 | Typecheck and loader binding |
| OAuth `getApiKey()` | Supported | Retain as the Bearer source; identity fail-closed validation is M1 | Typecheck and loader binding |
| OAuth `modifyModels()` | Supported; receives the full catalog and current credentials during lazy catalog composition | Keep foreign rows unchanged; install WorkBuddy request binding; invalid/ambiguous identity should remove WorkBuddy rows rather than throw | `modifier-behavior.md`: 5,112 rows/70 providers, exception fallback, stale static reference, resolver preservation |
| `fetchDynamicModels()` | Supported; callback receives only API key; native authoritative SQLite cache TTL is 24h | Do not use for v1: no stable authenticated WorkBuddy model endpoint and insufficient account/org/scope identity; select Desktop cache → builtin fallback | `adr-dynamic-models.md`; source/type inspection; static `models: []` also confirmed not to clear overlays |
| `usage` / UsageProvider | Supported; normalized credential includes account/org and report supports remaining credits/tier/metadata | Select host UsageProvider; one Billing adapter, host OAuth refresh lifecycle, no second refresher | `adr-credits-usage.md`; `pi-ai/src/usage.ts`; ProviderConfig registration source |
| `session_start` | Supported in interactive, headless, and actual Task sessions | Retain; optional Billing/UI work remains non-blocking and must branch on `ctx.hasUI` | `test/session-start.test.mts`; `headless-behavior.md` SDK and actual Task evidence |
| `turn_start` | Supported in interactive and headless sessions | Use as the current supported lifecycle point for model-dependent UI refresh | Typecheck plus parent/child-shaped headless emission |
| Custom Chat transport/parser | Not required for the WorkBuddy OpenAI-compatible endpoint | Prohibited; continue using host `openai-completions` | Provider config contains no custom transport |

## Verification result

- `npx tsc --noEmit`: zero errors.
- Direct Node TypeScript module import: successful.
- Official OMP 18.2.6 `loadExtensions()` under Bun 1.3.14: one extension, zero errors, one pending provider named `workbuddy`.
- Extension self-check: `ok`.
- Foreign-provider payload isolation check: passed.
- Non-blocking `session_start` check: passed.
- Request-boundary atomicity probe under Bun 1.3.14: lifecycle AuthStorage capture, fixed+identity composition, normal request, forced refresh, 401 retry, A→B through a retained model, and abort-before-transport all passed.
- Actual `runSubprocess()` Task executor probe: `@task` resolved `workbuddy/hy3`; three independent extension bindings; headless sessions; post-hook `stream=true`; required `yield`; cancellation; shutdown; two-account fail-closed with zero transport attempts.

## Current implementation boundary

**Loadable does not mean authenticated-runtime ready.** M0 verifies AuthStorage persistence/removal/cancellation, full-catalog modifier behavior, SDK headless lifecycle, the actual Task executor lifecycle, and the `resolveHeaders` / `getOAuthAccess` request-boundary mechanism across normal, refresh, retry, account switch, and abort. Canonical Thinking metadata and authenticated WorkBuddy Chat remain unverified.

Task 1.5 selects the request-boundary resolver; D6 selects Desktop cache → builtin fallback; D8 selects host UsageProvider. Production single-account enforcement and live WorkBuddy E2E remain M1/M5 work. See the three ADRs in `docs/omp-port/`.
