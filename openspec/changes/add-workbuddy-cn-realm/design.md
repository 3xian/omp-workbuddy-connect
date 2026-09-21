# Design

## Context

见 `proposal.md` 的 Why。当前扩展以一个国际站 Provider 为中心：入口闭包、认证客户端、模型构建、设置、Usage 和 UI 模块均直接使用 `workbuddy`、国际站端点或单一状态 key。`before_provider_request` 已按 Provider 过滤，但部分兼容逻辑仍只按 model ID 决定；这在两个 realm 出现相同 model ID 时会串扰。

中国站开发计划给出了可能的 origin、API、OAuth、缓存路径和响应结构，但这些值尚不是可发布事实。现有国际站已经完成真实 OMP、OAuth、Gateway、main/task/headless 和 UI/Usage 验证，因此本设计优先保护该基线，不把双站支持演化为通用多租户框架。

## Goals / Non-Goals

**Goals:**

- 用最小静态配置表达两个已知 realm 的差异，同时复用已证明确实相同的纯逻辑。
- 让认证、endpoint/header、模型目录、scope/settings、兼容修正、Usage/UI 和生命周期状态按 Provider 隔离。
- 先将国际站迁移到新结构并证明行为不变，再接入经过真实证据冻结的中国站。
- 让未知中国站目录或 Billing 能力显式 unavailable，而不是猜测、跨站回退或伪造可用状态。
- 保持当前模块划分和串行测试运行方式；只添加能防止真实跨 realm 风险的测试。

**Non-Goals:**

- 自动识别用户地区、自动选择站点或在失败时跨站重试。
- 同一 Provider 内多账号选择、账号合并或 credential migration。
- 构建任意数量 Provider 的插件框架、依赖注入容器或动态配置系统。
- 在没有中国站实证时实现 Billing、builtin catalog 或国际站兼容 workaround。
- 修改 OMP、复制 Chat transport/SSE parser，或改变国际站已有存储格式和命令语义。

## Decisions

### 1. 使用一个小型不可变 SiteDescriptor，而非通用 Provider 框架

引入一个只覆盖当前硬编码差异的只读描述符。预期字段按实际调用点分组：

- 身份：`providerId`、命令名、显示名；
- 协议：Chat base URL、OAuth start/poll/refresh URL、允许的 origin/referrer/product/domain headers、Plugin Auth headers、refresh source、pending/status 判定；
- 目录：已验证的缓存定位/解析器、可选 builtin、来源标签；
- 兼容：目标 realm 明确启用的 payload flags，以及以 provider + model 为键的预算覆盖；
- 本地状态：Provider 专属 settings 文件/key、Widget key 和 Usage 标识。

描述符不包含可变 credential、当前 scope、generation、registry 或 session。类型尽量使用字面量联合和 `Readonly`，构造后冻结；不增加继承层次、service locator 或运行时配置文件。

**理由：** 两个 realm 的差异明确且数量有限。静态描述符让审查者能直接看到安全边界，同时避免继续散落常量。

**未选方案：** 复制一套 CN 模块会让认证和修复逻辑漂移；通用 adapter/plugin framework 会为当前两个固定站点增加无收益抽象。

### 2. 每个 realm 创建独立运行时闭包

入口为每个已准入描述符调用同一个小型装配函数，得到独立的 registry 绑定、credential authority、scope/settings、目录状态、state generation、AbortController 集合和 UI 生命周期。共享模块只接收显式 descriptor 或 realm runtime，不读取“当前站点”全局变量。

`before_provider_request` 保持单一全局 hook 也可以，但必须按 `ctx.model.provider` 精确分派到不可变 realm policy；找不到 policy 时原样返回。request-bound `resolveHeaders` 继续承担 retained model、scope 和身份的 transport 前 fail-closed。

**理由：** 现有入口已经用闭包保存国际站运行态。按 realm 各建一个闭包比引入全局 map 的可变协调器更简单，也天然隔离取消和迟到结果。

### 3. M0 证据完成前不写入可发布 CN 协议值

先从授权中国站客户端和真实服务保存脱敏证据：客户端/Gateway 版本、所有 endpoint、固定 headers、start/poll/refresh 请求响应、pending/拒绝/超时/429 语义、JWT/identity 字段、缓存路径与 schema、模型能力和计费可用性。证据必须能区分“观察到”“推断”和“未获得”。

国际站 descriptor 可立即由当前常量机械迁移；CN descriptor 只有在上述关键字段冻结后才加入生产装配。无法获得某一可选能力的证据时采用明确缺省：无 builtin、目录 unavailable、无 UsageProvider，而不是阻塞已经验证的 Chat 核心或借用国际站值。

**理由：** 认证和 endpoint 猜错会造成凭据泄露或误路由，风险高于延后注册。

### 4. 兼容策略以 realm 为第一维度

payload policy 先按 provider 选择，再按该 realm 的证据处理 reasoning history、tool choice 和 unsupported fields。token clamp 使用 `(providerId, modelId)` 组合键或直接附着在目标 realm 的模型 metadata 上。国际站 `deepseek-v4.1-flash` 或 named-tool-choice 行为不成为 CN 默认值。

每个 workaround 必须有一个删除后可复现的真实 Gateway failure 和永久行为回归；无证据时走 OMP 原生 OpenAI-compatible 语义。

### 5. 目录、设置与 Usage 采取显式失败而非 fallback

- 国际站保持当前 Desktop cache → builtin fallback 和 free/all 语义。
- 中国站只读取经证据确认的位置和 schema；缺失/损坏且无已验证 builtin 时返回带原因的 `unavailable` 或 `empty` catalog，不读取国际站缓存。
- settings 保持在 OMP agent 目录，但文件名或顶层 key 按 provider 分离；旧国际站文件继续原样读取。
- 中国站在 Billing 契约验证前不注册 UsageProvider。`/workbuddy-cn` 仍显示账号、scope、目录和 provider state，credits/plan 显示 unavailable，且不发 Billing 请求。
- Widget key、Usage report filter、summary 和 generation 均使用 provider-specific identity。

### 6. 测试按风险分层，不做全量笛卡尔参数化

现有国际站测试继续作为稳定回归。只将无 realm 差异的纯函数/契约测试参数化；保留以下显式双站场景：

- 两个 AuthStorage namespace 同时登录、刷新、logout 和取消；
- 相同 model ID 下 endpoint/header、payload policy、token budget 和 retained model 隔离；
- 独立 cache、free/all、空目录、settings 重启恢复；
- Usage/UI pending result、generation、Widget key 和 lifecycle 清理互不影响；
- main、Task/subagent、headless 在中国站真实环境中的认证、Streaming 与工具闭环。

Mock 只证明本地边界；中国站发布仍需要真实 OAuth、Chat、reasoning、tools、声明的 vision 和版本化证据。

## Risks / Trade-offs

- **[中国站资料不可获得或协议频繁变化]** → 把 Provider 注册作为证据 gate；国际站迁移和回归可独立完成，中国站保持不可发布。
- **[descriptor 逐渐膨胀成配置框架]** → 只在两个 realm 确有不同且有调用点时添加字段；共同常量留在实现中，不提前抽象。
- **[国际站重构产生隐性行为变化]** → M1 只做 descriptor/闭包迁移，不同时加入 CN；对出站请求、设置路径、目录、Usage 和 UI 做前后对照。
- **[相同 model ID 导致全局 hook 串扰]** → 所有 dispatch 和 override 以 provider 为第一键，并保留第三方同 ID 原样回归。
- **[CN 无目录导致 Provider 看似安装但不可用]** → UI 明确报告 unavailable/empty 和原因；不注册伪模型，不回退国际站。
- **[双 realm live 验证成本增加]** → 共享确定性测试，但不削减身份、endpoint 和发布矩阵；串行运行避免当前 harness 的共享资源竞争。

## Migration Plan

1. 冻结当前国际站代码、类型、测试和 live evidence 基线；采集并评审中国站协议/缓存证据。
2. 引入最小 descriptor 与 realm runtime 装配，仅迁移 `workbuddy`；运行完整国际站 contract/runtime/live 回归，任何差异先修复再继续。
3. 基于已冻结证据添加 `workbuddy-cn` descriptor、独立认证/目录/settings/命令和 realm policy；默认不启用未验证 Usage 或 builtin。
4. 执行双 realm 隔离矩阵与中国站 live matrix；只有全部必需 gate 通过后更新 README、安装说明和包版本。
5. 回滚时移除 CN 生产装配和文档声明即可；国际站 descriptor 路径保留，因为其行为已独立验证且不依赖 CN。
