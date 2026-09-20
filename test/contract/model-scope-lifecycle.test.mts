import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Model } from "@oh-my-pi/pi-ai";
import type { ModelRegistry as ModelRegistryType } from "@oh-my-pi/pi-coding-agent/config/model-registry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const temp = await mkdtemp(join(tmpdir(), "workbuddy-model-scope-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousProductConfig = process.env.WORKBUDDYAI_PRODUCT_CONFIG;
const productConfigPath = join(temp, "product-config.json");
const settingsPath = join(temp, ".workbuddy-settings.json");
process.env.PI_CODING_AGENT_DIR = temp;
process.env.WORKBUDDYAI_PRODUCT_CONFIG = productConfigPath;
const { AuthStorage, streamSimple } = await import("@oh-my-pi/pi-ai");
const { unregisterOAuthProvider } = await import("@oh-my-pi/pi-ai/registry/oauth");
const { ModelRegistry } = await import("@oh-my-pi/pi-coding-agent/config/model-registry");

const realSample: unknown = JSON.parse(
  await readFile(new URL("../fixtures/desktop-product-config-real-sample.json", import.meta.url), "utf8"),
);
assert(
  typeof realSample === "object" && realSample !== null && "models" in realSample && Array.isArray(realSample.models),
  "real Desktop cache sample has an invalid root",
);
const realModels: unknown[] = realSample.models;
await writeFile(productConfigPath, `${JSON.stringify(realSample, null, 2)}\n`);

const authStorage = await AuthStorage.create(join(temp, "auth.db"));
const registry = new ModelRegistry(authStorage, join(temp, "models.yml"), {
  cacheDbPath: join(temp, "models.db"),
});
const expires = Date.now() + 60 * 60 * 1000;
authStorage.set("workbuddy", {
  type: "oauth",
  access: "scope-access",
  refresh: "scope-refresh",
  expires,
  accountId: "scope-account",
  orgId: "scope-org",
});
const credentialBefore = JSON.stringify(authStorage.get("workbuddy"));
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json({
  code: 0,
  data: { Response: { Data: { Accounts: [] } } },
});

const handlers: Record<string, Function[]> = {};
let command: ((args: unknown, ctx: any) => Promise<void>) | undefined;
let failNextRegister = false;
const pi: any = {
  on(name: string, handler: Function) {
    (handlers[name] ??= []).push(handler);
  },
  unregisterProvider(name: string) {
    registry.unregisterProvider(name);
  },
  registerProvider(name: string, config: Parameters<ModelRegistryType["registerProvider"]>[1]) {
    if (failNextRegister) {
      failNextRegister = false;
      throw new Error("simulated registration failure");
    }
    registry.registerProvider(name, config);
  },
  registerCommand(name: string, definition: { handler(args: unknown, ctx: any): Promise<void> }) {
    if (name === "workbuddy") command = definition.handler;
  },
};

const widgets: Array<string[] | undefined> = [];
const notifications: Array<{ message: string; type?: string }> = [];
const ctx: any = {
  model: undefined,
  modelRegistry: registry,
  sessionManager: { getSessionId: () => "scope-contract" },
  ui: {
    setWidget(_key: string, content: string[] | undefined) { widgets.push(content); },
    setStatus() {},
    notify(message: string, type?: string) { notifications.push({ message, type }); },
    async select() { return undefined; },
  },
};

try {
  const extension = await import("../../extensions/workbuddy.ts");
  await extension.default(pi);
  assert(command, "extension did not register /workbuddy");
  const sessionStart = handlers.session_start?.[0];
  assert(sessionStart, "extension did not register session_start");
  await sessionStart({}, ctx);
  await command("all", ctx);

  const deepseek = registry.find("workbuddy", "deepseek-v4.1-flash");
  const hy4 = registry.find("workbuddy", "hy4-preview-f");
  const hy3 = registry.find("workbuddy", "hy3");
  const retained = registry.find("workbuddy", "fast-model");
  assert(deepseek && hy4 && hy3 && retained, "real Desktop cache sample did not register every model in all scope");
  assert(deepseek.contextWindow === 1_000_000 && deepseek.maxTokens === 16_384, "Deepseek real budgets or safety clamp changed");
  assert(deepseek.input.includes("image") && deepseek.reasoning, "Deepseek real Vision/reasoning metadata changed");
  assert(hy4.contextWindow === 1_000_000 && hy4.maxTokens === 64_000, "Hy4 real budgets changed");
  assert(hy4.thinking?.efforts.join(",") === "high" && hy4.thinking.requiresEffort, "Hy4 real thinking metadata changed");
  assert(hy3.contextWindow === 192_000 && hy3.maxTokens === 64_000, "Hy3 real budgets changed");
  assert(hy3.thinking?.efforts.join(",") === "low,high" && hy3.thinking.requiresEffort, "Hy3 real thinking metadata changed");
  assert(retained.contextWindow === 200_000 && retained.maxTokens === 32_000 && retained.input.includes("image"), "paid real model metadata changed");
  assert(widgets.some((lines) => lines?.some((line) => line === "目录  desktop-cache")), "widget did not expose the Desktop cache source");
  assert(JSON.parse(await readFile(settingsPath, "utf8")).scope === "all", "all scope was not persisted");

  ctx.model = retained;
  failNextRegister = true;
  await command("free", ctx);
  assert(registry.find("workbuddy", "fast-model"), "registration failure did not restore the previous provider");
  assert(JSON.parse(await readFile(settingsPath, "utf8")).scope === "all", "registration failure persisted an uncommitted scope");
  assert(notifications.at(-1)?.type === "error", "registration failure was falsely reported as success");

  await chmod(settingsPath, 0o400);
  await command("free", ctx);
  await chmod(settingsPath, 0o600);
  assert(registry.find("workbuddy", "fast-model"), "settings failure did not restore the previous provider");
  assert(JSON.parse(await readFile(settingsPath, "utf8")).scope === "all", "settings failure changed the committed scope");
  assert(notifications.at(-1)?.type === "error", "settings failure was falsely reported as success");

  const paidModel = realModels.find(
    (model) => typeof model === "object" && model !== null && "id" in model && model.id === "fast-model",
  );
  assert(paidModel, "real paid model evidence is missing");
  await writeFile(productConfigPath, `${JSON.stringify({ models: [paidModel] }, null, 2)}\n`);
  await command("free", ctx);
  assert(!registry.getAll().some((model) => model.provider === "workbuddy"), "empty free scope retained stale WorkBuddy models");
  assert(JSON.parse(await readFile(settingsPath, "utf8")).scope === "free", "empty free scope was not persisted");
  assert(notifications.some((item) => item.type === "warning" && item.message.includes("重新选择模型")), "removed current model did not prompt reselection");
  assert(widgets.at(-1)?.some((line) => line === "模型  （当前范围为空）"), "empty scope was not explicit in the widget");

  const hook = handlers.before_provider_request?.[0];
  assert(hook, "extension did not register its request guard");
  let chatRequests = 0;
  const chatFetch: typeof fetch = async () => {
    chatRequests += 1;
    return new Response(null, { status: 500 });
  };
  const chatContext: Context = {
    messages: [{ role: "user", content: "must be blocked", timestamp: Date.now() }],
  };
  const stream = streamSimple(retained as Model, chatContext, {
    apiKey: "scope-access",
    fetch: chatFetch,
    onPayload: (payload) => hook({ type: "before_provider_request", payload }),
  });
  for await (const _event of stream) {
    // Drain the real OMP transport; the extension hook must stop it before fetch.
  }
  const blocked = await stream.result();
  assert(blocked.stopReason === "error" && blocked.errorMessage?.includes("outside the active"), "retained model was not blocked before transport");
  assert(chatRequests === 0, `retained model reached WorkBuddy HTTP ${chatRequests} time(s)`);
  assert(JSON.stringify(authStorage.get("workbuddy")) === credentialBefore, "scope changes modified the OMP credential row");

  const restartHandlers: Record<string, Function[]> = {};
  const restartPi = {
    ...pi,
    on(name: string, handler: Function) {
      (restartHandlers[name] ??= []).push(handler);
    },
    registerCommand() {},
  };
  await extension.default(restartPi as never);
  assert(!registry.getAll().some((model) => model.provider === "workbuddy"), "restart widened an authoritative empty free scope");
  assert(JSON.stringify(authStorage.get("workbuddy")) === credentialBefore, "restart registration modified the OMP credential row");

  console.log("OK: M2 real catalog metadata, transactional scope, retained-model guard, restart, and credential invariants");
} finally {
  unregisterOAuthProvider("workbuddy");
  globalThis.fetch = previousFetch;
  authStorage.close();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousProductConfig === undefined) delete process.env.WORKBUDDYAI_PRODUCT_CONFIG;
  else process.env.WORKBUDDYAI_PRODUCT_CONFIG = previousProductConfig;
  await rm(temp, { recursive: true, force: true });
}
