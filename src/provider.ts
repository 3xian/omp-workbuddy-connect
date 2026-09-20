import type { AuthStorage, Model, OAuthAccess, OAuthCredentials } from "@oh-my-pi/pi-ai";
import type { ExtensionContext, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { loginWorkBuddy, refreshWorkBuddyOAuth, validateRequestCredential, validateStoredCredential } from "./auth.ts";
import {
  WORKBUDDY_API_BASE,
  WORKBUDDY_ORIGIN,
  WORKBUDDY_PROTOCOL_HEADERS,
} from "./workbuddy-api.ts";

export const WORKBUDDY_PROVIDER = "workbuddy";
export const WORKBUDDY_FIXED_HEADERS = {
  Accept: WORKBUDDY_PROTOCOL_HEADERS.Accept,
  "X-Requested-With": WORKBUDDY_PROTOCOL_HEADERS["X-Requested-With"],
  Origin: WORKBUDDY_ORIGIN,
  Referer: `${WORKBUDDY_ORIGIN}/`,
  "User-Agent": WORKBUDDY_PROTOCOL_HEADERS["User-Agent"],
  "X-Product": "SaaS",
  "X-Domain": "www.workbuddy.ai",
} as const;

type StoredAuth = Pick<AuthStorage, "listOAuthAccounts" | "getOAuthAccess" | "remove">;
type ProviderModels = NonNullable<ProviderConfig["models"]>;
type Fetch = typeof globalThis.fetch;

interface RuntimeBinding {
  authStorage: StoredAuth;
  sessionId: string;
}

function identityError(reason: string): Error {
  return new Error(`workbuddy authentication rejected: ${reason}; keep exactly one account and run /login workbuddy again`);
}

function validateSingleStoredAccount(binding: RuntimeBinding, credentials?: OAuthCredentials) {
  const accounts = binding.authStorage.listOAuthAccounts(WORKBUDDY_PROVIDER);
  if (accounts.length !== 1) throw identityError(`expected one stored account, found ${accounts.length}`);
  const account = accounts[0]!;
  if (!account.accountId) throw identityError("stored account identity is incomplete");
  if (credentials && (account.accountId !== credentials.accountId || account.orgId !== credentials.orgId)) {
    throw identityError("selected credential does not match the stored account identity");
  }
  return account;
}

function validateResolvedIdentity(access: OAuthAccess, binding: RuntimeBinding): OAuthAccess {
  const account = validateSingleStoredAccount(binding);
  if (!access.accountId || access.credentialId === undefined) {
    throw identityError("request credential identity is incomplete");
  }
  if (
    access.credentialId !== account.credentialId
    || access.accountId !== account.accountId
    || access.orgId !== account.orgId
  ) {
    throw identityError("request credential does not match the sole stored account");
  }
  return access;
}

export interface WorkBuddyBillingAccess {
  accessToken: string;
  uid: string;
  enterpriseId?: string;
  email?: string;
}

export interface WorkBuddyProviderController {
  bindContext(context: ExtensionContext): void;
  config(models: ProviderModels): ProviderConfig;
  logout(): Promise<void>;
  shutdown(): void;
  /** Temporary legacy Billing bridge; M4 replaces this with the host UsageProvider. */
  resolveBillingAccess(signal?: AbortSignal): Promise<WorkBuddyBillingAccess>;
}

export function createWorkBuddyProvider(fetcher: Fetch = globalThis.fetch): WorkBuddyProviderController {
  let binding: RuntimeBinding | undefined;
  let authenticationEnabled = true;
  const lifecycleAbort = new AbortController();
  let authenticationAbort = new AbortController();

  function combinedSignal(signal?: AbortSignal): AbortSignal {
    const signals = [lifecycleAbort.signal, authenticationAbort.signal];
    if (signal) signals.push(signal);
    return AbortSignal.any(signals);
  }

  function requireBinding(): RuntimeBinding {
    if (!binding || !authenticationEnabled || lifecycleAbort.signal.aborted) {
      throw identityError("session authentication is not initialized");
    }
    return binding;
  }

  function getApiKey(credentials: OAuthCredentials): string {
    validateRequestCredential(credentials);
    validateSingleStoredAccount(requireBinding(), credentials);
    return credentials.access;
  }

  function modifyModels(models: Model[], credentials: OAuthCredentials): Model[] {
    try {
      validateStoredCredential(credentials);
      if (binding) validateSingleStoredAccount(binding, credentials);
    } catch {
      return models.filter((model) => model.provider !== WORKBUDDY_PROVIDER);
    }

    return models.map((model) => {
      if (model.provider !== WORKBUDDY_PROVIDER) return model;
      const previous = model.resolveHeaders;
      return {
        ...model,
        resolveHeaders: async (signal?: AbortSignal) => {
          const preserved = await previous?.(signal);
          const currentBinding = requireBinding();
          const requestSignal = combinedSignal(signal);
          const resolved = await currentBinding.authStorage.getOAuthAccess(
            WORKBUDDY_PROVIDER,
            currentBinding.sessionId,
            { signal: requestSignal },
          );
          requestSignal.throwIfAborted();
          const latestBinding = requireBinding();
          if (latestBinding !== currentBinding) throw identityError("session changed during credential resolution");
          if (!resolved) throw identityError("no usable OAuth credential");
          const access = validateResolvedIdentity(resolved, latestBinding);
          return {
            ...preserved,
            "X-User-Id": access.accountId!,
            ...(access.orgId ? { "X-Enterprise-Id": access.orgId } : { "X-No-Enterprise-Id": "1" }),
          };
        },
      };
    });
  }

  return {
    bindContext(context) {
      binding = {
        authStorage: context.modelRegistry.authStorage,
        sessionId: context.sessionManager.getSessionId(),
      };
    },
    config(models) {
      return {
        baseUrl: WORKBUDDY_API_BASE,
        api: "openai-completions",
        headers: WORKBUDDY_FIXED_HEADERS,
        oauth: {
          name: "WorkBuddy AI",
          login: async (callbacks) => {
            const credentials = await loginWorkBuddy({
              ...callbacks,
              signal: combinedSignal(callbacks.signal),
            }, fetcher);
            authenticationEnabled = true;
            return credentials;
          },
          refreshToken: (credentials: OAuthCredentials, signal?: AbortSignal) => refreshWorkBuddyOAuth(
            credentials,
            fetcher,
            Date.now(),
            combinedSignal(signal),
          ),
          getApiKey,
          modifyModels,
        },
        models,
      };
    },
    async logout() {
      if (!binding) throw identityError("session authentication is not initialized");
      const wasEnabled = authenticationEnabled;
      authenticationAbort.abort("WorkBuddy logout");
      authenticationAbort = new AbortController();
      try {
        await binding.authStorage.remove(WORKBUDDY_PROVIDER);
        authenticationEnabled = false;
      } catch (error) {
        authenticationEnabled = wasEnabled;
        throw error;
      }
    },
    shutdown() {
      authenticationEnabled = false;
      binding = undefined;
      lifecycleAbort.abort("WorkBuddy extension shutdown");
      authenticationAbort.abort("WorkBuddy extension shutdown");
    },
    async resolveBillingAccess(signal) {
      const currentBinding = requireBinding();
      validateSingleStoredAccount(currentBinding);
      const requestSignal = combinedSignal(signal);
      const resolved = await currentBinding.authStorage.getOAuthAccess(
        WORKBUDDY_PROVIDER,
        currentBinding.sessionId,
        { signal: requestSignal },
      );
      requestSignal.throwIfAborted();
      const latestBinding = requireBinding();
      if (latestBinding !== currentBinding) throw identityError("session changed during credential resolution");
      if (!resolved) throw identityError("no usable OAuth credential");
      const access = validateResolvedIdentity(resolved, latestBinding);
      return {
        accessToken: access.accessToken,
        uid: access.accountId!,
        ...(access.orgId ? { enterpriseId: access.orgId } : {}),
        ...(access.email ? { email: access.email } : {}),
      };
    },
  };
}
