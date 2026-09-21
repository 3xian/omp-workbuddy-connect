import type { AuthStorage, Model, OAuthCredentials, UsageCredential } from "@oh-my-pi/pi-ai";
import type { ExtensionContext, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { loginWorkBuddy, refreshWorkBuddyOAuth, validateRequestCredential, validateStoredCredential } from "./auth.ts";
import { createWorkBuddyUsageProvider } from "./credits.ts";
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

type StoredAuth = Pick<AuthStorage, "listOAuthAccounts" | "remove">;
type ProviderModels = NonNullable<ProviderConfig["models"]>;
type Fetch = typeof globalThis.fetch;

interface RuntimeBinding {
  authStorage: StoredAuth;
}

function identityError(reason: string): Error {
  return new Error(`workbuddy authentication rejected: ${reason}; keep exactly one account and run /login workbuddy again`);
}

function requireSingleStoredAccount(binding: RuntimeBinding) {
  const accounts = binding.authStorage.listOAuthAccounts(WORKBUDDY_PROVIDER);
  if (accounts.length !== 1) throw identityError(`expected one stored account, found ${accounts.length}`);
  const account = accounts[0]!;
  if (!account.accountId) throw identityError("stored account identity is incomplete");
  return account as typeof account & { accountId: string };
}


function validateCredentialIdentity(binding: RuntimeBinding, credentials: OAuthCredentials): void {
  const account = requireSingleStoredAccount(binding);
  if (account.accountId !== credentials.accountId || account.orgId !== credentials.orgId) {
    throw identityError("selected credential does not match the stored account identity");
  }
}


export interface WorkBuddyProviderController {
  bindContext(context: ExtensionContext): void;
  setModelAccess(activeIds: ReadonlySet<string>, transitioning: boolean): void;
  config(models: ProviderModels): ProviderConfig;
  logout(): Promise<void>;
  shutdown(): void;
}

export function createWorkBuddyProvider(fetcher: Fetch = globalThis.fetch): WorkBuddyProviderController {
  let binding: RuntimeBinding | undefined;
  let authenticationEnabled = true;
  const lifecycleAbort = new AbortController();
  let authenticationAbort = new AbortController();
  let modelAccess = {
    activeIds: new Set<string>(),
    transitioning: true,
    revision: 0,
  };

  function requireModelAccess(modelId: string, expectedRevision?: number): number {
    if (modelAccess.transitioning) {
      throw new Error(`WorkBuddy model "${modelId}" is unavailable while its scope is changing`);
    }
    if (!modelAccess.activeIds.has(modelId)) {
      throw new Error(`WorkBuddy model "${modelId}" is outside the active scope; select an available model`);
    }
    if (expectedRevision !== undefined && modelAccess.revision !== expectedRevision) {
      throw new Error(`WorkBuddy model "${modelId}" scope changed during request`);
    }
    return modelAccess.revision;
  }

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
    validateCredentialIdentity(requireBinding(), credentials);
    return credentials.access;
  }

  function modifyModels(models: Model[], credentials: OAuthCredentials): Model[] {
    try {
      validateStoredCredential(credentials);
      if (binding) validateCredentialIdentity(binding, credentials);
    } catch {
      return models.filter((model) => model.provider !== WORKBUDDY_PROVIDER);
    }

    return models.map((model) => {
      if (model.provider !== WORKBUDDY_PROVIDER) return model;
      const previous = model.resolveHeaders;
      return {
        ...model,
        resolveHeaders: async (signal?: AbortSignal) => {
          const accessRevision = requireModelAccess(model.id);
          const requestSignal = combinedSignal(signal);
          const currentBinding = requireBinding();
          const selectedAccount = requireSingleStoredAccount(currentBinding);
          const preserved = await previous?.(requestSignal);
          requestSignal.throwIfAborted();
          requireModelAccess(model.id, accessRevision);
          if (requireBinding() !== currentBinding) {
            throw identityError("authentication storage changed during header resolution");
          }
          const currentAccount = requireSingleStoredAccount(currentBinding);
          if (
            currentAccount.credentialId !== selectedAccount.credentialId
            || currentAccount.accountId !== selectedAccount.accountId
            || currentAccount.orgId !== selectedAccount.orgId
          ) {
            throw identityError("stored account changed during header resolution");
          }
          return {
            ...preserved,
            "X-User-Id": selectedAccount.accountId,
            ...(selectedAccount.orgId
              ? { "X-Enterprise-Id": selectedAccount.orgId }
              : { "X-No-Enterprise-Id": "1" }),
          };
        },
      };
    });
  }

  function validateBillingCredential(credential: UsageCredential): void {
    const currentBinding = requireBinding();
    const account = requireSingleStoredAccount(currentBinding);
    if (
      credential.type !== "oauth"
      || !credential.accessToken
      || !credential.accountId
      || credential.accountId !== account.accountId
      || credential.orgId !== account.orgId
    ) {
      throw identityError("Billing credential does not match the sole stored account");
    }
  }

  const usage = createWorkBuddyUsageProvider(validateBillingCredential);

  return {
    bindContext(context) {
      const authStorage = context.modelRegistry.authStorage;
      if (binding?.authStorage === authStorage) return;
      binding = { authStorage };
    },
    setModelAccess(activeIds, transitioning) {
      modelAccess = {
        activeIds: new Set(activeIds),
        transitioning,
        revision: modelAccess.revision + 1,
      };
    },
    config(models) {
      return {
        baseUrl: WORKBUDDY_API_BASE,
        api: "openai-completions",
        headers: WORKBUDDY_FIXED_HEADERS,
        usage,
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
  };
}
