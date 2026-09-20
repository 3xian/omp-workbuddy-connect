import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

function record(event: Record<string, unknown>): void {
  const target = process.env.WORKBUDDY_TASK_CONTRACT_LOG;
  if (!target) throw new Error("WORKBUDDY_TASK_CONTRACT_LOG is required");
  appendFileSync(target, `${JSON.stringify(event)}\n`);
}

export default function taskObserver(pi: ExtensionAPI): void {
  const instance = randomUUID();
  record({ event: "factory", instance });

  pi.on("session_start", (_event, ctx) => {
    record({
      event: "session_start",
      instance,
      hasUI: ctx.hasUI,
      provider: ctx.model?.provider,
      model: ctx.model?.id,
    });
  });

  pi.on("before_provider_request", (event) => {
    const payload = typeof event.payload === "object" && event.payload !== null
      ? event.payload as Record<string, unknown>
      : {};
    record({ event: "before_provider_request", instance, model: payload.model, stream: payload.stream });
  });

  pi.on("session_shutdown", () => {
    record({ event: "session_shutdown", instance });
  });
}
