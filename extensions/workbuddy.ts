// WorkBuddy AI international provider for OMP.
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  createWorkBuddyProvider,
  type WorkBuddyAccountAccess,
  type WorkBuddyProviderController,
} from "../src/provider.ts";

type Cred = WorkBuddyAccountAccess & { expiresAtMs?: number; nickname?: string };

const PROVIDER = "workbuddy";
const GLOBAL_BASE = "https://www.workbuddy.ai";
const CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
const PRODUCT_CONFIG_ENV = "WORKBUDDYAI_PRODUCT_CONFIG";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens" as const,
};
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
type Scope = "free" | "all";




type ProductModel = {
  id: string;
  name: string;
  credits?: string;
  contextWindow: number;
  maxTokens: number;
  supportsImages: boolean;
  supportsReasoning: boolean;
  supportedEfforts?: Effort[];
  canDisableThinking: boolean;
};

type ProductConfig = { source: "cache" | "builtin"; models: ProductModel[] };

const FREE_IDS = ["hy3", "deepseek-v4.1-flash", "hy4-preview-f"] as const;
// ponytail: flash reasoning loops (OK/Let me write/Go) eat 128k max_tokens; 16k stops the stall. Raise if long answers get cut.
const FLASH_MAX_TOKENS = 16_384;

const BUILTIN_MODELS: ProductModel[] = [
  {
    id: "deepseek-v4.1-flash",
    name: "Deepseek-V4.1-Flash",
    credits: "x0.00",
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    supportsImages: true,
    supportsReasoning: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    canDisableThinking: false,
  },
  {
    id: "hy4-preview-f",
    name: "Hy4 preview",
    credits: "x0.00",
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    supportsImages: true,
    supportsReasoning: true,
    supportedEfforts: ["high"],
    canDisableThinking: false,
  },
  {
    id: "hy3",
    name: "Hy3",
    credits: "x0.00",
    contextWindow: 192_000,
    maxTokens: 64_000,
    supportsImages: true,
    supportsReasoning: true,
    supportedEfforts: ["low", "high"],
    canDisableThinking: false,
  },
];

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function productConfigPath(): string {
  const override = process.env[PRODUCT_CONFIG_ENV]?.trim();
  if (override) return override;
  return join(homedir(), ".workbuddy-ai", "cache", "acc-product-config-v3.json");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function creditsAreFree(credits: string | undefined): boolean {
  if (credits === undefined) return false;
  return /^x?0(?:\.0+)?$/u.test(credits.trim());
}

function parseEffort(value: unknown): Effort | undefined {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value)
    ? value as Effort
    : undefined;
}

function parseProductModel(value: unknown): ProductModel | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (id === "") return undefined;
  const reasoning = asRecord(row.reasoning);
  const rawEfforts = reasoning?.supportedEfforts;
  let supportedEfforts: Effort[] | undefined;
  if (Array.isArray(rawEfforts)) {
    const efforts = rawEfforts.map(parseEffort).filter((e): e is Effort => e !== undefined);
    if (efforts.length > 0) supportedEfforts = efforts;
  }
  return {
    id,
    name: typeof row.name === "string" && row.name !== "" ? row.name : id,
    ...(typeof row.credits === "string" && row.credits.trim() !== "" ? { credits: row.credits.trim() } : {}),
    contextWindow: positiveNumber(row.maxInputTokens) ?? positiveNumber(row.maxAllowedSize) ?? 0,
    maxTokens: positiveNumber(row.maxOutputTokens) ?? 0,
    supportsImages: row.supportsImages === true && row.disabledMultimodal !== true,
    supportsReasoning: row.supportsReasoning === true,
    ...supportedEfforts ? { supportedEfforts } : {},
    canDisableThinking: reasoning?.canDisableThinking === true,
  };
}

export function parseProductConfig(text: string): ProductConfig | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const document = asRecord(parsed);
  if (!document || !Array.isArray(document.models)) return undefined;
  const models = document.models.map(parseProductModel).filter((m): m is ProductModel => m !== undefined);
  if (models.length === 0) return undefined;
  return { source: "cache", models };
}

export function loadProductConfig(path = productConfigPath()): ProductConfig {
  try {
    const parsed = parseProductConfig(readFileSync(path, "utf8"));
    if (parsed) return parsed;
  } catch { /* missing/unreadable cache → builtin */ }
  return { source: "builtin", models: BUILTIN_MODELS };
}

export function freeModelIds(config: ProductConfig): readonly string[] {
  if (config.source === "builtin") return FREE_IDS;
  const free = config.models.filter((m) => creditsAreFree(m.credits)).map((m) => m.id);
  return free.length > 0 ? free : FREE_IDS;
}

function settingsPath(): string {
  return join(agentDir(), ".workbuddy-settings.json");
}

export function loadSettings(): { scope: Scope } {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as { scope?: string };
    if (parsed.scope === "all") return { scope: "all" };
  } catch { /* default free */ }
  return { scope: "free" };
}

async function saveSettings(scope: Scope): Promise<void> {
  await writeFile(settingsPath(), `${JSON.stringify({ scope }, null, 2)}\n`, { mode: 0o600 });
}

export function buildPiModels(config: ProductConfig, scope: Scope) {
  const byId = new Map<string, ProductModel>();
  if (config.source === "cache") {
    for (const model of config.models) byId.set(model.id, model);
  }
  for (const model of BUILTIN_MODELS) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  const free = new Set(freeModelIds(config));
  const rows = [...byId.values()].filter((model) => scope === "all" || free.has(model.id));
  return rows.flatMap((row) => {
    if (row.contextWindow <= 0 || row.maxTokens <= 0) return [];
    const credits = row.credits ?? "x?";
    return [{
      id: row.id,
      name: `${row.name} · ${credits}`,
      reasoning: row.supportsReasoning,
      input: (row.supportsImages ? ["text", "image"] : ["text"]) as ("text" | "image")[],
      cost: ZERO_COST,
      contextWindow: row.contextWindow,
      maxTokens: row.id === "deepseek-v4.1-flash" ? Math.min(row.maxTokens, FLASH_MAX_TOKENS) : row.maxTokens,
      compat: COMPAT,
    }];
  });
}



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
      ? Math.min(current, FLASH_MAX_TOKENS)
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

export function widgetLines(input: {
  cred?: Cred;
  credits?: { total: number; packs: Pack[] };
  error?: string;
  scope?: Scope;
  models?: { name: string }[];
}): string[] {
  const scope = input.scope ?? "free";
  const lines = [`WorkBuddy AI · 国际版 · ${scope === "all" ? "全部模型" : "仅免费模型"}`];
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
  const names = (input.models ?? []).map((model) => model.name).join("  |  ") || "（无模型）";
  lines.push(`模型  ${names}`);
  lines.push("设置  /workbuddy");
  return lines;
}

async function fetchCredits(cred: Cred): Promise<{ total: number; packs: Pack[] }> {
  const now = new Date();
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
    signal: AbortSignal.timeout(30_000),
  });
  const envelope: unknown = await response.json();
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

type PaintCtx = { ui: Ui; model?: { provider?: string } };

/** Paints the card and returns the lines drawn, or undefined when hidden. */
async function paint(
  ctx: PaintCtx,
  provider: WorkBuddyProviderController,
  notify = false,
  extra: { scope: Scope; models: { name: string }[] } = { scope: "free", models: [] },
  force = false,
): Promise<string[] | undefined> {
  const { ui } = ctx;
  if (!showsWorkBuddyCard(ctx.model?.provider, force)) {
    ui.setWidget("workbuddy", undefined);
    ui.setStatus("workbuddy", undefined);
    return undefined;
  }
  let cred: Cred | undefined;
  let credits: { total: number; packs: Pack[] } | undefined;
  let error: string | undefined;
  try {
    cred = await provider.resolveCredential();
    credits = await fetchCredits(cred);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const lines = widgetLines({ cred, credits, error, ...extra });
  ui.setWidget("workbuddy", lines);
  ui.setStatus("workbuddy", credits ? `积分 ${credits.total}` : cred ? "WorkBuddy 已登录" : "WorkBuddy 未登录");
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
  let models = buildPiModels(loadProductConfig(), scope);
  let ids = new Set(models.map((model) => model.id));
  /** Last painted card lines for this session, reused on model switch. */
  let card: string[] | undefined;
  const extra = () => ({ scope, models });


  function apply(next?: Scope) {
    if (next) scope = next;
    models = buildPiModels(loadProductConfig(), scope);
    ids = new Set(models.map((model) => model.id));
    pi.registerProvider(PROVIDER, provider.config(models));
  }

  apply();


  pi.on("before_provider_request", (event) => {
    const payload = asObject(event.payload);
    if (!payload || !isWorkBuddyModel(payload.model, ids)) return;
    return prepareChatPayload(payload);
  });

  pi.on("session_start", (_event, ctx) => {
    provider.bindContext(ctx);
    // Never block session startup on the optional account/credits card.
    void paint(ctx, provider, false, extra())
      .then((lines) => { card = lines; })
      .catch(() => undefined);
  });

  // OMP refreshes model-dependent UI at the next turn; never block it on network I/O.
  pi.on("turn_start", (_event, ctx) => {
    if (!showsWorkBuddyCard(ctx.model?.provider)) {
      card = undefined;
      ctx.ui.setWidget("workbuddy", undefined);
      ctx.ui.setStatus("workbuddy", undefined);
      return;
    }
    if (card) ctx.ui.setWidget("workbuddy", card);
    void paint(ctx, provider, false, extra()).then((lines) => { card = lines; }).catch(() => undefined);
  });

  pi.registerCommand("workbuddy", {
    description: "WorkBuddy 设置：刷新积分、免费/全部模型、断开登录",
    handler: async (args, ctx) => {
      const cmd = String(args ?? "").trim().toLowerCase();
      if (cmd === "free" || cmd === "all") {
        await saveSettings(cmd);
        apply(cmd);
        await paint(ctx, provider, true, extra(), true);
        return;
      }
      if (cmd === "logout" || cmd === "disconnect") {
        ctx.ui.notify("请使用 /logout workbuddy 删除 OMP 保存的 WorkBuddy 凭据", "info");
        return;
      }
      const pick = await ctx.ui.select("WorkBuddy 设置", [
        "刷新积分与账号",
        scope === "free" ? "列出全部模型（含付费）" : "只列出免费模型",
        "断开登录",
      ]);
      if (pick === undefined) return;
      if (pick.startsWith("列出全部")) {
        await saveSettings("all");
        apply("all");
      } else if (pick.startsWith("只列出")) {
        await saveSettings("free");
        apply("free");
      } else if (pick === "断开登录") {
        ctx.ui.notify("请使用 /logout workbuddy 删除 OMP 保存的 WorkBuddy 凭据", "info");
      }
      await paint(ctx, provider, true, extra(), true);
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
  if (FREE_IDS.length !== 3) throw new Error("count");
  if (!creditsAreFree("x0.00") || creditsAreFree("x1.00")) throw new Error("credits free");
  const flash = buildPiModels({ source: "builtin", models: BUILTIN_MODELS }, "free")
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
  const fromCache = parseProductConfig(JSON.stringify({
    models: [{
      id: "deepseek-v4.1-flash",
      name: "Deepseek-V4.1-Flash",
      credits: "x0.00",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 128_000,
      supportsReasoning: true,
      reasoning: { supportedEfforts: ["low", "medium", "high", "xhigh", "max"] },
    }],
  }));
  if (!fromCache) throw new Error("parse config");
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
