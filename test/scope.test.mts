import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const temp = await mkdtemp(join(tmpdir(), "workbuddy-payload-scope-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousProductConfig = process.env.WORKBUDDYAI_PRODUCT_CONFIG;
const productConfigPath = join(temp, "product-config.json");
process.env.PI_CODING_AGENT_DIR = temp;
process.env.WORKBUDDYAI_PRODUCT_CONFIG = productConfigPath;
await writeFile(productConfigPath, JSON.stringify({
  models: [{
    id: "contract-active",
    name: "Contract Active",
    credits: "x0.00",
    maxInputTokens: 32_000,
    maxOutputTokens: 4_096,
    supportsImages: false,
    supportsReasoning: true,
    reasoning: { supportedEfforts: ["low"], canDisableThinking: true },
  }],
}));

const { refreshDirsFromEnv } = await import("@oh-my-pi/pi-utils");
refreshDirsFromEnv();

try {
  const ext: any = await import("../extensions/workbuddy.ts");
  const handlers: Record<string, Function[]> = {};
  const pi: any = {
    on: (name: string, fn: Function) => { (handlers[name] ??= []).push(fn); },
    registerProvider: () => {},
    unregisterProvider: () => {},
    registerCommand: () => {},
  };
  await ext.default(pi);
  const hook = handlers.before_provider_request?.[0];
  assert(hook, "no before_provider_request handler");

  const foreign = {
    model: "grok-4.6",
    messages: [
      { role: "developer", content: "You are Grok." },
      { role: "assistant", content: "answer", reasoning: "private host state" },
      { role: "user", content: "hi" },
    ],
    stream: false,
    max_tokens: 777,
    reasoning_effort: "low",
    tool_choice: { type: "function", function: { name: "bash" } },
    tools: [{ type: "function", function: { name: "bash" } }],
    provider_specific_field: { keep: true },
  };
  const foreignBefore = JSON.stringify(foreign);
  assert(hook({ type: "before_provider_request", payload: foreign }) === undefined, "foreign payload was replaced");
  assert(JSON.stringify(foreign) === foreignBefore, "foreign payload fields were changed");

  const active = { ...foreign, model: "contract-active" };
  const activeBefore = JSON.stringify(active);
  const activeResult = hook({ type: "before_provider_request", payload: active });
  assert(activeResult === active, "active WorkBuddy payload identity changed");
  assert(JSON.stringify(active) === activeBefore, "active WorkBuddy payload fields were changed");

  console.log("OK: hook recognizes the active ID and leaves active and nonmatching payloads byte-equivalent");
} finally {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousProductConfig === undefined) delete process.env.WORKBUDDYAI_PRODUCT_CONFIG;
  else process.env.WORKBUDDYAI_PRODUCT_CONFIG = previousProductConfig;
  refreshDirsFromEnv();
  await rm(temp, { recursive: true, force: true });
}
