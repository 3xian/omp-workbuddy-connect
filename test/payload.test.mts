import {
  asProviderPayload,
  normalizeNamedToolChoice,
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
assert(JSON.stringify(native) === before, "payload parsing changed host-generated fields");
const normalized = normalizeNamedToolChoice(native);
assert(normalized !== native, "named tool choice did not create a compatibility copy");
assert(normalized.tool_choice === "lookup", "named tool choice was not encoded as the Gateway string name");
assert(native.tool_choice.function.name === "lookup", "named tool compatibility mutated the host payload");
const automatic = { model: "contract-active", tool_choice: "auto", messages: [] };
assert(normalizeNamedToolChoice(automatic) === automatic, "string tool choice was needlessly copied");
const unrelated = { model: "contract-active", tool_choice: { type: "custom", function: { name: "lookup" } } };
assert(normalizeNamedToolChoice(unrelated) === unrelated, "non-function choice was needlessly rewritten");

const stringPayload = asProviderPayload(JSON.stringify(native));
assert(stringPayload?.model === native.model, "serialized host payload did not parse");
assert(asProviderPayload("{") === undefined, "invalid JSON payload was accepted");
assert(asProviderPayload([]) === undefined && asProviderPayload(null) === undefined, "non-object payload was accepted");

console.log("OK: payload boundary preserves host semantics except the evidenced named tool_choice string delta");
