import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const temp = await mkdtemp(join(tmpdir(), "workbuddy-settings-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = temp;

try {
  const settings = await import("../src/settings.ts");
  const path = join(temp, ".workbuddy-settings.json");
  assert(settings.workBuddySettingsPath() === path, "settings did not honor OMP's public agent directory");
  assert(settings.loadSettings().scope === "free", "missing settings did not use safe free scope");

  await settings.saveSettings("all");
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  assert(typeof parsed === "object" && parsed !== null && "scope" in parsed && parsed.scope === "all", "saved scope was not readable");
  assert(Object.keys(parsed).join(",") === "scope", `settings persisted fields other than scope: ${raw}`);
  assert(!raw.includes("token") && !raw.includes("credential") && !raw.includes("secret"), "settings persisted credential material");
  assert(((await stat(path)).mode & 0o777) === 0o600, "settings permissions are not 0600");

  await settings.saveSettings("free");
  assert(settings.loadSettings().scope === "free", "free scope did not survive restart load");
  console.log("OK: settings use OMP agent dir, persist scope only, and enforce 0600");
} finally {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(temp, { recursive: true, force: true });
}
