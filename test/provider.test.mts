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
let accounts: Array<{
  position: number;
  credentialId: number;
  accountId: string;
  orgId?: string;
  active: boolean;
}> = [{
  position: 0,
  credentialId: 11,
  accountId: "account-a",
  orgId: "org-a",
  active: false,
}];
let resolvedIdentity: {
  accessToken: string;
  credentialId: number;
  accountId: string;
  orgId?: string;
} = {
  accessToken: credentials.access,
  credentialId: 11,
  accountId: "account-a",
  orgId: "org-a",
};
let resolvedSession: string | undefined;
let accessGate: Promise<void> | undefined;
let markAccessStarted: (() => void) | undefined;
const authStorage = {
  listOAuthAccounts() {
    return accounts;
  },
  async getOAuthAccess(_provider: string, sessionId?: string) {
    resolvedSession = sessionId;
    markAccessStarted?.();
    await accessGate;
    return resolvedIdentity;
  },
};
const controller = createWorkBuddyProvider();
controller.setModelAccess(new Set(["hy3"]), false);
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
const expiredProjection = oauth.modifyModels([workbuddy], { ...credentials, expires: Date.now() - 1 });
assert(expiredProjection.length === 1, "expired refreshable credential hid the model before host refresh");
const projected = oauth.modifyModels([foreignOpenAI, workbuddy, foreignAnthropic], credentials);
assert(projected[0] === foreignOpenAI && projected[2] === foreignAnthropic, "foreign provider rows changed");
const projectedWorkBuddy = projected[1];
assert(projectedWorkBuddy?.provider === "workbuddy" && projectedWorkBuddy.resolveHeaders, "WorkBuddy resolver was not installed");
controller.bindContext({
  modelRegistry: { authStorage },
  sessionManager: { getSessionId: () => "session-a" },
} as unknown as ExtensionContext);
assert(oauth.getApiKey(credentials) === "access-a", "getApiKey did not return validated host access");
const headers = await projectedWorkBuddy.resolveHeaders();
assert(previousResolverCalls === 1, "existing resolver was not composed exactly once");
assert(headers?.["X-Existing"] === "preserved", "existing resolver headers were lost");
assert(headers?.["X-User-Id"] === "account-a" && headers["X-Enterprise-Id"] === "org-a", "request identity headers mismatch");
const resolverCallsBeforeScopeChecks = previousResolverCalls;
controller.setModelAccess(new Set(["hy3"]), true);
let transitionRejected = false;
try {
  await projectedWorkBuddy.resolveHeaders();
} catch (error) {
  transitionRejected = error instanceof Error && error.message.includes("scope is changing");
}
assert(transitionRejected, "scope transition did not fail closed at the resolver");
assert(previousResolverCalls === resolverCallsBeforeScopeChecks, "scope transition reached the previous resolver");

controller.setModelAccess(new Set(), false);
let removedModelRejected = false;
try {
  await projectedWorkBuddy.resolveHeaders();
} catch (error) {
  removedModelRejected = error instanceof Error && error.message.includes("outside the active scope");
}
assert(removedModelRejected, "removed model did not fail closed at the resolver");
assert(previousResolverCalls === resolverCallsBeforeScopeChecks, "removed model reached the previous resolver");
controller.setModelAccess(new Set(["hy3"]), false);
let releaseAccess!: () => void;
accessGate = new Promise<void>((resolve) => { releaseAccess = resolve; });
const accessStarted = new Promise<void>((resolve) => { markAccessStarted = resolve; });
const inFlightResolution = projectedWorkBuddy.resolveHeaders();
await accessStarted;
controller.setModelAccess(new Set(["hy3"]), true);
releaseAccess();
let midFlightTransitionRejected = false;
try {
  await inFlightResolution;
} catch (error) {
  midFlightTransitionRejected = error instanceof Error && error.message.includes("scope is changing");
}
assert(midFlightTransitionRejected, "scope transition during credential resolution did not fail closed");
accessGate = undefined;
markAccessStarted = undefined;
controller.setModelAccess(new Set(["hy3"]), false);


accounts = [{ position: 0, credentialId: 21, accountId: "account-b", orgId: "org-b", active: true }];
resolvedIdentity = {
  accessToken: "access-b",
  credentialId: 21,
  accountId: "account-b",
  orgId: "org-b",
};
controller.bindContext({
  modelRegistry: { authStorage },
  sessionManager: { getSessionId: () => "session-b" },
} as unknown as ExtensionContext);
const switchedHeaders = await projectedWorkBuddy.resolveHeaders();
assert(
  switchedHeaders?.["X-User-Id"] === "account-b" && switchedHeaders["X-Enterprise-Id"] === "org-b",
  "retained resolver captured the projection-time binding",
);
assert(resolvedSession === "session-b", `resolver used stale session ${resolvedSession}`);

const childController = createWorkBuddyProvider();
childController.setModelAccess(new Set(["hy3"]), false);
childController.bindContext({
  modelRegistry: { authStorage },
  sessionManager: { getSessionId: () => "subagent-b" },
} as unknown as ExtensionContext);
const childOAuth = childController.config([]).oauth;
const childCredentials: OAuthCredentials = {
  access: "access-b",
  refresh: "refresh-b",
  expires: Date.now() + 60_000,
  accountId: "account-b",
  orgId: "org-b",
};
const childModel = childOAuth?.modifyModels?.([workbuddy], childCredentials)[0];
assert(childModel?.resolveHeaders, "fresh subagent controller did not project a resolver");
const childHeaders = await childModel.resolveHeaders();
assert(
  childHeaders?.["X-User-Id"] === "account-b" && childHeaders["X-Enterprise-Id"] === "org-b",
  "fresh subagent controller did not resolve account B",
);
assert(resolvedSession === "subagent-b", `fresh subagent used stale session ${resolvedSession}`);

accounts = [{ position: 0, credentialId: 11, accountId: "account-a", orgId: "org-a", active: true }];
resolvedIdentity = {
  accessToken: credentials.access,
  credentialId: 11,
  accountId: "account-a",
  orgId: "org-a",
};
controller.bindContext({
  modelRegistry: { authStorage },
  sessionManager: { getSessionId: () => "session-a" },
} as unknown as ExtensionContext);

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

const noOrgCredentials = { ...credentials, orgId: undefined };
accounts = [{ position: 0, credentialId: 11, accountId: "account-a", active: true }];
resolvedIdentity = {
  accessToken: credentials.access,
  credentialId: 11,
  accountId: "account-a",
};
assert(oauth.modifyModels([foreignOpenAI, workbuddy], noOrgCredentials).length === 2, "optional enterprise identity hid WorkBuddy model");
assert(oauth.getApiKey(noOrgCredentials) === "access-a", "getApiKey rejected optional enterprise identity");
const noOrgModel = oauth.modifyModels([workbuddy], noOrgCredentials)[0];
const noOrgHeaders = await noOrgModel?.resolveHeaders?.();
assert(noOrgHeaders?.["X-Enterprise-Id"] === undefined, "request fabricated enterprise identity");
assert(noOrgHeaders?.["X-No-Enterprise-Id"] === "1", "request omitted no-enterprise marker");

accounts = [];
let requestBoundaryRejected = false;
try {
  await projectedWorkBuddy.resolveHeaders();
} catch (error) {
  requestBoundaryRejected = error instanceof Error && error.message.includes("found 0");
}
assert(requestBoundaryRejected, "retained WorkBuddy model bypassed request-boundary account guard");


let shutdownFetchStarted = false;
const shutdownController = createWorkBuddyProvider(async (_input, init) => {
  shutdownFetchStarted = true;
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
});
const shutdownLogin = shutdownController.config([]).oauth!.login({
  onAuth() {},
  async onPrompt() { return ""; },
});
await Promise.resolve();
assert(shutdownFetchStarted, "extension-shutdown login request did not start");
shutdownController.shutdown();
let shutdownCancelled = false;
try {
  await shutdownLogin;
} catch (error) {
  shutdownCancelled = error instanceof Error && error.name === "LoginCancelledError";
}
assert(shutdownCancelled, "extension shutdown did not cancel OAuth network work");
console.log("OK: provider headers, isolation, resolver composition, and single-account fail-closed");
