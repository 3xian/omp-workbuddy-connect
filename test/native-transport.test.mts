import { setTimeout as sleep } from "node:timers/promises";
import { streamSimple, type Context, type Model } from "@oh-my-pi/pi-ai";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const model: Model<"openai-completions"> = {
  id: "transport-contract",
  name: "Transport Contract",
  api: "openai-completions",
  provider: "workbuddy",
  baseUrl: "https://gateway.invalid/v2",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
  compat: {
    supportsDeveloperRole: true,
    supportsReasoningEffort: true,
    supportsToolChoice: true,
    supportsForcedToolChoice: true,
    supportsNamedToolChoice: true,
  },
};
const context: Context = {
  messages: [{ role: "user", content: [{ type: "text", text: "transport" }], timestamp: Date.now() }],
};

function response(chunks: unknown[]): Response {
  const body = [...chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`), "data: [DONE]\n\n"].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
function chunk(delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, number>) {
  return {
    id: "chatcmpl-transport-contract",
    object: "chat.completion.chunk",
    created: 1,
    model: model.id,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}
async function drain(fetchImpl: typeof fetch, signal?: AbortSignal) {
  const stream = streamSimple(model, context, {
    apiKey: "contract-key",
    fetch: fetchImpl,
    signal,
    reasoning: "high",
  });
  const events: string[] = [];
  for await (const event of stream) events.push(event.type);
  return { events, result: await stream.result() };
}

const normal = await drain(async () => response([
  chunk({ reasoning_content: "inspect" }),
  chunk({ content: "answer" }),
  chunk({}, "stop", { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }),
]));
assert(normal.result.stopReason === "stop", `normal stream failed: ${normal.result.errorMessage}`);
assert(normal.events.includes("thinking_delta"), "native stream lost reasoning delta");
assert(normal.events.includes("text_delta"), "native stream lost text delta");
assert(normal.events.at(-1) === "done", `native stream did not terminate on DONE: ${normal.events.join(",")}`);
const normalWire = JSON.stringify(normal.result);
assert(normalWire.includes("inspect") && normalWire.includes("answer"), "native stream lost final reasoning or text");
assert(normalWire.includes("\"input\":3") && normalWire.includes("\"output\":2"), `native usage was not mapped: ${normalWire}`);

const badRequest = await drain(async () => new Response(
  JSON.stringify({ error: { message: "bad gateway field", type: "invalid_request_error", code: "bad_field" } }),
  { status: 400, headers: { "content-type": "application/json", "request-id": "req-contract-400" } },
));
assert(badRequest.result.stopReason === "error", `HTTP 400 did not become an error result: ${badRequest.result.stopReason}`);
assert(badRequest.events.at(-1) === "error", "HTTP 400 did not emit a terminal error event");
assert(badRequest.result.errorMessage?.includes("bad gateway field"), `HTTP 400 lost server diagnostics: ${badRequest.result.errorMessage}`);

const controller = new AbortController();
let abortFetchStarted = false;
const abortPromise = drain(async (_input, init) => {
  abortFetchStarted = true;
  return await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}, controller.signal);
while (!abortFetchStarted) await sleep(0);
controller.abort();
const aborted = await abortPromise;
assert(aborted.result.stopReason === "aborted", `AbortSignal did not stop the request: ${aborted.result.stopReason}`);
assert(aborted.events.at(-1) === "error", "aborted request did not emit a terminal event");

let retryAttempts = 0;
const retried = await drain(async () => {
  retryAttempts += 1;
  if (retryAttempts === 1) {
    return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), {
      status: 503,
      headers: { "content-type": "application/json", "retry-after": "0" },
    });
  }
  return response([chunk({ content: "recovered" }), chunk({}, "stop")]);
});
assert(retryAttempts === 2, `native transport did not perform one transient retry: ${retryAttempts}`);
assert(retried.result.stopReason === "stop", `retry did not recover: ${retried.result.errorMessage}`);
assert(JSON.stringify(retried.result.content).includes("recovered"), "retry recovery lost the final content");

console.log("OK: native openai-completions handles reasoning/text/usage/DONE, diagnostics, AbortSignal, and transient retry");
