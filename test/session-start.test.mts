import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
// A legacy credential deliberately remains on disk. M1 must ignore it: only
// the empty OMP AuthStorage below is authoritative, and no Billing call starts.
const authDir = join(tmpdir(), `workbuddy-session-start-${process.pid}`);
await mkdir(authDir, { recursive: true });
await writeFile(join(authDir, ".workbuddy-auth.json"), JSON.stringify({
  version: 1,
  credential: {
    accessToken: "test-token",
    refreshToken: "",
    expiresAtMs: Date.now() + 60 * 60 * 1000,
    domain: "",
    uid: "test-user",
  },
}));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = authDir;

const authStorage = await AuthStorage.create(join(authDir, "auth.db"));
const modelRegistry = new ModelRegistry(authStorage, join(authDir, "models.yml"), {
  cacheDbPath: join(authDir, "models.db"),
});
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
try {
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  };

  const ext: any = await import("../extensions/workbuddy.ts");
  const handlers: Record<string, Function[]> = {};
  const pi: any = {
    on: (name: string, fn: Function) => { (handlers[name] ??= []).push(fn); },
    registerProvider: () => {},
    registerCommand: () => {},
  };
  await ext.default(pi);
  const start = handlers.session_start?.[0];
  if (!start) throw new Error("no session_start handler");

  const ui = { setWidget() {}, setStatus() {}, notify() {} };
  const context = {
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
  await Promise.resolve();
  if (fetchCalls !== 0) throw new Error(`legacy credential triggered ${fetchCalls} network request(s)`);
  console.log("OK: session_start returns without waiting for WorkBuddy network");
} finally {
  authStorage.close();
  globalThis.fetch = originalFetch;
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  await rm(authDir, { recursive: true, force: true });
}
