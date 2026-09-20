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
| Account identity headers | Must eventually come from the same host credential generation as Bearer authentication | Not implemented in this batch; current legacy credential/header code is not the target contract | Tasks 1.4–1.5 must establish host behavior before M1 implements `modifyModels()` projection |
| `before_provider_request` | Supported payload hook | Retain, scoped by the current WorkBuddy model-ID set | Typecheck; `test/scope.test.mts` proves a foreign payload is byte-for-byte unchanged |
| OAuth `login()` | Supported | Retain for the M0 protocol probe; production credential-boundary hardening is M1 | Typecheck and loader binding |
| OAuth `refreshToken()` | Supported | Retain for M0; remove legacy credential fallback in M1 | Typecheck and loader binding |
| OAuth `getApiKey()` | Supported | Retain as the Bearer source; identity fail-closed validation is M1 | Typecheck and loader binding |
| OAuth `modifyModels()` | Supported and receives the catalog plus credentials | Do not guess behavior; task 1.5 must verify full-catalog, rebuild, exception, stale-reference, and subagent behavior before M1 | Type/source inspection only; runtime behavior intentionally not marked verified |
| `fetchDynamicModels()` | Supported Provider capability | Decision deferred to the task 1.7 Dynamic Model ADR | Type/source inspection only |
| `usage` / UsageProvider | Supported host capability | Decision deferred to the task 1.8 Credits / Usage ADR | Type/source inspection only |
| `session_start` | Supported event | Retain; optional Billing/UI work remains non-blocking | Typecheck and `test/session-start.test.mts` |
| `turn_start` | Supported event | Use as the current supported lifecycle point for model-dependent UI refresh | Typecheck and official loader binding |
| Custom Chat transport/parser | Not required for the WorkBuddy OpenAI-compatible endpoint | Prohibited; continue using host `openai-completions` | Provider config contains no custom transport |

## Verification result

- `npx tsc --noEmit`: zero errors.
- Direct Node TypeScript module import: successful.
- Official OMP 18.2.6 `loadExtensions()` under Bun 1.3.14: one extension, zero errors, one pending provider named `workbuddy`.
- Extension self-check: `ok`.
- Foreign-provider payload isolation check: passed.
- Non-blocking `session_start` check: passed.

## Current implementation boundary

**Loadable does not mean authenticated-runtime ready.** The extension currently proves only the OMP registration/type/loading baseline. Canonical Thinking metadata, AuthStorage ownership, credential-bound identity headers, headless/subagent semantics, and authenticated WorkBuddy Chat remain unverified and must not be advertised as working.

This batch proves native loading and the static/public registration contract. It does not claim OAuth persistence, credential deletion, modifier refresh semantics, headless task-role behavior, or a successful WorkBuddy Chat request; those remain tasks 1.4–1.6 and later live gates.
