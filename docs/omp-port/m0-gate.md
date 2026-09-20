# M0 Admission Gate

Gate result: **PASS — M1 may start**

Verified: 2026-09-20

## Frozen versions

| Object | Exact value |
|---|---|
| Fork baseline | `6b91ab6753bcb8b5603859b2d9646644a4e62258` |
| Runtime probe base | `55aae5053ef96103a704ec51e81a1b81bf663257` on `feat/omp-port` |
| M0 gate record commit | `9727df23534f68c3abe3440403e2a9bb589fd986` |
| Upstream baseline | `cb2398e3374144db0c088d7a4887dc0913342858` |
| OMP 18.2.6 | `78b753124d11f8dd3ae73e2524125890ff7c977e` |
| Installed contracts | `@oh-my-pi/pi-ai@18.2.6`, `@oh-my-pi/pi-coding-agent@18.2.6` |
| Runtime | Darwin arm64; Node `v26.9.0`; Bun `1.3.14`; TypeScript `7.0.2` |

The runtime probe base identifies the code used for the recorded experiments. The later gate-record commit documents those results. Subsequent review fixes do not rewrite either historical commit; `baseline-manifest.md` remains the authoritative separation of frozen commits and workspace state.

## Six required deliverables

| Deliverable | Evidence | Result |
|---|---|---|
| Baseline Manifest | `baseline-manifest.md` | PASS |
| API Compatibility Matrix | `api-compatibility-matrix.md` | PASS |
| Credential Behavior Note | `credential-behavior.md` | PASS |
| Dynamic Model ADR | `adr-dynamic-models.md`: Path B, Desktop cache → builtin fallback | PASS |
| Credits / Usage ADR | `adr-credits-usage.md`: host UsageProvider | PASS |
| Requirement → Implementation → Test Matrix | `requirement-implementation-test-matrix.md`: 40/40 unique IDs | PASS |

Supporting evidence: `modifier-behavior.md`, `adr-request-identity-binding.md`, and `headless-behavior.md`.

## Admission checks

| Gate | Executed evidence | Result |
|---|---|---|
| Exact commits and runtime | baseline manifest plus `git rev-parse HEAD` / active branch | PASS |
| Zero TypeScript errors | `npx tsc --noEmit` | PASS; exit 0 |
| Official OMP loader | OMP 18.2.6 `loadExtensions(['./extensions/workbuddy.ts'])` under Bun 1.3.14 | PASS: one extension, zero errors, provider `workbuddy` |
| Module/self behavior | `node --experimental-strip-types extensions/workbuddy.ts --self-check` | PASS: `ok` |
| Payload isolation | `node --experimental-strip-types test/scope.test.mts` | PASS: foreign payload unchanged |
| Startup non-blocking | `node --experimental-strip-types test/session-start.test.mts` | PASS |
| OAuth/persistence/refresh/logout | isolated official AuthStorage protocol probe documented in `credential-behavior.md` | PASS for host contract |
| Modifier/full catalog | 5,112 rows / 70 providers, exception fallback, retained model and resolver composition in `modifier-behavior.md` | PASS |
| Request identity | local built-in transport: normal, forced refresh, 401 retry, A→B retained model, abort-before-transport | PASS |
| Headless SDK | parent and child-shaped isolated sessions, no UI dependency, abort/dispose/shutdown | PASS |
| Actual Task executor | real `runSubprocess`, `@task`→`workbuddy/hy3`, independent bindings, hook, `yield`, cancellation, shutdown | PASS |
| Multiple stored OAuth rows | Task request resolver rejected two rows before transport | PASS: zero added transport attempts |
| OpenSpec | `openspec validate adapt-workbuddy-international-omp --strict` | PASS |
| Requirement inventory | executable comparison of spec headings to matrix rows | PASS: spec 40, matrix 40, missing/extra/duplicates empty |

The actual Task probe used a synthetic in-process provider. Authenticated WorkBuddy Task Chat, Gateway streaming/tool behavior, and live identity remain M5 evidence and are not claimed here.

## Decisions entering M1

1. Request identity uses request-boundary `Model.resolveHeaders` composed with public AuthStorage OAuth access; `setModel` is fallback only.
2. v1 is single stored WorkBuddy OAuth account; more than one row fails closed with no transport.
3. Model source is Desktop product cache → builtin fallback. No remote endpoint is assumed.
4. Credits use host UsageProvider and the host OAuth lifecycle; no second refresher.
5. Static `registerProvider({ models: [] })` does not clear old rows in OMP 18.2.6; M2 must implement a verified clearing operation.

## Re-estimation boundary

The original 12–18 day total is not a commitment. M1–M5 retain their ordered gates. M0 evidence adds explicit implementation obligations for request-boundary identity, empty-catalog clearing, UsageProvider normalization, and actual Task/headless parity. Each later milestone is accepted only by its named behavior and live evidence, not elapsed time or document completion.
