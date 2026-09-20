export type ProviderPayload = Record<string, unknown>;

/** Parse the host hook payload without changing its fields or semantics. */
export function asProviderPayload(payload: unknown): ProviderPayload | undefined {
  let value = payload;
  if (typeof payload === "string") {
    try {
      value = JSON.parse(payload) as unknown;
    } catch {
      return undefined;
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ProviderPayload
    : undefined;
}


/**
 * WorkBuddy Gateway code 11101 rejects OpenAI's named-choice object because
 * its `tool_choice` field is a string. Preserve every other host-owned field.
 */
export function normalizeNamedToolChoice(payload: ProviderPayload): ProviderPayload {
  const choice = payload.tool_choice;
  if (typeof choice !== "object" || choice === null || Array.isArray(choice)) return payload;
  if ((choice as Record<string, unknown>).type !== "function") return payload;
  const fn = (choice as Record<string, unknown>).function;
  if (typeof fn !== "object" || fn === null || Array.isArray(fn)) return payload;
  const name = (fn as Record<string, unknown>).name;
  if (typeof name !== "string" || name.length === 0) return payload;
  return { ...payload, tool_choice: name };
}

