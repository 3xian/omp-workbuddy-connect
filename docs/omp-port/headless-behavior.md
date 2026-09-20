# OMP 18.2.6 Headless and Child-Session Behavior

Verified: 2026-09-20

Host contract: `@oh-my-pi/pi-ai@18.2.6` and `@oh-my-pi/pi-coding-agent@18.2.6`, corresponding to OMP tag commit `78b753124d11f8dd3ae73e2524125890ff7c977e`.

## Probe boundary

The probe loaded the actual `extensions/workbuddy.ts` factory into two isolated SDK sessions:

- a headless parent session created with `hasUI: false`;
- a headless child-shaped session created with `hasUI: false` and `parentAgentId`.

Both used an in-memory SessionManager, isolated AuthStorage/model-cache paths, no discovery, no tools, no skills, no prompt templates, and a synthetic WorkBuddy model. No network request or live WorkBuddy authentication occurred.

## Runtime observations

| Contract | Parent | Child-shaped session |
|---|---:|---:|
| Extension factory loaded independently | Yes | Yes |
| `session_start` emitted | Yes | Yes |
| `ctx.hasUI` | `false` | `false` |
| `ctx.ui.setWidget()` / `setStatus()` safe without a UI | Yes | Yes |
| `turn_start` emitted | Yes | Yes |
| `before_provider_request` executed | Yes | Yes |
| WorkBuddy hook preserved the host-native payload unchanged | Yes | Yes |
| `ctx.abort` and `ctx.shutdown` exposed as functions | Yes | Yes |
| `session_shutdown` after `dispose()` | Exactly once | Exactly once |

The parent also completed the public `session.abort({ reason })` path before disposal. The isolated OAuth probe separately proved that the `/login` controller's AbortSignal reaches `oauth.login()` and that cancellation writes no credential.

## Actual Task executor probe

Task 1.6b used `runSubprocess()` from `@oh-my-pi/pi-coding-agent/task/executor`, not a child-shaped SDK session. The isolated probe supplied the task role as `@task` with `modelRoles.task = workbuddy/hy3`, a synthetic in-process streaming API, the real WorkBuddy extension path, and a separately loaded observer extension.

Observed results:

| Contract | Result |
|---|---|
| Task role resolution | `workbuddy/hy3` |
| Required terminal tool | Real Task `yield` executed; result was `\"task-probe-ok\"` |
| Extension binding | Three Task sessions produced three distinct factory instances |
| Headless state | All three `session_start` events reported `ctx.hasUI === false` |
| Payload hook | Both dispatched WorkBuddy requests reached the observer with `model=hy3`; synthetic transport `stream=false` was preserved because the request-bound hook only applies the evidenced named `tool_choice` encoding |
| Cancellation | A provider request was held open, caller AbortSignal aborted it, and `runSubprocess` returned `aborted=true`, exit code 1 |
| Shutdown | All three sessions emitted `session_shutdown` with `keepAlive=false` |
| Ambiguous stored accounts | Two stored OAuth rows were rejected by the request resolver before the synthetic transport; added transport attempts: 0 |

The probe uses temporary AuthStorage/model-cache/config paths and missing Desktop auth/product paths. It makes no network request and removes its temporary directory. The executable regression contract is retained at `test/contract/task-runtime-contract.test.mts` with its observer fixture.

## Lifecycle decisions

- Authentication is not UI-dependent. OAuth receives callbacks plus an AbortSignal from AuthStorage; the credential protocol does not require `ctx.ui`.
- Optional UI work must branch on `ctx.hasUI`. Headless UI helpers are safe no-ops in this host version, but the extension must not use them as an authentication prerequisite.
- The child-shaped SDK probe and actual Task executor probe both loaded separately bound extension factories. The Task result additionally proves role-model resolution, required `yield`, payload-hook wiring, cancellation, and shutdown through the actual executor.
- `session.dispose()` is the supported shutdown boundary and emits `session_shutdown`; extension-owned timers/resources must be released there.
- `session.abort()` is the supported active-turn cancellation boundary. OAuth polling must additionally honor the signal supplied to `oauth.login()`.
- In print/headless initialization, `ctx.shutdown()` is only a callback supplied by the host mode; its default is a no-op. It is not a substitute for `session.dispose()`.

## Evidence limit

This proves actual SDK headless lifecycle and actual no-op WorkBuddy payload-hook execution in parent, child-shaped, and actual Task executor sessions. The Task transport was synthetic and authentication was isolated host storage, so it does not prove authenticated WorkBuddy Chat, Gateway streaming, or live tool execution. Those remain M5 release gates.
