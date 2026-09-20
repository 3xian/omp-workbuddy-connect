import { setTimeout as sleep } from "node:timers/promises";
import { type } from "@oh-my-pi/omptype";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { streamSimple, type Model } from "@oh-my-pi/pi-ai";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Synthetic standard-capability fixture: exercises OMP host behavior, not WorkBuddy Gateway support.
const model: Model<"openai-completions"> = {
  id: "tool-contract",
  name: "Tool Contract",
  api: "openai-completions",
  provider: "workbuddy",
  baseUrl: "https://gateway.invalid/v2",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
  compat: {
    supportsDeveloperRole: true,
    supportsToolChoice: true,
    supportsForcedToolChoice: true,
    supportsNamedToolChoice: true,
  },
};

function sse(chunks: unknown[]): Response {
  const body = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, number>) {
  return {
    id: "chatcmpl-tool-contract",
    object: "chat.completion.chunk",
    created: 1,
    model: model.id,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

let active = 0;
let maxActive = 0;
const executions: Array<{ id: string; value: number }> = [];
const tool: AgentTool = {
  name: "contract_tool",
  label: "Contract Tool",
  description: "Return the supplied integer.",
  parameters: type({ value: "number" }),
  intent: "omit",
  concurrency: "shared",
  async execute(id, params) {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(15);
    active -= 1;
    const value = Number((params as { value: number }).value);
    executions.push({ id, value });
    return { content: [{ type: "text", text: `result:${id}:${value}` }] };
  },
};

const namedPayloads: Record<string, unknown>[] = [];
let namedRequest = 0;
const namedFetch: typeof fetch = async (_input, init) => {
  namedPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  const request = namedRequest++;
  if (request === 0) {
    return sse([
      chunk({ reasoning_content: "select the first tool" }),
      chunk({ tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "contract_tool", arguments: "{\"value\":" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] }, "tool_calls"),
    ]);
  }
  if (request === 1) {
    return sse([
      chunk({ tool_calls: [{ index: 0, id: "call-2", type: "function", function: { name: "contract_tool", arguments: "{\"value\":2}" } }] }, "tool_calls"),
    ]);
  }
  if (request === 2) {
    return sse([
      chunk({ tool_calls: [
        { index: 0, id: "call-3", type: "function", function: { name: "contract_tool", arguments: "{\"value\":" } },
        { index: 1, id: "call-4", type: "function", function: { name: "contract_tool", arguments: "{\"value\":4}" } },
      ] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "3}" } }] }, "tool_calls"),
    ]);
  }
  if (request === 3) {
    return sse([
      chunk({ content: "all tools complete" }),
      chunk({}, "stop", { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 }),
    ]);
  }
  throw new Error(`unexpected named-tool request ${request}`);
};

const namedAgent = new Agent({
  initialState: { model, tools: [tool] },
  streamFn: (target, context, options) => streamSimple(target, context, {
    ...options,
    apiKey: "contract-key",
    fetch: namedFetch,
  }),
});
await namedAgent.prompt("Run the contract tool.", {
  toolChoice: { type: "function", function: { name: "contract_tool" } },
});
assert(namedRequest === 4, `sequential/multi-call loop stopped after ${namedRequest} requests`);
assert(executions.map((entry) => entry.id).sort().join(",") === "call-1,call-2,call-3,call-4", "tool calls were not executed exactly once");
assert(maxActive === 2, `same-turn shared tools did not execute in parallel: max=${maxActive}`);
const namedChoice = namedPayloads[0]?.tool_choice as { type?: string; function?: { name?: string } } | undefined;
assert(
  namedChoice?.type === "function" && namedChoice.function?.name === "contract_tool",
  `named tool_choice was rewritten or lost: ${JSON.stringify(namedPayloads[0]?.tool_choice)}`,
);
const namedWire = JSON.stringify(namedPayloads);
for (const id of ["call-1", "call-2", "call-3", "call-4"]) {
  assert(namedWire.includes(`\"tool_call_id\":\"${id}\"`), `tool result lost correlation ID ${id}`);
  assert(namedWire.includes(`result:${id}:`), `tool result for ${id} was not replayed to the model`);
}
const namedHistory = JSON.stringify(namedAgent.state.messages);
assert(namedHistory.includes("select the first tool"), "assistant reasoning was lost from host history");
assert(namedHistory.includes("\"type\":\"toolCall\"") && namedHistory.includes("\"role\":\"toolResult\""), "tool history was not preserved beside reasoning");
const namedLast = namedAgent.state.messages.at(-1);
assert(namedLast?.role === "assistant", "named tool loop did not finish with an assistant answer");
assert(JSON.stringify(namedLast.content).includes("all tools complete"), "named tool loop lost the final answer");

const autoPayloads: Record<string, unknown>[] = [];
let autoRequest = 0;
const autoFetch: typeof fetch = async (_input, init) => {
  autoPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  const request = autoRequest++;
  if (request === 0) {
    return sse([
      chunk({ tool_calls: [{ index: 0, id: "call-auto", type: "function", function: { name: "contract_tool", arguments: "{\"value\":5}" } }] }, "tool_calls"),
    ]);
  }
  if (request === 1) return sse([chunk({ content: "auto complete" }), chunk({}, "stop")]);
  throw new Error(`unexpected auto-tool request ${request}`);
};
const autoAgent = new Agent({
  initialState: { model, tools: [tool] },
  streamFn: (target, context, options) => streamSimple(target, context, {
    ...options,
    apiKey: "contract-key",
    fetch: autoFetch,
  }),
});
await autoAgent.prompt("Choose the tool automatically.", { toolChoice: "auto" });
assert(autoRequest === 2, `auto tool loop stopped after ${autoRequest} requests`);
assert(autoPayloads[0]?.tool_choice === "auto", "auto tool_choice was rewritten or lost");
assert(JSON.stringify(autoPayloads[1]?.messages).includes("call-auto"), "auto tool result was not correlated in replay");
assert(JSON.stringify(autoAgent.state.messages.at(-1)?.content).includes("auto complete"), "auto tool loop lost the final answer");

console.log("OK: real OMP Agent loop handles named/auto, streamed args, sequential, parallel multi-tool, correlation, and final answer");
