# Spec Delta

## MODIFIED Requirements

### Requirement: AUTH-01 Single credential authority
每个 WorkBuddy Provider 的运行时 Chat、身份 Header 与可选积分认证 SHALL 仅来自该 Provider 的 OMP AuthStorage namespace 及其认证生命周期。系统 MUST NOT 从 `.workbuddy-auth.json`、Desktop credential、环境变量凭据文件、另一个 WorkBuddy realm 或其他 Provider 选择或回退 Token，也不得在插件中另行持久化正式凭据或建立独立刷新器。

#### Scenario: Legacy credentials remain on disk
- **WHEN** 目标 WorkBuddy Provider 在 OMP 中未登录，但旧插件、Desktop 或另一个 realm 的凭据存在
- **THEN** 目标 Provider 被视为未登录并提示 `/login <providerId>`，不会读取其他来源恢复认证或发送 Chat

#### Scenario: Restart uses persisted host credential
- **WHEN** 某一 realm 成功登录后重启 OMP，且该 Provider 的宿主凭据仍有效
- **THEN** 该 realm 的 Chat 与可选积分使用恢复的同一宿主账号，无需重新登录或读取其他 realm/旧文件

### Requirement: AUTH-04 Durable credential identity binding
每个 WorkBuddy Chat transport attempt 的 Authorization、X-User-Id SHALL 属于目标 Provider 同一个唯一 stored OAuth durable credential row。credential 有 orgId 时 SHALL 同源发送 X-Enterprise-Id；无 orgId 时 SHALL 发送目标 realm 已验证的 no-enterprise marker，不得伪造组织。Authorization SHALL 仅由宿主原生 AuthStorage resolver 解析。Header 与 Bearer 的解析 MUST 共享宿主提供的 request-attempt identity 或由同一个原子 credential resolution 产生；分别读取“当前唯一账号”不构成同源证明。目标 Provider 的 `getApiKey(credentials)` SHALL 在返回 access 前验证宿主选择的 accountId/可选 orgId。401 retry 是新的 transport attempt：同账号 refresh 时 durable identity MUST 保持一致；用户明确换号后 MAY 使用新 row，但该 retry 内 Bearer 与 Headers 仍 MUST 原子同源。固定 Headers SHALL 由目标 realm descriptor 提供其已验证的 Origin/Referer/domain/product 等协议值，MUST NOT 使用另一个 realm 的固定值或未验证的 credential domain 改写路由。

#### Scenario: First authenticated request
- **WHEN** 用户在任一 WorkBuddy realm 首次登录后发出模型请求
- **THEN** 实际出站请求的 Bearer、用户 ID 和可选企业语义属于目标 Provider 的同一 durable credential ID，并只携带该 realm 已验证的固定 Headers

#### Scenario: Refresh, retry, and account switch
- **WHEN** 单账号发生 forced refresh 或 401 retry，或 A logout 后 B 在已有会话登录
- **THEN** forced refresh/401 retry 可更换 Bearer，但每次出站的 Bearer 与身份 Headers 仍属于目标 Provider 的同一 durable credential row；切换到 B 后不再使用 A row，迟到 A 结果不会恢复旧身份

#### Scenario: Account changes between Bearer and Header resolution
- **WHEN** 宿主已为请求选择 A Bearer，但在 identity Headers 解析前 storage 切换到 B，或并发 B 请求改变选择
- **THEN** A 请求必须在任何 Chat HTTP 前失败；不得发送 B Headers 与 A Bearer，也不得用全局 pending cache 或另一个 realm 猜测请求归属

#### Scenario: Request session differs from lifecycle binding
- **WHEN** 同一 Provider 服务 main、Task 或 child 等多个 session，实际请求由 session B 的 AuthStorage resolver 选择 Bearer，而最后一次 lifecycle binding 属于 session A
- **THEN** Header identity MUST 与请求 session B 的 Bearer 同源；不得读取全局 last-bound session A 或另一个 Provider 的 `active` row 冒充当前请求证明

#### Scenario: Persisted credential before session binding
- **WHEN** OMP 重启时目标 Provider 的 AuthStorage 已持久化一个完整 credential，Provider 在 `session_start` 绑定前注册并投影模型
- **THEN** 该 Provider 模型保留 request-boundary resolver；任一 lifecycle session 绑定其 AuthStorage authority 后首个请求动态读取当前唯一 stored identity，注册期未绑定不得被误判为非法 credential

### Requirement: AUTH-05 Three-layer fail closed
每个 WorkBuddy Provider SHALL 在登录返回前、刷新返回前、提供请求 API key 前分别校验必要身份。只在模型投影抛异常不构成拒绝保证；accountId 缺失时 MUST 不提供可用认证且不发送 Chat Completion 请求。enterpriseId/orgId 是服务端实证可缺省的可选组织属性，不属于账号主体；缺省时必须发送目标 realm 已验证的 no-enterprise marker。

#### Scenario: Stored credential lacks accountId
- **WHEN** 目标 Provider 的宿主 credential 有 access 但没有 accountId
- **THEN** 在请求认证边界拒绝调用，提示 `/login <providerId>`，观测到该 Provider 零个 Chat HTTP 请求

#### Scenario: Stored credential omits optional orgId
- **WHEN** 目标 Provider 的唯一宿主 credential 有完整 accountId 但没有 orgId
- **THEN** 请求继续绑定该 durable row，发送 X-User-Id 与目标 realm 已验证的 no-enterprise marker，且不发送 X-Enterprise-Id

### Requirement: AUTH-06 Provider isolation during identity binding
账号身份绑定 SHALL 只影响发起请求的目标 Provider。`workbuddy` 与 `workbuddy-cn` SHALL 分别使用自身的 AuthStorage namespace、身份 resolver 和固定 realm headers，并保留所有其他 Provider 的模型内容和行为。任一 Provider 身份无效或 stored credential 歧义时 SHOULD 只从该 Provider 的投影目录移除 rows，同时其请求认证边界仍须独立 fail closed；不得依赖 modifier 抛错或另一个 realm 的有效凭据。

#### Scenario: Mixed-provider catalog
- **WHEN** 目录同时包含 OpenAI、Anthropic、`workbuddy` 与 `workbuddy-cn` 模型
- **THEN** 每个 WorkBuddy realm 只获得自身 request-boundary identity resolver，其他 Provider 的模型内容保持不变

#### Scenario: One realm has invalid credentials
- **WHEN** 中国站 credential 缺失或歧义而国际站 credential 有效，或反之
- **THEN** 仅无效 realm 的模型调用被拒绝，有效 realm 不被登出、隐藏或改写身份

### Requirement: AUTH-07 Enforced single effective account
每个 WorkBuddy Provider SHALL 各自只支持一个 stored OAuth credential。`listOAuthAccounts(providerId)` 对目标 Provider 返回零行时视为该 realm 未登录，一行时允许继续，超过一行时该 realm 的模型调用 SHALL 被明确拒绝且不得擅自选择、轮换或删除用户凭据。`active` 仅表示指定 session sticky 到目标 Provider 的哪一行，不得用于判断 stored credential 数量。一个 realm 的 credential MUST NOT 计入、满足或修复另一个 realm 的账号约束。

#### Scenario: Multiple stored credentials are detectable
- **WHEN** 公开 API 显示某一 WorkBuddy Provider 存在多个 stored OAuth credentials
- **THEN** 明确拒绝该 Provider 的模型调用并告知单账号要求，另一个 Provider 的合法单账号调用不受影响

#### Scenario: Sequential account switch in existing session
- **WHEN** realm 内 A 登录并调用、刷新并调用，然后 A 退出、B 登录，并在已有会话和新 subagent 中请求
- **THEN** B 登录后的请求不再带 A Bearer 或身份 Header，且不会读取另一个 realm 的 credential

### Requirement: AUTH-08 Provider-scoped logout
`/workbuddy logout` 与 `/workbuddy-cn logout` SHALL 只删除各自 Provider 在 OMP 中的认证，使该 realm 的旧认证和身份运行态不可再用于新请求，清理该 realm 的 UI/Usage 异步状态并按需更新其模型。logout MUST NOT 删除另一个 realm 的宿主 credential、设置、UI 或模型，也不得删除 Desktop credential 或客户端数据。

#### Scenario: Logout with pending billing request
- **WHEN** 用户退出一个 realm 时该 realm 的积分或目录请求仍在进行
- **THEN** 仅该 realm 的宿主 credential 被删除，后续 Chat 不可认证，迟到响应不恢复其状态，另一个 realm 与 Desktop 登录保持不变

## ADDED Requirements

### Requirement: AUTH-10 Realm-bound authentication protocol
每次登录、轮询、刷新和 Chat attempt SHALL 使用目标 Provider 已验证的 endpoint、Origin/Referer、product/domain、Plugin Auth headers、refresh source 与 pending/status 语义。凭据、pending code、AbortSignal 和异步结果 MUST NOT 在 `workbuddy` 与 `workbuddy-cn` 之间复用或回退。

#### Scenario: Concurrent login in both realms
- **WHEN** 国际站和中国站登录流程同时处于 polling 或 refresh
- **THEN** 每个流程只访问自身 endpoint、使用自身 protocol headers 和取消边界，并将结果写入自身 AuthStorage namespace

#### Scenario: Realm protocol is unavailable
- **WHEN** 中国站协议字段尚未通过证据准入或响应不满足其已验证 schema
- **THEN** 中国站认证失败并保持未登录，不尝试国际站 endpoint、header、response parser 或 credential fallback
