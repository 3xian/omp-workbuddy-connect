import {
  asProviderPayload,
  isCurrentWorkBuddyPayload,
  payloadModelId,
} from "../src/payload.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const native = {
  model: "contract-active",
  messages: [
    { role: "developer", content: "native developer semantics" },
    { role: "assistant", content: "answer", reasoning: "host-owned replay state" },
    { role: "user", content: "continue" },
  ],
  stream: false,
  max_tokens: 777,
  reasoning_effort: "low",
  tools: [{ type: "function", function: { name: "lookup" } }],
  tool_choice: { type: "function", function: { name: "lookup" } },
  unsupported_candidate: "host-owned",
};
const before = JSON.stringify(native);
const parsed = asProviderPayload(native);
assert(parsed === native, "object payload identity changed");
assert(payloadModelId(parsed) === "contract-active", "payload model ID was not read");
assert(isCurrentWorkBuddyPayload(parsed, new Set(["contract-active"])), "active payload was not recognized");
assert(!isCurrentWorkBuddyPayload(parsed, new Set(["other"])), "foreign payload was classified as WorkBuddy");
assert(JSON.stringify(native) === before, "payload parsing changed host-generated fields");

const stringPayload = asProviderPayload(JSON.stringify(native));
assert(stringPayload?.model === native.model, "serialized host payload did not parse");
assert(asProviderPayload("{") === undefined, "invalid JSON payload was accepted");
assert(asProviderPayload([]) === undefined && asProviderPayload(null) === undefined, "non-object payload was accepted");

console.log("OK: payload boundary identifies model scope without rewriting native semantics");
