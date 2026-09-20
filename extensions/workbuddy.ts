// WorkBuddy AI international provider for OMP.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  createWorkBuddyProvider,
  type WorkBuddyBillingAccess,
  type WorkBuddyProviderController,
} from "../src/provider.ts";
import {
  buildOmpModels,
  clampModelMaxTokens,
  FLASH_MAX_TOKENS,
  loadProductConfig,
  type ModelScope as Scope,
  type ProductConfigFallbackReason,
  type ProductConfigSource,
} from "../src/models.ts";
import { loadSettings, saveSettings } from "../src/settings.ts";

type Cred = WorkBuddyBillingAccess & { expiresAtMs?: number; nickname?: string };

const PROVIDER = "workbuddy";
const GLOBAL_BASE = "https://www.workbuddy.ai";
const CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";




function stripAssistantReasoning(messages: unknown[]): void {
  for (const item of messages) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const msg = item as Record<string, unknown>;
    if (msg.role !== "assistant") continue;
    delete msg.reasoning;
    delete msg.thinking;
    delete msg.reasoning_content;
    if (!Array.isArray(msg.content)) continue;
    msg.content = msg.content.filter((part) => {
      if (typeof part !== "object" || part === null) return true;
      const type = (part as { type?: string }).type;
      return type !== "reasoning" && type !== "thinking";
    });
    if (Array.isArray(msg.content) && msg.content.length === 0) msg.content = "";
  }
}

export function prepareChatPayload(payload: Record<string, unknown>): Record<string, unknown> {
  payload.stream = true;
  const messages = payload.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (typeof message === "object" && message !== null && !Array.isArray(message)
        && (message as Record<string, unknown>).role === "developer") {
        (message as Record<string, unknown>).role = "system";
      }
    }
    if (messages.length > 0 && (messages[0] as { role?: string } | undefined)?.role !== "system") {
      messages.unshift({ role: "system", content: "You are a helpful assistant." });
    }
    stripAssistantReasoning(messages);
  }
  if (payload.model === "deepseek-v4.1-flash") {
    const current = Number(payload.max_tokens);
    payload.max_tokens = Number.isFinite(current) && current > 0
      ? clampModelMaxTokens(payload.model, current)
      : FLASH_MAX_TOKENS;
  }
  if ("tool_choice" in payload) {
    const choice = payload.tool_choice;
    if (typeof choice === "string") {
      if (choice.trim().toLowerCase() === "none") {
        delete payload.tool_choice;
        delete payload.tools;
        delete payload.functions;
      }
    } else if (typeof choice === "object" && choice !== null && !Array.isArray(choice)) {
      const wrapped = choice as Record<string, unknown>;
      const type = typeof wrapped.type === "string" ? wrapped.type.trim().toLowerCase() : "";
      if (type === "none") {
        delete payload.tool_choice;
        delete payload.tools;
        delete payload.functions;
      } else if (type === "auto" || type === "required") {
        payload.tool_choice = type;
      } else if (type === "function") {
        const fn = typeof wrapped.function === "object" && wrapped.function !== null
          ? (wrapped.function as Record<string, unknown>)
          : undefined;
        const name = (typeof fn?.name === "string" ? fn.name : typeof wrapped.name === "string" ? wrapped.name : "").trim();
        payload.tool_choice = name || "auto";
      } else {
        delete payload.tool_choice;
      }
    } else {
      delete payload.tool_choice;
    }
  }
  // ponytail: never inject reasoning_effort — upstream sends a bare request when no
  // level is chosen, so "Default" must stay Default instead of silently becoming high.
  return payload;
}

/** `before_provider_request` carries no provider, so payloads are scoped by model id.
 *  Without this the hook rewrites every other provider's request (developer role,
 *  tool_choice, stream). */
export function isWorkBuddyModel(modelId: unknown, ids: ReadonlySet<string>): boolean {
  return typeof modelId === "string" && ids.has(modelId);
}

function asObject(payload: unknown): Record<string, unknown> | undefined {
  const value = typeof payload === "string"
    ? (() => {
      try {
        return JSON.parse(payload) as unknown;
      } catch {
        return undefined;
      }
    })()
    : payload;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}


type Pack = { name: string; remain: number; size: number };

function unwrap(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseCredits(envelope: unknown): { total: number; packs: Pack[] } {
  const inner = unwrap(unwrap(unwrap(unwrap(envelope).data).Response).Data);
  const raw = Array.isArray(inner.Accounts) ? inner.Accounts : [];
  const packs: Pack[] = [];
  let total = 0;
  for (const item of raw) {
    const account = unwrap(item);
    const num = (key: string): number => typeof account[key] === "number" ? account[key] as number : 0;
    const size = num("CycleCapacitySize");
    const cycleRemain = num("CycleCapacityRemain");
    const cycleUsed = num("CycleCapacityUsed");
    let remain = size > 0 || cycleRemain > 0 || cycleUsed > 0 ? cycleRemain : num("CapacityRemain");
    if (remain < 0) remain = 0;
    total += remain;
    packs.push({
      name: typeof account.PackageName === "string" ? account.PackageName : "(unnamed)",
      remain,
      size: size > 0 ? size : num("CapacitySize"),
    });
  }
  return { total, packs };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtStamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtExpiry(ms: number): string {
  if (ms <= 0) return "未知";
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function bar(remain: number, size: number, width = 28): string {
  if (size <= 0) return "";
  const n = Math.round(Math.min(1, Math.max(0, remain / size)) * width);
  return `${"█".repeat(n)}${"░".repeat(width - n)}`;
}

const FALLBACK_REASON_LABELS: Record<ProductConfigFallbackReason, string> = {
  missing: "缓存不存在",
  unreadable: "缓存不可读",
  "invalid-json": "JSON 无效",
  "invalid-schema": "结构无效",
  "no-valid-models": "无有效模型",
};

type CatalogExtra = {
  scope: Scope;
  models: { name: string }[];
  source: ProductConfigSource;
  fallbackReason?: ProductConfigFallbackReason;
};

export function widgetLines(input: {
  cred?: Cred;
  credits?: { total: number; packs: Pack[] };
  error?: string;
  scope?: Scope;
  models?: { name: string }[];
  source?: ProductConfigSource;
  fallbackReason?: ProductConfigFallbackReason;
}): string[] {
  const scope = input.scope ?? "free";
  const lines = [`WorkBuddy AI · 国际版 · ${scope === "all" ? "全部模型" : "仅免费模型"}`];
  const source = input.source ?? "builtin-fallback";
  const fallback = input.fallbackReason ? ` · ${FALLBACK_REASON_LABELS[input.fallbackReason]}` : "";
  lines.push(`目录  ${source}${fallback}`);
  const names = (input.models ?? []).map((model) => model.name).join("  |  ");
  lines.push(`模型  ${names || "（当前范围为空）"}`);
  if (!input.cred) {
    lines.push("未登录。设置 → 模型 → WorkBuddy AI → Connect，或 /login workbuddy");
    if (input.error) lines.push(input.error);
    lines.push("设置  /workbuddy");
    return lines;
  }
  lines.push(`账号  已登录  ${input.cred.nickname || input.cred.email || input.cred.uid}`);
  lines.push(`令牌  ${fmtExpiry(input.cred.expiresAtMs ?? 0)} 过期（由 OMP 自动续期）`);
  if (input.credits) {
    lines.push(`积分  合计 ${input.credits.total}`);
    for (const pack of input.credits.packs) {
      const right = pack.size > 0 ? `${pack.remain} / ${pack.size}` : String(pack.remain);
      lines.push(`  ${pack.name}  剩余 ${right}`);
      const drawn = bar(pack.remain, pack.size);
      if (drawn) lines.push(`  ${drawn}`);
    }
  } else if (input.error) {
    lines.push(`积分  ${input.error}`);
  }
  lines.push("设置  /workbuddy");
  return lines;
}

async function fetchCredits(cred: Cred, signal?: AbortSignal): Promise<{ total: number; packs: Pack[] }> {
  const now = new Date();
  const timeoutSignal = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${GLOBAL_BASE}/v2/billing/meter/get-user-resource`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Origin: GLOBAL_BASE,
      Referer: `${GLOBAL_BASE}/`,
      "User-Agent": CLIENT_UA,
      Authorization: `Bearer ${cred.accessToken}`,
      ...(cred.uid === "" ? {} : { "X-User-Id": cred.uid }),
    },
    body: JSON.stringify({
      PageNumber: 1,
      PageSize: 100,
      ProductCode: "p_tcaca",
      Status: [0, 3],
      PackageEndTimeRangeBegin: fmtStamp(now),
      PackageEndTimeRangeEnd: fmtStamp(new Date(now.getTime() + 365 * 101 * 24 * 3600 * 1000)),
    }),
    signal: requestSignal,
  });
  signal?.throwIfAborted();
  const envelope: unknown = await response.json();
  signal?.throwIfAborted();
  const msg = unwrap(envelope).msg;
  if (!response.ok || unwrap(envelope).code !== 0) {
    throw new Error(typeof msg === "string" && msg !== "" ? msg : `credits ${response.status}`);
  }
  return parseCredits(envelope);
}

type Ui = {
  setWidget(key: string, content: string[] | undefined): void;
  setStatus(key: string, text: string | undefined): void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
};

/** The card belongs to sessions actually running a WorkBuddy model. */
export function showsWorkBuddyCard(provider: unknown, force = false): boolean {
  return force || provider === PROVIDER;
}

type PaintCtx = { ui: Ui; model?: { provider?: string; id?: string } };
type PaintGuard = { signal: AbortSignal; current(): boolean };

/** Paints the card and returns the lines drawn, or undefined when hidden/stale. */
async function paint(
  ctx: PaintCtx,
  provider: WorkBuddyProviderController,
  guard: PaintGuard,
  notify = false,
  extra: CatalogExtra = { scope: "free", models: [], source: "builtin-fallback", fallbackReason: "missing" },
  force = false,
): Promise<string[] | undefined> {
  const { ui } = ctx;
  if (!showsWorkBuddyCard(ctx.model?.provider, force)) {
    if (!guard.current()) return undefined;
    ui.setWidget("workbuddy", undefined);
    ui.setStatus("workbuddy", undefined);
    return undefined;
  }
  let cred: Cred | undefined;
  let credits: { total: number; packs: Pack[] } | undefined;
  let error: string | undefined;
  // Temporary legacy Billing adapter; M4 moves this fetch into OMP UsageProvider.
  try {
    cred = await provider.resolveBillingAccess(guard.signal);
    credits = await fetchCredits(cred, guard.signal);
  } catch (caught) {
    if (!guard.current()) return undefined;
    error = caught instanceof Error ? caught.message : String(caught);
  }
  if (!guard.current()) return undefined;
  const lines = widgetLines({ cred, credits, error, ...extra });
  ui.setWidget("workbuddy", lines);
  const status = extra.models.length === 0
    ? `WorkBuddy · ${extra.scope} 无模型`
    : credits ? `积分 ${credits.total}` : cred ? "WorkBuddy 已登录" : "WorkBuddy 未登录";
  ui.setStatus("workbuddy", status);
  if (notify) {
    ui.notify(
      error ? `WorkBuddy：${error}` : `WorkBuddy 已刷新 · 积分 ${credits?.total ?? "?"}`,
      error ? "warning" : "info",
    );
  }
  return lines;
}


export default async function (pi: ExtensionAPI) {
  const provider = createWorkBuddyProvider();
  let scope = loadSettings().scope;
  let catalog = loadProductConfig();
  let models = buildOmpModels(catalog, scope);
  let activeIds = new Set(models.map((model) => model.id));
  const knownIds = new Set(catalog.models.map((model) => model.id));
  let pendingIds = new Set<string>();
  let transitioning = false;
  let card: string[] | undefined;
  let uiGeneration = 0;
  let uiAbort = new AbortController();
  const extra = (): CatalogExtra => ({
    scope,
    models,
    source: catalog.source,
    fallbackReason: catalog.fallbackReason,
  });

  function invalidateUi(reason: string): number {
    uiGeneration += 1;
    uiAbort.abort(reason);
    uiAbort = new AbortController();
    return uiGeneration;
  }

  function installProvider(nextModels: typeof models): void {
    // OMP replaces non-empty overlays on register. Empty static overlays are ignored,
    // so only that case needs an explicit unregister to clear stale selector rows.
    if (nextModels.length === 0) pi.unregisterProvider(PROVIDER);
    pi.registerProvider(PROVIDER, provider.config(nextModels));
  }

  function throwAfterRollback(previousModels: typeof models, original: unknown): never {
    try {
      installProvider(previousModels);
    } catch (rollbackError) {
      throw new AggregateError(
        [original, rollbackError],
        "WorkBuddy model scope update failed and the previous provider could not be restored",
      );
    }
    throw original;
  }

  async function switchScope(nextScope: Scope, ctx: PaintCtx): Promise<void> {
    if (transitioning) throw new Error("WorkBuddy model scope update is already in progress");

    const nextCatalog = loadProductConfig();
    const nextModels = buildOmpModels(nextCatalog, nextScope);
    const nextActiveIds = new Set(nextModels.map((model) => model.id));
    const nextKnownIds = new Set(nextCatalog.models.map((model) => model.id));
    const previousModels = models;
    pendingIds = nextKnownIds;
    transitioning = true;
    try {
      try {
        installProvider(nextModels);
      } catch (error) {
        throwAfterRollback(previousModels, error);
      }
      try {
        await saveSettings(nextScope);
      } catch (error) {
        throwAfterRollback(previousModels, error);
      }

      scope = nextScope;
      catalog = nextCatalog;
      models = nextModels;
      activeIds = nextActiveIds;
      for (const id of nextKnownIds) knownIds.add(id);
      card = undefined;
      invalidateUi("WorkBuddy model scope changed");

      if (
        ctx.model?.provider === PROVIDER
        && typeof ctx.model.id === "string"
        && !activeIds.has(ctx.model.id)
      ) {
        ctx.ui.notify(
          `当前模型 ${ctx.model.id} 已不在 WorkBuddy ${scope} 范围内，请重新选择模型`,
          "warning",
        );
      }
    } finally {
      pendingIds = new Set();
      transitioning = false;
    }
  }

  async function repaint(
    ctx: PaintCtx,
    notify = false,
    force = false,
  ): Promise<string[] | undefined> {
    const generation = invalidateUi("WorkBuddy UI superseded");
    const signal = uiAbort.signal;
    const guard: PaintGuard = {
      signal,
      current: () => generation === uiGeneration && !signal.aborted,
    };
    const lines = await paint(ctx, provider, guard, notify, extra(), force);
    if (guard.current()) card = lines;
    return lines;
  }

  async function logout(ctx: PaintCtx): Promise<void> {
    invalidateUi("WorkBuddy logout");
    try {
      await provider.logout();
      card = undefined;
      ctx.ui.setWidget("workbuddy", undefined);
      ctx.ui.setStatus("workbuddy", undefined);
      ctx.ui.notify("WorkBuddy 已断开登录", "info");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      ctx.ui.notify(`WorkBuddy 退出失败：${message}`, "error");
    }
  }

  async function chooseScope(nextScope: Scope, ctx: PaintCtx): Promise<void> {
    try {
      await switchScope(nextScope, ctx);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      ctx.ui.notify(`WorkBuddy 模型范围切换失败：${message}`, "error");
      return;
    }
    await repaint(ctx, true, true);
  }

  installProvider(models);

  pi.on("before_provider_request", (event) => {
    const payload = asObject(event.payload);
    if (!payload || typeof payload.model !== "string") return;
    const modelId = payload.model;
    if (transitioning && (knownIds.has(modelId) || pendingIds.has(modelId))) {
      throw new Error(`WorkBuddy model "${modelId}" is unavailable while its scope is changing`);
    }
    if (activeIds.has(modelId)) return prepareChatPayload(payload);
    if (knownIds.has(modelId)) {
      throw new Error(
        `WorkBuddy model "${modelId}" is outside the active "${scope}" scope; select an available model`,
      );
    }
  });

  pi.on("session_start", (_event, ctx) => {
    provider.bindContext(ctx);
    // Never block session startup on the optional account/credits card.
    void repaint(ctx).catch(() => undefined);
  });

  pi.on("session_switch", (_event, ctx) => {
    invalidateUi("WorkBuddy session switched");
    card = undefined;
    provider.bindContext(ctx);
  });

  pi.on("session_shutdown", () => {
    invalidateUi("WorkBuddy session shutdown");
    card = undefined;
    provider.shutdown();
  });

  // OMP refreshes model-dependent UI at the next turn; never block it on network I/O.
  pi.on("turn_start", (_event, ctx) => {
    if (!showsWorkBuddyCard(ctx.model?.provider)) {
      invalidateUi("WorkBuddy model inactive");
      card = undefined;
      ctx.ui.setWidget("workbuddy", undefined);
      ctx.ui.setStatus("workbuddy", undefined);
      return;
    }
    if (card) ctx.ui.setWidget("workbuddy", card);
    void repaint(ctx).catch(() => undefined);
  });

  pi.registerCommand("workbuddy", {
    description: "WorkBuddy 设置：刷新积分、免费/全部模型、断开登录",
    handler: async (args, ctx) => {
      const cmd = String(args ?? "").trim().toLowerCase();
      if (cmd === "free" || cmd === "all") {
        await chooseScope(cmd, ctx);
        return;
      }
      if (cmd === "logout" || cmd === "disconnect") {
        await logout(ctx);
        return;
      }
      const pick = await ctx.ui.select("WorkBuddy 设置", [
        "刷新积分与账号",
        scope === "free" ? "列出全部模型（含付费）" : "只列出免费模型",
        "断开登录",
      ]);
      if (pick === undefined) return;
      if (pick.startsWith("列出全部")) {
        await chooseScope("all", ctx);
        return;
      }
      if (pick.startsWith("只列出")) {
        await chooseScope("free", ctx);
        return;
      }
      if (pick === "断开登录") {
        await logout(ctx);
        return;
      }
      await repaint(ctx, true, true);
    },
  });
}

if (process.argv.includes("--self-check")) {
  const payload = prepareChatPayload({
    model: "hy3",
    messages: [{ role: "developer", content: "sys" }, { role: "user", content: "hi" }],
    tool_choice: { type: "function", function: { name: "foo" } },
  });
  if (payload.stream !== true) throw new Error("stream");
  if ((payload.messages as { role: string }[])[0].role !== "system") throw new Error("system");
  if (payload.tool_choice !== "foo") throw new Error("tool_choice");
  if (payload.reasoning_effort !== undefined) throw new Error("no injected effort");
  const kept = prepareChatPayload({ messages: [], reasoning_effort: "max" });
  if (kept.reasoning_effort !== "max") throw new Error("explicit effort preserved");
  if (!showsWorkBuddyCard("workbuddy")) throw new Error("card: own provider shown");
  if (showsWorkBuddyCard("GROKCPA")) throw new Error("card: foreign provider hidden");
  if (showsWorkBuddyCard(undefined) || showsWorkBuddyCard(null) || showsWorkBuddyCard(42)) throw new Error("card: unknown provider hidden");
  if (!showsWorkBuddyCard("GROKCPA", true)) throw new Error("card: explicit command overrides");
  const ours = new Set(["hy3", "deepseek-v4.1-flash"]);
  if (!isWorkBuddyModel("hy3", ours)) throw new Error("scope: own model accepted");
  if (isWorkBuddyModel("grok-4.6", ours)) throw new Error("scope: foreign model must be rejected");
  if (isWorkBuddyModel(undefined, ours) || isWorkBuddyModel(42, ours)) throw new Error("scope: non-string rejected");
  const prepended = prepareChatPayload({ messages: [{ role: "user", content: "hi" }] });
  if ((prepended.messages as { role: string }[])[0].role !== "system") throw new Error("prepend");
  const flash = buildOmpModels(loadProductConfig("/definitely/missing/workbuddy-product-config.json"), "all")
    .find((model) => model.id === "deepseek-v4.1-flash");
  if (flash?.maxTokens !== FLASH_MAX_TOKENS) throw new Error("flash cap");
  const looped = prepareChatPayload({
    model: "deepseek-v4.1-flash",
    max_tokens: 128_000,
    messages: [{ role: "assistant", content: "done", reasoning: "OK.\nLet me write.", thinking: "Go." }],
  });
  const assistant = (looped.messages as Record<string, unknown>[])[1];
  if (assistant.reasoning !== undefined || assistant.thinking !== undefined) throw new Error("reasoning replay");
  if (looped.max_tokens !== FLASH_MAX_TOKENS) throw new Error("flash payload cap");

  const credits = parseCredits({
    code: 0,
    data: {
      Response: {
        Data: {
          Accounts: [
            { PackageName: "Bonus Pack", CycleCapacitySize: 250, CycleCapacityRemain: 249 },
            { PackageName: "Free Plan Subscription", CycleCapacitySize: 100, CycleCapacityRemain: 100 },
          ],
        },
      },
    },
  });
  if (credits.total !== 349 || credits.packs.length !== 2) throw new Error("credits");
  const lines = widgetLines({
    cred: {
      accessToken: "a",
      expiresAtMs: Date.UTC(2027, 8, 12, 1, 30, 0),
      uid: "u",
      enterpriseId: "e",
      nickname: "user@example.com",
    },
    credits,
  });
  if (!lines.some((line) => line.includes("user@example.com"))) throw new Error("account");
  if (!lines.some((line) => line.includes("合计 349"))) throw new Error("total");
  console.log("ok");
}
