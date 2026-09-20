import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
// M4 exercises the host credential/UsageProvider boundary. Billing deliberately
// remains pending while session_start must return immediately.
const authDir = join(tmpdir(), `workbuddy-session-start-${process.pid}`);
await mkdir(authDir, { recursive: true });
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = authDir;

let fetchCalls = 0;
let releaseBilling!: (response: Response) => void;
const authStorage = await AuthStorage.create(join(authDir, "auth.db"), {
  usageFetch: async () => {
    fetchCalls += 1;
    return new Promise<Response>((resolve) => {
      releaseBilling = resolve;
    });
  },
});
await authStorage.set("workbuddy", {
  type: "oauth",
  access: "host-access",
  refresh: "host-refresh",
  expires: Date.now() + 60 * 60 * 1000,
  accountId: "host-account",
});
const modelRegistry = new ModelRegistry(authStorage, join(authDir, "models.yml"), {
  cacheDbPath: join(authDir, "models.db"),
});
try {

  const ext: any = await import("../extensions/workbuddy.ts");
  const handlers: Record<string, Function[]> = {};
  const pi: any = {
    on: (name: string, fn: Function) => { (handlers[name] ??= []).push(fn); },
    registerProvider: (name: string, config: unknown) => modelRegistry.registerProvider(name, config as never),
    unregisterProvider: () => {},
    registerCommand: () => {},
  };
  await ext.default(pi);
  const start = handlers.session_start?.[0];
  if (!start) throw new Error("no session_start handler");

  const ui = { setWidget() {}, setStatus() {}, notify() {} };
  const context = {
    hasUI: true,
    model: { provider: "workbuddy" },
    ui,
    modelRegistry,
    sessionManager: { getSessionId: () => "session-start-contract" },
  };
  const result = await Promise.race([
    start({}, context),
    sleep(100, Symbol.for("timed-out")),
  ]);
  if (result === Symbol.for("timed-out")) {
    throw new Error("session_start is blocked by the WorkBuddy network request");
  }
  for (let attempt = 0; attempt < 50 && fetchCalls === 0; attempt += 1) await sleep(1);
  if (fetchCalls !== 1) throw new Error(`host UsageProvider started ${fetchCalls} Billing request(s)`);
  releaseBilling(Response.json({
    code: 0,
    data: { Response: { Data: { Accounts: [] } } },
  }));
  console.log("OK: session_start returns without waiting for host Billing");
} finally {
  authStorage.close();
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  await rm(authDir, { recursive: true, force: true });
}
