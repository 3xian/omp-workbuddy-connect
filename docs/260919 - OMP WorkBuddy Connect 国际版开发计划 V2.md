# OMP WorkBuddy Connect 国际版开发计划 V2

## 1. 文档目标

本开发计划用于指导 `omp-workbuddy-connect` 从现有 `pi-workbuddy-connect` Fork 演进为面向 OMP 的原生 WorkBuddy AI 国际版 Provider Extension。

本计划以以下目标为最高优先级：

1. 不修改 OMP 本体；
2. 使用 OMP 原生 Provider / OAuth / ModelRegistry / Transport 能力；
3. WorkBuddy 插件只实现 WorkBuddy-specific 差异；
4. OMP AuthStorage 是正式 Credential 的唯一事实来源；
5. `Authorization`、`X-User-Id`、`X-Enterprise-Id` 必须始终属于同一个 WorkBuddy Account；
6. 优先保证认证链、请求链和 Agent / Subagent 稳定，再完善 UI；
7. 所有 WorkBuddy compatibility patch 必须有明确服务端兼容依据。

需求基线明确要求 OMP 本体 0 修改、复用 `openai-completions` transport，并将 AuthStorage 作为 WorkBuddy OAuth Credential 的正式存储来源。

---

# 2. 开发基线冻结

正式开发前必须首先冻结本次适配针对的代码基线。

## 2.1 Fork 基线

必须记录：

```text
Repository:
https://github.com/ha5h6r000wn/omp-workbuddy-connect

Branch:
<实际开发分支>

Commit:
<exact commit SHA>
```

不得使用：

```text
main 最新代码
当前仓库
最新版本
```

等无法稳定复现的描述作为开发基线。

---

## 2.2 OMP 基线

v1 首版目标宿主固定为：

```text
Repository:
can1357/oh-my-pi

Version:
18.2.6

Commit:
<exact commit SHA>
```

需求定义的首版支持目标即为 OMP 18.2.6，且不要求兼容更早版本。

开发依赖和类型检查应针对该版本完成。

禁止开发期使用：

```json
"*"
```

一类不确定版本约束验证核心 API。

---

## 2.3 Upstream 基线

记录 Fork 所基于的：

```text
icekale/pi-workbuddy-connect
commit = <SHA>
```

用于未来区分：

```text
upstream 功能
OMP 适配修改
Fork 自定义修改
```

---

# 3. 第一性原理与系统不变量

以下规则属于架构不变量，而不是一般实现建议。

---

## 3.1 Credential Single Source of Truth

正式调用链必须唯一：

```text
WorkBuddy OAuth Login / Refresh
            ↓
       OMP AuthStorage
            ↓
       OAuth Credential
            ↓
 ┌──────────┼───────────┐
 ↓          ↓           ↓
Bearer   Identity     Credits
         Headers
```

正常 Provider 调用期间不得：

```text
从 .workbuddy-auth.json 找 token
从 WorkBuddy Desktop 找 token
从环境变量挑选 token
比较多个来源哪个 token 更新
```

现有插件自己的 Credential 文件、Desktop Credential 等只能：

```text
作为未来显式 import 功能的输入
```

不得成为运行时 credential fallback。

需求已经明确要求删除双份 credential 主链路。

---

## 3.2 Credential Identity Atomicity

以下三个字段构成一个认证原子：

```text
Authorization
X-User-Id
X-Enterprise-Id
```

要求：

```text
Bearer Token N
X-User-Id N
X-Enterprise-Id N
```

必须来自同一个 Credential Generation。

禁止出现：

```text
Authorization → Account B
X-User-Id     → Account A
```

这一条是 v1.0 最核心的安全和正确性约束。

---

## 3.3 Fail Closed

认证身份不完整时：

```text
不得降级
不得 fallback
不得静默继续
不得发送 Chat Completion 请求
```

例如：

```text
access 存在
accountId 缺失
```

也必须视为不可用 credential。

---

## 3.4 Model Metadata Is Protocol

以下字段不是 UI metadata：

```text
reasoning
thinking
input
contextWindow
maxTokens
compat
```

它们会直接决定：

```text
OMP 最终生成什么请求
```

因此能力声明必须以：

```text
WorkBuddy Gateway 实际能力
```

为准，而不是简单按照底层模型官方 API 推断。

---

## 3.5 Plugin Owns Differences Only

OMP 负责：

```text
OAuth Credential persistence
Bearer resolution
OpenAI message conversion
Streaming
SSE
Tool Call Streaming
Usage parsing
Retry
Abort
Agent orchestration
```

插件负责：

```text
WorkBuddy OAuth protocol
WorkBuddy identity metadata
WorkBuddy-specific Headers
WorkBuddy model catalog
WorkBuddy thinking metadata
WorkBuddy-specific payload compatibility
Credits / UX
```

不得新增：

```text
Custom Transport
SSE Parser
Global fetch interceptor
CredentialStore
TransportManager
Custom Retry Framework
```

开发计划原版已经正确提出了这一职责边界，应继续坚持。

---

# 4. M0：Freeze Baseline & Verify Host Contract

## 4.1 目标

在开发任何业务功能之前，首先证明：

> 当前 Fork 能基于准确的 OMP 18.2.6 API 契约进行开发。

M0 不追求 WorkBuddy 功能完整，而追求：

```text
宿主契约确定
编译基线干净
扩展能够加载
关键 API 行为已有证据
```

---

## 4.2 API Compatibility Matrix

对 Fork 当前所有 OMP-facing API 做逐项检查。

至少验证：

| 当前能力 | OMP 18.2.6 | V2 处理 |
|---|---|---|
| OMP extension manifest | 必须 | 使用 `omp.extensions` |
| `@oh-my-pi/*` imports | 必须 | 全量迁移 |
| Provider `name` | 不作为 ProviderConfig 顶层字段使用 | 删除 |
| `refreshModels()` | 不使用 | 删除 |
| `before_provider_headers` | 不使用 | 删除 |
| `model_select` | 不依赖 | 删除 |
| `before_provider_request` | 使用 | 保留 |
| OAuth `getApiKey()` | 使用 | Bearer 来源 |
| OAuth `refreshToken()` | 使用 | Token lifecycle |
| `Model.resolveHeaders()` | 使用候选 | request-boundary identity materialization |
| `AuthStorage.getOAuthAccess()` | 使用候选 | 同一 OAuth selection 的 token/credentialId/identity |
| `ExtensionAPI.setModel()` | fallback 候选 | resolver 无法证明原子性时验证 rebind |
| OAuth `modifyModels()` | 使用 | WorkBuddy-only catalog projection / resolver installation |
| `fetchDynamicModels()` | 架构评估 | M0 决策 |
| `usage` / UsageProvider | 架构评估 | M0 决策 |

不得使用：

```text
API 应该存在
和 Pi 差不多
理论上支持
```

作为开发依据。

---

## 4.3 修复现有编译和加载问题

第一阶段立即修复：

```text
TypeScript syntax error
unsupported ProviderConfig fields
unknown events
wrong package imports
manifest mismatch
```

M0 完成标准：

```bash
tsc --noEmit
```

必须：

```text
0 errors
```

OMP 启动必须没有：

```text
extension load error
unknown provider field
unknown event
module resolution error
```

原开发计划已经发现当前代码存在模块导入失败，因此恢复可执行基线必须先于任何功能开发。

---

## 4.4 验证 AuthStorage 行为

必须使用真实 OMP 验证以下行为，而不是只读类型：

```text
/login workbuddy
credential persistence
credential refresh
credential deletion
restart recovery
```

尤其确认：

```text
同一个 Provider 多次 OAuth 登录
```

实际是：

```text
replace
append
rotate
```

哪一种行为。

这个结论直接决定单账号限制应如何实现。

---

## 4.5 验证 Request Identity Binding

先保留 modifier 六项证据：

1. modifier 输入是否为完整 catalog；
2. registry rebuild 后何时重新执行；
3. credential 更新后何时重新应用；
4. modifier 抛异常时 Registry 行为；
5. Provider re-register 后旧 model reference 是否 stale；
6. probe-only child-shaped session 是否取得 fresh model。

再验证首选 request-boundary 路径：

1. `modifyModels()` 能否为 WorkBuddy model 安装并组合 `resolveHeaders()`；
2. `stream()` 是否在实际 transport 前执行 resolver；
3. resolver 能否通过公开 `getOAuthAccess()` 获得 accountId/orgId/credentialId；
4. normal、forced refresh、401 retry、logout A→B、abort 下，实际出站 Bearer 与身份是否同 generation；
5. 失败时公开 `setModel(freshModel)` 能否覆盖 main/child/resume/task/headless；
6. 仍失败时是否能以 reload/new-session 明确 fail closed。

永久测试要求：非 WorkBuddy Provider 不得发生任何变化；身份非法或 stored credential 歧义时 WorkBuddy rows 消失，request boundary 仍独立拒绝。

---

## 4.6 Dynamic Model Architecture Decision

M0 必须调查：

```text
WorkBuddy 是否存在稳定的在线 product / model config API？
```

如果存在可靠 authenticated endpoint：

```text
优先研究 fetchDynamicModels()
```

如果不存在：

```text
v1 接受：
Desktop cache
  ↓
builtin fallback
```

但必须明确这是 Known Limitation。

这里要求的是：

```text
v1.0 做架构决策
```

并不等于：

```text
v1.0 必须实现 fetchDynamicModels()
```

---

## 4.7 Credits Architecture Decision

评估 OMP `UsageProvider` 是否能够表达：

```text
account
remaining credits
plan
```

以及是否能够方便获得 WorkBuddy 身份。

若适合：

```text
优先使用宿主 Usage 生命周期
```

若不适合：

```text
保留独立 WorkBuddy Billing client
```

但不得建立第二套 Token refresh 系统。

---

## 4.8 M0 Deliverables

M0 必须输出：

```text
Baseline Manifest
API Compatibility Matrix
Credential Behavior Note
Dynamic Model ADR
Credits / Usage ADR
Requirement → Implementation → Test Matrix
```

---

## 4.9 M0 Exit Gate

只有同时满足：

```text
exact commits frozen
+
typecheck = 0 error
+
official OMP loads extension
+
OAuth APIs confirmed
+
logout path confirmed
+
modifyModels behavior confirmed
+
subagent/headless extension loading behavior confirmed
```

才进入 M1。

---

# 5. M1：Authentication & Identity Invariant

## 5.1 目标

用一个真实 WorkBuddy 模型证明：

```text
login
→ correct identity
→ real streaming
→ refresh
→ restart
→ logout
→ account switch
```

完整成立。

这是 v1 最重要的里程碑。

---

# 5.2 OAuth Credential Schema

WorkBuddy credential 至少包含：

```text
accessToken
refreshToken
expiresAtMs
durable uid（data.uid；缺省时取同一官方 access token 的 JWT uid/sub）
enterpriseId（可选；仅官方明确返回时）
nickname / email
```

OMP 正式 credential：

```text
access       ← accessToken
refresh      ← refreshToken
expires      ← expiresAtMs
accountId    ← data.uid ?? JWT uid ?? JWT sub
orgId        ← enterpriseId（可选，不伪造）
```

---

## 5.3 不直接 nickname → email

除非 WorkBuddy 明确返回真实 email：

```text
email → email
```

否则：

```text
nickname
```

不得强行映射为：

```text
OAuthCredential.email
```

nickname 可以：

```text
保留在插件 UI runtime state
```

或使用未来 OMP 明确支持的 display identity 字段。

原因：

```text
email / accountId / orgId
```

属于 Credential identity，不应为了 UI 展示污染认证语义。

---

# 5.4 Login Boundary Validation

OAuth 登录完成后，在 credential 写入 OMP 前必须验证：

```text
access
refresh
expires
durable uid
```

其中 durable uid 的唯一允许顺序为：

```text
Plugin Auth data.uid
→ 同一官方 access token 的 JWT uid
→ 同一官方 access token 的 JWT sub
```

2026-09-20 隔离 Live 登录的脱敏 shape 确认：顶层不含 uid/enterpriseId，access token claim 含 `sub` 且不含 enterprise claim；冻结 upstream 同时定义 `enterpriseId?`，Chat 无企业时发送 `X-No-Enterprise-Id: 1`，refresh 则省略企业 Header。因此 JWT email/name/nickname 不得作为 accountId fallback；durable uid 缺失时：

```text
Login = Failure
```

enterpriseId 缺失不是登录失败，OMP credential 省略 orgId，Chat 显式发送 no-enterprise marker；禁止从 email、domain 或 accountId 伪造 orgId。

不得：

```text
部分登录成功
```

---

# 5.5 Refresh Boundary Validation

Refresh 必须：

```text
Input:
old OMP OAuth Credential

WorkBuddy Refresh API:
→ new access
→ new expiry
→ new refresh（服务端发生 rotation 时）
→ omit refresh（服务端未发生或未声明 rotation 时允许）

Output:
new access
new expiry
new refresh（响应明确提供时）
old input refresh（响应省略 refresh 时）
old accountId
old orgId
identity fields
```

缺省 refresh 的兼容基线来自冻结 upstream `cb2398e3374144db0c088d7a4887dc0913342858`：既有 `refreshAccess` 在响应提供非空 `refreshToken` 时替换，否则保留本次输入 credential 的 refresh。当前没有官方或 live 证据证明成功 refresh 必定 rotation，因此 v1 不把 omission 误判为失败；这不允许读取旧文件、其他账号或保留旧 access/expiry。

Refresh 不得再调用：

```text
resolveCred()
current()
Desktop credential
.workbuddy-auth.json
```

补身份。

---

# 5.6 Authorization

使用：

```text
oauth.getApiKey()
```

返回：

```text
access
```

让 OMP 内置 OpenAI transport 负责：

```http
Authorization: Bearer <access>
```

插件不得重新注入 Authorization。

---

# 5.7 Request-Boundary Identity Headers

固定国际版 Provider Headers：

```text
Accept
X-Requested-With
Origin
Referer
User-Agent
X-Product
X-Domain
```

账号 Header：

```text
X-User-Id
X-Enterprise-Id 或 X-No-Enterprise-Id: 1（二选一）
```

`oauth.modifyModels()` 只负责为 WorkBuddy model 安装经过 M0 验证的 credential-aware identity binding。首选机制：

```text
existing model.resolveHeaders
        +
AuthStorage.getOAuthAccess(provider, sessionId, { signal })
        ↓
accountId → X-User-Id
orgId 存在 → X-Enterprise-Id
orgId 缺省 → X-No-Enterprise-Id: 1
```

固定 Header resolver 与账号 resolver 必须组合；不得把账号信息长期写入静态 `model.headers`。由于 Bearer 与 identity 是两次解析，必须通过实际出站 normal/refresh/retry/A→B 验证明同 credential generation，不能仅证明 resolver 最终读到新账号。

---

# 5.8 Provider Isolation

`modifyModels()` 必须：

```ts
models.map(model => {
    if (model.provider !== "workbuddy") {
        return model;
    }

    // WorkBuddy-only transformation
});
```

禁止假定 modifier 输入中只有 WorkBuddy Model。

永久回归测试：

```text
OpenAI model before modifier
===
OpenAI model after modifier

Anthropic model before modifier
===
Anthropic model after modifier
```

---

# 5.9 Three-Layer Fail Closed

不能只依赖 `modifyModels()` 抛错。

必须至少做到：

### Layer 1 — Login

```text
missing identity
→ reject credential
```

### Layer 2 — Refresh

```text
refresh 后 identity invalid
→ reject refreshed credential
```

### Layer 3 — API Key Boundary

在提供 Access Token 前再次确认必要 identity 存在。

```text
identity missing
→ do not provide usable auth
→ Chat request must not be sent
```

---

# 5.10 Single Account Enforcement

v1 只正式支持一个 stored WorkBuddy OAuth credential；这不是单纯 README limitation。

使用：

```text
listOAuthAccounts('workbuddy').length
```

判定：

```text
0 → unauthenticated
1 → admissible
>1 → reject before Chat
```

`active` 只表示某 session sticky 到哪一行，不用于计数。系统不得自动选择、轮换或删除凭据。

仍必须通过 Account Switch Test：

```text
A login/request
→ A refresh/request
→ A logout
→ B login/request
→ existing session B request
→ spawned subagent B request
```

每次实际出站请求的 Bearer、user id、enterprise id 和 credential id 必须属于同一 generation，且迟到 A 结果不得恢复旧身份。

---

# 5.11 删除旧 Credential 主链路

正常调用路径删除：

```text
saveOwn()
loadOwn()
current()
resolveCred()
Desktop credential preference
own file refresh
```

如代码因未来 Import 功能暂时保留：

```text
必须与 Provider runtime path 隔离
```

---

# 5.12 Logout

`/workbuddy logout` 最终必须调用：

```text
OMP provider-scoped credential deletion
```

随后：

```text
clear provider auth runtime state
clear WorkBuddy widget/status
invalidate pending credits generation
rebuild/update models if required
```

不得删除：

```text
WorkBuddy Desktop credential
WorkBuddy Client data
```

需求对 Logout 已明确要求删除 OMP AuthStorage credential，而非仅删除插件文件。

---

# 5.13 M1 Exit Gate

必须在真实账号下全部通过：

```text
OAuth login
first real request
streaming response
restart recovery
forced token refresh
missing identity rejection
logout
A → B switch
```

M1 第一阶段只需要：

```text
一个真实且稳定的 WorkBuddy 模型
```

不需要先实现完整模型目录。

---

# 6. M2：Model Catalog & Capability Contract

## 6.1 目标

模型目录不只是“能显示”，而是必须做到：

> OMP 根据 metadata 生成的请求，与 WorkBuddy Gateway 真实支持能力一致。

---

# 6.2 buildOmpModels()

重构：

```text
buildPiModels()
```

为：

```text
buildOmpModels()
```

输出必须由真实 OMP 类型检查。

至少包含：

```text
id
name
provider
api
baseUrl
reasoning
thinking
input
contextWindow
maxTokens
compat
```

---

# 6.3 Thinking

删除：

```text
thinkingLevelMap
```

使用 OMP canonical metadata：

```text
reasoning
thinking
```

明确区分：

```text
no reasoning
reasoning + required effort
reasoning + optional off
reasoning but cannot disable
```

WorkBuddy：

```text
minimal
low
medium
high
xhigh
max
```

只暴露 gateway 实际支持的 effort。

禁止：

```text
模型名字看起来像 GPT / Claude
→ 推测支持某 effort
```

---

# 6.4 reasoning_effort

标准：

```text
reasoning_effort
```

由 OMP OpenAI-compatible transport 根据 model metadata 生成。

插件不再维护第二套：

```text
OMP effort
→ WorkBuddy effort
```

除非 Gateway 存在明确非标准 schema。

---

# 6.5 Vision

Product config 声明支持 image：

```text
input = [text, image]
```

同时验证：

```text
compat.stripImageInput
```

必要时显式：

```text
false
```

完成至少一次：

```text
真实图片输入 E2E
```

---

# 6.6 Context / Token Limits

模型目录中的：

```text
contextWindow
maxTokens
```

必须和 Gateway 请求预算一致。

现有已确认需要的：

```text
specific model max token clamp
```

可以保留。

但应建立：

```text
Catalog capability
==
Request capability
```

测试。

---

# 6.7 Free / All Semantics

定义：

```text
/workbuddy free
```

为：

> 当前插件有足够证据确认属于免费范围的模型。

原则：

```text
unknown != free
```

若价格未知：

```text
不得因为未知而加入 free
```

如果免费集合为空：

```text
明确显示 empty
```

不得把：

```text
付费模型
未知价格模型
fallback list
```

重新包装为 free。

---

## 6.8 cost: 0

如果：

```text
cost: 0
```

只是 OMP metadata 占位：

```text
不得向用户宣传
"免费"
"不消耗积分"
```

真实计费语义以 WorkBuddy 产品配置 / Billing 信息为准。

---

# 6.9 Dynamic Model Decision

根据 M0 ADR：

### Path A

如果在线模型 API 稳定：

```text
fetchDynamicModels
→ OMP cache
→ models
```

### Path B

如果没有可靠 API：

```text
WorkBuddy Desktop cache
      ↓
parse product config
      ↓
builtin fallback
```

同时 UI / log 明确：

```text
model source
```

例如：

```text
remote
desktop-cache
builtin-fallback
```

---

# 6.10 `/workbuddy free/all`

切换 scope 时必须：

```text
rebuild WorkBuddy models
update Provider registration
update WorkBuddy model ID set
update model selector
update widget
persist scope
```

禁止：

```text
修改 credential
重新登录
```

---

# 6.11 Current Model Removed from Scope

若用户当前正在使用：

```text
workbuddy/model-paid
```

然后执行：

```text
/workbuddy free
```

而当前模型不在新目录：

```text
明确提示用户重新选择模型
```

不得：

```text
自动切换至其他付费模型
自动选择任意 fallback
```

---

# 6.12 M2 Exit Gate

至少验证：

```text
3 WorkBuddy models
metadata correct
thinking correct
vision correct
context/max token correct
free/all correct
empty free collection correct
restart scope persistence
credential unchanged after re-register
```

---

# 7. M3：Gateway Compatibility & Tool Calling

## 7.1 原则

进入 M3 时，从：

```text
OMP 原生 OpenAI-compatible payload
```

出发。

插件只做：

```text
minimum WorkBuddy delta
```

---

# 7.2 Compatibility Evidence Rule

任何 payload transform 必须回答：

> 如果删除该 transform，哪个 WorkBuddy Gateway Case 会失败？

不能明确回答：

```text
删除
```

---

# 7.3 保留候选

已知可能需要保留：

```text
stripAssistantReasoning
tool_choice normalization
specific model token clamp
Gateway-specific unsupported field cleanup
```

---

# 7.4 优先删除

若 OMP 已正确完成：

```text
stream=true
developer → system
standard reasoning_effort
standard max_tokens conversion
tool streaming parsing
```

插件不得重复处理。

---

# 7.5 不自动插入系统提示词

除非通过真实 Gateway 证明：

```text
没有 system message
→ 请求失败
```

否则不得自动插入：

```text
"You are a helpful assistant."
```

Provider Adapter 不应改变用户 prompt semantics。

---

# 7.6 before_provider_request

继续使用：

```text
before_provider_request
```

但只处理 request-bound context 明确属于 WorkBuddy 的请求：

```text
ctx.model.provider === "workbuddy"
```

不得使用 `payload.model` 或累计 ID Set 推断 Provider。OMP 18.2.6 handler 异常会被记录后吞没，故 hook 只承担有证据的 wire compatibility；活动 scope、切换期和 retained-model fail-closed guard 必须位于 WorkBuddy-bound `resolveHeaders`，在 transport 前阻断。不得为此重写 custom transport。

---

# 7.7 Hook Isolation

必须永久测试：

```text
Non-WorkBuddy payload before hook
===
Non-WorkBuddy payload after hook
```

这是 Provider 隔离的 Release Gate。

---

# 7.8 Tool Calling

测试：

```text
single tool
sequential tools
multiple tools
parallel/multi tool if supported
tool arguments streaming
tool_choice=auto
named tool_choice
```

闭环：

```text
OMP Tool Definition
        ↓
WorkBuddy Request
        ↓
Tool Call Delta
        ↓
OMP Tool Execution
        ↓
Tool Result
        ↓
Next WorkBuddy Turn
```

尤其验证：

```text
tool_call_id
tool result association
assistant tool message replay
```

---

# 7.9 Streaming

全部继续使用：

```text
openai-completions
```

验证：

```text
text delta
reasoning delta
tool call delta
usage
[DONE]
HTTP Error
Abort
Retry
```

插件不得实现：

```text
SSE parser
stream retry
tool delta parser
```

---

# 7.10 M3 Exit Gate

必须完成：

```text
normal chat
reasoning history
single tool
sequential tools
multi-tool
tool arguments streaming
named tool
abort
HTTP error
retry
other provider isolation
```

---

# 8. M4：Commands, Credits & UI

## 8.1 原则

UI 和 Billing 属于：

```text
Optional Plane
```

核心 Chat/Auth 属于：

```text
Critical Plane
```

必须满足：

```text
Credits failure
Widget failure
TUI unavailable
```

都不能阻塞 Chat。

---

# 8.2 `/workbuddy`

显示：

```text
login state
account
credits
plan
scope
model count
model source
provider state
```

必要时显示：

```text
credits unavailable
```

不得把接口异常显示成：

```text
0 credits
```

---

# 8.3 `/workbuddy free`

执行：

```text
set scope = free
rebuild models
update model ID set
re-register provider
persist setting
refresh UI
```

---

# 8.4 `/workbuddy all`

同理：

```text
set scope = all
```

“all”定义为：

> 当前插件能够识别的全部 WorkBuddy Models。

不得宣传：

```text
WorkBuddy 服务端绝对完整模型列表
```

除非已使用可信在线服务端目录。

---

# 8.5 `/workbuddy logout`

流程：

```text
invalidate UI generation
↓
delete OMP credential
↓
clear widget/status
↓
invalidate provider auth state
↓
refresh models/provider state
```

---

# 8.6 Credits

Credits 请求：

```text
必须使用 OMP credential
```

不得：

```text
单独刷新 token
访问旧 credential file
访问 Desktop credential
```

Credits failure：

```text
unavailable
```

Chat：

```text
继续正常工作
```

---

# 8.7 Async UI Generation

所有异步 UI 请求建议使用：

```text
stateGeneration
```

模式：

```ts
const generation = stateGeneration;

const result = await fetchCredits();

if (generation !== stateGeneration) {
    return;
}
```

执行以下行为时增加 generation：

```text
logout
account switch
model scope change
session teardown
```

防止：

```text
旧账号迟到响应
```

重新污染 Widget。

原计划已经正确识别了这类 stale async response 风险。

---

# 8.8 OAuth Poll Cancellation

OAuth polling 必须响应：

```text
user cancel
session abort
extension shutdown
```

支持：

```text
AbortSignal / AbortController
```

错误至少区分：

```text
authorization rejected
poll timeout
user cancelled
network failure
server 5xx
rate limit
```

仅 authorization polling 对 429 携带的有效：

```text
Retry-After
```

在总轮询截止时间与取消边界内等待后继续 poll。一次性的 login-start 与 refresh 请求遇到 429 时向宿主/调用方返回 `rate_limited`，插件不建立独立 retry loop。

---

# 8.9 UI Lifecycle

不再依赖：

```text
model_select
```

使用：

```text
session_start
turn_start
```

同步：

```text
current model
WorkBuddy widget
status
```

接受：

```text
模型切换到下一 turn 才刷新 widget
```

这一差异属于 Known Limitation。

---

# 8.10 Headless

所有：

```text
auth
model
payload
transport
```

不能依赖：

```text
ctx.hasUI
```

UI：

```ts
if (!ctx.hasUI) {
    return;
}
```

即可。

---

# 8.11 M4 Exit Gate

必须通过：

```text
/workbuddy
/workbuddy free
/workbuddy all
/workbuddy logout
credits normal
credits failure
credits slow
logout with pending credits
scope restart persistence
headless
no UI access in headless
```

---

# 9. M5：Agent Validation & Release Hardening

## 9.1 Main Agent

WorkBuddy 作为：

```text
main model
```

必须完成：

```text
chat
thinking
tool
streaming
refresh
```

---

# 9.2 Subagent

配置：

```text
task role → WorkBuddy model
```

Spawn 后验证：

```text
OAuth
identity headers
payload hook
streaming
tool calling
result return
```

---

# 9.3 Headless

验证：

```text
non-interactive execution
```

没有 TUI 时仍可：

```text
load extension
authenticate
resolve model
send request
run tool
```

---

# 9.4 Security

必须检查：

```text
access token not in logs
refresh token not in logs
Authorization not in logs
token not in repository
token not in project directory
```

允许日志：

```text
provider
model
identity presence
token expiry
scope
model count
HTTP status
```

Identity 如果输出：

```text
必须脱敏
```

---

# 10. Release Matrix

v1 发布前必须完成以下真实测试。

| Domain | Cases |
|---|---|
| Install | OMP 18.2.6 正式加载 |
| Type | `tsc --noEmit` 0 errors |
| Login | Fresh OAuth |
| Auth | First request identity |
| Restart | Credential recovery |
| Refresh | Expired access |
| Failure | Invalid refresh |
| Identity | Missing accountId |
| Identity | Optional orgId / no-enterprise path |
| Switch | Account A → Account B |
| Logout | Credential truly invalid |
| Chat | ≥3 real models |
| Thinking | supported efforts |
| Vision | real image |
| Tools | read / grep / bash |
| Tools | sequential / multi |
| Agent | main agent |
| Agent | subagent / role |
| Runtime | headless |
| Scope | free |
| Scope | all |
| Scope | empty free |
| Billing | success |
| Billing | 5xx |
| Billing | timeout / slow |
| Isolation | other provider unchanged |
| Logging | no credential leakage |

---

# 11. Release Evidence

每次正式验收必须保存：

```text
OMP version
OMP commit
extension version
extension commit
Node/Bun runtime
test date
WorkBuddy account type
tested model IDs
test matrix result
known limitations
redacted diagnostic evidence
```

这样未来：

```text
OMP 18.2.7
OMP 18.3
WorkBuddy Gateway change
```

出现回归时可以快速定位。

---

# 12. 自动化测试分层

## 12.1 Unit Tests

优先纯函数：

```text
credential mapping
refresh identity preservation
model building
thinking mapping
free model filtering
payload transform
```

---

# 12.2 Contract Tests

使用 OMP 真实类型/API：

```text
ProviderConfig compile
OAuth callbacks
modifyModels isolation
payload hook isolation
```

---

# 12.3 Integration Tests

真实 OMP runtime：

```text
extension load
provider register
login persistence
provider re-register
logout
subagent
```

---

# 12.4 Live E2E

真实 WorkBuddy：

```text
OAuth
Chat
Refresh
Vision
Tools
Credits
```

Mock 通过不能代替 Live E2E。

原开发计划也明确要求真实账号联调必须作为发布证据。

---

# 13. 永久回归测试

以下行为必须长期保留：

```text
Refresh 后 identity 保留

Missing identity
→ no usable request auth

modifyModels
→ other providers unchanged

payload hook
→ other providers unchanged

A logout + B login
→ no A identity

reasoning cleanup
→ tool messages intact

free
→ no known paid model

unknown price
→ not free

Billing slow
→ startup/chat unaffected

logout
→ stale credits ignored

Provider re-register
→ OAuth credential unchanged

Headless
→ no UI dependency
```

---

# 14. 推荐代码结构

```text
extensions/
  workbuddy.ts
```

仅作为：

```text
composition root
extension registration
```

核心代码：

```text
src/
  auth.ts
  provider.ts
  workbuddy-api.ts
  models.ts
  payload.ts
  credits.ts
  settings.ts
  ui.ts
```

---

## auth.ts

负责：

```text
credential mapping
login callback
refresh
identity validation
```

---

## provider.ts

负责：

```text
ProviderConfig
OAuth adapter
modifyModels
registerProvider
re-register
```

---

## workbuddy-api.ts

仅负责 WorkBuddy HTTP Protocol：

```text
Plugin Auth
Refresh
Billing
Product Config
```

不得引用 UI。

---

## models.ts

负责：

```text
product config parsing
scope
thinking metadata
vision metadata
model catalog
```

---

## payload.ts

只包含：

```text
verified WorkBuddy-specific compatibility
```

---

## credits.ts

负责：

```text
billing response parsing
credits state
```

---

## settings.ts

只保存：

```text
scope
non-sensitive settings
```

不得保存：

```text
credential
token
```

---

## ui.ts

负责：

```text
status
widget
notify
select
```

---

# 15. 禁止提前抽象

v1 不新增：

```text
CredentialStore
TransportManager
Provider Framework
Generic Gateway Adapter
Custom HTTP Retry Framework
```

原则：

> 模块化为了隔离协议边界和提高可测试性，而不是为了增加抽象层。

原开发计划的模块拆分原则保持不变。

---

# 16. 推荐实施顺序

最终执行顺序：

```text
M0
Baseline + Host Contract
        ↓
M1
Authentication Invariant
        ↓
M2
Model Contract
        ↓
M3
Gateway Compatibility
        ↓
M4
Commands / Credits / UI
        ↓
M5
Agent / Release Validation
```

M2 / M3 可以在以下接口固定后局部并行：

```text
Credential contract
Provider registration contract
Model ID contract
```

但：

```text
M1 不建议并行拆开
```

因为认证是整个项目风险最高的共享状态链。

---

# 17. 每阶段完成定义

## M0

```text
TypeScript clean
OMP loads
API assumptions verified
```

## M1

```text
one model
full auth lifecycle
identity invariant proven
```

## M2

```text
model catalog contract correct
```

## M3

```text
Gateway compatibility + tools correct
```

## M4

```text
management plane stable and non-blocking
```

## M5

```text
main/subagent/headless/live E2E release-ready
```

---

# 18. 排期原则

不建议在 M0 前锁定完整工期。

先完成 M0：

```text
1–2 engineer days
```

然后根据实际发现重新估算：

```text
M1–M5
```

原因包括：

```text
Fork 当前实际基线
AuthStorage behavior
multi-account behavior
dynamic model API
logout API
subagent runtime
```

都可能改变后续工作量。

原计划给出的 12–18 工程日可以作为初始 planning range，但不作为正式承诺。

---

# 19. v1 Release Definition

只有同时满足：

```text
OMP 本体 0 修改
+
extension installs
+
OAuth login
+
AuthStorage single source
+
automatic refresh
+
identity invariant
+
restart recovery
+
model selection
+
streaming
+
thinking
+
vision where declared
+
tool calling
+
main agent
+
subagent
+
headless
+
credits
+
free/all
+
logout
+
provider isolation
+
no credential leakage
```

才视为国际版 OMP WorkBuddy Connect v1 完成。

---

# 20. v1 Known Limitations

首版可以接受：

### L1. 单 WorkBuddy Account

不保证多 credential rotation。

但：

```text
不得接受 identity mismatch
```

---

### L2. Widget 延迟

模型切换后：

```text
可能到下一 turn_start 才刷新
```

---

### L3. Request-bound Provider Isolation

OMP 18.2.6 的 hook context 绑定精确 request Model：

```text
ctx.model.provider
```

因此当前或历史同 ID 的其他 Provider 不会误命中。Scope/transition 安全约束位于 WorkBuddy `resolveHeaders`；hook 异常不能作为 fail-closed 机制。

---

### L4. Product Config Dependency

如果 M0 最终选择：

```text
Desktop cache + builtin fallback
```

模型发现受到本地 cache 状态影响。

必须向用户明确 model source。

---

# 21. v1.1 Candidates

以下功能不进入 v1 Critical Path：

```text
true multi-account support
Desktop credential import
more reliable provider-specific payload interception
online dynamic model discovery
UsageProvider enhancement
instant model-select UI lifecycle
```

其中：

```text
Dynamic Model
UsageProvider
```

是否应该进入 v1，实现决策由 M0 ADR 决定。

---

# 22. 最终设计原则

整个 Fork 长期坚持：

### Principle 1

```text
OMP-native
not Pi compatibility patch
```

### Principle 2

```text
AuthStorage is the credential authority
```

### Principle 3

```text
Token + Account Identity are atomic
```

### Principle 4

```text
Fail closed on authentication ambiguity
```

### Principle 5

```text
Host handles standards
Plugin handles differences
```

### Principle 6

```text
Model metadata is executable protocol
```

### Principle 7

```text
Unknown billing state is not free
```

### Principle 8

```text
Optional UI/Billing failure never breaks Chat
```

### Principle 9

```text
Compatibility patches require evidence
```

### Principle 10

```text
Real OMP + Real WorkBuddy E2E
is the final source of truth
```

---

# 23. 首个开发交付物

第一轮开发不要以：

```text
Provider 成功注册
模型成功出现在列表
```

作为成功标准。

首个真正的里程碑必须是：

```text
Official OMP 18.2.6
        ↓
/login workbuddy
        ↓
OMP AuthStorage
        ↓
Correct Bearer
+
Correct X-User-Id
+
Correct X-Enterprise-Id
        ↓
One real WorkBuddy model
        ↓
Streaming response
        ↓
Forced access-token expiry
        ↓
Automatic refresh
        ↓
Identity remains correct
        ↓
Restart
        ↓
Credential restored
        ↓
Logout
        ↓
Credential unusable
        ↓
Account B login
        ↓
No Account A identity remains
```

只有这条链成立，后续：

```text
Model Catalog
Thinking
Vision
Tools
Credits
UI
Subagent
```

才建立在可靠基础上。

---

# Appendix A — Requirement Revision 1.6: Command-scoped Management UI

本附录保留上文冻结的 v1 规划与当时的 Widget lifecycle 决策，并记录自 `v1.1.6` 起实际采用的后续修订；若与 §8.9 或 §20 L2 冲突，以本附录为准。

```text
session_start / session_switch
→ 绑定 request runtime
→ 清理旧的 command-scoped UI
→ zero Billing

turn_start
→ 收起显式详情
→ 使待处理详情刷新 generation 失效
→ 迟到 Billing 结果不得重绘
→ zero Billing

/workbuddy
→ 唯一自动 Billing/detail 入口
→ 临时显示紧凑 Widget

/workbuddy free | all
→ transactional scope update
→ one-shot notify
→ zero Billing / no persistent Widget
```

WorkBuddy 不占用 OMP status line，不使用 timer。调用方 AbortSignal 不保证终止宿主共享的 in-flight Usage 请求；契约是使旧详情失效并丢弃迟到结果。详情最多显示前四个模型名称和剩余数量，完整选择使用 `/model`。