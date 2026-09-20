import type { OAuthCredentials, OAuthLoginCallbacks } from "@oh-my-pi/pi-ai";
import { pollPluginToken, refreshPluginToken, startPluginLogin } from "./workbuddy-api.ts";

export interface WorkBuddyCredential {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  uid: string;
  enterpriseId: string;
  email?: string;
  nickname?: string;
}

type JsonRecord = Record<string, unknown>;
type Fetch = typeof globalThis.fetch;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`workbuddy credential is missing ${field}; run /login workbuddy again`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function expiryFromResponse(value: unknown, now: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("workbuddy credential has invalid expiry; run /login workbuddy again");
  }
  const expiresAtMs = now + value * 1000;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now) {
    throw new Error("workbuddy credential has invalid expiry; run /login workbuddy again");
  }
  return expiresAtMs;
}

function explicitEmail(value: unknown): string | undefined {
  const email = optionalString(value);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : undefined;
}

function responseIdentity(data: JsonRecord): { uid?: string; enterpriseId?: string } {
  return {
    uid: optionalString(data.uid),
    enterpriseId: optionalString(data.enterpriseId) ?? optionalString(data.enterprise_id),
  };
}

export function credentialFromLoginResponse(data: JsonRecord, now = Date.now()): WorkBuddyCredential {
  const identity = responseIdentity(data);
  const credential: WorkBuddyCredential = {
    accessToken: requiredString(data.accessToken, "access token"),
    refreshToken: requiredString(data.refreshToken, "refresh token"),
    expiresAtMs: expiryFromResponse(data.expiresIn, now),
    uid: requiredString(identity.uid, "uid"),
    enterpriseId: requiredString(identity.enterpriseId, "enterpriseId"),
  };
  const email = explicitEmail(data.email);
  const nickname = optionalString(data.nickname);
  if (email) credential.email = email;
  if (nickname) credential.nickname = nickname;
  return credential;
}

export function oauthFromWorkBuddy(credential: WorkBuddyCredential): OAuthCredentials {
  return {
    access: credential.accessToken,
    refresh: credential.refreshToken,
    expires: credential.expiresAtMs,
    accountId: credential.uid,
    orgId: credential.enterpriseId,
    ...(credential.email ? { email: credential.email } : {}),
  };
}

export function validateRequestCredential(credentials: OAuthCredentials, now = Date.now()): OAuthCredentials {
  requiredString(credentials.access, "access token");
  requiredString(credentials.refresh, "refresh token");
  requiredString(credentials.accountId, "accountId");
  requiredString(credentials.orgId, "orgId");
  if (!Number.isFinite(credentials.expires) || credentials.expires <= now) {
    throw new Error("workbuddy credential is expired or has invalid expiry; run /login workbuddy again");
  }
  return credentials;
}

function validateRefreshInput(credentials: OAuthCredentials): void {
  requiredString(credentials.access, "access token");
  requiredString(credentials.refresh, "refresh token");
  requiredString(credentials.accountId, "accountId");
  requiredString(credentials.orgId, "orgId");
  if (!Number.isFinite(credentials.expires) || credentials.expires <= 0) {
    throw new Error("workbuddy credential has invalid expiry; run /login workbuddy again");
  }
}

export async function loginWorkBuddy(
  callbacks: OAuthLoginCallbacks,
  fetcher: Fetch = globalThis.fetch,
  now: () => number = Date.now,
): Promise<OAuthCredentials> {
  callbacks.onProgress?.("正在打开 WorkBuddy 登录页…");
  const { state, authUrl } = await startPluginLogin(fetcher);
  callbacks.onAuth({ url: authUrl });
  callbacks.onProgress?.("请在弹出的页面完成登录，完成后会自动继续");
  return oauthFromWorkBuddy(credentialFromLoginResponse(await pollPluginToken(state, fetcher, now), now()));
}

export async function refreshWorkBuddyOAuth(
  credentials: OAuthCredentials,
  fetcher: Fetch = globalThis.fetch,
  now = Date.now(),
): Promise<OAuthCredentials> {
  validateRefreshInput(credentials);
  const data = await refreshPluginToken(credentials.refresh, credentials.orgId!, fetcher);
  const returnedIdentity = responseIdentity(data);
  if (returnedIdentity.uid && returnedIdentity.uid !== credentials.accountId) {
    throw new Error("workbuddy refresh returned a different account identity; run /login workbuddy again");
  }
  if (returnedIdentity.enterpriseId && returnedIdentity.enterpriseId !== credentials.orgId) {
    throw new Error("workbuddy refresh returned a different enterprise identity; run /login workbuddy again");
  }
  const refreshed: OAuthCredentials = {
    access: requiredString(data.accessToken, "refreshed access token"),
    refresh: requiredString(data.refreshToken, "refreshed refresh token"),
    expires: expiryFromResponse(data.expiresIn, now),
    accountId: credentials.accountId,
    orgId: credentials.orgId,
    ...(credentials.email ? { email: credentials.email } : {}),
  };
  return validateRequestCredential(refreshed, now);
}
