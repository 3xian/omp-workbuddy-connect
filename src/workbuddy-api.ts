import { LoginCancelledError } from "@oh-my-pi/pi-ai/error";
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

const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 15 * 60 * 1000;
const AUTHORIZATION_PENDING = 11217;

type JsonRecord = Record<string, unknown>;
type Fetch = typeof globalThis.fetch;

export interface WorkBuddyRequestOptions {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}

export interface WorkBuddyPollOptions extends WorkBuddyRequestOptions {
  pollIntervalMs?: number;
  deadlineMs?: number;
  now?: () => number;
}

export type WorkBuddyOAuthErrorKind =
  | "authorization_rejected"
  | "poll_timeout"
  | "network_failure"
  | "server_failure"
  | "rate_limited"
  | "invalid_response"
  | "token_refresh";

export class WorkBuddyOAuthError extends Error {
  readonly kind: WorkBuddyOAuthErrorKind;
  readonly status?: number;

  constructor(
    kind: WorkBuddyOAuthErrorKind,
    message: string,
    status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkBuddyOAuthError";
    this.kind = kind;
    this.status = status;
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LoginCancelledError("WorkBuddy login cancelled");
  }
}

async function oauthFetch(
  fetcher: Fetch,
  input: string,
  init: RequestInit,
  options: WorkBuddyRequestOptions,
): Promise<Response> {
  throwIfCancelled(options.signal);
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  try {
    const response = await fetcher(input, { ...init, signal });
    throwIfCancelled(options.signal);
    return response;
  } catch (error) {
    throwIfCancelled(options.signal);
    if (timeoutSignal.aborted) {
      throw new WorkBuddyOAuthError(
        "network_failure",
        "WorkBuddy OAuth request timed out",
        undefined,
        { cause: error },
      );
    }
    throw new WorkBuddyOAuthError(
      "network_failure",
      "WorkBuddy OAuth network failure",
      undefined,
      { cause: error },
    );
  }
}

async function readEnvelope(response: Response): Promise<JsonRecord> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    throw new WorkBuddyOAuthError(
      "invalid_response",
      "WorkBuddy OAuth returned invalid JSON",
      response.status,
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || typeof (parsed as JsonRecord).code !== "number"
    || !Number.isFinite((parsed as JsonRecord).code)
  ) {
    throw new WorkBuddyOAuthError(
      "invalid_response",
      "WorkBuddy OAuth returned an invalid envelope",
      response.status,
    );
  }
  return parsed as JsonRecord;
}

function envelopeData(envelope: JsonRecord, response: Response): JsonRecord {
  const data = envelope.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new WorkBuddyOAuthError(
      "invalid_response",
      "WorkBuddy OAuth returned invalid data",
      response.status,
    );
  }
  return data as JsonRecord;
}

function responseError(response: Response, kind: "authorization_rejected" | "token_refresh"): WorkBuddyOAuthError {
  if (response.status === 429) {
    return new WorkBuddyOAuthError("rate_limited", "WorkBuddy OAuth rate limited", 429);
  }
  if (response.status >= 500) {
    return new WorkBuddyOAuthError(
      "server_failure",
      "WorkBuddy OAuth service failure",
      response.status,
    );
  }
  return new WorkBuddyOAuthError(
    kind,
    kind === "authorization_rejected"
      ? "WorkBuddy authorization was rejected"
      : "WorkBuddy token refresh was rejected; run /login workbuddy again",
    response.status,
  );
}

function retryAfterMs(response: Response, now: number): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  try {
    await sleep(ms, undefined, { signal });
  } catch (error) {
    throwIfCancelled(signal);
    throw error;
  }
  throwIfCancelled(signal);
}

export async function startPluginLogin(
  fetcher: Fetch = globalThis.fetch,
  options: WorkBuddyRequestOptions = {},
): Promise<{ state: string; authUrl: string }> {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const response = await oauthFetch(fetcher, `${WORKBUDDY_API_BASE}/plugin/auth/state?platform=CLI&nonce=${nonce}`, {
    method: "POST",
    headers: PLUGIN_AUTH_HEADERS,
    body: JSON.stringify({ nonce }),
  }, options);
  if (!response.ok) throw responseError(response, "authorization_rejected");
  const envelope = await readEnvelope(response);
  if (envelope.code !== 0) throw responseError(response, "authorization_rejected");
  const data = envelopeData(envelope, response);
  const state = typeof data.state === "string" ? data.state.trim() : "";
  const authUrl = typeof data.authUrl === "string" ? data.authUrl.trim() : "";
  let parsedAuthUrl: URL | undefined;
  try {
    parsedAuthUrl = new URL(authUrl);
  } catch {
    // Rejected by the common incomplete-data branch below.
  }
  if (
    state === ""
    || !parsedAuthUrl
    || parsedAuthUrl.origin !== WORKBUDDY_ORIGIN
    || parsedAuthUrl.username !== ""
    || parsedAuthUrl.password !== ""
  ) {
    throw new WorkBuddyOAuthError(
      "invalid_response",
      "WorkBuddy login start returned incomplete or untrusted data",
    );
  }
  throwIfCancelled(options.signal);
  return { state, authUrl };
}

export async function pollPluginToken(
  state: string,
  fetcher: Fetch = globalThis.fetch,
  options: WorkBuddyPollOptions = {},
): Promise<JsonRecord> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? POLL_DEADLINE_MS);
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  while (true) {
    throwIfCancelled(options.signal);
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new WorkBuddyOAuthError(
        "poll_timeout",
        "WorkBuddy authorization polling timed out",
      );
    }
    const response = await oauthFetch(
      fetcher,
      `${WORKBUDDY_API_BASE}/plugin/auth/token?state=${encodeURIComponent(state)}`,
      { headers: PLUGIN_AUTH_HEADERS },
      {
        signal: options.signal,
        requestTimeoutMs: Math.min(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, remainingMs),
      },
    );
    if (response.status === 429) {
      const delayMs = retryAfterMs(response, now());
      if (delayMs === undefined) throw responseError(response, "authorization_rejected");
      await wait(Math.min(delayMs, Math.max(0, deadline - now())), options.signal);
      continue;
    }
    if (!response.ok) throw responseError(response, "authorization_rejected");
    const envelope = await readEnvelope(response);
    if (envelope.code === AUTHORIZATION_PENDING) {
      await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())), options.signal);
      continue;
    }
    if (envelope.code !== 0) throw responseError(response, "authorization_rejected");
    throwIfCancelled(options.signal);
    return envelopeData(envelope, response);
  }
}

export async function refreshPluginToken(
  refreshToken: string,
  enterpriseId: string | undefined,
  fetcher: Fetch = globalThis.fetch,
  options: WorkBuddyRequestOptions = {},
): Promise<JsonRecord> {
  const response = await oauthFetch(fetcher, `${WORKBUDDY_API_BASE}/plugin/auth/token/refresh`, {
    method: "POST",
    headers: {
      ...WORKBUDDY_PROTOCOL_HEADERS,
      "X-Refresh-Token": refreshToken,
      "X-Auth-Refresh-Source": "workbuddy",
      ...(enterpriseId ? { "X-Enterprise-Id": enterpriseId } : {}),
    },
  }, options);
  if (!response.ok) throw responseError(response, "token_refresh");
  const envelope = await readEnvelope(response);
  if (envelope.code !== 0) throw responseError(response, "token_refresh");
  throwIfCancelled(options.signal);
  return envelopeData(envelope, response);
}

function formatBillingTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function fetchWorkBuddyBillingEnvelope(
  credential: { accessToken?: string; accountId?: string },
  fetcher: Fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const accessToken = credential.accessToken?.trim();
  const accountId = credential.accountId?.trim();
  if (!accessToken || !accountId) throw new Error("WorkBuddy Billing credential identity is incomplete");
  const now = new Date();
  const response = await fetcher(`${WORKBUDDY_API_BASE}/billing/meter/get-user-resource`, {
    method: "POST",
    headers: {
      ...WORKBUDDY_PROTOCOL_HEADERS,
      Authorization: `Bearer ${accessToken}`,
      "X-User-Id": accountId,
    },
    body: JSON.stringify({
      PageNumber: 1,
      PageSize: 100,
      ProductCode: "p_tcaca",
      Status: [0, 3],
      PackageEndTimeRangeBegin: formatBillingTimestamp(now),
      PackageEndTimeRangeEnd: formatBillingTimestamp(new Date(now.getTime() + 365 * 101 * 24 * 60 * 60 * 1000)),
    }),
    signal,
  });
  if (!response.ok) throw new Error(`WorkBuddy Billing HTTP ${response.status}`);
  return response.json();
}
