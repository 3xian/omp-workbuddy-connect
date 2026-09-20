# WorkBuddy Gateway compatibility evidence

Evidence snapshot: 2026-09-20  
Host contract: `@oh-my-pi/pi-ai` / `@oh-my-pi/pi-agent-core` 18.2.6  
Gateway live identity: unavailable in the current AuthStorage; no WorkBuddy credential was used by these checks.

## Decision rule

A WorkBuddy payload transform is retained only when the repository contains a reproducible native-request failure, a redacted Gateway response, the affected model/version, and a regression for the minimal correction. A local fixture proves the OMP host contract; it is not substituted for Gateway evidence.

## Candidate decisions

| Candidate | Native request failure | Redacted Gateway response | Applicable model/version | Decision and minimal correction | Regression evidence |
|---|---|---|---|---|---|
| Assistant reasoning replay cleanup (`reasoning` / `thinking` deletion) | No reproducible Gateway case is present | None; not fabricated | None established | **Deleted.** No plugin cleanup remains. OMP owns reasoning parsing/history conversion; its ordinary content, tool calls, `tool_call_id`, and tool results remain intact. | `test/tool-loop.test.mts` keeps reasoning beside tool history, executes four correlated calls, replays results, and receives the final answer. |
| Named `tool_choice` rewrite (object to string/name) | No reproducible Gateway case is present | None; not fabricated | None established | **Deleted.** No WorkBuddy-specific capability override or plugin rewrite remains; OMP owns standard named-choice encoding and compatibility fallback behavior. | `test/tool-loop.test.mts` observes the native named object and `auto` on an explicit standard-capability fixture, including streamed arguments. Live WorkBuddy acceptance remains unproven. |
| Request-body token clamp | No redacted Gateway rejection is present in the repository | None; not fabricated | `deepseek-v4.1-flash`; product catalog currently reports 128,000 output tokens | **Deleted from the payload hook.** The existing M2 model-catalog safety limit of 16,384 remains host metadata (`Model.maxTokens`), not an M3 payload transform. Its server limit still requires live confirmation before release. | `test/model-transport.test.mts` proves OMP emits at most the catalog limit and does not raise smaller budgets. This is host-contract evidence only. |
| Unsupported-field cleanup, forced `stream`, developer-to-system rewrite, tool removal, and automatic system prompt | No reproducible Gateway case is present | None; not fabricated | None established | **Deleted.** `src/payload.ts` only parses the object and reads `model`; it does not add, remove, rename, clamp, or rewrite fields. | `test/payload.test.mts` and `test/scope.test.mts` retain stream, roles, prompt, reasoning effort, max tokens, tools, named choice, reasoning history, and unknown provider fields byte-equivalently. |

There are therefore **zero retained M3 payload transforms**. A future compatibility exception must add a redacted failing native request/response pair and a minimal regression before code is added.

## Native host contract evidence

- `test/native-transport.test.mts`: real OMP `openai-completions` stream implementation; reasoning/text deltas, usage, `[DONE]`, HTTP 400 diagnostics, `AbortSignal`, and one `Retry-After`-aware 503 retry.
- `test/tool-loop.test.mts`: real OMP `Agent`; named and auto choice, fragmented arguments, single/sequential/same-turn multi-tool execution, parallel shared tools, exact `tool_call_id` correlation, result replay, and final assistant answer.
- `test/scope.test.mts`: actual extension hook; current WorkBuddy ID returns the identical payload object, while a nonmatching ID receives no replacement and no mutation.
- `test/model-transport.test.mts`: real OMP request builder for image, reasoning effort, and model metadata budget behavior.

These fixtures do not call WorkBuddy and cannot prove Gateway acceptance.

## Hook isolation limitation

OMP 18.2.6 supplies the payload hook with the request body but no reliable provider identity. The extension can only compare `payload.model` with the currently registered WorkBuddy model-ID set. If another provider uses the exact same model ID, the hook cannot distinguish the two. The current hook is intentionally a no-op for active WorkBuddy payloads rather than introducing a custom transport or global fetch interceptor; absolute cross-provider isolation is not claimed.

## Live gate still required

M3 live acceptance remains blocked until a WorkBuddy account is available through OMP AuthStorage. Run the same native paths against the Gateway and retain redacted request/response evidence for ordinary chat, reasoning history, named/sequential/multi tools, streamed arguments, abort/error/retry behavior, and model-budget acceptance. Any observed incompatibility must be reduced to a server case before a transform is introduced.
