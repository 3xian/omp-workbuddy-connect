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

export function payloadModelId(payload: ProviderPayload): string | undefined {
  return typeof payload.model === "string" ? payload.model : undefined;
}

/** The OMP 18.2.6 hook has no provider identity, so matching is intentionally ID-only. */
export function isCurrentWorkBuddyPayload(
  payload: ProviderPayload,
  activeIds: ReadonlySet<string>,
): boolean {
  const modelId = payloadModelId(payload);
  return modelId !== undefined && activeIds.has(modelId);
}
