import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface PendingBilling {
  account: string | null;
  resolve(response: Response): void;
}

const temp = await mkdtemp(join(tmpdir(), "workbuddy-ui-"));
const productConfig = join(temp, "product-config.json");
await writeFile(productConfig, JSON.stringify({
  models: [{
    id: "ui-model",
    name: "UI Model",
    credits: "x1.00",
    maxInputTokens: 32_000,
    maxOutputTokens: 4_096,
    supportsReasoning: false,
  }],
}));
await writeFile(join(temp, ".workbuddy-settings.json"), JSON.stringify({ scope: "all" }));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousProductConfig = process.env.WORKBUDDYAI_PRODUCT_CONFIG;
process.env.PI_CODING_AGENT_DIR = temp;
process.env.WORKBUDDYAI_PRODUCT_CONFIG = productConfig;
const { refreshDirsFromEnv } = await import("@oh-my-pi/pi-utils");
refreshDirsFromEnv();

const pending: PendingBilling[] = [];
let billingCalls = 0;
const authStorage = await AuthStorage.create(join(temp, "auth.db"), {
  usageFetch: async (_input, init) => {
    billingCalls += 1;
    return new Promise<Response>((resolve) => {
      pending.push({ account: new Headers(init?.headers).get("x-user-id"), resolve });
    });
  },
  usageRequestTimeoutMs: 5_000,
});
const registry = new ModelRegistry(authStorage, join(temp, "models.yml"), {
  cacheDbPath: join(temp, "models.db"),
});
const credential = (accountId: string, email?: string) => ({
  type: "oauth" as const,
  access: `access-${accountId}`,
  refresh: `refresh-${accountId}`,
  expires: Date.now() + 60 * 60 * 1000,
  accountId,
  ...(email ? { email } : {}),
});
await authStorage.set("workbuddy", credential("account-a", "employee@example.com"));

const handlers: Record<string, Function[]> = {};
let command: ((args: unknown, ctx: any) => Promise<void>) | undefined;
const pi = {
  on(name: string, handler: Function) { (handlers[name] ??= []).push(handler); },
  registerProvider(name: string, config: unknown) { registry.registerProvider(name, config as never); },
  unregisterProvider(name: string) { registry.unregisterProvider(name); },
  registerCommand(name: string, definition: { handler(args: unknown, ctx: any): Promise<void> }) {
    if (name === "workbuddy") command = definition.handler;
  },
};
const widgets: Array<string[] | undefined> = [];
const statuses: Array<string | undefined> = [];
const notifications: string[] = [];
const ui = {
  setWidget(_key: string, value: string[] | undefined) { widgets.push(value); },
  setStatus(_key: string, value: string | undefined) { statuses.push(value); },
  notify(message: string) { notifications.push(message); },
};
const ctx: any = {
  hasUI: true,
  model: { provider: "workbuddy", id: "ui-model" },
  modelRegistry: registry,
  sessionManager: { getSessionId: () => "ui-session" },
  ui,
};

function billingResponse(remaining: number): Response {
  return Response.json({
    code: 0,
    data: {
      Response: {
        Data: {
          Accounts: [{
            PackageName: "Free Plan Subscription",
            CycleCapacitySize: 100,
            CycleCapacityRemain: remaining,
          }],
        },
      },
    },
  });
}

async function waitForCalls(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && billingCalls < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert(billingCalls === expected, `expected ${expected} Billing calls, observed ${billingCalls}`);
}

try {
  const extension = await import("../extensions/workbuddy.ts");
  await extension.default(pi as never);
  const sessionStart = handlers.session_start?.[0];
  const sessionSwitch = handlers.session_switch?.[0];
  const turnStart = handlers.turn_start?.[0];
  const sessionShutdown = handlers.session_shutdown?.[0];
  assert(sessionStart && sessionSwitch && turnStart && sessionShutdown && command, "management handlers were not registered");

  const startResult = await sessionStart({}, ctx);
  assert(startResult === undefined, "session_start awaited optional Billing");
  await waitForCalls(1);
  assert(widgets.at(-1)?.some((line) => line === "积分  查询中"), "startup did not expose the pending state");
  assert(widgets.at(-1)?.some((line) => line === "账号  em***@example.com"), "email identity was not rendered redacted");
  assert(!widgets.at(-1)?.some((line) => line.includes("employee@example.com")), "email identity leaked into the Widget");

  await authStorage.remove("workbuddy");
  await authStorage.set("workbuddy", credential("account-b"));
  await sessionSwitch({}, ctx);
  await waitForCalls(2);
  assert(pending[0]?.account === "account-a" && pending[1]?.account === "account-b", "account switch used the wrong host identity");
  const widgetsBeforeLateA = widgets.length;
  pending[0]!.resolve(billingResponse(99));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(widgets.length === widgetsBeforeLateA, "late account A result repainted account B UI");
  pending[1]!.resolve(billingResponse(8));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(widgets.at(-1)?.some((line) => line === "账号  acco…nt-b"), "account B identity was not rendered redacted");
  assert(!widgets.at(-1)?.some((line) => line.includes("account-b")), "account B identity leaked into the Widget");
  assert(widgets.at(-1)?.some((line) => line === "积分  合计 8"), "account B credits were not rendered");

  const statusPromise = command("", ctx);
  await waitForCalls(3);
  pending[2]!.resolve(billingResponse(7));
  await statusPromise;
  const statusLines = widgets.at(-1) ?? [];
  for (const field of ["登录  ", "账号  ", "积分  ", "套餐  ", "范围  ", "模型数  ", "目录  ", "Provider  "]) {
    assert(statusLines.some((line) => line.startsWith(field)), `/workbuddy omitted ${field.trim()}`);
  }

  await authStorage.invalidateUsageCache("workbuddy");
  const staleScopeRefresh = command("", ctx);
  await waitForCalls(4);
  const scopeChange = command("free", ctx);
  await waitForCalls(5);
  pending[3]!.resolve(billingResponse(66));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(!widgets.at(-1)?.some((line) => line === "积分  合计 66"), "old-scope result repainted the new scope");
  pending[4]!.resolve(billingResponse(5));
  await Promise.all([staleScopeRefresh, scopeChange]);
  assert(widgets.at(-1)?.some((line) => line === "范围  free"), "free command did not update scope display");
  assert(widgets.at(-1)?.some((line) => line === "模型数  0"), "free command did not display the empty scope");

  await authStorage.invalidateUsageCache("workbuddy");
  await turnStart({}, ctx);
  await waitForCalls(6);
  await turnStart({}, { ...ctx, model: { provider: "openai", id: "gpt" } });
  pending[5]!.resolve(billingResponse(6));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(widgets.at(-1) === undefined && statuses.at(-1) === undefined, "late result restored UI after leaving WorkBuddy");

  const callsBeforeHeadless = billingCalls;
  const headlessUi = new Proxy({}, {
    get() { throw new Error("headless UI access"); },
  });
  const headlessCtx = { ...ctx, hasUI: false, ui: headlessUi, model: { provider: "workbuddy", id: "ui-model" } };
  await sessionSwitch({}, headlessCtx);
  await turnStart({}, headlessCtx);
  await command("", headlessCtx);
  assert(billingCalls === callsBeforeHeadless, "headless lifecycle started optional Billing or touched UI");

  const throwingCtx = {
    ...ctx,
    model: { provider: "workbuddy", id: "ui-model" },
    ui: {
      setWidget() { throw new Error("widget failure"); },
      setStatus() { throw new Error("status failure"); },
      notify() { throw new Error("notify failure"); },
    },
  };
  await turnStart({}, throwingCtx);
  await sessionShutdown({}, throwingCtx);
  assert(notifications.some((message) => message.includes("状态已更新")), "/workbuddy did not report status completion");

  console.log("OK: commands, generation guards, optional UI failures, and headless isolation");
} finally {
  authStorage.close();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousProductConfig === undefined) delete process.env.WORKBUDDYAI_PRODUCT_CONFIG;
  else process.env.WORKBUDDYAI_PRODUCT_CONFIG = previousProductConfig;
  refreshDirsFromEnv();
  await rm(temp, { recursive: true, force: true });
}
