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
| WorkBuddy payload transformation set `stream: true` | Yes | Yes |
| `ctx.abort` and `ctx.shutdown` exposed as functions | Yes | Yes |
| `session_shutdown` after `dispose()` | Exactly once | Exactly once |

The parent also completed the public `session.abort({ reason })` path before disposal. The isolated OAuth probe separately proved that the `/login` controller's AbortSignal reaches `oauth.login()` and that cancellation writes no credential.

## Lifecycle decisions

- Authentication is not UI-dependent. OAuth receives callbacks plus an AbortSignal from AuthStorage; the credential protocol does not require `ctx.ui`.
- Optional UI work must branch on `ctx.hasUI`. Headless UI helpers are safe no-ops in this host version, but the extension must not use them as an authentication prerequisite.
- Task/child sessions load a separately bound extension factory. Mutable extension-local state must not be assumed to be shared with the parent.
- `session.dispose()` is the supported shutdown boundary and emits `session_shutdown`; extension-owned timers/resources must be released there.
- `session.abort()` is the supported active-turn cancellation boundary. OAuth polling must additionally honor the signal supplied to `oauth.login()`.
- In print/headless initialization, `ctx.shutdown()` is only a callback supplied by the host mode; its default is a no-op. It is not a substitute for `session.dispose()`.

## Evidence limit

This proves actual SDK headless lifecycle and actual WorkBuddy payload-hook execution, not a live Task tool completion or authenticated WorkBuddy Chat response. Task executor source resolves a child model from the shared ModelRegistry and constructs `createAgentSession({ hasUI: false, ... })`; the model-identity result for that fresh resolution is recorded separately in `modifier-behavior.md`.
