import type { OAuthCredentials } from "@oh-my-pi/pi-ai";
import {
  credentialFromLoginResponse,
  oauthFromWorkBuddy,
  refreshWorkBuddyOAuth,
} from "../src/auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function complete(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accessToken: "access-a",
    refreshToken: "refresh-a",
    expiresIn: 3600,
    uid: "account-a",
    enterpriseId: "org-a",
    ...overrides,
  };
}

const required = ["accessToken", "refreshToken", "expiresIn", "uid", "enterpriseId"] as const;
for (const field of required) {
  const data = complete();
  delete data[field];
  let rejected = false;
  try {
    credentialFromLoginResponse(data, 1_000);
  } catch {
    rejected = true;
  }
  assert(rejected, `missing ${field} was accepted`);
}

for (const expiresIn of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  let rejected = false;
  try {
    credentialFromLoginResponse(complete({ expiresIn }), 1_000);
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("expiry");
  }
  assert(rejected, `invalid expiresIn ${expiresIn} was accepted`);
}

const mapped = oauthFromWorkBuddy(credentialFromLoginResponse(complete({
  email: "real@example.com",
  nickname: "Display Name",
  domain: "attacker.invalid",
}), 1_000));
assert(mapped.access === "access-a" && mapped.refresh === "refresh-a", "tokens were not mapped");
assert(mapped.expires === 3_601_000, `expiry was not mapped: ${mapped.expires}`);
assert(mapped.accountId === "account-a" && mapped.orgId === "org-a", "identity was not mapped");
assert(mapped.email === "real@example.com", "explicit email was not preserved");
assert(!("nickname" in mapped) && !("domain" in mapped), "display/routing data polluted OAuth identity");

const nicknameOnly = oauthFromWorkBuddy(credentialFromLoginResponse(complete({ nickname: "looks@example.com" }), 1_000));
assert(nicknameOnly.email === undefined, "nickname was aliased to email");
const malformedEmail = oauthFromWorkBuddy(credentialFromLoginResponse(complete({ email: "not-an-email" }), 1_000));
assert(malformedEmail.email === undefined, "malformed email was persisted");

const previous: OAuthCredentials = {
  access: "expired-a",
  refresh: "refresh-a",
  expires: 1,
  accountId: "account-a",
  orgId: "org-a",
  email: "real@example.com",
};
let refreshRequest: RequestInit | undefined;
const successfulRefresh: typeof fetch = async (_input, init) => {
  refreshRequest = init;
  return Response.json({
    code: 0,
    data: {
      accessToken: "access-a2",
      refreshToken: "refresh-a2",
      expiresIn: 7200,
      uid: "account-a",
      enterpriseId: "org-a",
    },
  });
};
const refreshed = await refreshWorkBuddyOAuth(previous, successfulRefresh, 10_000);
assert(refreshed.access === "access-a2" && refreshed.refresh === "refresh-a2", "refresh tokens were not replaced");
assert(refreshed.expires === 7_210_000, "refresh expiry was not replaced");
assert(refreshed.accountId === previous.accountId && refreshed.orgId === previous.orgId, "refresh lost identity");
assert(refreshed.email === previous.email, "refresh lost verified email");
const refreshHeaders = new Headers(refreshRequest?.headers);
assert(refreshHeaders.get("x-refresh-token") === "refresh-a", "refresh did not use host credential input");
assert(refreshHeaders.get("x-enterprise-id") === "org-a", "refresh did not use host enterprise identity");

for (const responseData of [
  complete({ accessToken: "", uid: undefined, enterpriseId: undefined }),
  complete({ refreshToken: "", uid: undefined, enterpriseId: undefined }),
  complete({ expiresIn: 0, uid: undefined, enterpriseId: undefined }),
  complete({ accessToken: "access-x", refreshToken: "refresh-x", uid: "account-b", enterpriseId: "org-a" }),
  complete({ accessToken: "access-x", refreshToken: "refresh-x", uid: "account-a", enterpriseId: "org-b" }),
]) {
  let rejected = false;
  const fetcher: typeof fetch = async () => Response.json({ code: 0, data: responseData });
  try {
    await refreshWorkBuddyOAuth(previous, fetcher, 10_000);
  } catch {
    rejected = true;
  }
  assert(rejected, `invalid refresh response was accepted: ${JSON.stringify(responseData)}`);
}

let missingIdentityRejected = false;
try {
  await refreshWorkBuddyOAuth({ ...previous, orgId: undefined }, successfulRefresh, 10_000);
} catch {
  missingIdentityRejected = true;
}
assert(missingIdentityRejected, "refresh input without identity was accepted");

console.log("OK: login mapping and refresh boundaries reject incomplete or conflicting identity");
