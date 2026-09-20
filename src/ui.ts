import type { OAuthAccountSummary, UsageReport } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { summarizeWorkBuddyUsage, type WorkBuddyCredits } from "./credits.ts";
import type { ModelScope, ProductConfigFallbackReason, ProductConfigSource } from "./models.ts";
import { WORKBUDDY_PROVIDER } from "./provider.ts";

const FALLBACK_REASON_LABELS: Record<ProductConfigFallbackReason, string> = {
  missing: "缓存不存在",
  unreadable: "缓存不可读",
  "invalid-json": "JSON 无效",
  "invalid-schema": "结构无效",
  "no-valid-models": "无有效模型",
};

export interface WorkBuddyUiView {
  scope: ModelScope;
  models: ReadonlyArray<{ id: string; name: string }>;
  source: ProductConfigSource;
  fallbackReason?: ProductConfigFallbackReason;
  transitioning: boolean;
}

type CreditsState =
  | { kind: "unqueried" }
  | { kind: "loading" }
  | { kind: "available"; report: UsageReport; credits: WorkBuddyCredits }
  | { kind: "unavailable" };

interface RefreshOptions {
  forceRefresh?: boolean;
  notify?: boolean;
  showWhenInactive?: boolean;
}

function accountKey(account: OAuthAccountSummary): string {
  return `${account.credentialId}:${account.accountId ?? ""}:${account.orgId ?? ""}`;
}

export class WorkBuddyUiController {
  #stateGeneration = 0;
  #abort = new AbortController();
  #credits: CreditsState = { kind: "unqueried" };
  #activeSessionId: string | undefined;
  #accountKey: string | undefined;
  #card: string[] | undefined;

  constructor(private readonly currentView: () => WorkBuddyUiView) {}

  invalidate(reason: string): void {
    this.#stateGeneration += 1;
    this.#abort.abort(reason);
    this.#abort = new AbortController();
    this.#credits = { kind: "unqueried" };
    this.#card = undefined;
  }

  beginSession(ctx: ExtensionContext): void {
    const sessionId = ctx.sessionManager.getSessionId();
    if (this.#activeSessionId !== sessionId) this.invalidate("WorkBuddy session changed");
    this.#activeSessionId = sessionId;
    this.#invalidateOnAccountChange(ctx);
    if (!ctx.hasUI) return;
    if (ctx.model?.provider !== WORKBUDDY_PROVIDER) {
      this.clear(ctx, "WorkBuddy model inactive");
      return;
    }
    this.#render(ctx);
    void this.refresh(ctx).catch(() => undefined);
  }

  syncTurn(ctx: ExtensionContext): void {
    this.#invalidateOnAccountChange(ctx);
    if (!ctx.hasUI) return;
    if (ctx.model?.provider !== WORKBUDDY_PROVIDER) {
      this.clear(ctx, "WorkBuddy model inactive");
      return;
    }
    if (this.#card) this.#safeWidget(ctx, this.#card);
    void this.refresh(ctx).catch(() => undefined);
  }

  clear(ctx: ExtensionContext, reason: string): void {
    this.invalidate(reason);
    if (!ctx.hasUI) return;
    this.#safeWidget(ctx, undefined);
    this.#safeStatus(ctx, undefined);
  }

  shutdown(): void {
    this.invalidate("WorkBuddy session shutdown");
    this.#activeSessionId = undefined;
    this.#accountKey = undefined;
  }

  async refresh(ctx: ExtensionContext, options: RefreshOptions = {}): Promise<string[] | undefined> {
    if (!ctx.hasUI) return undefined;
    const view = this.currentView();
    const show = options.showWhenInactive || ctx.model?.provider === WORKBUDDY_PROVIDER;
    if (!show) {
      this.clear(ctx, "WorkBuddy model inactive");
      return undefined;
    }

    const accounts = ctx.modelRegistry.authStorage.listOAuthAccounts(
      WORKBUDDY_PROVIDER,
      ctx.sessionManager.getSessionId(),
    );
    const account = accounts.length === 1 && accounts[0]?.accountId ? accounts[0] : undefined;
    if (!account) {
      this.invalidate("WorkBuddy account unavailable");
      this.#credits = { kind: "unavailable" };
      return this.#render(ctx, options.notify);
    }

    const nextAccountKey = accountKey(account);
    if (this.#accountKey !== undefined && this.#accountKey !== nextAccountKey) {
      this.invalidate("WorkBuddy account switched");
    }
    this.#accountKey = nextAccountKey;
    const generation = ++this.#stateGeneration;
    this.#abort.abort("WorkBuddy UI superseded");
    this.#abort = new AbortController();
    const signal = this.#abort.signal;
    const sessionId = ctx.sessionManager.getSessionId();
    const scope = view.scope;
    this.#credits = { kind: "loading" };
    this.#render(ctx);

    try {
      if (options.forceRefresh) {
        await ctx.modelRegistry.authStorage.invalidateUsageCache(WORKBUDDY_PROVIDER, signal);
      }
      const reports = await ctx.modelRegistry.authStorage.fetchUsageReports({ signal });
      const report = reports?.find((candidate) => candidate.provider === WORKBUDDY_PROVIDER
        && candidate.limits.every((limit) => !limit.scope.accountId || limit.scope.accountId === account.accountId));
      const credits = report ? summarizeWorkBuddyUsage(report) : undefined;
      if (!this.#isCurrent(ctx, generation, sessionId, scope, nextAccountKey, options.showWhenInactive)) return undefined;
      this.#credits = report && credits ? { kind: "available", report, credits } : { kind: "unavailable" };
    } catch {
      if (!this.#isCurrent(ctx, generation, sessionId, scope, nextAccountKey, options.showWhenInactive)) return undefined;
      this.#credits = { kind: "unavailable" };
    }
    return this.#render(ctx, options.notify);
  }

  #invalidateOnAccountChange(ctx: ExtensionContext): void {
    const accounts = ctx.modelRegistry.authStorage.listOAuthAccounts(
      WORKBUDDY_PROVIDER,
      ctx.sessionManager.getSessionId(),
    );
    const nextKey = accounts.length === 1 && accounts[0]?.accountId ? accountKey(accounts[0]) : undefined;
    if (this.#accountKey !== undefined && this.#accountKey !== nextKey) this.invalidate("WorkBuddy account switched");
    this.#accountKey = nextKey;
  }

  #isCurrent(
    ctx: ExtensionContext,
    generation: number,
    sessionId: string,
    scope: ModelScope,
    expectedAccountKey: string,
    showWhenInactive = false,
  ): boolean {
    if (generation !== this.#stateGeneration || this.#abort.signal.aborted || !ctx.hasUI) return false;
    if (this.#activeSessionId !== sessionId || ctx.sessionManager.getSessionId() !== sessionId) return false;
    if (!showWhenInactive && ctx.model?.provider !== WORKBUDDY_PROVIDER) return false;
    if (this.currentView().scope !== scope) return false;
    const accounts = ctx.modelRegistry.authStorage.listOAuthAccounts(WORKBUDDY_PROVIDER, sessionId);
    return accounts.length === 1 && accounts[0]?.accountId !== undefined && accountKey(accounts[0]) === expectedAccountKey;
  }

  #lines(ctx: ExtensionContext): string[] {
    const view = this.currentView();
    const accounts = ctx.modelRegistry.authStorage.listOAuthAccounts(
      WORKBUDDY_PROVIDER,
      ctx.sessionManager.getSessionId(),
    );
    const account = accounts.length === 1 && accounts[0]?.accountId ? accounts[0] : undefined;
    const fallback = view.fallbackReason ? ` · ${FALLBACK_REASON_LABELS[view.fallbackReason]}` : "";
    const names = view.models.map((model) => model.name).join("  |  ");
    const lines = [
      `WorkBuddy AI · 国际版 · ${view.scope === "all" ? "全部模型" : "仅免费模型"}`,
      `登录  ${account ? "已登录" : accounts.length > 1 ? `不可用（${accounts.length} 个账号）` : "未登录"}`,
      `账号  ${account?.email || account?.accountId || "不可用"}`,
      `范围  ${view.scope}`,
      `模型数  ${view.models.length}`,
      `目录  ${view.source}${fallback}`,
      `模型  ${names || "（当前范围为空）"}`,
    ];

    if (this.#credits.kind === "available") {
      const { credits } = this.#credits;
      lines.push(`积分  合计 ${credits.totalRemaining}`);
      lines.push(`套餐  ${credits.plans.join("、") || "无可用套餐"}`);
      for (const pack of credits.packs) {
        const amount = pack.limit === undefined ? String(pack.remaining) : `${pack.remaining} / ${pack.limit}`;
        lines.push(`  ${pack.name}  剩余 ${amount}`);
      }
    } else if (this.#credits.kind === "loading") {
      lines.push("积分  查询中");
      lines.push("套餐  查询中");
    } else if (this.#credits.kind === "unavailable") {
      lines.push("积分  不可用");
      lines.push("套餐  不可用");
    } else {
      lines.push("积分  未查询");
      lines.push("套餐  未查询");
    }

    const providerState = view.transitioning
      ? "切换中"
      : !account
        ? "认证不可用"
        : view.models.length === 0
          ? "已就绪（当前范围无模型）"
          : "已就绪";
    lines.push(`Provider  ${providerState}`);
    lines.push("设置  /workbuddy free | all | logout");
    return lines;
  }

  #render(ctx: ExtensionContext, notify = false): string[] | undefined {
    if (!ctx.hasUI) return undefined;
    const lines = this.#lines(ctx);
    this.#card = lines;
    this.#safeWidget(ctx, lines);
    const status = this.#credits.kind === "available"
      ? `WorkBuddy · 积分 ${this.#credits.credits.totalRemaining}`
      : this.#credits.kind === "loading"
        ? "WorkBuddy · 积分查询中"
        : this.#credits.kind === "unavailable"
          ? "WorkBuddy · 积分不可用"
          : "WorkBuddy · 积分未查询";
    this.#safeStatus(ctx, status);
    if (notify) {
      const message = this.#credits.kind === "available"
        ? `WorkBuddy 状态已更新 · 积分 ${this.#credits.credits.totalRemaining}`
        : "WorkBuddy 状态已更新 · 积分不可用";
      this.#safeNotify(ctx, message, this.#credits.kind === "available" ? "info" : "warning");
    }
    return lines;
  }

  #safeWidget(ctx: ExtensionContext, content: string[] | undefined): void {
    try {
      ctx.ui.setWidget("workbuddy", content);
    } catch {
      // Optional UI failures never enter the Chat plane.
    }
  }

  #safeStatus(ctx: ExtensionContext, text: string | undefined): void {
    try {
      ctx.ui.setStatus("workbuddy", text);
    } catch {
      // Optional UI failures never enter the Chat plane.
    }
  }

  #safeNotify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
    try {
      ctx.ui.notify(message, type);
    } catch {
      // Optional UI failures never enter the Chat plane.
    }
  }
}
