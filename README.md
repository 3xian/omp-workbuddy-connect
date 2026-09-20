# OMP WorkBuddy Connect

> **Development status — not release-ready**
>
> M0、M1 与 M2 3.1–3.5 已完成；M2 3.6–3.10 以及 M3–M5 尚未完成，因此本分支不可发布。
> 权威实施进度见 `openspec/changes/adapt-workbuddy-international-omp/tasks.md`。
> 下文描述当前开发分支行为；尚未通过的里程碑能力会明确标注。

## 当前开发分支

WorkBuddy AI 国际版 provider for OMP。当前认证与基础模型契约已迁移到 OMP，完整 M2 scope 切换安全与后续 Gateway/UI/release gate 仍在开发。

移植自 [iceloon/dsh-workbuddyai-connect](https://github.com/iceloon/dsh-workbuddyai-connect)（DSH 插件）；当前实现直接注册 OMP provider，不使用 shim 或 loopback 代理。

## 安装

```bash
pi install git:github.com/icekale/pi-workbuddy-connect
```

或本地加载：

```bash
pi -e /path/to/pi-workbuddy-connect
```

## 登录

设置 → 模型 → WorkBuddy AI → **Connect**（弹出浏览器登录页），或：

```
/login workbuddy
```

正式凭据仅由 OMP AuthStorage 持久化和刷新。`.workbuddy-auth.json`、Desktop credential 与 `WORKBUDDY_AUTH_FILE` 不参与登录或请求回退；使用 `/login workbuddy` 登录。

## 模型与推理档

默认 scope 为 `free`。只有有效 Desktop 产品目录中带明确零 multiplier credits 证据的模型会显示；`0`、`0.0`、`x0`、`x0.00` 等规范零值会归一为免费证据，非零、缺失或格式错误均不是免费。内置清单仅作为目录 fallback，不构成免费证据，因此 fallback 来源的 `free` 可以为空。

每个模型的 reasoning、图片能力和推理档来自产品配置 `~/.workbuddy-ai/cache/acc-product-config-v3.json`。缓存不可用时，`all` scope 可使用当前内置目录：

| 模型 | 上下文 / 有效输出上限 | OMP canonical effort |
| --- | --- | --- |
| Deepseek-V4.1-Flash | 1M / 16k | low · medium · high · xhigh · max |
| Hy4 preview | 1M / 64k | high |
| Hy3 | 192k / 64k | low · high |

推理配置使用 OMP canonical `thinking: { mode: "effort", efforts, requiresEffort }`。未声明可信 `supportedEfforts` 或 off 能力时，只保留 `reasoning` capability，不自动扩展 effort；`canDisableThinking=false` 会禁止 off。对于允许关闭的模型，OMP 18.2.6 在没有 Gateway-specific disable 证据时会把关闭请求限制到最低受支持 effort；WorkBuddy 的真实关闭编码仍须在 3.10 通过 live 请求确认，插件不会预设未经验证的 `none` 或其他 wire 值。

## 设置

pi 没有 DSH 那种插件配置卡片，等价入口有两处：

- **侧栏 widget** — 账号、token 过期时间、各积分包余量，以及当前模型列表。
- **`/workbuddy`** — 弹出选择菜单：

  ```
  刷新积分与账号
  列出全部模型（含付费）   ← 切换范围，scope 存 ~/.pi/agent/.workbuddy-settings.json
  断开登录
  ```

  也接受参数：`/workbuddy free` · `/workbuddy all`。断开认证请使用宿主命令 `/logout workbuddy`。

切换范围会立即重注册 provider；空目录清理与 retained model 阻断仍属于未完成的 3.7/3.8，当前不可视为完整 scope 安全保证。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `WORKBUDDYAI_PRODUCT_CONFIG` | 指定产品配置 JSON 路径 |
| `PI_CODING_AGENT_DIR` | OMP agent 目录，当前仅影响非敏感设置文件位置 |

## 自检

```bash
npx --yes bun@1.3.14 extensions/workbuddy.ts --self-check
```

覆盖 payload 规整、请求预算限制、积分解析与 widget 渲染；模型和认证边界由下列独立测试覆盖。

## 与上游的差异

- 直接 `pi.registerProvider`，去掉 DSH 的 shim 与 loopback 端口转发。
- 内置模型仅作为产品目录不可用时的 fallback，不是免费模型证明。
- 推理档由 OMP canonical `thinking` metadata 驱动；宿主根据 `efforts`、`requiresEffort` 和 Gateway compat 生成 `reasoning_effort`。
- 选 Default（auto）时不主动选择 effort；选择具体档位、required off 和 optional off 均由 OMP transport 根据模型 metadata 处理。
- Deepseek-V4.1-Flash 的目录与请求有效输出上限均为 16k（`FLASH_MAX_TOKENS`）：已记录的 Gateway 行为显示更大预算可能陷入重复推理循环。产品目录原始 `maxOutputTokens` 可以更高，但不会作为实际请求上限公开。
- 发送前剔除 assistant 消息里回放的 `reasoning` / `thinking` / `reasoning_content` 字段，上游端点会拒绝这些字段。
- 不按模型名称猜测 reasoning effort，也不为缺少可信能力信息的模型生成全档默认。

## 测试

```bash
node test/model-catalog.test.mts
npx --yes bun@1.3.14 test/model-transport.test.mts
npx --yes bun@1.3.14 test/auth.test.mts
npx --yes bun@1.3.14 test/provider.test.mts
npx --yes bun@1.3.14 test/scope.test.mts
npx --yes bun@1.3.14 test/session-start.test.mts
npx --yes bun@1.3.14 test/contract/persisted-credential-restart.test.mts
npx --yes bun@1.3.14 test/contract/request-identity-binding.test.mts
npx --yes bun@1.3.14 test/contract/task-runtime-contract.test.mts
npx tsc -p tsconfig.json
```

## License

MIT
