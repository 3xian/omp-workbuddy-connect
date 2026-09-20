import { LoginCancelledError } from "@oh-my-pi/pi-ai/error";
import {
  pollPluginToken,
  refreshPluginToken,
  startPluginLogin,
  WorkBuddyOAuthError,
  type WorkBuddyOAuthErrorKind,
} from "../src/workbuddy-api.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectKind(promise: Promise<unknown>, kind: WorkBuddyOAuthErrorKind): Promise<WorkBuddyOAuthError> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof WorkBuddyOAuthError, `expected WorkBuddyOAuthError, got ${String(error)}`);
    assert(error.kind === kind, `expected ${kind}, got ${error.kind}`);
    return error;
  }
  throw new Error(`expected ${kind} rejection`);
}

async function expectCancelled(promise: Promise<unknown>): Promise<LoginCancelledError> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof LoginCancelledError, `expected LoginCancelledError, got ${String(error)}`);
    return error;
  }
  throw new Error("expected cancellation rejection");
}

await expectKind(
  pollPluginToken("state", async () => new Response("{", {
    headers: { "Content-Type": "application/json" },
  }), { deadlineMs: 100 }),
  "invalid_response",
);
await expectKind(
  pollPluginToken("state", async () => Response.json({}), { deadlineMs: 100 }),
  "invalid_response",
);
await expectKind(
  pollPluginToken("state", async () => Response.json({ code: 0, data: [] }), { deadlineMs: 100 }),
  "invalid_response",
);
const pending = () => Response.json({ code: 11217 });
const success = () => Response.json({ code: 0, data: { accessToken: "access", refreshToken: "refresh", expiresIn: 3600, uid: "account", enterpriseId: "org" } });

let calls = 0;
const pendingThenSuccess: typeof fetch = async () => {
  calls += 1;
  return calls === 1 ? pending() : success();
};
const completed = await pollPluginToken("state", pendingThenSuccess, { pollIntervalMs: 1, deadlineMs: 100 });
assert(completed.accessToken === "access" && calls === 2, "pending authorization did not continue once");

calls = 0;
const delayAbort = new AbortController();
const delayed = pollPluginToken("state", async () => {
  calls += 1;
  return pending();
}, { signal: delayAbort.signal, pollIntervalMs: 1_000, deadlineMs: 5_000 });
await new Promise((resolve) => setTimeout(resolve, 5));
delayAbort.abort("user cancelled");
await expectCancelled(delayed);
await new Promise((resolve) => setTimeout(resolve, 10));
assert(calls === 1, `cancelled poll issued ${calls} requests`);

const requestAbort = new AbortController();
let releaseRequest!: (response: Response) => void;
const lateRequest = pollPluginToken("state", () => new Promise<Response>((resolve) => {
  releaseRequest = resolve;
}), { signal: requestAbort.signal, deadlineMs: 5_000 });
await Promise.resolve();
requestAbort.abort("session aborted");
releaseRequest(success());
await expectCancelled(lateRequest);

await expectKind(
  pollPluginToken("state", async () => pending(), { pollIntervalMs: 20, deadlineMs: 5 }),
  "poll_timeout",
);

calls = 0;
await expectKind(pollPluginToken("state", async () => {
  calls += 1;
  return Response.json({ code: 40001, msg: "denied" });
}, { deadlineMs: 100 }), "authorization_rejected");
assert(calls === 1, "authorization rejection was retried");

calls = 0;
await expectKind(pollPluginToken("state", async () => {
  calls += 1;
  throw new TypeError("offline");
}, { deadlineMs: 100 }), "network_failure");
assert(calls === 1, "network failure was retried");

calls = 0;
const serverError = await expectKind(pollPluginToken("state", async () => {
  calls += 1;
  return new Response(null, { status: 503 });
}, { deadlineMs: 100 }), "server_failure");
assert(serverError.status === 503 && calls === 1, "5xx classification or retry boundary is wrong");

calls = 0;
const rateLimitedThenSuccess: typeof fetch = async () => {
  calls += 1;
  return calls === 1
    ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
    : success();
};
await pollPluginToken("state", rateLimitedThenSuccess, { deadlineMs: 100 });
assert(calls === 2, "valid Retry-After was not honored");

const rateAbort = new AbortController();
calls = 0;
const rateWait = pollPluginToken("state", async () => {
  calls += 1;
  return new Response(null, { status: 429, headers: { "Retry-After": "5" } });
}, { signal: rateAbort.signal, deadlineMs: 10_000 });
await new Promise((resolve) => setTimeout(resolve, 5));
rateAbort.abort("extension shutdown");
await expectCancelled(rateWait);
assert(calls === 1, "cancelled Retry-After wait issued another request");

await expectKind(startPluginLogin(async () => Response.json({
  code: 0,
  data: { state: "state", authUrl: "https://example.invalid/login" },
})), "invalid_response");
const trustedStart = await startPluginLogin(async () => Response.json({
  code: 0,
  data: { state: "state", authUrl: "https://www.workbuddy.ai/login?platform=CLI" },
}));
assert(trustedStart.state === "state", "official WorkBuddy login URL was rejected");

calls = 0;
const loginStartRateError = await expectKind(startPluginLogin(async () => {
  calls += 1;
  return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
}), "rate_limited");
assert(loginStartRateError.status === 429 && calls === 1, "login-start rate limit was generically retried");

calls = 0;
const rateError = await expectKind(refreshPluginToken("refresh", "org", async () => {
  calls += 1;
  return new Response(null, { status: 429 });
}), "rate_limited");
assert(rateError.status === 429 && calls === 1, "refresh rate limit was generically retried");

console.log("OK: OAuth cancellation, timeout, rejection, network, 5xx, and Retry-After boundaries");
