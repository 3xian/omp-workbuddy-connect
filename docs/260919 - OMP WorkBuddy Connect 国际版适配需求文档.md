# OMP WorkBuddy Connect 国际版适配需求文档

## 1. 文档信息

**项目名称**：OMP WorkBuddy Connect  
**项目类型**：`pi-workbuddy-connect` Fork / OMP Extension  
**目标宿主**：oh-my-pi（OMP）  
**首版目标版本**：OMP 18.2.6  
**上游项目**：`icekale/pi-workbuddy-connect`  
**目标服务**：WorkBuddy AI 国际版  
**目标服务域名**：`https://www.workbuddy.ai`  
**文档状态**：开发需求基线（Requirement Revision 1.1）
**版本目标**：v1.0


## 1.1 实施裁决与修订说明

本文件定义产品目标和初始技术基线。对于 OpenSpec change `adapt-workbuddy-international-omp`，发生明确技术契约冲突时，实施优先级为：

1. 经评审的 OpenSpec normative specs；
2. `260919 - OMP WorkBuddy Connect 国际版开发计划 V2.md`；
3. 本需求文档中未被上述文件收紧或替代的内容。

Revision 1.1 已同步三项收紧：nickname 不再别名映射为 OAuth email；认证身份存在歧义时 fail closed；多账号不只是不保证轮换，而是必须证明单一有效账号及顺序换号无身份混用。

---

# 2. 项目背景

现有 `pi-workbuddy-connect` 为 upstream Pi 生态开发，能够通过 WorkBuddy AI 国际版 OAuth 登录，并将 WorkBuddy 模型注册为 Pi Provider。

现有实现主要包含：

- WorkBuddy AI OAuth 登录；
- Access Token / Refresh Token 管理；
- WorkBuddy 模型注册；
- WorkBuddy 产品配置读取；
- 免费模型 / 全部模型切换；
- reasoning / thinking level 映射；
- WorkBuddy 请求 Header 注入；
- 请求 Payload 兼容处理；
- Tool Calling 兼容处理；
- WorkBuddy 积分查询；
- `/workbuddy` 命令；
- TUI Widget / Status 展示。

OMP 与 upstream Pi 保持较高兼容性，但 Provider、OAuth、Model Metadata 和 Extension Event API 已存在一定分叉。

本项目目标不是修改 OMP，也不是要求 OMP 增加兼容 API，而是：

> Fork `pi-workbuddy-connect`，将其重构为面向 OMP 的原生 WorkBuddy AI Provider Extension。

OMP 18.2.6 已具备运行时 `registerProvider()`、OAuth Provider 注册、OAuth credential storage、`modifyModels()`、OpenAI-compatible Chat Completions transport、Provider request hook 和 Extension UI 等能力，因此绝大多数功能可在插件侧完成。

---

# 3. 项目目标

## 3.1 核心目标

开发一个 OMP-native WorkBuddy AI Extension，使用户能够：

1. 在 OMP 中安装插件；
2. 执行 `/login workbuddy` 登录 WorkBuddy AI 国际版；
3. 使用 WorkBuddy OAuth 凭据；
4. 在 OMP 模型列表中选择 WorkBuddy 模型；
5. 正常进行：
   - 普通文本对话；
   - Reasoning / Thinking；
   - Tool Calling；
   - Streaming；
   - Agent / Subagent 模型调用；
6. 自动刷新 WorkBuddy Access Token；
7. 查询 WorkBuddy 剩余积分；
8. 使用 `/workbuddy` 管理 WorkBuddy 插件功能；
9. 在不修改 OMP 源码的情况下完成全部核心功能。

---

# 4. 非目标范围

v1.0 明确不包含以下内容：

### 4.1 不修改 OMP

不得要求：

- 修改 OMP Extension API；
- 给 OMP 打 Patch；
- 修改 OMP Provider transport；
- 增加 `before_provider_headers`；
- 修改 OMP AuthStorage；
- 修改 OMP ModelRegistry。

插件必须能够运行在官方 OMP 18.2.6 上。

### 4.2 暂不支持 WorkBuddy 国内版

v1.0 仅支持：

```text
https://www.workbuddy.ai
```

不支持：

```text
workbuddy.cn
copilot.tencent.com
```

国内版作为后续独立需求。

### 4.3 v1.0 仅支持一个有效 WorkBuddy 账号

v1.0 正式支持：

> 一个 WorkBuddy Provider 对应一个有效 WorkBuddy AI OAuth Account。

OMP 自身虽然可保存同一 Provider 的多个 OAuth credential，但 WorkBuddy 请求除 Bearer Token 外还需要与账号绑定的：

```text
X-User-Id
X-Enterprise-Id
```

OMP 18.2.6 没有 upstream Pi 的 `before_provider_headers` event，但公开 `Model.resolveHeaders(signal)` 会在真实请求前解析 Header，`modifyModels()` 可以保留并组合该 resolver，`AuthStorage.getOAuthAccess()` 可返回一次 OAuth 选择的 access token、credentialId、accountId 和 orgId。v1 不依赖多账号轮换：`listOAuthAccounts('workbuddy')` 超过一个 stored OAuth credential 时必须明确拒绝且不得选择、轮换或删除。任何 Bearer 与身份 Header 不一致或无法证明一致的情况都必须 fail closed，不得发送 Chat 请求。

### 4.4 不重新实现 OpenAI Streaming Transport

不得自行重写：

- SSE Parser；
- Tool Call Streaming；
- Reasoning Delta Parser；
- Retry；
- Abort；
- Usage Parser。

优先复用 OMP 内置：

```text
api: openai-completions
```

OMP 18.2.6 已具备完整 OpenAI-compatible streaming 和 tool-call transport。

---

# 5. 总体架构

目标架构：

```text
OMP
 │
 ├── Extension
 │     │
 │     └── omp-workbuddy-connect
 │
 ├── AuthStorage
 │     │
 │     └── WorkBuddy OAuth Credential
 │           ├── access
 │           ├── refresh
 │           ├── expires
 │           ├── accountId = WorkBuddy uid
 │           └── orgId = WorkBuddy enterpriseId
 │
 ├── ModelRegistry
 │     │
 │     └── workbuddy/*
 │
 └── openai-completions transport
         │
         ├── Authorization
         ├── WorkBuddy Headers
         ├── WorkBuddy Payload Adaptation
         │
         ▼
https://www.workbuddy.ai/v2/chat/completions
```

插件负责：

```text
认证协议
WorkBuddy 身份信息
WorkBuddy Header
模型元数据
Thinking 映射
WorkBuddy 特殊 Payload
Tool Choice Compatibility
积分查询
UI / Commands
```

OMP 负责：

```text
Credential persistence
Token resolution
Streaming
SSE
OpenAI message conversion
Tool call stream parsing
Retry / Abort
Model selection
Agent / Subagent 调度
```

---

# 6. Provider 定义

Provider ID：

```text
workbuddy
```

基础配置：

```text
baseUrl = https://www.workbuddy.ai/v2
api     = openai-completions
```

不得通过自定义 HTTP Client 绕过 OMP Provider 系统。

插件必须使用 OMP：

```ts
pi.registerProvider("workbuddy", ...)
```

进行注册。

OMP Extension API 原生支持运行时 Provider 注册。

---

# 7. Package 与依赖适配

Fork 应转为 OMP-native package。

## 7.1 Manifest

由：

```json
{
  "pi": {
    "extensions": [
      "./extensions"
    ]
  }
}
```

调整为：

```json
{
  "omp": {
    "extensions": [
      "./extensions"
    ]
  }
}
```

不再依赖 OMP legacy Pi extension compatibility。

## 7.2 Package Import

优先将 upstream Pi package：

```text
@earendil-works/pi-ai
@earendil-works/pi-coding-agent
```

替换为 OMP 对应 package：

```text
@oh-my-pi/pi-ai
@oh-my-pi/pi-coding-agent
```

目标是让 TypeScript 类型检查直接基于 OMP API，而不是依赖 legacy compatibility shim。

---

# 8. OAuth 需求

## 8.1 登录入口

必须支持：

```text
/login workbuddy
```

登录过程继续复用 WorkBuddy AI 当前 Plugin Auth API。

登录成功后必须向 OMP 返回标准 OAuth Credential。

## 8.2 Credential 映射

WorkBuddy Credential：

```text
accessToken
refreshToken
expiresAtMs
durable uid（data.uid；缺省时取同一官方 access token 的 JWT uid/sub）
enterpriseId（可选；仅官方明确返回时）
nickname
email（可选；仅当官方响应明确提供真实 email 时）
domain
```

映射为 OMP：

```text
accessToken       → access
refreshToken      → refresh
expiresAtMs       → expires
data.uid/JWT uid/sub → accountId
enterpriseId      → orgId（可选，不伪造）
email             → email（仅真实、已验证的 email）
nickname          → 仅用于当前 UI 展示，不写入 OAuth email
domain            → 不保存，国际版固定 www.workbuddy.ai
```

2026-09-20 隔离 Live 登录的脱敏 shape 为顶层 `accessToken,domain,expiresIn,refreshExpiresIn,refreshToken,scope,sessionState,tokenType`，JWT claim 含 `sub` 且无 enterprise claim；冻结 upstream `cb2398e3374144db0c088d7a4887dc0913342858` 同时定义可选 `enterpriseId`。因此 durable account identity 仅允许 `data.uid → JWT uid → JWT sub`；JWT email/name/nickname 不得替代 accountId。enterpriseId 缺省时省略 orgId，Chat 发送 `X-No-Enterprise-Id: 1`，refresh 省略 X-Enterprise-Id。

示意：

```ts
return {
    access: credential.accessToken,
    refresh: credential.refreshToken,
    expires: credential.expiresAtMs,
    accountId: credential.uid ?? accessTokenClaims.uid ?? accessTokenClaims.sub,
    ...(credential.enterpriseId ? { orgId: credential.enterpriseId } : {}),
    ...(isVerifiedEmail(credential.email) ? { email: credential.email } : {}),
};
```

不得为持久化 nickname 新建 credential 文件；重启后 nickname 不可用时，以账号标识展示。

OMP AuthStorage 应成为 WorkBuddy credential 的唯一正式存储来源。OMP 的 stored OAuth credential 本身支持持久化、解析和刷新。

---

# 9. Credential 存储重构

## 9.1 删除双份 Credential 主链路

现有插件自身维护的：

```text
.workbuddy-auth.json
```

不得继续作为正常 Provider 调用的主 credential store。

正式调用链应为：

```text
/login workbuddy
      ↓
OMP AuthStorage
      ↓
WorkBuddy OAuth Credential
      ↓
Provider request
```

## 9.2 Desktop Credential

现有 WorkBuddy Desktop / CodeBuddyExtension Credential 读取逻辑：

- 可以暂时保留代码；
- 不作为正常请求优先 credential source；
- 不得与 OMP AuthStorage 在每次请求时竞争 token。

后续可独立实现：

```text
/workbuddy import
```

将 Desktop credential 导入 OMP。

该功能不属于 v1.0 必需项。

---

# 10. Token Refresh

必须使用 OMP OAuth `refreshToken()` 生命周期。

Refresh 后必须保留：

```text
accountId
orgId
email
```

不得因为 Token Refresh 丢失：

```text
uid
enterpriseId
```

期望结果：

```text
旧 Access Token 过期
      ↓
OMP 调用 refreshToken()
      ↓
WorkBuddy Refresh API
      ↓
返回新 access / refresh / expires
      ↓
保留 accountId / orgId
      ↓
继续调用模型
```

---

# 11. Authorization Header

原插件通过 `before_provider_headers` 手动设置：

```text
Authorization: Bearer <accessToken>
```

OMP 版本不得继续依赖该方式。

应通过：

```text
oauth.getApiKey()
```

向 OMP 提供 WorkBuddy Access Token，由 OMP OpenAI-compatible transport 负责标准 Bearer Authentication。OMP Provider/Auth pipeline 本身支持 Stored OAuth credential 到请求认证的解析。

---

# 12. WorkBuddy 固定 Headers

国际版以下 Headers 为 Provider 固定 Header：

```text
Accept
X-Requested-With
Origin
Referer
User-Agent
X-Product
X-Domain
```

建议 Provider 注册时设置：

```text
Origin   = https://www.workbuddy.ai
Referer  = https://www.workbuddy.ai/
X-Domain = www.workbuddy.ai
X-Product = SaaS
```

具体值以当前 upstream 插件行为为准。现有插件对这些 Header 的处理位于 WorkBuddy request header 构造逻辑中。

---

# 13. Request-Boundary 账号 Headers

WorkBuddy 请求必须携带：

```text
X-User-Id
X-Enterprise-Id
```

OMP 18.2.6 没有 upstream Pi 的 `before_provider_headers`，不得恢复旧事件或全局 fetch 拦截。OMP Model 公开：

```ts
resolveHeaders?: (signal?: AbortSignal) =>
    Promise<Record<string, string> | undefined>
```

`stream()` / `streamSimple()` 会在 provider dispatch 前 await 该 resolver。`oauth.modifyModels()` SHALL 只为 WorkBuddy model 安装经过验证的 credential-aware identity binding，优先组合 model 既有 resolver 与：

```text
AuthStorage.getOAuthAccess(provider, sessionId, { signal })
```

映射：

```text
access.accountId → X-User-Id
access.orgId 存在 → X-Enterprise-Id
access.orgId 缺省 → X-No-Enterprise-Id: 1
```

不得把账号身份长期快照到静态 `model.headers`。Provider 固定 Headers 可能已经由既有 `resolveHeaders` 表达，WorkBuddy resolver 必须组合而不是覆盖它。

`getApiKey()` 产生 Bearer 与 `getOAuthAccess()` 产生 identity 是两次公开调用。M0 必须用真实出站请求证明 normal、forced refresh、401/retry、logout A→login B、abort 下 Bearer、两个身份 Header 和 durable credential ID 同 generation。单账号规则降低歧义，但不能替代竞态实验。

如果 request-boundary resolver 无法证明原子性，第二候选是公开 `ExtensionAPI.setModel(freshModel)`；若 main/child/resume/task/headless 仍不能安全 rebind，则 fail closed，并要求新会话或 reload。

---

# 14. 单账号限制

v1.0 必须在 README / Known Limitations 中注明：

> WorkBuddy AI OAuth 当前正式支持一个 stored OAuth credential。

`listOAuthAccounts('workbuddy')` 的行数用于判定：

```text
0 rows  → unauthenticated
1 row   → admissible
>1 rows → reject before Chat
```

其中 `active` 仅表示指定 session sticky 到哪一行，不是 stored credential 数量。系统不得偷偷选择、轮换或自动删除凭据。

不得为了支持多账号而修改 OMP。即使只有一行，仍必须证明 request-boundary Bearer 与 identity 的同 generation 原子性。

---

# 15. Model Metadata 重构

现有：

```text
buildPiModels()
```

建议重构为：

```text
buildOmpModels()
```

模型至少必须提供：

```text
id
name
provider
api
baseUrl
reasoning
input
contextWindow
maxTokens
compat
thinking
```

实际字段以 OMP `ProviderModelConfig` 类型为准。

---

# 16. Thinking / Reasoning 适配

## 16.1 删除 Pi-specific thinkingLevelMap

不得继续将：

```text
thinkingLevelMap
```

作为 OMP model schema。

改为 OMP：

```text
reasoning
thinking
```

## 16.2 Level 映射

WorkBuddy 支持的：

```text
minimal
low
medium
high
xhigh
max
```

应映射到 OMP canonical effort。

建议结构：

```ts
thinking: {
    mode: "effort",
    efforts: [...],
    requiresEffort: ...
}
```

其中：

```text
canDisableThinking = false
```

映射为：

```text
requiresEffort = true
```

## 16.3 Reasoning Effort

标准：

```text
reasoning_effort
```

应优先由 OMP OpenAI-compatible transport 根据 model thinking metadata 生成。

插件不应重复实现一套 reasoning-level translation。

插件仅保留 WorkBuddy gateway 明确需要的特殊兼容处理。

---

# 17. Input Capability

根据 WorkBuddy product config 设置：

```text
input = [text]
```

或：

```text
input = [text, image]
```

对于 WorkBuddy 明确声明支持图片、但模型 family 在 OMP 默认规则中可能被判断为 text-only 的模型，需要显式检查：

```text
compat.stripImageInput
```

必要时覆盖为：

```text
false
```

目标是：

> 以 WorkBuddy Gateway 实际能力为准，而非假设上游模型官方 API 能力等同于 WorkBuddy Gateway。

---

# 18. Request Payload Hook

OMP 版本继续使用：

```text
before_provider_request
```

不得删除该机制。

OMP 18.2.6 Extension API 支持 Provider request payload hook，而内置 OpenAI completions transport 会在发出请求前使用 hook 返回的替代 payload。

插件仅应在该 hook 中处理 WorkBuddy-specific compatibility。

---

# 19. Payload Hook 保留逻辑

以下逻辑需要继续保留并逐项测试：

### 19.1 Assistant Reasoning Replay 清理

继续执行现有：

```text
stripAssistantReasoning
```

避免历史 assistant reasoning 内容以 WorkBuddy 不接受的形式重新提交。

### 19.2 Tool Choice Normalization

保留 WorkBuddy 特殊：

```text
tool_choice
```

转换。

不得假设 OMP 标准 OpenAI Tool Calling 与 WorkBuddy gateway 完全一致。

### 19.3 Model-specific Max Tokens Clamp

保留上游插件已经存在的特殊模型 token clamp，例如当前针对特定 DeepSeek 模型的限制。

### 19.4 Payload Cleanup

保留 WorkBuddy 已验证需要删除或调整的字段。

但对于 OMP 已原生正确处理的：

```text
developer → system
standard reasoning_effort
stream=true
standard max_tokens
```

应尽量交由 OMP，不重复实现。

---

# 20. Hook 请求识别

OMP `before_provider_request` 当前没有可靠的 Provider ID 字段供插件直接过滤。

现阶段允许继续沿用 upstream 插件：

```text
WorkBuddy Model ID Set
```

识别请求。

即：

```text
payload.model ∈ currentWorkBuddyModelIds
```

才执行 WorkBuddy payload transformation。

该方式存在不同 Provider 使用同名 Model ID 时的理论冲突。

v1.0 将其列为 Known Limitation，不为解决此问题重新实现 custom transport。

---

# 21. Tool Calling

必须验收以下能力：

```text
OMP Tool Definition
       ↓
WorkBuddy request
       ↓
WorkBuddy tool call
       ↓
OMP tool execution
       ↓
tool result
       ↓
next WorkBuddy turn
```

至少测试：

- 单工具调用；
- 连续工具调用；
- 多工具调用；
- Tool arguments streaming；
- `tool_choice=auto`；
- WorkBuddy named tool choice compatibility。

不得重新实现 OMP Tool Call Stream Parser。

---

# 22. Streaming

必须继续使用：

```text
openai-completions
```

内置 Streaming。

必须验证：

- 普通 text delta；
- reasoning delta；
- tool call delta；
- usage；
- `[DONE]`；
- HTTP Error；
- Abort；
- Retry。

插件不额外实现 SSE parser。

---

# 23. 动态模型

现有 upstream：

```text
refreshModels()
```

不是 OMP 18.2.6 ProviderConfig API。

因此必须移除该字段。

## v1.0

优先保持现有模型来源：

```text
WorkBuddy product config/cache
        ↓
buildOmpModels()
        ↓
registerProvider(models)
```

执行：

```text
/workbuddy free
/workbuddy all
```

时重新执行模型构建和 Provider 注册。

## v1.1 可选增强

以后可改为：

```text
fetchDynamicModels()
```

接入 OMP 原生 dynamic model refresh/cache。

该增强不作为 v1.0 release blocker。

---

# 24. Free / All 模式

继续支持：

```text
/workbuddy free
```

仅注册免费模型。

继续支持：

```text
/workbuddy all
```

注册全部当前可识别模型。

切换后要求：

1. 重新构建 WorkBuddy models；
2. 更新 Provider；
3. 更新当前可选择模型集合；
4. 更新 Widget；
5. 不破坏 OAuth credential。

---

# 25. 积分查询

继续保留 WorkBuddy Billing API 查询。

展示信息至少包括：

```text
账户
剩余积分
套餐信息
当前模型范围：free / all
```

积分查询失败不得影响正常模型调用。

错误处理：

```text
积分 API 失败
→ Widget 显示 unavailable / 查询失败
→ Provider 仍可正常使用
```

后续可考虑接 OMP Provider `usage` API，但不作为 v1.0 必需功能。OMP Extension Provider 目前也支持注册 UsageProvider。

---

# 26. `/workbuddy` 命令

v1.0 至少保留：

```text
/workbuddy
/workbuddy free
/workbuddy all
/workbuddy logout
```

建议：

### `/workbuddy`

显示：

- 登录状态；
- 账号；
- 积分；
- Scope；
- 模型数量；
- Provider 状态。

### `/workbuddy free`

切换免费模型。

### `/workbuddy all`

切换全部模型。

### `/workbuddy logout`

清理 WorkBuddy OAuth Credential。

---

# 27. Logout

原插件仅删除：

```text
.workbuddy-auth.json
```

的逻辑必须修改。

OMP 版本的正式 credential 位于 OMP AuthStorage，因此 logout 必须最终移除：

```text
provider = workbuddy
```

对应的 OMP OAuth credential。

同时：

- 清理 WorkBuddy Widget；
- 清理 status；
- 不删除 WorkBuddy Desktop 原生 credential；
- 不删除 WorkBuddy 自身客户端数据。

OMP 本身也提供 provider-scoped `/logout`。

---

# 28. UI / Widget

以下 OMP UI API 可继续使用：

```text
notify
setStatus
setWidget
select
```

OMP ExtensionContext 已公开这些能力。

现有 WorkBuddy Widget 视觉设计可尽量保持。

---

# 29. Model Select 生命周期适配

upstream 插件使用：

```text
model_select
```

OMP 18.2.6 不保证存在等价公开事件。

v1.0 采用：

```text
session_start
turn_start
```

同步 Widget。

要求：

### session_start

如果当前模型为 WorkBuddy：

```text
显示 WorkBuddy Widget
```

否则：

```text
隐藏 Widget
```

### turn_start

每次 turn 开始重新检查：

```text
ctx.model / ctx.models.current()
```

并同步 Widget。

允许存在：

> 用户刚刚切换模型，但在下一次 Turn 开始前 Widget 尚未立即变化。

该差异不属于 release blocker。

---

# 30. Agent / Subagent Compatibility

必须验证 WorkBuddy 模型作为：

```text
main model
```

和：

```text
role / subagent model
```

时都能够正常调用。

插件不得依赖只有 Interactive TUI 才存在的运行时状态才能完成模型认证。

Headless / Subagent 调用时：

```text
OAuth
Headers
Payload
Transport
```

都必须独立可用。

Widget 等 UI 功能可以在：

```text
ctx.hasUI = false
```

时自动跳过。

---

# 31. 配置目录

遵循 OMP 18.2.6 当前目录体系。

默认：

```text
~/.omp/agent
```

如存在：

```text
PI_CODING_AGENT_DIR
```

应尊重该环境变量。

不得自行引入未经 OMP 定义的：

```text
OMP_CODING_AGENT_DIR
```

Credential 由 OMP AuthStorage 管理后，插件应尽量减少自行在 agent directory 中保存认证数据。

---

# 32. 错误处理

至少定义以下错误：

## Authentication

- 未登录；
- Access Token 失效；
- Refresh Token 失效；
- OAuth Poll 超时；
- WorkBuddy Authorization 拒绝。

## Account Metadata

- durable uid/accountId 缺失：认证失败；
- enterpriseId/orgId 缺失：合法的 no-enterprise 账号；
- 已有 orgId 与刷新响应明确返回的 enterpriseId 冲突：认证失败；
- credential 不完整：认证失败。

accountId 缺失或企业身份明确矛盾时必须 fail closed，并提示用户重新执行：

```text
/login workbuddy
```

orgId 单纯缺失时不得伪造组织；Chat 必须发送 `X-No-Enterprise-Id: 1`。

## Model

- Product config 不存在；
- Product config 格式错误；
- Model ID 缺失；
- Scope 下没有模型。

## Billing

积分接口异常仅作为非致命错误。

## API

WorkBuddy 返回非 2xx 时，应尽量保留 OMP transport 原始错误信息，避免插件吞掉错误。

---

# 33. 日志要求

不得在普通日志中输出：

```text
accessToken
refreshToken
完整 Authorization
```

可以输出：

```text
provider
model
uid 是否存在
enterpriseId 是否存在
token expiry
scope
model count
HTTP status
```

如需 debug credential，只允许输出脱敏值。

---

# 34. 安全要求

插件不得：

- 将 WorkBuddy Token 写入项目目录；
- 将 Token 写入日志；
- 将 Credential 上传到第三方服务；
- 修改 WorkBuddy Desktop credential；
- 在退出 OMP 时删除 WorkBuddy Desktop 登录状态。

所有网络请求仅应访问插件功能所需的 WorkBuddy 官方国际版 endpoints。

---

# 35. 兼容目标

首版明确支持：

```text
OMP 18.2.6
```

不要求反向兼容：

```text
upstream Pi
```

也不要求：

```text
OMP < 18.2.6
```

如果未来 OMP Extension API 变化，通过版本迭代处理。

---

# 36. v1.0 必须完成的代码改造

## P0

- [ ] Manifest 改为 OMP extension
- [ ] package import 改为 `@oh-my-pi/*`
- [ ] Provider schema OMP 化
- [ ] 删除 `before_provider_headers`
- [ ] 删除 Marker Header
- [ ] Authorization 改为 OMP OAuth/API key pipeline
- [ ] uid → OAuth `accountId`
- [ ] enterpriseId → OAuth `orgId`
- [ ] 使用 `modifyModels()` 为 WorkBuddy 安装经过验证的 request-boundary identity binding
- [ ] Token refresh 保留 account identity
- [ ] `thinkingLevelMap` → OMP `thinking`
- [ ] `buildPiModels()` → `buildOmpModels()`
- [ ] 保留 `before_provider_request`
- [ ] 保留 Tool Choice WorkBuddy compatibility
- [ ] 保留 reasoning history cleanup
- [ ] 删除 unsupported `refreshModels`
- [ ] 确保 WorkBuddy OpenAI streaming 正常
- [ ] OAuth credential 以 OMP AuthStorage 为主

## P1

- [ ] `/workbuddy`
- [ ] `/workbuddy free`
- [ ] `/workbuddy all`
- [ ] `/workbuddy logout`
- [ ] 积分 Widget
- [ ] `model_select` → session/turn lifecycle
- [ ] Vision model compatibility
- [ ] 正确处理无 UI 模式
- [ ] main agent / subagent 测试

## P2

- [ ] `fetchDynamicModels`
- [ ] Desktop credential import
- [ ] OMP UsageProvider
- [ ] 多账号支持研究
- [ ] 更可靠的 Provider-specific payload interception

---

# 37. 验收测试

## 37.1 安装

插件可以被 OMP 18.2.6 正常加载。

启动无：

```text
extension load error
unknown provider field
unknown event
module resolution error
```

---

## 37.2 登录

执行：

```text
/login workbuddy
```

能够完成 OAuth。

重启 OMP 后：

```text
无需重新登录
```

---

## 37.3 Refresh

人为等待 / 模拟 Access Token 过期。

必须：

```text
自动 refresh
继续请求
```

并保持：

```text
X-User-Id
X-Enterprise-Id
```

正确。

---

## 37.4 模型发现

WorkBuddy 模型可以出现在 OMP 模型列表。

模型至少正确显示：

```text
name
reasoning capability
context
max tokens
input modality
```

---

## 37.5 普通对话

至少三个不同 WorkBuddy 模型正常：

```text
user
→ assistant streaming response
```

---

## 37.6 Thinking

对支持 Reasoning 的模型分别测试：

```text
low
medium
high
```

如模型支持：

```text
xhigh / max
```

也测试。

如果模型允许关闭 Thinking：

```text
off
```

应正常。

如果不允许关闭：

```text
OMP 不应发送非法 off 配置
```

---

## 37.7 Tools

使用 OMP 内置工具完成至少：

```text
read
grep
bash
```

工具闭环。

---

## 37.8 Subagent

配置：

```text
task role → WorkBuddy model
```

Spawn subagent 后能够正常：

- Auth；
- Streaming；
- Tool calling；
- 返回结果。

---

## 37.9 Scope

测试：

```text
/workbuddy free
```

只有 free models。

测试：

```text
/workbuddy all
```

恢复全部 models。

---

## 37.10 Credits

Widget 能显示积分。

Billing API 故障时模型仍然能使用。

---

## 37.11 Logout

执行：

```text
/workbuddy logout
```

后：

- OMP WorkBuddy credential 被删除；
- WorkBuddy models 不再被认为已认证；
- WorkBuddy Desktop 登录状态不受影响。

---

# 38. Known Limitations

v1.0 明确接受以下限制：

### L1. 单 WorkBuddy Account

多 OAuth account rotation 不保证 Header 身份一致。

### L2. Widget 非模型切换瞬时刷新

模型切换后可能到下一次：

```text
turn_start
```

才更新。

### L3. Payload Hook 按 Model ID 识别

理论上不同 Provider 出现完全相同 Model ID 时可能误命中。

### L4. Product Config Dependency

若继续依赖 WorkBuddy Desktop 的 product config cache，则模型目录会受到 WorkBuddy Desktop 本地缓存状态影响。

---

# 39. v1.0 Release Definition

只有同时满足以下条件才视为 v1.0 完成：

```text
OMP 本体 0 修改
          +
插件正常安装
          +
OAuth 登录
          +
OAuth 自动刷新
          +
正确 WorkBuddy Identity Headers
          +
模型选择
          +
Streaming
          +
Thinking
          +
Tool Calling
          +
main agent
          +
subagent
          +
积分查询
          +
free/all
          +
logout
```

---

# 40. 推荐开发顺序

建议按以下顺序开发，避免 UI 功能掩盖底层 Provider 问题。

### Phase 1：Provider Skeleton

完成：

```text
OMP package
registerProvider
一个静态测试模型
OAuth login
Authorization
```

目标：

> 能完成一次最简单 WorkBuddy Chat Completion。

### Phase 2：Identity

完成：

```text
uid
enterpriseId
modifyModels
WorkBuddy headers
refresh identity
```

目标：

> 完整正确认证链。

### Phase 3：Model Metadata

完成：

```text
product config
buildOmpModels
thinking
vision
context/max tokens
```

### Phase 4：Gateway Compatibility

完成：

```text
before_provider_request
tool_choice
reasoning replay
token clamp
```

### Phase 5：Agent Validation

完成：

```text
tools
main agent
subagent
thinking levels
```

### Phase 6：UX

完成：

```text
/workbuddy
free/all
credits
widget
logout
```

### Phase 7：Hardening

完成：

```text
error handling
logging
restart persistence
expired token
missing product config
headless mode
```

---

# 41. 最终设计原则

本 Fork 应长期坚持以下原则：

**1. OMP-native，而非 Pi compatibility patch。**

**2. 优先使用 OMP 已有 Provider/Auth/Transport 能力。**

**3. WorkBuddy 插件只处理 WorkBuddy-specific differences。**

**4. Token 生命周期只有 OMP AuthStorage 一个 authority。**

**5. 不为了短期兼容复制 OMP 已经具备的 Streaming、Tool Calling、Reasoning transport。**

**6. 对 OMP 18.2.6 没有暴露的能力，通过明确功能边界处理，而不是修改 OMP 本体。**

**7. 第一版优先保证认证链、模型调用链和 Agent 调用稳定，再完善模型发现和 UI。**
