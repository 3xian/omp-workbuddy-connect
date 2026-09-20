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

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
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
  try {
    return record(await response.json());
  } catch (error) {
    throw new WorkBuddyOAuthError(
      "invalid_response",
      "WorkBuddy OAuth returned an invalid response",
      response.status,
      { cause: error },
    );
  }
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
  const data = record(envelope.data);
  const state = typeof data.state === "string" ? data.state.trim() : "";
  const authUrl = typeof data.authUrl === "string" ? data.authUrl.trim() : "";
  if (state === "" || authUrl === "") {
    throw new WorkBuddyOAuthError(
      "invalid_response",
      "WorkBuddy login start returned incomplete data",
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
    return record(envelope.data);
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
  return record(envelope.data);
}
