# WorkBuddy Gateway compatibility evidence

Evidence snapshot: 2026-09-20  
Host contract: `@oh-my-pi/pi-ai` / `@oh-my-pi/pi-agent-core` 18.2.6  
Gateway live identity: isolated `/login workbuddy` completed; all evidence below is redacted, and the profile ended with zero enabled WorkBuddy credentials.

## Decision rule

A WorkBuddy payload transform is retained only when the repository contains a reproducible native-request failure, a redacted Gateway response, the affected model/version, and a regression for the minimal correction. A local fixture proves the OMP host contract; it is not substituted for Gateway evidence.

## Candidate decisions

| Candidate | Native request failure | Redacted Gateway response | Applicable model/version | Decision and minimal correction | Regression evidence |
|---|---|---|---|---|---|
| Assistant reasoning replay cleanup (`reasoning` / `thinking` deletion) | No reproducible Gateway case is present | None; not fabricated | None established | **Deleted.** No plugin cleanup remains. OMP owns reasoning parsing/history conversion; its ordinary content, tool calls, `tool_call_id`, and tool results remain intact. | `test/tool-loop.test.mts` keeps reasoning beside tool history, executes four correlated calls, replays results, and receives the final answer. |
| Named `tool_choice` rewrite (object to string/name) | OMP `/force:read` emitted the native OpenAI named object; `deepseek-v4.1-flash` failed before tool execution | HTTP 400, code `11101`: `tool_choice` object could not be unmarshaled into the Gateway string field; request/account identifiers omitted | `deepseek-v4.1-flash`, OMP 18.2.6, 2026-09-20 | **Retained as the only M3 payload delta.** For an active WorkBuddy model, copy the payload and replace `{type:"function", function:{name}}` with the function-name string. String choices and every unrelated field remain untouched. | `test/payload.test.mts` and `test/scope.test.mts` prove copy-not-mutate behavior, foreign isolation, and no-op string choices. Reloading the extension changed the same `/force:read` case from HTTP 400 to one `Read` execution and `DEEP_NAMED_TOOL_OK`. |
| Request-body token clamp | No redacted Gateway rejection is present in the repository | None; not fabricated | `deepseek-v4.1-flash`; product catalog currently reports 128,000 output tokens | **Deleted from the payload hook.** The existing M2 model-catalog safety limit of 16,384 remains host metadata (`Model.maxTokens`), not an M3 payload transform. Its server limit still requires live confirmation before release. | `test/model-transport.test.mts` proves OMP emits at most the catalog limit and does not raise smaller budgets. This is host-contract evidence only. |
| Unsupported-field cleanup, forced `stream`, developer-to-system rewrite, tool removal, and automatic system prompt | No reproducible Gateway case is present | None; not fabricated | None established | **Deleted.** Apart from the named-choice delta above, `src/payload.ts` does not add, remove, rename, clamp, or rewrite fields. | `test/payload.test.mts` and `test/scope.test.mts` retain stream, roles, prompt, reasoning effort, max tokens, tools, reasoning history, and unknown provider fields. |

There is therefore **one retained M3 payload transform**: the evidenced named-choice object-to-string conversion. A future compatibility exception must add a redacted failing native request/response pair and a minimal regression before code is added.

## Native host contract evidence

- `test/native-transport.test.mts`: real OMP `openai-completions` stream implementation; reasoning/text deltas, usage, `[DONE]`, HTTP 400 diagnostics, `AbortSignal`, and one `Retry-After`-aware 503 retry.
- `test/tool-loop.test.mts`: real OMP `Agent`; named and auto choice, fragmented arguments, single/sequential/same-turn multi-tool execution, parallel shared tools, exact `tool_call_id` correlation, result replay, and final assistant answer.
- `test/scope.test.mts`: actual extension hook; a current WorkBuddy named choice receives a copied payload with only `tool_choice` changed, compatible string choices retain identity, and a nonmatching ID receives no replacement or mutation.
- `test/model-transport.test.mts`: real OMP request builder for image, reasoning effort, and model metadata budget behavior.

These fixtures do not call WorkBuddy and cannot prove Gateway acceptance.

## Hook isolation limitation

OMP 18.2.6 supplies the payload hook with the request body but no reliable provider identity. Active matching uses the current WorkBuddy model-ID set, while the retained-model guard keeps a cumulative `knownIds` set. A foreign provider using a current WorkBuddy ID cannot be distinguished; a foreign request using a historical/removed WorkBuddy ID can be rejected as outside the active scope, not merely transformed. Moving the retained-model guard to WorkBuddy-bound `resolveHeaders` would remove that ambiguity, but is deferred hardening rather than an M3 compatibility rewrite. Absolute cross-provider isolation is not claimed.

## Live gate result

M3 live acceptance **passed** in an isolated `workbuddy-m3-live` profile on OMP 18.2.6:

- OAuth login, the 22-model Desktop catalog, `all` scope, and model selection succeeded.
- `hy3` completed ordinary chat, two reasoning-history turns, one tool, two strictly sequential tools, and two same-turn tools.
- The same Hy3 session was interrupted with Escape during generation and immediately completed a follow-up turn.
- `deepseek-v4.1-flash` completed reasoning chat plus an automatic read-tool loop.
- Native named choice reproduced the redacted code `11101` rejection; the minimal object-to-string correction then completed the same forced `read` loop.
- Generic fragmented arguments, correlation, HTTP diagnostics, retry ownership, abort, and SSE termination remain exact OMP contract evidence; no service fault was manufactured.
- `/logout workbuddy` marked the sole isolated credential `deleted by user`; the final AuthStorage inspection found zero enabled WorkBuddy credentials.

No account ID, token, authorization value, OAuth state, or request ID is retained in this document.
