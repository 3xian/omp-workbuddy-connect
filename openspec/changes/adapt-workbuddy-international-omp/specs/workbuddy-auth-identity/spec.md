# Spec Delta

## Purpose

定义 WorkBuddy OAuth 凭据的唯一权威来源、生命周期和账号身份一致性，使登录、刷新、重启、退出及换号期间的每个真实模型请求均具有完整且同源的认证信息，缺失或歧义时安全拒绝发送。

## ADDED Requirements

### Requirement: AUTH-01 Single credential authority
运行时 Chat、身份 Header 与积分认证 SHALL 仅来自 OMP AuthStorage 及其认证生命周期。系统 MUST NOT 从 `.workbuddy-auth.json`、Desktop credential、环境变量凭据文件选择或回退 Token，也不得在插件中另行持久化正式凭据或建立独立刷新器。

#### Scenario: Legacy credentials remain on disk
- **WHEN** OMP 中未登录但旧插件或 Desktop 凭据存在，或设置了 `WORKBUDDY_AUTH_FILE`
- **THEN** WorkBuddy 被视为未登录并提示 `/login workbuddy`，不会读取旧来源恢复认证或发送 Chat

#### Scenario: Restart uses persisted host credential
- **WHEN** 成功登录后重启 OMP，且宿主凭据仍有效
- **THEN** Chat 与积分使用恢复的同一宿主账号，无需重新登录或读取旧文件

### Requirement: AUTH-02 Validated login and identity semantics
OAuth 登录 SHALL 在返回宿主持久化前校验非空 access、refresh、有效 expiry、uid 和 enterpriseId，并映射到 access、refresh、expires、accountId、orgId。真实 email 才能写入 email 字段；nickname SHALL 仅用于展示，不得伪装为 email 或账号 ID。国际版 domain 不作为可变 credential 路由保存。

#### Scenario: Complete login response
- **WHEN** 官方 Plugin Auth 返回完整有效凭据和明确真实 email
- **THEN** OMP 获得映射正确的 OAuth credential，email 保持原语义，UI 可以展示独立 nickname

#### Scenario: Missing or invalid login fields
- **WHEN** 登录响应缺少任一必需字段，特别是 uid 或 enterpriseId，或 expiry 无效
- **THEN** 登录失败，不返回可持久化的部分成功 credential，并提示重新登录

#### Scenario: Nickname without email
- **WHEN** 官方响应只有 nickname 而没有真实 email
- **THEN** nickname 不写入 OAuth email，重启后允许用账号标识展示，不为保留昵称新增凭据文件

### Requirement: AUTH-03 Host-managed refresh preserves identity
Access Token 过期后系统 SHALL 由 OMP OAuth 刷新生命周期调用官方刷新协议，以传入宿主 credential 为唯一输入，返回有效 Token/expiry 并保留 accountId、orgId 及已确认的身份字段。MUST NOT 从旧文件补身份或在身份变更不明时继续使用 Token。

#### Scenario: Forced access expiry
- **WHEN** 已登录账号的 access 被强制过期且 refresh 有效
- **THEN** 宿主自动刷新并继续请求，新 Bearer 与保留的 accountId/orgId 属于同一账号，响应仍可 Streaming

#### Scenario: Invalid refresh or identity
- **WHEN** refresh 失效、响应无效，或输入/输出身份不完整或矛盾
- **THEN** 刷新不返回可用认证，报告明确错误并提示重新登录，不回退其他 Token 来源

### Requirement: AUTH-04 Credential generation atomicity
每次 WorkBuddy Chat 的 Authorization、X-User-Id 和 X-Enterprise-Id SHALL 对应同一 credential generation；Authorization 由宿主原生认证提供，账号 Headers SHALL 在请求边界从对应宿主 credential 解析，不得依赖长期静态账号 Header 快照。固定 Headers SHALL 使用国际版 Origin/Referer/X-Domain、SaaS X-Product 及已验证协议值，不使用 credential domain 改写路由。

#### Scenario: First authenticated request
- **WHEN** 用户首次登录后发出模型请求
- **THEN** 实际出站请求的 Bearer、用户 ID、企业 ID 和 durable credential ID 一致，且携带官方国际版固定 Headers，无旧 Marker Header

#### Scenario: Refresh, retry, and account switch
- **WHEN** 单账号发生 forced refresh 或 401 retry，或 A logout 后 B 在已有会话登录
- **THEN** 每次实际出站尝试的 Bearer、用户 ID、企业 ID 均来自该次选择的同一 credential generation，迟到 A 结果不会恢复旧身份

### Requirement: AUTH-05 Three-layer fail closed
系统 SHALL 在登录返回前、刷新返回前、提供请求 API key 前分别校验必要身份。只在模型投影抛异常不构成拒绝保证；任何必要身份缺失时 MUST 不提供可用认证且不发送 Chat Completion 请求。

#### Scenario: Stored credential lacks accountId
- **WHEN** 宿主已存 credential 有 access 但没有 accountId
- **THEN** 在请求认证边界拒绝调用，提示 `/login workbuddy`，观测到零个 Chat HTTP 请求

#### Scenario: Stored credential lacks orgId despite modifier recovery
- **WHEN** orgId 缺失且宿主捕获模型投影异常并继续提供目录
- **THEN** 仍无法获得可用请求认证，不因目录可见而发送无企业身份的 Chat

### Requirement: AUTH-06 Provider isolation during identity binding
账号身份绑定 SHALL 仅影响 `workbuddy` 的模型，保留所有其他 Provider 的模型内容和行为，不得假定 modifier 输入只有 WorkBuddy。身份无效或 stored credential 歧义时 SHOULD 从投影目录移除 WorkBuddy rows，同时请求认证边界仍须独立 fail closed；不得依赖 modifier 抛错。

#### Scenario: Mixed-provider catalog
- **WHEN** 带 OpenAI、Anthropic、WorkBuddy 模型的目录应用 WorkBuddy 身份绑定
- **THEN** 仅 WorkBuddy 模型获得相应 request-boundary identity resolver；其他 Provider 的模型内容保持不变

### Requirement: AUTH-07 Enforced single effective account
v1 SHALL 只支持一个 stored WorkBuddy OAuth credential。`listOAuthAccounts('workbuddy')` 返回零行时视为未登录，一行时允许继续，超过一行时模型调用 SHALL 被明确拒绝且不得擅自选择、轮换或删除用户凭据。`active` 仅表示指定 session sticky 到哪一行，不得用于判断 stored credential 数量。不能证明身份一致性不得发布。

#### Scenario: Multiple stored credentials are detectable
- **WHEN** 公开 API 显示存在多个 stored WorkBuddy OAuth credentials
- **THEN** 明确拒绝模型调用并告知单账号要求，不允许宿主轮换导致身份错配

#### Scenario: Sequential account switch in existing session
- **WHEN** A 登录并调用、刷新并调用，然后 A 退出、B 登录，并在已有会话和新 subagent 中请求
- **THEN** B 登录完成后的请求不再带 A Bearer、A user ID 或 A enterprise ID，且每次请求的所有认证信息属于 B 的同一 credential generation

### Requirement: AUTH-08 Provider-scoped logout
`/workbuddy logout` SHALL 删除 OMP 中 WorkBuddy 的认证、使旧认证和身份运行态不可再用于新请求、清理 Widget/status 并使待返回积分失效，必要时更新模型。不得删除 Desktop credential 或 WorkBuddy 客户端数据。

#### Scenario: Logout with pending billing request
- **WHEN** 用户退出时旧账号积分请求仍在进行
- **THEN** 宿主 WorkBuddy credential 被删除，后续 Chat 不可认证，迟到响应不恢复登录状态或 Widget，Desktop 登录保持不变

### Requirement: AUTH-09 Cancellable OAuth polling and actionable errors
OAuth polling SHALL 响应用户取消、session abort、extension shutdown，停止后续轮询并终止可取消的在途请求；错误 SHALL 区分授权拒绝、轮询超时、用户取消、网络失败、服务端 5xx 和限流。429 携带有效 Retry-After 时 SHALL 在总超时与取消边界内遵守，不新增通用重试框架。

#### Scenario: Cancellation during request or poll delay
- **WHEN** 用户取消、会话中止或扩展关闭发生在 HTTP 请求或下一次轮询等待期间
- **THEN** 轮询停止，不持久化迟到授权结果，不留下继续发请求的定时任务

#### Scenario: Authorization rejection and timeout
- **WHEN** 官方明确拒绝授权或达到轮询总截止时间
- **THEN** 返回对应错误，不把拒绝当作继续等待，也不无限轮询

#### Scenario: Rate limit or network failure
- **WHEN** 返回 429 和有效 Retry-After，或遇到网络失败或 5xx
- **THEN** 限流等待遵守 Retry-After 且可取消，网络失败和 5xx 分别可识别，错误不包含认证秘密
