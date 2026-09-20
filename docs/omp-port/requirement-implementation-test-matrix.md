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
| HOST-05 | gate/evidence docs | requirement inventory count | strict OpenSpec validation | M0–M5 gate command sets and 19-script release runner | dated redacted OAuth/Chat/Refresh/Vision/Tools/Credits/main/Task/headless matrix | M0–M5 functional gate PASS; publication tag pending |
| AUTH-01 | `src/auth.ts`, provider composition | legacy-source rejection | AuthStorage-only resolver contract | legacy file ignored; `persisted-credential-restart.test.mts` uses host credential before extension registration | fresh login, streamed chat, restart recovery | M1 PASS |
| AUTH-02 | `src/auth.ts` login mapping | `test/auth.test.mts`: missing/invalid fields; JWT subject; optional enterprise; nickname/email/domain | OAuth callback return type | host persistence contract plus legacy-source rejection | A/B authorization; redacted response/claim key shape | M1 PASS |
| AUTH-03 | `src/auth.ts`, `src/workbuddy-api.ts` refresh | rotation/omission, token/expiry/identity preservation and contradiction rejection | production host `refreshToken` callback | frozen upstream omission fallback; optional enterprise refresh omits enterprise header; forced expiry/401 fixtures | forced expiry refreshed and streamed; restart remained usable | M1 PASS |
| AUTH-04 | `src/provider.ts` resolver | durable-row/header composition, optional enterprise/no-enterprise, pre-bind projection | production `Model.resolveHeaders` + host Authorization | persisted A → register → bind → find → request; retained session and fresh child controller resolve current B | A/B streamed requests succeeded on live no-enterprise path | M1 PASS |
| AUTH-05 | login/refresh/getApiKey/request validation | missing accountId and conflicting refresh identity; optional orgId | getApiKey plus retained-model fail-closed | production contract: missing account/ambiguous identity produces zero Chat requests; missing org sends no-enterprise marker | live optional-org login/chat/refresh passed; malformed fixture remained fail-closed | M1 PASS |
| AUTH-06 | WorkBuddy-only modifier/resolver | mixed catalog preserves exact foreign rows | full-catalog modifier and fixed-header contract | scope regression plus production transport headers | WorkBuddy live request path passed; mixed-provider isolation remains fixture-backed | M1 PASS |
| AUTH-07 | single-account guard | 0/1/2 rows and active ignored for count | `listOAuthAccounts` at getApiKey/resolver boundaries | production retained-model zero-transport; A→B retained/fresh-child resolver; synthetic Task host/runtime guard harness | distinct A→B; retained session plus explicit Hy3 fresh Task completed under B; final enabled count zero | M1 PASS |
| AUTH-08 | provider-scoped logout | generation invalidation and late-result discard | public `AuthStorage.remove('workbuddy')` | real AuthStorage delete, failed-delete error with prior auth restored, successful-delete old resolver fail-closed, pending Billing discard, model-switch status clear, Desktop fixture unchanged | zero enabled credentials after logout; next request failed before transport | M1 PASS |
| AUTH-09 | `src/workbuddy-api.ts`, provider lifecycle | host `LoginCancelledError`/Abort classification, refresh-request abort, malformed envelope/data, polling Retry-After, and one-shot 429 matrix | login controller signal, refresh ownership signal, `session_shutdown` abort | request/delay/polling-429 waits cancel; late success discarded; malformed JSON/schema and reject/timeout/network/5xx/one-shot-429 classified without generic retry | cancellation/error branches intentionally exercised by isolated protocol harness, not destructive live account actions | M1 PASS |
| GATE-01 | `src/payload.ts`, `gateway-compatibility-evidence.md` | every former transform classified; one evidenced named-choice delta retained | real payload hook contract | copy-on-write named delta; all other fields preserved | isolated Deepseek named object reproduced HTTP 400/code `11101`; corrected string form passed | M3 PASS |
| GATE-02 | `src/payload.ts` minimal boundary | `payload.test.mts`: only named choice changes; no prompt/role/other-field mutation | host-generated stream/effort/max/tool fields | native semantics preserved except evidenced string encoding | Hy3 ordinary/no-injected-system chat passed | M3 PASS |
| GATE-03 | request-bound Provider hook + WorkBuddy resolver scope guard | `scope.test.mts`: WorkBuddy named copy/string identity plus current/historical same-ID foreign identity; `provider.test.mts`: transition/inactive fail closed before prior resolver | actual `ExtensionRunner` request Model and swallowed-error contract; real `streamSimple` retained model | resolver revision checks and zero `fetch`; no cumulative ID routing | hardened Provider route completed isolated Deepseek named-tool live case | M3 PASS |
| GATE-04 | no reasoning cleanup retained without evidence | `tool-loop.test.mts`: reasoning/content/tool/result history | real OMP Agent history and replay | next-turn correlated result reuse and final answer | Hy3 two-turn reasoning history and subsequent tool loops passed | M3 PASS |
| GATE-05 | native OMP Agent/tool loop plus minimal named encoding | named/auto, fragmented arguments, sequential/multi synthetic standard-capability fixtures | real OMP Agent/tool delta parser and request-bound WorkBuddy hook | four correlated calls; same-turn shared tools overlap; final answer | Hy3 single/sequential/same-turn tools; hardened Deepseek forced named `Read` returned `DEEP_NAMED_TOOL_OK` | M3 PASS |
| GATE-06 | native `openai-completions` | reasoning/text/usage/DONE/400/abort/503 cases | real OMP stream/error/abort/retry implementation | injected Fetch boundary, no plugin parser/client/retry | live chat and user-abort recovery passed; deliberate service errors not required | M3 PASS |
| UX-01 | `src/ui.ts`, command state | available/unavailable/not-queried compact render; negative/incoherent/empty-package data rejected; no stale last-good | command registration and normalized Usage report | `test/ui.test.mts` compact fields and masked identity; `test/credits.test.mts` genuine zero and semantic-invalid boundaries | official Billing success and live unavailable/logout transitions | M4/M5 PASS |
| UX-02 | command orchestration | free/all/logout transitions | command/UI API contract | scope commit/rollback and unchanged credential; scope actions issue no Billing and mount no detail; provider-scoped delete and failed-delete truthfulness | live free/all/logout and post-logout fail-closed passed | M4/M5 PASS |
| UX-03 | `src/credits.ts`, `src/workbuddy-api.ts`, Provider `usage` | strict parser and genuine-zero cases | normalized schema; `retainLastGoodOnFailure=false`; `validatesCredentials=false`; host `X-User-Id`; no Billing enterprise header | success→5xx, malformed/semantic-invalid/empty, timeout; session/turn zero-request; single-account guard | official Billing success; controlled 5xx/timeout/slow production-adapter faults | M4/M5 PASS |
| UX-04 | `src/ui.ts` `stateGeneration` | stale-result discard | turn/session/account/scope/model inputs checked before apply | next-turn dismiss, account A→B, scope change, logout pending result, shutdown invalidation | live logout/scope/credits passed; prior live A→B retained | M4 PASS; M5 PASS |
| UX-05 | command-scoped lifecycle display | masked compact detail; no WorkBuddy status line | session_start/turn_start hooks clear UI without Billing | explicit show, next-turn clear/cancel, startup dormant, UI exceptions contained | live free/all switch, credits, login/logout, and masked identity | M4 PASS; M5 PASS |
| UX-06 | `ctx.hasUI` guards | no-UI branch | auth/provider/hook registration remains unconditional | headless lifecycle/status command performs zero UI access and starts no optional Billing; Task contract remains green | authenticated headless thinking/read/result passed | M4 PASS; M5 PASS |
| UX-07 | `src/settings.ts` | `settings.test.mts`: public agent path/scope/0600/no-secret/atomic-failure cases | OMP `getAgentDir()` rule | isolated directory, byte-preserving failure, temp cleanup, empty-free restart; UI reads committed scope | isolated profile scope persisted across restart | M2 3.9 PASS; M4/M5 PASS |
| MODEL-01 | `src/models.ts` | `model-catalog.test.mts`: parse/diagnose capabilities | ProviderModelConfig plus `ModelRegistry` final Model fields | four synthetic models resolved through real registry; authorized real-cache ID summary retained | Hy3, Hy4 preview, and Deepseek-V4.1-Flash live Chat passed | M2/M5 PASS |
| MODEL-02 | canonical thinking metadata | supported/required/optional/unknown/default/invalid-default matrix | host effort generation, defaultLevel, and required-off clamp | synthetic high/multi defaults plus `model-transport.test.mts`; real-cache thinking summary | live supported high effort passed; off remains unavailable where the catalog disallows it | M2/M5 PASS |
| MODEL-03 | input/compat metadata | image capability projection | final Model image normalization | valid 1×1 PNG reaches local OpenAI transport as `image_url`; synthetic final Models retain Vision | Hy3 identified a real 2×2 red PNG | M2/M5 PASS |
| MODEL-04 | catalog/request budget clamp | lower/higher and unrelated-model budgets | host-native max-token clamp without payload mutation | synthetic resolved budgets plus emitted 16k clamp and smaller-budget preservation; real-cache budget summary | ordinary live requests passed; no claim that the server maximum was re-measured | M2 PASS; documented boundary |
| MODEL-05 | free projection | paid/unknown/empty/builtin fixtures | zero cost is not free evidence | real registry all→paid→free(empty), stale rows removed | live cache exposed 3 explicit-free rows and 22 all-scope rows | M2/M5 PASS |
| MODEL-06 | Desktop cache→builtin source | missing/unreadable/invalid JSON/schema/no-valid-row/valid-empty cases | ADR and host registration semantics | exact Widget source/fallback reason; authorized real-cache ID summary | live source was `desktop-cache`; no remote-source claim | M2/M5 PASS |
| MODEL-07 | provider/scope/settings commit | registration/atomic-settings failure rollback and stale-model block | non-empty in-place register; empty unregister/register semantics | all→paid→free(empty) next Chat zero HTTP; restart; credential invariant | live free→all→free re-registration passed | M2/M5 PASS |
| REL-01 | composed main/task/headless paths | component regressions | official host API/type checks | main + actual Task + headless scenarios | real chat/thinking/tools/refresh/Task/headless | M5 PASS |
| REL-02 | release runner/evidence | complete matrix inventory | install/type gate | deterministic negative/failure cases | required positive live cases and isolated real-host negatives | M5 PASS; `release-evidence.md` |
| REL-03 | test suites by layer | pure behavior suite | real OMP type/API suite | official runtime suite | WorkBuddy live E2E suite | M5 PASS: 19 permanent scripts plus Live |
| REL-04 | redaction/endpoints | identity masking and URL-origin regression | logger/request boundary review | repo/log/network/file audit | redacted live outcomes; unchanged Desktop metadata checksum | M5 PASS |
| REL-05 | `release-evidence.md` | evidence field review | exact host/runtime/base revisions | reproducible command and matrix log | dated account-type/model evidence without identifiers | M5 PASS |
| REL-06 | README/release notes | limitation checklist | compatibility metadata | official local install and migration read-through | operator commands and known limitations recorded | M5 PASS |

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
- The isolated local-extension OAuth/Gateway run completed on OMP 18.2.6. Hy3 covered ordinary chat, reasoning history, single/sequential/same-turn tools and abort recovery; Deepseek-V4.1-Flash covered reasoning, automatic tools, and named forcing.
- Gate record: `docs/omp-port/m3-gate.md`. A naturally observed redacted HTTP 400/code `11101` proved that named `tool_choice` must be a string; the minimal copy-on-write correction passed the same live case. Final isolated AuthStorage contained zero enabled WorkBuddy credentials.

## M4 evidence index

- UX-01/03: `src/credits.ts`, the Billing protocol in `src/workbuddy-api.ts`, and `test/credits.test.mts` cover normalized account/plan/pack data, genuine zero, semantic-invalid and empty-package rejection, success→5xx, malformed data, timeout, no stale last-good, single-account rejection, `validatesCredentials: false`, `X-User-Id`, and absence of unevidenced Billing `X-Enterprise-Id`.
- UX-01/02/04/05/06: `src/ui.ts`, `extensions/workbuddy.ts`, and `test/ui.test.mts` cover compact command detail, no WorkBuddy status line, next-turn dismissal, account/scope/session generation invalidation, optional UI exception containment, and headless zero-UI access.
- UX-02/04: `test/contract/model-scope-lifecycle.test.mts` and `test/contract/provider-logout.test.mts` retain transactional free/all changes, explicit detail after scope changes, credential invariance/delete semantics, pending-Billing logout, and model-leave clearing.
- UX-03/05: `test/session-start.test.mts` uses a real isolated OMP AuthStorage OAuth row plus registered UsageProvider and proves session startup issues no Billing request or persistent UI.
- UX-07: `test/settings.test.mts` retains host-directory scope persistence and secret-free settings.
- Gate record: `docs/omp-port/m4-gate.md`. `/workbuddy` detail is command-scoped and dismissed on the next `turn_start`; the authenticated Billing and complete release matrix are archived in `release-evidence.md`.

## Coverage check

Exactly 40 requirement IDs are represented once: HOST 5, AUTH 9, GATE 6, UX 7, MODEL 7, REL 6. Every row names a unit, host contract, runtime integration, and live entry; N/A is used only where no WorkBuddy service behavior exists. Planned or partial rows remain non-passing until their milestone evidence runs.
