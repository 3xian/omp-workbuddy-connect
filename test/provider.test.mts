import type { Model, OAuthCredentials } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  createWorkBuddyProvider,
  WORKBUDDY_FIXED_HEADERS,
} from "../src/provider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const credentials: OAuthCredentials = {
  access: "access-a",
  refresh: "refresh-a",
  expires: Date.now() + 60_000,
  accountId: "account-a",
  orgId: "org-a",
};
let accounts = [{
  position: 0,
  credentialId: 11,
  accountId: "account-a",
  orgId: "org-a",
  active: false,
}];
const authStorage = {
  listOAuthAccounts() {
    return accounts;
  },
  async getOAuthAccess() {
    return {
      accessToken: credentials.access,
      credentialId: 11,
      accountId: "account-a",
      orgId: "org-a",
    };
  },
};
const controller = createWorkBuddyProvider();
controller.bindContext({
  modelRegistry: { authStorage },
  sessionManager: { getSessionId: () => "session-a" },
} as unknown as ExtensionContext);

const config = controller.config([]);
assert(config.baseUrl === "https://www.workbuddy.ai/v2", "provider routing was not fixed to international API");
assert(config.api === "openai-completions", "provider did not use host Chat transport");
assert(config.headers?.Origin === "https://www.workbuddy.ai", "missing fixed Origin");
assert(config.headers?.Referer === "https://www.workbuddy.ai/", "missing fixed Referer");
assert(config.headers?.["X-Domain"] === "www.workbuddy.ai", "missing fixed X-Domain");
assert(config.headers?.["X-Product"] === "SaaS", "missing fixed X-Product");
assert(!Object.keys(WORKBUDDY_FIXED_HEADERS).some((name) => name.toLowerCase() === "authorization"), "plugin injected Chat Authorization");
const oauth = config.oauth;
assert(oauth?.getApiKey && oauth.modifyModels, "provider OAuth boundaries are incomplete");
assert(oauth.getApiKey(credentials) === "access-a", "getApiKey did not return validated host access");

const foreignOpenAI = { provider: "openai", id: "gpt", marker: {} } as unknown as Model;
const foreignAnthropic = { provider: "anthropic", id: "claude", marker: {} } as unknown as Model;
let previousResolverCalls = 0;
const workbuddy = {
  provider: "workbuddy",
  id: "hy3",
  resolveHeaders: async () => {
    previousResolverCalls += 1;
    return { "X-Existing": "preserved", "X-User-Id": "stale" };
  },
} as unknown as Model;
const projected = oauth.modifyModels([foreignOpenAI, workbuddy, foreignAnthropic], credentials);
assert(projected[0] === foreignOpenAI && projected[2] === foreignAnthropic, "foreign provider rows changed");
const projectedWorkBuddy = projected[1];
assert(projectedWorkBuddy?.provider === "workbuddy" && projectedWorkBuddy.resolveHeaders, "WorkBuddy resolver was not installed");
const headers = await projectedWorkBuddy.resolveHeaders();
assert(previousResolverCalls === 1, "existing resolver was not composed exactly once");
assert(headers?.["X-Existing"] === "preserved", "existing resolver headers were lost");
assert(headers?.["X-User-Id"] === "account-a" && headers["X-Enterprise-Id"] === "org-a", "request identity headers mismatch");

accounts = [
  { position: 0, credentialId: 11, accountId: "account-a", orgId: "org-a", active: true },
  { position: 1, credentialId: 12, accountId: "account-b", orgId: "org-b", active: false },
];
const ambiguous = oauth.modifyModels([foreignOpenAI, workbuddy, foreignAnthropic], credentials);
assert(ambiguous.length === 2 && ambiguous[0] === foreignOpenAI && ambiguous[1] === foreignAnthropic, "ambiguous account did not hide only WorkBuddy rows");
let ambiguousKeyRejected = false;
try {
  oauth.getApiKey(credentials);
} catch (error) {
  ambiguousKeyRejected = error instanceof Error && error.message.includes("found 2");
}
assert(ambiguousKeyRejected, "getApiKey accepted multiple stored accounts");

accounts = [{ position: 0, credentialId: 11, accountId: "account-a", orgId: "org-a", active: true }];
const activeStillOne = oauth.modifyModels([workbuddy], credentials);
assert(activeStillOne.length === 1, "active sticky marker was incorrectly counted as another account");

const missingOrg = { ...credentials, orgId: undefined };
assert(oauth.modifyModels([foreignOpenAI, workbuddy], missingOrg).length === 1, "invalid identity remained in catalog");
let missingOrgRejected = false;
try {
  oauth.getApiKey(missingOrg);
} catch {
  missingOrgRejected = true;
}
assert(missingOrgRejected, "getApiKey accepted missing org identity");

accounts = [];
let requestBoundaryRejected = false;
try {
  await projectedWorkBuddy.resolveHeaders();
} catch (error) {
  requestBoundaryRejected = error instanceof Error && error.message.includes("found 0");
}
assert(requestBoundaryRejected, "retained WorkBuddy model bypassed request-boundary account guard");

console.log("OK: provider headers, isolation, resolver composition, and single-account fail-closed");
