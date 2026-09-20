import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthStorage,
  streamSimple,
  type Context,
  type Model,
  type OAuthCredentials,
} from "@oh-my-pi/pi-ai";
import { unregisterOAuthProvider } from "@oh-my-pi/pi-ai/registry/oauth";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";

const PROVIDER = "workbuddy-contract";
const SESSION = "request-identity-contract";
const temp = await mkdtemp(join(tmpdir(), "workbuddy-identity-contract-"));
const authStorage = await AuthStorage.create(join(temp, "auth.db"));
let refreshNumber = 1;

const registry = new ModelRegistry(authStorage, join(temp, "models.yml"), {
  cacheDbPath: join(temp, "models.db"),
});
registry.registerProvider(PROVIDER, {
  baseUrl: "https://workbuddy.invalid/v2",
  api: "openai-completions",
  oauth: {
    name: "WorkBuddy Contract",
    async login() { throw new Error("test login is not callable"); },
    async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      refreshNumber += 1;
      return {
        ...credentials,
        access: `access-a${refreshNumber}`,
        expires: Date.now() + 60 * 60 * 1000,
      };
    },
    getApiKey(credentials: OAuthCredentials) { return credentials.access; },
  },
  models: [{
    id: "hy3",
    name: "Identity Contract Hy3",
    reasoning: false,
    input: ["text"],
    supportsTools: true,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 4_096,
  }],
});

const registered = registry.find(PROVIDER, "hy3");
if (!registered) throw new Error("contract model was not registered");

const model: Model = {
  ...registered,
  resolveHeaders: async (signal?: AbortSignal) => {
    const accounts = authStorage.listOAuthAccounts(PROVIDER, SESSION);
    if (accounts.length !== 1) throw new Error(`expected one stored account; found ${accounts.length}`);
    const access = await authStorage.getOAuthAccess(PROVIDER, SESSION, { signal });
    if (!access?.accountId || !access.orgId) throw new Error("missing WorkBuddy identity");
    return {
      "X-User-Id": access.accountId,
      "X-Enterprise-Id": access.orgId,
      "X-Durable-Credential-Id": String(access.credentialId),
      "X-Fixed-Contract": "preserved",
    };
  },
};

interface Attempt {
  authorization: string | null;
  userId: string | null;
  orgId: string | null;
  credentialId: string | null;
  fixed: string | null;
  status: number;
}
const attempts: Attempt[] = [];
let failNextWith401 = false;

function completionResponse(): Response {
  const now = Math.floor(Date.now() / 1000);
  const body = [
    `data: ${JSON.stringify({ id: "chatcmpl-contract", object: "chat.completion.chunk", created: now, model: "hy3", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: "chatcmpl-contract", object: "chat.completion.chunk", created: now, model: "hy3", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const fetcher: typeof fetch = async (_input, init) => {
  const headers = new Headers(init?.headers);
  const status = failNextWith401 ? 401 : 200;
  attempts.push({
    authorization: headers.get("authorization"),
    userId: headers.get("x-user-id"),
    orgId: headers.get("x-enterprise-id"),
    credentialId: headers.get("x-durable-credential-id"),
    fixed: headers.get("x-fixed-contract"),
    status,
  });
  if (failNextWith401) {
    failNextWith401 = false;
    return new Response(JSON.stringify({ error: { message: "expired", type: "authentication_error" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return completionResponse();
};

const context: Context = {
  messages: [{ role: "user", content: "contract", timestamp: Date.now() }],
};

async function request(): Promise<void> {
  const stream = streamSimple(model, context, {
    apiKey: authStorage.resolver(PROVIDER, { sessionId: SESSION, baseUrl: model.baseUrl, modelId: model.id }),
    fetch: fetcher,
    maxTokens: 16,
  });
  for await (const _event of stream) {
    // Drain the real openai-completions stream.
  }
  const result = await stream.result();
  if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? `unexpected stop: ${result.stopReason}`);
}

function oauth(access: string, accountId: string, orgId: string, expires: number): OAuthCredentials {
  return { type: "oauth", access, refresh: `refresh-${accountId}`, expires, accountId, orgId };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  await authStorage.set(PROVIDER, oauth("access-a1", "account-a", "org-a", Date.now() + 60 * 60 * 1000));
  await request();
  const normal = attempts.at(-1)!;
  assert(normal.authorization === "Bearer access-a1", `normal bearer: ${normal.authorization}`);
  assert(normal.userId === "account-a" && normal.orgId === "org-a", "normal identity mismatch");
  assert(normal.fixed === "preserved", "existing/fixed headers were not composed");
  const rowA = normal.credentialId;

  await authStorage.set(PROVIDER, oauth("access-a1", "account-a", "org-a", Date.now() - 1));
  await request();
  const forced = attempts.at(-1)!;
  assert(forced.authorization === "Bearer access-a2", `forced refresh bearer: ${forced.authorization}`);
  assert(forced.credentialId === rowA && forced.userId === "account-a" && forced.orgId === "org-a", "forced refresh changed durable identity");

  failNextWith401 = true;
  const retryStart = attempts.length;
  await request();
  const retry = attempts.slice(retryStart);
  assert(retry.length === 2, `expected 401 plus retry, saw ${retry.length}`);
  assert(retry[0]?.authorization === "Bearer access-a2" && retry[0]?.status === 401, "401 first attempt mismatch");
  assert(retry[1]?.authorization === "Bearer access-a3" && retry[1]?.status === 200, "401 refresh bearer mismatch");
  assert(retry.every((attempt) => attempt.credentialId === rowA && attempt.userId === "account-a" && attempt.orgId === "org-a"), "401 retry crossed durable identity");

  await authStorage.remove(PROVIDER);
  await authStorage.set(PROVIDER, oauth("access-b1", "account-b", "org-b", Date.now() + 60 * 60 * 1000));
  await request();
  const switched = attempts.at(-1)!;
  assert(switched.authorization === "Bearer access-b1", "retained model did not resolve B bearer");
  assert(switched.userId === "account-b" && switched.orgId === "org-b" && switched.credentialId !== rowA, "retained model kept A identity");

  await authStorage.set(PROVIDER, [
    oauth("access-b1", "account-b", "org-b", Date.now() + 60 * 60 * 1000),
    oauth("access-c1", "account-c", "org-c", Date.now() + 60 * 60 * 1000),
  ]);
  const beforeAmbiguous = attempts.length;
  let ambiguityRejected = false;
  try {
    await request();
  } catch (error) {
    ambiguityRejected = error instanceof Error && error.message.includes("expected one stored account");
  }
  assert(ambiguityRejected, "two stored accounts were not rejected explicitly");
  assert(attempts.length === beforeAmbiguous, "two stored accounts reached provider transport");

  console.log("OK: normal, refresh, 401 same-row identity, A→B retained model, and two-row fail-closed");
} finally {
  unregisterOAuthProvider(PROVIDER);
  authStorage.close();
  await rm(temp, { recursive: true, force: true });
}
