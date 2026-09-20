# M3 Gateway Compatibility Gate

Recorded: 2026-09-20  
Host: OMP 18.2.6  
Status: **PASS**

## Local implementation result

Tasks 4.1–4.7 are complete:

- only one WorkBuddy-specific payload transform remains, backed by a redacted live Gateway failure;
- `src/payload.ts` is otherwise a copy-on-write identification boundary;
- the actual extension hook leaves nonmatching payloads unchanged and changes only an active model's named `tool_choice`;
- reasoning, ordinary content, tool calls, `tool_call_id`, and tool results survive the native Agent loop;
- a synthetic standard-capability model completes named/auto, fragmented-argument, sequential and same-turn parallel tool calls through the real OMP Agent;
- the real OMP `openai-completions` implementation owns reasoning/text/tool streaming, usage, `[DONE]`, HTTP diagnostics, abort, and Retry-After-aware retry;
- the plugin contains no Chat client, SSE/tool parser, retry loop, or global Chat fetch interceptor.

Synthetic capability fixtures prove the OMP 18.2.6 host contract. The isolated live run separately proved WorkBuddy behavior.

## Compatibility decisions

Reasoning cleanup, request-body token clamp, forced stream, developer/system rewrite, unsupported-field cleanup, and automatic system prompts remain deleted because no Gateway failure was observed. Native named forcing on `deepseek-v4.1-flash` produced a redacted HTTP 400/code `11101`: the Gateway could not unmarshal the OpenAI named-choice object into its string `tool_choice` field.

The retained correction is deliberately narrow: for an active WorkBuddy model only, copy the payload and replace `{type:"function", function:{name}}` with `name`. Existing string choices and all other fields remain untouched. Repeating the same `/force:read` case after reload executed one `Read` call and returned `DEEP_NAMED_TOOL_OK`.

No production `supportsDeveloperRole`, `supportsForcedToolChoice`, or `supportsNamedToolChoice` override was added. OMP generated the native named object; the plugin adapts only the evidenced Gateway wire difference.

## Local verification

The following completed with exit code 0 after restoring test-owned environment variables and directory caches:

```text
omp --version                                  -> omp/18.2.6
npx bun test test                             -> 16 script files completed, 0 failures
npx bun extensions/workbuddy.ts --self-check -> ok
npx tsc --noEmit                              -> no diagnostics
npx openspec validate adapt-workbuddy-international-omp --strict
                                                -> valid
```

The repository tests are executable `.test.mts` contract scripts rather than `bun:test` declarations, so Bun reports zero formal test cases; their sixteen explicit `OK:` contracts and process exit status are the acceptance signal. Plain `bun test test` succeeds without the previous cross-file environment leak.

## Known isolation boundary

OMP 18.2.6 does not expose provider identity to `before_provider_request`. Active matching uses current WorkBuddy IDs; stale-model protection uses cumulative historical WorkBuddy IDs. Therefore another provider using a current identical ID can be misidentified, and one using a historical identical ID can be rejected as outside scope. Moving the retained-model guard to WorkBuddy-bound `resolveHeaders` is deferred hardening. Absolute same-ID cross-provider isolation is not claimed.


## Task 4.7 — live acceptance

The unpublished source was loaded directly:

```bash
omp --profile workbuddy-m3-live \
  --no-extensions \
  --extension /absolute/path/to/omp-workbuddy-connect/extensions/workbuddy.ts
```

The isolated run completed:

1. `/login workbuddy`, `/workbuddy all`, and selection from the 22-model Desktop catalog;
2. Hy3 ordinary chat and a two-turn reasoning-history continuation;
3. Hy3 single-tool, strictly sequential two-tool, and same-turn two-tool execution;
4. user Escape abort followed by a successful turn in the same session;
5. Deepseek-V4.1-Flash reasoning and automatic tool execution;
6. Deepseek native named-force failure, minimal compatibility correction, extension reload, and successful forced `read`;
7. `/logout workbuddy`, followed by AuthStorage inspection showing the sole row disabled as `deleted by user` and zero enabled WorkBuddy credentials.

Fragmented tool arguments, exact correlation, generic non-2xx propagation, Retry-After handling, retry ownership, and SSE terminal behavior remain native OMP contract evidence. The live service was not intentionally damaged to manufacture 4xx/5xx behavior; the named-choice failure occurred naturally during the required case.

The evidence is redacted: no account ID, token, authorization value, OAuth state, or request ID is recorded.
