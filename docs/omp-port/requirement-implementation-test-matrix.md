# Requirement → Implementation → Test Matrix

Baseline: OMP 18.2.6 / `78b753124d11f8dd3ae73e2524125890ff7c977e`

Status date: 2026-09-20

Status vocabulary: **PASS** means the named gate evidence was executed; **PARTIAL** means only the stated lower-layer evidence exists; **PLANNED / NOT RUN** is never a pass. Live WorkBuddy evidence is intentionally not claimed in M0.

| ID | Target implementation | Unit entry | OMP contract entry | Runtime integration entry | Live WorkBuddy entry | Gate / status |
|---|---|---|---|---|---|---|
| HOST-01 | manifest, package/lock, baseline docs | manifest values review | `tsc --noEmit`; exact dependency resolution | baseline workspace/branch/commit capture | N/A | M0 PASS |
| HOST-02 | `package.json`, `extensions/workbuddy.ts` | import smoke | official `loadExtensions` | isolated official extension load | install/load matrix | M0 PASS |
| HOST-03 | provider/auth/hook boundaries | protocol fixture probes | API compatibility, modifier, Task executor probes | OAuth persistence/logout/refresh/restart; actual Task lifecycle | authenticated Task request | M0 PASS for host contract; live NOT RUN |
| HOST-04 | D6/D8 architecture | ADR invariant review | `fetchDynamicModels` and `UsageProvider` type/source checks | empty static registration/source behavior | future endpoint/Billing confirmation | M0 PASS |
| HOST-05 | gate/evidence docs | requirement inventory count | strict OpenSpec validation | M0 gate command set | full release matrix | M0 PASS; later gates NOT RUN |
| AUTH-01 | `src/auth.ts`, provider composition | legacy-source rejection | AuthStorage-only resolver contract | restart with legacy files ignored | fresh login/chat | M1 PLANNED / NOT RUN |
| AUTH-02 | `src/auth.ts` login mapping | missing/invalid fields; nickname/email | OAuth callback return type | persistence/restart identity | login response variants | M1 PLANNED / NOT RUN |
| AUTH-03 | `src/auth.ts`, `workbuddy-api.ts` refresh | token/expiry/identity preservation | host `refreshToken` callback | forced expiry and invalid refresh | live forced refresh | M1 PLANNED / NOT RUN |
| AUTH-04 | `src/provider.ts` resolver | generation/header composition | `Model.resolveHeaders` + host Authorization | normal/refresh/401/A→B requests | redacted gateway identity | M1 PARTIAL: M0 probe PASS; production/live NOT RUN |
| AUTH-05 | auth validation at login/refresh/request | missing accountId/orgId | getApiKey fail-closed | zero-request negative cases | live malformed credential | M1 PLANNED / NOT RUN |
| AUTH-06 | WorkBuddy-only modifier/resolver | mixed catalog preservation | `modifyModels` full-catalog probe | foreign provider request unchanged | mixed-provider session | M1 PARTIAL: M0 modifier PASS |
| AUTH-07 | single-account guard | 0/1/2 stored rows | `listOAuthAccounts` semantics | actual Task two-row zero-transport probe | multi-row authenticated attempt | M1 PARTIAL: host/Task contract PASS |
| AUTH-08 | provider-scoped logout | state invalidation ordering | public AuthStorage delete | delete/restart/no-old-request | logout then live request | M1 PARTIAL: M0 delete contract PASS |
| AUTH-09 | OAuth controller | cancel/error/Retry-After cases | OAuth AbortSignal contract | user/session/shutdown cancellation | live deny/429/timeout | M1 PLANNED / NOT RUN |
| GATE-01 | `src/payload.ts`, evidence log | one regression per retained delta | real payload hook contract | unpatched/patched fixture requests | gateway failure/success pair | M3 PLANNED / NOT RUN |
| GATE-02 | `src/payload.ts` | no prompt injection/native fields | host-generated payload inspection | ordinary conversation semantics | live no-system case | M3 PLANNED / NOT RUN |
| GATE-03 | payload ID scope | `test/scope.test.mts` migration | before-provider hook result | matching/nonmatching requests | same-ID limitation observation | M3 PARTIAL: existing isolation test; final NOT RUN |
| GATE-04 | reasoning cleanup | content/tool/result association | OMP history types | next-turn tool result reuse | live reasoning + tool history | M3 PLANNED / NOT RUN |
| GATE-05 | native tool loop | named/auto argument fixtures | OMP tool delta parser | single/sequential/multi/parallel tools | live tool loop | M3 PLANNED / NOT RUN |
| GATE-06 | native `openai-completions` | no custom parser/transport | stream/error/abort/retry contract | local protocol server matrix | live streaming/error | M3 PLANNED / NOT RUN |
| UX-01 | `src/ui.ts`, command state | available/unavailable/not-queried render | command registration | command output states | live account/credits/plan | M4 PLANNED / NOT RUN |
| UX-02 | command orchestration | free/all/logout transitions | command/UI API contract | credential unchanged/deleted cases | live commands | M4 PLANNED / NOT RUN |
| UX-03 | WorkBuddy UsageProvider | credits pack parser | UsageProvider normalized schema | slow/5xx/timeout nonblocking | live Billing | M4 PLANNED / NOT RUN; ADR accepted |
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
| MODEL-07 | provider/scope/settings commit | transition rollback cases | unregister/re-register semantics | free/all/empty/restart; credential invariant | live selector behavior | M2 PLANNED / NOT RUN |
| REL-01 | composed main/task/headless paths | component regressions | official host API/type checks | main + actual Task + headless scenarios | chat/thinking/tools/refresh/task | M5 PARTIAL: M0 Task/headless contract PASS |
| REL-02 | release runner/evidence | matrix schema validation | install/type gate | all local release cases | every required live case | M5 PLANNED / NOT RUN |
| REL-03 | test suites by layer | pure behavior suite | real OMP type/API suite | official runtime suite | live E2E suite | M5 PLANNED / NOT RUN |
| REL-04 | redaction/endpoints | secret scrub fixtures | logger/request boundary review | repo/log/network audit | redacted live capture | M5 PLANNED / NOT RUN |
| REL-05 | `release-evidence.md` | evidence field validation | version/commit capture | reproducible command log | dated account/model evidence | M5 PLANNED / NOT RUN |
| REL-06 | README/release notes | limitation checklist | compatibility metadata | clean install/migration read-through | operator confirmation | M5 PLANNED / NOT RUN |

## M0 evidence index

- HOST-01: `baseline-manifest.md`
- HOST-02/03: `api-compatibility-matrix.md`, `credential-behavior.md`, `modifier-behavior.md`
- AUTH-04/06/07/08: `adr-request-identity-binding.md` and its local HTTP/AuthStorage evidence
- HOST-03/REL-01/UX-06: `headless-behavior.md`, including the actual `runSubprocess` Task executor probe
- HOST-04/MODEL-06: `adr-dynamic-models.md`
- HOST-04/UX-03: `adr-credits-usage.md`
- HOST-05: this matrix and `m0-gate.md`

## Coverage check

Exactly 40 requirement IDs are represented once: HOST 5, AUTH 9, GATE 6, UX 7, MODEL 7, REL 6. Every row names a unit, host contract, runtime integration, and live entry; N/A is used only where no WorkBuddy service behavior exists. Planned or partial rows remain non-passing until their milestone evidence runs.
