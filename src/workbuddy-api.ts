import { setTimeout as sleep } from "node:timers/promises";

export const WORKBUDDY_ORIGIN = "https://www.workbuddy.ai";
export const WORKBUDDY_API_BASE = `${WORKBUDDY_ORIGIN}/v2`;
export const WORKBUDDY_USER_AGENT = "CLI/2.63.2 CodeBuddy/2.63.2";

export const WORKBUDDY_PROTOCOL_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Origin: WORKBUDDY_ORIGIN,
  Referer: `${WORKBUDDY_ORIGIN}/`,
  "User-Agent": WORKBUDDY_USER_AGENT,
  "X-Requested-With": "XMLHttpRequest",
  "X-Product": "SaaS",
} as const;

const PLUGIN_AUTH_HEADERS = {
  ...WORKBUDDY_PROTOCOL_HEADERS,
  "X-No-Authorization": "true",
  "X-No-User-Id": "1",
  "X-No-Enterprise-Id": "1",
  "X-No-Department-Info": "1",
} as const;

type JsonRecord = Record<string, unknown>;
type Fetch = typeof globalThis.fetch;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function message(envelope: JsonRecord, fallback: string): string {
  return typeof envelope.msg === "string" && envelope.msg.trim() !== "" ? envelope.msg : fallback;
}

async function responseEnvelope(response: Response, fallback: string): Promise<JsonRecord> {
  let envelope: JsonRecord;
  try {
    envelope = record(await response.json());
  } catch {
    throw new Error(fallback);
  }
  if (!response.ok || envelope.code !== 0) throw new Error(message(envelope, fallback));
  return envelope;
}

export async function startPluginLogin(fetcher: Fetch = globalThis.fetch): Promise<{ state: string; authUrl: string }> {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const response = await fetcher(`${WORKBUDDY_API_BASE}/plugin/auth/state?platform=CLI&nonce=${nonce}`, {
    method: "POST",
    headers: PLUGIN_AUTH_HEADERS,
    body: JSON.stringify({ nonce }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = record((await responseEnvelope(response, "workbuddy login start failed")).data);
  const state = typeof data.state === "string" ? data.state.trim() : "";
  const authUrl = typeof data.authUrl === "string" ? data.authUrl.trim() : "";
  if (state === "" || authUrl === "") throw new Error("workbuddy login start returned incomplete data");
  return { state, authUrl };
}

export async function pollPluginToken(
  state: string,
  fetcher: Fetch = globalThis.fetch,
  now: () => number = Date.now,
): Promise<JsonRecord> {
  const deadline = now() + 15 * 60 * 1000;
  while (now() < deadline) {
    const response = await fetcher(`${WORKBUDDY_API_BASE}/plugin/auth/token?state=${encodeURIComponent(state)}`, {
      headers: PLUGIN_AUTH_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    let envelope: JsonRecord;
    try {
      envelope = record(await response.json());
    } catch {
      throw new Error("workbuddy login returned an invalid response");
    }
    if (response.ok && envelope.code === 11217) {
      await sleep(2_000);
      continue;
    }
    if (!response.ok || envelope.code !== 0) throw new Error(message(envelope, "workbuddy login failed"));
    return record(envelope.data);
  }
  throw new Error("workbuddy login timed out");
}

export async function refreshPluginToken(
  refreshToken: string,
  enterpriseId: string,
  fetcher: Fetch = globalThis.fetch,
): Promise<JsonRecord> {
  const response = await fetcher(`${WORKBUDDY_API_BASE}/plugin/auth/token/refresh`, {
    method: "POST",
    headers: {
      ...WORKBUDDY_PROTOCOL_HEADERS,
      "X-Refresh-Token": refreshToken,
      "X-Auth-Refresh-Source": "workbuddy",
      "X-Enterprise-Id": enterpriseId,
    },
    signal: AbortSignal.timeout(30_000),
  });
  return record((await responseEnvelope(response, "workbuddy token refresh failed; run /login workbuddy again")).data);
}
