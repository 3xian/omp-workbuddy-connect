# OMP WorkBuddy Connect

> **Development status — not release-ready**
>
> M0–M4 已完成；M5 发布验收尚未完成，因此本分支不可发布。
> 权威实施进度见 `openspec/changes/adapt-workbuddy-international-omp/tasks.md`。
> 下文描述当前开发分支行为；尚未通过的里程碑能力会明确标注。

## 当前开发分支

WorkBuddy AI 国际版 provider for OMP。当前认证、模型目录契约、scope 切换安全、最小 Gateway 兼容和非阻塞管理面已迁移到 OMP；release gate 仍在开发。

移植自 [iceloon/dsh-workbuddyai-connect](https://github.com/iceloon/dsh-workbuddyai-connect)（DSH 插件）；当前实现直接注册 OMP provider，不使用 shim 或 loopback 代理。

## 开发加载

当前分支尚未发布，不应使用上游仓库的 `pi install` 命令冒充本实现。开发时由 OMP 18.2.6 显式加载本地入口；独立 profile 可隔离日常凭据和会话：

```bash
omp --profile workbuddy-m3-live \
  --no-extensions \
  --extension /absolute/path/to/omp-workbuddy-connect/extensions/workbuddy.ts
```

`--no-extensions` 仅关闭环境中的自动发现，不会禁用显式 `--extension`。启动后执行 `/login workbuddy`；如果 `free` 范围为空，登录后执行 `/workbuddy all`，再用 `/model` 选择 WorkBuddy 模型。

## 登录

设置 → 模型 → WorkBuddy AI → **Connect**（弹出浏览器登录页），或：

```
/login workbuddy
```

正式凭据仅由 OMP AuthStorage 持久化和刷新。`.workbuddy-auth.json`、Desktop credential 与 `WORKBUDDY_AUTH_FILE` 不参与登录或请求回退；使用 `/login workbuddy` 登录。

## 模型与推理档

默认 scope 为 `free`。只有有效 Desktop 产品目录中带明确零 multiplier credits 证据的模型会显示；`0`、`0.0`、`x0`、`x0.00` 等规范零值会归一为免费证据，非零、缺失或格式错误均不是免费。有效缓存（包括 `models: []`）是权威结果，不会被内置列表扩宽。内置清单仅作为整个目录不可用或无任何有效行时的 fallback，不构成免费证据，因此 fallback 来源的 `free` 可以为空。

每个模型的 reasoning、图片能力和推理档来自产品配置 `~/.workbuddy-ai/cache/acc-product-config-v3.json`。Widget 显示精确来源 `desktop-cache` 或 `builtin-fallback`；fallback 同时显示缺失、不可读、JSON 无效、结构无效或无有效模型的原因。缓存不可用时，`all` scope 可使用当前内置目录：

| 模型 | 上下文 / 有效输出上限 | OMP canonical effort |
| --- | --- | --- |
| Deepseek-V4.1-Flash | 1M / 16k | low · medium · high · xhigh · max |
| Hy4 preview | 1M / 64k | high |
| Hy3 | 192k / 64k | low · high |

推理配置使用 OMP canonical `thinking: { mode: "effort", efforts, requiresEffort }`。未声明可信 `supportedEfforts` 或 off 能力时，只保留 `reasoning` capability，不自动扩展 effort；`canDisableThinking=false` 会禁止 off。对于允许关闭的模型，OMP 18.2.6 在没有 Gateway-specific disable 证据时会把关闭请求限制到最低受支持 effort；WorkBuddy 的真实关闭编码仍须在 M5 live gate 确认，插件不会预设未经验证的 `none` 或其他 wire 值。

## 设置

管理面完全可选；Billing、Widget 或 TUI 故障不会阻塞登录、Chat 或工具调用。

- **侧栏 Widget/status** — 显示登录、账号、积分、套餐、scope、模型数、目录来源和 Provider 状态。积分明确区分未查询、查询中、可用（含真实 0）和不可用；失败后不沿用 last-good 值。
- **`/workbuddy`** — 强制刷新并显示当前状态。
- **`/workbuddy free`** — 切到有明确免费证据的模型范围。
- **`/workbuddy all`** — 切到当前插件可识别的全部模型。
- **`/workbuddy logout`** — 失效异步 UI、删除 OMP WorkBuddy credential，并清除 Widget/status。

scope 存于 `~/.omp/agent/.workbuddy-settings.json`（或 `PI_CODING_AGENT_DIR`）。模型切换依赖 `session_start` / `turn_start`，因此 Widget 允许到下一次 turn 才反映新模型；这不影响认证或请求路由。Headless 模式不会调用 select/notify/widget/status。

非空范围切换直接重注册 Provider，让 OMP 原位替换 runtime overlay；只有权威空目录才先注销旧 Provider，以清除 OMP 18.2.6 不会被 `models: []` 覆盖的陈旧行。随后保存非敏感 scope，最后提交内存与 Widget 状态。注册或设置写入失败会恢复旧目录且不报告成功；当前模型被移出范围时插件提示重选，并在选择范围内模型前阻断 retained Model 请求，不自动选择付费模型或 fallback。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `WORKBUDDYAI_PRODUCT_CONFIG` | 指定产品配置 JSON 路径 |
| `PI_CODING_AGENT_DIR` | 覆盖 OMP agent 目录；非敏感 scope 设置文件随宿主目录规则存放 |

## 自检

```bash
npx --yes bun@1.3.14 extensions/workbuddy.ts --self-check
```

覆盖最小 payload compatibility boundary、请求预算限制与严格积分解析；模型、认证和 UI 生命周期边界由下列独立测试覆盖。

## 与上游的差异

- 直接 `pi.registerProvider`，去掉 DSH 的 shim 与 loopback 端口转发。
- 内置模型仅作为产品目录不可用时的 fallback，不是免费模型证明。
- 推理档由 OMP canonical `thinking` metadata 驱动；宿主根据 `efforts`、`requiresEffort` 和 Gateway compat 生成 `reasoning_effort`。
- 选 Default（auto）时不主动选择 effort；选择具体档位、required off 和 optional off 均由 OMP transport 根据模型 metadata 处理。
- Deepseek-V4.1-Flash 的目录与请求有效输出上限均为 16k（`FLASH_MAX_TOKENS`）：已记录的 Gateway 行为显示更大预算可能陷入重复推理循环。产品目录原始 `maxOutputTokens` 可以更高，但不会作为实际请求上限公开。
- 插件当前不清理 assistant reasoning/history；OMP 原生 history 与 tool association 保持不变。只有真实 WorkBuddy Gateway 拒绝证据可复现时，才增加最小兼容转换。
- WorkBuddy Gateway 的 `tool_choice` 只接受字符串；插件仅把 OMP 原生 named-choice 对象复制为函数名字符串。该差异来自隔离 live gate 的可复现 `400` / code `11101`，其他 tool/prompt/history 字段不改写。
- 不按模型名称猜测 reasoning effort，也不为缺少可信能力信息的模型生成全档默认。

## 测试

```bash
npx --yes bun@1.3.14 test/payload.test.mts
npx --yes bun@1.3.14 test/tool-loop.test.mts
npx --yes bun@1.3.14 test/native-transport.test.mts
npx --yes bun@1.3.14 test/model-catalog.test.mts
npx --yes bun@1.3.14 test/model-transport.test.mts
npx --yes bun@1.3.14 test/settings.test.mts
npx --yes bun@1.3.14 test/auth.test.mts
npx --yes bun@1.3.14 test/provider.test.mts
npx --yes bun@1.3.14 test/scope.test.mts
npx --yes bun@1.3.14 test/session-start.test.mts
npx --yes bun@1.3.14 test/credits.test.mts
npx --yes bun@1.3.14 test/ui.test.mts
npx --yes bun@1.3.14 test/contract/model-scope-lifecycle.test.mts
npx --yes bun@1.3.14 test/contract/before-provider-request-runtime.test.mts
npx --yes bun@1.3.14 test/contract/persisted-credential-restart.test.mts
npx --yes bun@1.3.14 test/contract/request-identity-binding.test.mts
npx --yes bun@1.3.14 test/contract/task-runtime-contract.test.mts
npx --yes bun@1.3.14 test/contract/provider-logout.test.mts
npx tsc --noEmit
```

## License

MIT
