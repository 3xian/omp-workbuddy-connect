import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage, streamSimple, type Context } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { prepareChatPayload } from "../extensions/workbuddy.ts";
import { buildOmpModels, parseProductConfig } from "../src/models.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const config = parseProductConfig(JSON.stringify({
  models: [{
    id: "deepseek-v4.1-flash",
    name: "Vision Reasoning",
    credits: "x0.00",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    supportsImages: true,
    supportsReasoning: true,
    reasoning: {
      supportedEfforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
      canDisableThinking: false,
    },
  }],
}));
assert(config, "integration product catalog did not parse");
const models = buildOmpModels(config, "all");
const temp = await mkdtemp(join(tmpdir(), "workbuddy-model-contract-"));
const authStorage = await AuthStorage.create(join(temp, "auth.db"));
const registry = new ModelRegistry(authStorage, join(temp, "models.yml"), {
  cacheDbPath: join(temp, "models.db"),
});

registry.registerProvider("workbuddy", {
  baseUrl: "https://gateway.invalid/v2",
  api: "openai-completions",
  apiKey: "contract-key",
  models,
});
const model = registry.find("workbuddy", "deepseek-v4.1-flash");
assert(model, "OMP ModelRegistry did not resolve the provider model");
assert(model.provider === "workbuddy", `resolved provider missing: ${model.provider}`);
assert(model.api === "openai-completions", `resolved API missing: ${model.api}`);
assert(model.baseUrl === "https://gateway.invalid/v2", `resolved base URL missing: ${model.baseUrl}`);
assert(model.contextWindow === 1_000_000 && model.maxTokens === 16_384, "resolved model budgets disagree with catalog");
assert(model.thinking?.requiresEffort === true, "resolved model lost required thinking metadata");
assert(model.input.includes("image") && model.compat.stripImageInput === false, "resolved model lost vision compatibility");

const payloads: Record<string, unknown>[] = [];
const chatFetch: typeof fetch = async (_input, init) => {
  payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  const now = Math.floor(Date.now() / 1000);
  const body = [
    `data: ${JSON.stringify({ id: "chatcmpl-model-contract", object: "chat.completion.chunk", created: now, model: model.id, choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: "chatcmpl-model-contract", object: "chat.completion.chunk", created: now, model: model.id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
const context: Context = {
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        mimeType: "image/png",
      },
    ],
    timestamp: Date.now(),
  }],
};

async function request(maxTokens: number): Promise<void> {
  const stream = streamSimple(model, context, {
    apiKey: "contract-key",
    fetch: chatFetch,
    maxTokens,
    reasoning: "high" as never,
    onPayload(payload) {
      return prepareChatPayload(payload as Record<string, unknown>);
    },
  });
  for await (const _event of stream) {
    // Drain the actual OMP openai-completions transport.
  }
  const result = await stream.result();
  if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? `unexpected stop: ${result.stopReason}`);
}

try {
  await request(128_000);
  await request(1_024);
  assert(payloads.length === 2, `unexpected request count: ${payloads.length}`);
  assert(payloads[0]?.reasoning_effort === "high", "host transport did not generate standard reasoning_effort");
  assert(payloads[0]?.max_tokens === 16_384, `high request escaped clamp: ${payloads[0]?.max_tokens}`);
  assert(payloads[1]?.max_tokens === 1_024, `small request was raised: ${payloads[1]?.max_tokens}`);
  const wireMessages = JSON.stringify(payloads[0]?.messages);
  assert(wireMessages.includes("image_url"), `real transport stripped image input: ${wireMessages}`);
  assert(wireMessages.includes("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"), "real transport did not encode image data");
  console.log("OK: resolved OMP model drives reasoning, vision, and request token budgets");
} finally {
  authStorage.close();
  await rm(temp, { recursive: true, force: true });
}
