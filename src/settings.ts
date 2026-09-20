import { readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import type { ModelScope } from "./models.ts";

export interface WorkBuddySettings {
  scope: ModelScope;
}

export function workBuddySettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, ".workbuddy-settings.json");
}

export function loadSettings(agentDir = getAgentDir()): WorkBuddySettings {
  try {
    const value: unknown = JSON.parse(readFileSync(workBuddySettingsPath(agentDir), "utf8"));
    if (typeof value === "object" && value !== null && "scope" in value && value.scope === "all") {
      return { scope: "all" };
    }
  } catch { /* Missing or invalid settings use the safe free scope. */ }
  return { scope: "free" };
}

export async function saveSettings(scope: ModelScope, agentDir = getAgentDir()): Promise<void> {
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const path = workBuddySettingsPath(agentDir);
  await writeFile(path, `${JSON.stringify({ scope }, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
