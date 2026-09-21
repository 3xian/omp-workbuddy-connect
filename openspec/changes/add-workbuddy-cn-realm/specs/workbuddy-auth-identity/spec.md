# Spec Delta

## MODIFIED Requirements

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
