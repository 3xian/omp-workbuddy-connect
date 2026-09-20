# Requirement → Implementation → Test Matrix

Baseline: OMP 18.2.6 / `78b753124d11f8dd3ae73e2524125890ff7c977e`

Status date: 2026-09-20

Status vocabulary: **PASS** means the named gate evidence was executed; **PARTIAL** means only the stated lower-layer evidence exists; **PLANNED / NOT RUN** is never a pass.

Live safety note (2026-09-20): the first task 2.11 eligibility attempt opened the official login URL against the default profile, then was cancelled with zero stored WorkBuddy accounts before/after. All subsequent attempts used dedicated profile `workbuddy-m1-live-20260920`. No token, Authorization value, account identifier, or JWT claim value is retained in this document.

M1 live exit evidence (redacted):

- Account A fresh OAuth returned response keys `accessToken,domain,expiresIn,refreshExpiresIn,refreshToken,scope,sessionState,tokenType`; JWT identity keys included `sub` but no uid/enterprise claim. This matches frozen upstream `cb2398e3374144db0c088d7a4887dc0913342858`: `data.uid → JWT uid → JWT sub`, optional `enterpriseId`, Chat `X-No-Enterprise-Id`, and refresh omission of `X-Enterprise-Id`.
- Stable model `workbuddy/hy3` completed a streamed A request. Forced access expiry completed host refresh and another streamed request; restart then restored the host credential and completed a third request.
- Provider-scoped logout left zero enabled WorkBuddy credentials. A post-logout request failed before transport with the host's missing-key error.
- The browser was switched to a distinct B account before a new OAuth state was authorized. B's durable subject differed from A without recording either value here. The retained session completed a B request.
- The isolated profile explicitly set `modelRoles.task = workbuddy/hy3`. After B login, the actual OMP Task tool spawned a fresh headless subagent; its Hy3 turn independently reversed a five-word phrase and returned both the transformed phrase and explanation. The successful non-canned result required a live WorkBuddy model request resolved through B's sole enabled credential; no A credential was available after provider-scoped deletion. Final logout again left zero enabled WorkBuddy credentials.

| ID | Target implementation | Unit entry | OMP contract entry | Runtime integration entry | Live WorkBuddy entry | Gate / status |
|---|---|---|---|---|---|---|
| HOST-01 | manifest, package/lock, baseline docs | manifest values review | `tsc --noEmit`; exact dependency resolution | baseline workspace/branch/commit capture | N/A | M0 PASS |
| HOST-02 | `package.json`, `extensions/workbuddy.ts` | import smoke | official `loadExtensions` | isolated official extension load | install/load matrix | M0 PASS |
| HOST-03 | provider/auth/hook boundaries | protocol fixture probes | API compatibility, modifier, Task executor probes | OAuth persistence/logout/refresh/restart; actual Task lifecycle | explicit `modelRoles.task=workbuddy/hy3`; fresh B Task produced independent transformation result | M0 host contract PASS; M1 live PASS |
| HOST-04 | D6/D8 architecture | ADR invariant review | `fetchDynamicModels` and `UsageProvider` type/source checks | empty static registration/source behavior | future endpoint/Billing confirmation | M0 PASS |
| HOST-05 | gate/evidence docs | requirement inventory count | strict OpenSpec validation | M0/M1/M2 gate command sets | M1 complete authentication chain; later live gates remain | M0 PASS; M1 PASS; M2 PASS; later gates NOT RUN |
| AUTH-01 | `src/auth.ts`, provider composition | legacy-source rejection | AuthStorage-only resolver contract | legacy file ignored; `persisted-credential-restart.test.mts` uses host credential before extension registration | fresh login, streamed chat, restart recovery | M1 PASS |
| AUTH-02 | `src/auth.ts` login mapping | `test/auth.test.mts`: missing/invalid fields; JWT subject; optional enterprise; nickname/email/domain | OAuth callback return type | host persistence contract plus legacy-source rejection | A/B authorization; redacted response/claim key shape | M1 PASS |
| AUTH-03 | `src/auth.ts`, `src/workbuddy-api.ts` refresh | rotation/omission, token/expiry/identity preservation and contradiction rejection | production host `refreshToken` callback | frozen upstream omission fallback; optional enterprise refresh omits enterprise header; forced expiry/401 fixtures | forced expiry refreshed and streamed; restart remained usable | M1 PASS |
| AUTH-04 | `src/provider.ts` resolver | durable-row/header composition, optional enterprise/no-enterprise, pre-bind projection | production `Model.resolveHeaders` + host Authorization | persisted A → register → bind → find → request; retained session and fresh child controller resolve current B | A/B streamed requests succeeded on live no-enterprise path | M1 PASS |
| AUTH-05 | login/refresh/getApiKey/request validation | missing accountId and conflicting refresh identity; optional orgId | getApiKey plus retained-model fail-closed | production contract: missing account/ambiguous identity produces zero Chat requests; missing org sends no-enterprise marker | live optional-org login/chat/refresh passed; malformed fixture remained fail-closed | M1 PASS |
| AUTH-06 | WorkBuddy-only modifier/resolver | mixed catalog preserves exact foreign rows | full-catalog modifier and fixed-header contract | scope regression plus production transport headers | WorkBuddy live request path passed; mixed-provider isolation remains fixture-backed | M1 PASS |
| AUTH-07 | single-account guard | 0/1/2 rows and active ignored for count | `listOAuthAccounts` at getApiKey/resolver boundaries | production retained-model zero-transport; A→B retained/fresh-child resolver; synthetic Task host/runtime guard harness | distinct A→B; retained session plus explicit Hy3 fresh Task completed under B; final enabled count zero | M1 PASS |
| AUTH-08 | provider-scoped logout | generation invalidation and late-result discard | public `AuthStorage.remove('workbuddy')` | real AuthStorage delete, failed-delete error with prior auth restored, successful-delete old resolver fail-closed, pending Billing discard, model-switch status clear, Desktop fixture unchanged | zero enabled credentials after logout; next request failed before transport | M1 PASS |
| AUTH-09 | `src/workbuddy-api.ts`, provider lifecycle | host `LoginCancelledError`/Abort classification, refresh-request abort, malformed envelope/data, polling Retry-After, and one-shot 429 matrix | login controller signal, refresh ownership signal, `session_shutdown` abort | request/delay/polling-429 waits cancel; late success discarded; malformed JSON/schema and reject/timeout/network/5xx/one-shot-429 classified without generic retry | cancellation/error branches intentionally exercised by isolated protocol harness, not destructive live account actions | M1 PASS |
| GATE-01 | `src/payload.ts`, `gateway-compatibility-evidence.md` | every former transform classified; zero retained M3 transforms | real payload hook contract | unmodified native payload fixtures | no Gateway credential; failure/success pairs not run | M3 local decision PASS; live gate BLOCKED |
| GATE-02 | `src/payload.ts` no-op boundary | `payload.test.mts`: no prompt/role/field mutation | host-generated stream/effort/max/tool fields | native payload identity and semantics | live no-system case not run | M3 local PASS; live gate BLOCKED |
| GATE-03 | current model-ID set | `scope.test.mts`: active identity plus byte-equivalent foreign request | real `before_provider_request` result | isolated product config and actual extension hook | same-ID cross-provider limitation documented | M3 local PASS; limitation retained |
| GATE-04 | no cleanup retained without evidence | `tool-loop.test.mts`: reasoning/content/tool/result history | real OMP Agent history and replay | next-turn correlated result reuse and final answer | live reasoning + tool history not run | M3 conditional local PASS; live gate BLOCKED |
| GATE-05 | native tool metadata and loop | named/auto, fragmented arguments, sequential/multi fixtures | real OMP Agent/tool delta parser | four correlated calls; same-turn shared tools overlap; final answer | live Gateway tool loop not run | M3 local PASS; live gate BLOCKED |
| GATE-06 | native `openai-completions` | reasoning/text/usage/DONE/400/abort/503 cases | real OMP stream/error/abort/retry implementation | injected Fetch boundary, no plugin parser/client/retry | live streaming/error not run | M3 local PASS; live gate BLOCKED |
| UX-01 | `src/ui.ts`, command state | available/unavailable/not-queried render; no stale last-good | command registration | command output after success→failure | live account/credits/plan | M4 PLANNED / NOT RUN |
| UX-02 | command orchestration | free/all/logout transitions | command/UI API contract | credential unchanged/deleted cases | live commands | M4 PLANNED / NOT RUN |
| UX-03 | WorkBuddy UsageProvider | credits parser and genuine-zero cases | normalized schema; `retainLastGoodOnFailure=false`; `X-User-Id` | slow/5xx/timeout nonblocking and unavailable | live Billing | M4 PLANNED / NOT RUN; ADR accepted |
| UX-04 | UI `stateGeneration` | stale-result discard | session/scope identity inputs | logout/account/scope/teardown races | live pending Billing switch | M4 PLANNED / NOT RUN |
| UX-05 | lifecycle display | visibility render | session_start/turn_start hooks | switch in/out next-turn refresh | interactive model switch | M4 PLANNED / NOT RUN |
| UX-06 | UI guards | no-UI branch | `ctx.hasUI` contract | headless SDK and Task probes | authenticated headless tools | M4 PARTIAL: M0 headless/Task PASS |
| UX-07 | `src/settings.ts` | `settings.test.mts`: public agent path/scope/0600/no-secret/atomic-failure cases | OMP `getAgentDir()` rule | isolated directory, byte-preserving failure, temp cleanup, empty-free restart | N/A | M2 3.9 PASS; M4 UI gate remains |
| MODEL-01 | `src/models.ts` | `model-catalog.test.mts`: parse/diagnose capabilities | ProviderModelConfig plus `ModelRegistry` final Model fields | four synthetic models resolved through real registry; authorized real-cache ID summary retained | ≥3 live Chat models remains M5 | M2 PASS; live Chat gate NOT RUN |
| MODEL-02 | canonical thinking metadata | supported/required/optional/unknown/default/invalid-default matrix | host effort generation, defaultLevel, and required-off clamp | synthetic high/multi defaults plus `model-transport.test.mts`; real-cache thinking summary | live supported effort and true off encoding remains M5 | M2 PASS; live encoding gate NOT RUN |
| MODEL-03 | input/compat metadata | image capability projection | final Model image normalization | valid 1×1 PNG reaches local OpenAI transport as `image_url`; synthetic final Models retain Vision | real WorkBuddy image request remains M5 | M2 PASS; live image gate NOT RUN |
| MODEL-04 | catalog/request budget clamp | lower/higher and unrelated-model budgets | host-native max-token clamp without payload mutation | synthetic resolved budgets plus emitted 16k clamp and smaller-budget preservation; real-cache budget summary | live server limit remains M5 | M2 PASS; live server gate NOT RUN |
| MODEL-05 | free projection | paid/unknown/empty/builtin fixtures | zero cost is not free evidence | real registry all→paid→free(empty), stale rows removed | live pricing confirmation remains M5 | M2 PASS; live pricing gate NOT RUN |
| MODEL-06 | Desktop cache→builtin source | missing/unreadable/invalid JSON/schema/no-valid-row/valid-empty cases | ADR and host registration semantics | exact Widget source/fallback reason; authorized real-cache ID summary | future remote source requires new ADR | M2 PASS |
| MODEL-07 | provider/scope/settings commit | registration/atomic-settings failure rollback and stale-model block | non-empty in-place register; empty unregister/register semantics | all→paid→free(empty) next Chat zero HTTP; restart; credential invariant | live selector UX remains M5 | M2 PASS |
| REL-01 | composed main/task/headless paths | component regressions | official host API/type checks | main + actual Task + headless scenarios | chat/thinking/tools/refresh/task | M5 PARTIAL: M0 Task/headless contract PASS |
| REL-02 | release runner/evidence | matrix schema validation | install/type gate | all local release cases | every required live case | M5 PLANNED / NOT RUN |
| REL-03 | test suites by layer | pure behavior suite | real OMP type/API suite | official runtime suite | live E2E suite | M5 PLANNED / NOT RUN |
| REL-04 | redaction/endpoints | secret scrub fixtures | logger/request boundary review | repo/log/network audit | redacted live capture | M5 PLANNED / NOT RUN |
| REL-05 | `release-evidence.md` | evidence field validation | version/commit capture | reproducible command log | dated account/model evidence | M5 PLANNED / NOT RUN |
| REL-06 | README/release notes | limitation checklist | compatibility metadata | clean install/migration read-through | operator confirmation | M5 PLANNED / NOT RUN |

## M0 evidence index

- HOST-01: `baseline-manifest.md`
- HOST-02/03: `api-compatibility-matrix.md`, `credential-behavior.md`, `modifier-behavior.md`
- AUTH-04/06/07/08: `adr-request-identity-binding.md`, `test/contract/request-identity-binding.test.mts`, and local AuthStorage evidence
- HOST-03/REL-01/UX-06: `headless-behavior.md` and `test/contract/task-runtime-contract.test.mts`, which exercises the actual `runSubprocess` Task executor
- HOST-04/MODEL-06: `adr-dynamic-models.md`
- HOST-04/UX-03: `adr-credits-usage.md`
- HOST-05: this matrix and `m0-gate.md`

## M2 evidence index

- MODEL-01–06: `src/models.ts`, `test/model-catalog.test.mts`, `test/model-transport.test.mts`, synthetic `test/fixtures/model-scope-contract.json`, and the non-secret authorized real-cache inspection summary in `m2-gate.md`.
- MODEL-06: `docs/omp-port/adr-dynamic-models.md`; exact `desktop-cache` / `builtin-fallback` source and five fallback reasons are exercised.
- MODEL-07/UX-07: `src/settings.ts` and `test/contract/model-scope-lifecycle.test.mts`; real `ModelRegistry` covers non-empty in-place replacement, empty cleanup, rollback, retained-model pretransport failure, restart, and unchanged AuthStorage credential. `test/settings.test.mts` covers atomic failure-byte preservation and temporary cleanup.
- Gate record: `docs/omp-port/m2-gate.md`. It distinguishes local real-cache inspection/OMP contracts from later live Gateway Chat, Vision, effort, selector, and pricing gates.

## M3 evidence index

- GATE-01–04: `src/payload.ts`, the actual hook in `extensions/workbuddy.ts`, `test/payload.test.mts`, `test/scope.test.mts`, and `docs/omp-port/gateway-compatibility-evidence.md`.
- GATE-04/05: `test/tool-loop.test.mts` drives the real OMP `Agent` through reasoning plus single, sequential, streamed-argument, same-turn parallel tool calls, correlated results, and a final answer.
- GATE-06: `test/native-transport.test.mts` drives the real OMP `openai-completions` implementation through successful and failure paths.
- Live WorkBuddy evidence is unavailable because AuthStorage contains no WorkBuddy credential. Task 4.7 and the M3 gate remain blocked; local fixtures are not represented as Gateway proof.

## Coverage check

Exactly 40 requirement IDs are represented once: HOST 5, AUTH 9, GATE 6, UX 7, MODEL 7, REL 6. Every row names a unit, host contract, runtime integration, and live entry; N/A is used only where no WorkBuddy service behavior exists. Planned or partial rows remain non-passing until their milestone evidence runs.
