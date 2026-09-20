import type { Model } from "@oh-my-pi/pi-ai";
import { ExtensionRunner } from "../../node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/runner.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const requestModel = {
  id: "same-id",
  provider: "foreign",
  api: "openai-completions",
} as Model;
const payload = { model: "same-id", messages: [] };
let observedModel: Model | undefined;
const extension = {
  path: "contract-before-provider-request",
  handlers: new Map([
    ["before_provider_request", [(_event: unknown, ctx: { model?: Model }) => {
      observedModel = ctx.model;
      throw new Error("hook cannot enforce fail-closed transport");
    }]],
  ]),
};
const runner = new ExtensionRunner(
  [extension] as never,
  {} as never,
  process.cwd(),
  { getCwd: () => process.cwd(), getSessionId: () => "contract-session" } as never,
  {} as never,
);
let extensionErrors = 0;
runner.onError(() => { extensionErrors += 1; });

const result = await runner.emitBeforeProviderRequest(payload, requestModel);
assert(observedModel === requestModel, "request-bound model was not exposed as ctx.model");
assert(result === payload, "a throwing hook unexpectedly blocked or replaced the provider payload");
assert(extensionErrors === 1, "the host did not report the swallowed hook failure");

console.log("OK: OMP request hooks receive the exact request model and swallow handler failures");
