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
| HOST-05 | gate/evidence docs | requirement inventory count | strict OpenSpec validation | M0 gate command set | M1 complete authentication chain | M0 PASS; M1 PASS; later gates NOT RUN |
| AUTH-01 | `src/auth.ts`, provider composition | legacy-source rejection | AuthStorage-only resolver contract | legacy file ignored; `persisted-credential-restart.test.mts` uses host credential before extension registration | fresh login, streamed chat, restart recovery | M1 PASS |
| AUTH-02 | `src/auth.ts` login mapping | `test/auth.test.mts`: missing/invalid fields; JWT subject; optional enterprise; nickname/email/domain | OAuth callback return type | host persistence contract plus legacy-source rejection | A/B authorization; redacted response/claim key shape | M1 PASS |
| AUTH-03 | `src/auth.ts`, `src/workbuddy-api.ts` refresh | rotation/omission, token/expiry/identity preservation and contradiction rejection | production host `refreshToken` callback | frozen upstream omission fallback; optional enterprise refresh omits enterprise header; forced expiry/401 fixtures | forced expiry refreshed and streamed; restart remained usable | M1 PASS |
| AUTH-04 | `src/provider.ts` resolver | durable-row/header composition, optional enterprise/no-enterprise, pre-bind projection | production `Model.resolveHeaders` + host Authorization | persisted A → register → bind → find → request; retained session and fresh child controller resolve current B | A/B streamed requests succeeded on live no-enterprise path | M1 PASS |
| AUTH-05 | login/refresh/getApiKey/request validation | missing accountId and conflicting refresh identity; optional orgId | getApiKey plus retained-model fail-closed | production contract: missing account/ambiguous identity produces zero Chat requests; missing org sends no-enterprise marker | live optional-org login/chat/refresh passed; malformed fixture remained fail-closed | M1 PASS |
| AUTH-06 | WorkBuddy-only modifier/resolver | mixed catalog preserves exact foreign rows | full-catalog modifier and fixed-header contract | scope regression plus production transport headers | WorkBuddy live request path passed; mixed-provider isolation remains fixture-backed | M1 PASS |
| AUTH-07 | single-account guard | 0/1/2 rows and active ignored for count | `listOAuthAccounts` at getApiKey/resolver boundaries | production retained-model zero-transport; A→B retained/fresh-child resolver; synthetic Task host/runtime guard harness | distinct A→B; retained session plus explicit Hy3 fresh Task completed under B; final enabled count zero | M1 PASS |
| AUTH-08 | provider-scoped logout | generation invalidation and late-result discard | public `AuthStorage.remove('workbuddy')` | real AuthStorage delete, failed-delete error with prior auth restored, successful-delete old resolver fail-closed, pending Billing discard, model-switch status clear, Desktop fixture unchanged | zero enabled credentials after logout; next request failed before transport | M1 PASS |
| AUTH-09 | `src/workbuddy-api.ts`, provider lifecycle | host `LoginCancelledError`/Abort classification plus deadline/Retry-After/error protocol matrix | login controller signal, refresh ownership signal, `session_shutdown` abort | request/delay/429 waits cancel; late success discarded; reject/timeout/network/5xx/429 classified without generic retry | cancellation/error branches intentionally exercised by isolated protocol harness, not destructive live account actions | M1 PASS |
| GATE-01 | `src/payload.ts`, evidence log | one regression per retained delta | real payload hook contract | unpatched/patched fixture requests | gateway failure/success pair | M3 PLANNED / NOT RUN |
| GATE-02 | `src/payload.ts` | no prompt injection/native fields | host-generated payload inspection | ordinary conversation semantics | live no-system case | M3 PLANNED / NOT RUN |
| GATE-03 | payload ID scope | `test/scope.test.mts` migration | before-provider hook result | matching/nonmatching requests | same-ID limitation observation | M3 PARTIAL: existing isolation test; final NOT RUN |
| GATE-04 | reasoning cleanup | content/tool/result association | OMP history types | next-turn tool result reuse | live reasoning + tool history | M3 PLANNED / NOT RUN |
| GATE-05 | native tool loop | named/auto argument fixtures | OMP tool delta parser | single/sequential/multi/parallel tools | live tool loop | M3 PLANNED / NOT RUN |
| GATE-06 | native `openai-completions` | no custom parser/transport | stream/error/abort/retry contract | local protocol server matrix | live streaming/error | M3 PLANNED / NOT RUN |
| UX-01 | `src/ui.ts`, command state | available/unavailable/not-queried render; no stale last-good | command registration | command output after success→failure | live account/credits/plan | M4 PLANNED / NOT RUN |
| UX-02 | command orchestration | free/all/logout transitions | command/UI API contract | credential unchanged/deleted cases | live commands | M4 PLANNED / NOT RUN |
| UX-03 | WorkBuddy UsageProvider | credits parser and genuine-zero cases | normalized schema; `retainLastGoodOnFailure=false`; `X-User-Id` | slow/5xx/timeout nonblocking and unavailable | live Billing | M4 PLANNED / NOT RUN; ADR accepted |
| UX-04 | UI `stateGeneration` | stale-result discard | session/scope identity inputs | logout/account/scope/teardown races | live pending Billing switch | M4 PLANNED / NOT RUN |
| UX-05 | lifecycle display | visibility render | session_start/turn_start hooks | switch in/out next-turn refresh | interactive model switch | M4 PLANNED / NOT RUN |
| UX-06 | UI guards | no-UI branch | `ctx.hasUI` contract | headless SDK and Task probes | authenticated headless tools | M4 PARTIAL: M0 headless/Task PASS |
| UX-07 | `src/settings.ts` | path/scope/no-secret cases | OMP agent-dir rule | custom directory and restart | N/A | M4 PLANNED / NOT RUN |
| MODEL-01 | `src/models.ts` | parse/diagnose capabilities | ProviderModelConfig/final Model types | register three rows | three real model IDs | M2 PLANNED / NOT RUN |
| MODEL-02 | canonical thinking metadata | supported/required/off matrix | host effort generation | selector and request payload | live supported efforts | M2 PLANNED / NOT RUN |
| MODEL-03 | input/compat metadata | image retention | final Model image normalization | actual image reaches local transport | real image request | M2 PLANNED / NOT RUN |
| MODEL-04 | catalog/request budget clamp | lower/equal/higher budgets | host max token field | catalog/request consistency | live server limit | M2 PLANNED / NOT RUN |
| MODEL-05 | free projection | paid/unknown/empty fixtures | zero cost not free evidence | empty scope clears stale rows | live pricing confirmation | M2 PLANNED / NOT RUN |
| MODEL-06 | Desktop cache→builtin source | missing/malformed/valid source cases | ADR and host registration semantics | source labels and fallback | cache-derived real IDs | M2 PLANNED / NOT RUN; ADR accepted |
| MODEL-07 | provider/scope/settings commit | transition rollback and stale-model block | unregister/re-register semantics | all→paid→free(empty) next Chat zero transport; restart; credential invariant | live selector behavior | M2 PLANNED / NOT RUN |
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

## Coverage check

Exactly 40 requirement IDs are represented once: HOST 5, AUTH 9, GATE 6, UX 7, MODEL 7, REL 6. Every row names a unit, host contract, runtime integration, and live entry; N/A is used only where no WorkBuddy service behavior exists. Planned or partial rows remain non-passing until their milestone evidence runs.
