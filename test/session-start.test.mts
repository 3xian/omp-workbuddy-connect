import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Temporary legacy credential fixture. This test protects only the invariant
// that optional account/credits work cannot block session startup. M1 will
// migrate the fixture to the OMP AuthStorage boundary.
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

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => await new Promise<Response>(() => {});

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
  const result = await Promise.race([
    start({}, { model: { provider: "workbuddy" }, ui }),
    new Promise<symbol>((resolve) => setTimeout(() => resolve(Symbol.for("timed-out")), 100)),
  ]);
  if (result === Symbol.for("timed-out")) {
    throw new Error("session_start is blocked by the WorkBuddy network request");
  }
  console.log("OK: session_start returns without waiting for WorkBuddy network");
} finally {
  globalThis.fetch = originalFetch;
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  await rm(authDir, { recursive: true, force: true });
}
