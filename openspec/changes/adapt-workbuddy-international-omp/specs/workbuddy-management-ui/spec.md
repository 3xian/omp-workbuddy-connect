# Spec Delta

## Purpose

定义 WorkBuddy 的命令、积分和可选 UI 管理面，使用户能查看真实账号与目录状态、切换模型范围和退出，同时保证计费故障、迟到异步结果或无交互终端不会破坏核心认证及模型调用。

## ADDED Requirements

### Requirement: UX-01 Management command reports truthful state
`/workbuddy` SHALL 提供 login state、account、credits、plan、scope、model count、model source 和 provider state。没有当前有效积分结果时 SHALL 显示 unavailable/查询失败，不把异常伪装成零积分，也不得在请求失败后把宿主 last-good cache 当作当前结果；昵称缺失可使用账号显示，不污染 OAuth email。

#### Scenario: Status with available credits
- **WHEN** 已登录用户执行 `/workbuddy` 且积分接口成功
- **THEN** 展示账号、真实积分与套餐、范围、模型数量、目录来源和 Provider 状态

#### Scenario: Status with billing error
- **WHEN** 积分接口 5xx、超时或无法解析有效结果
- **THEN** 状态说明积分不可用而不是 0 credits 或上一次成功的旧值，其他已知状态仍可查看

### Requirement: UX-02 Required scope and logout commands
系统 SHALL 支持 `/workbuddy free`、`/workbuddy all`、`/workbuddy logout`，分别遵守目录范围一致性及 provider-scoped logout 契约。切换不触发重新登录；logout SHALL 先使旧异步状态失效，再删除认证、清理显示并更新 Provider 状态。

#### Scenario: Scope commands preserve authentication
- **WHEN** 已登录用户执行 free 或 all
- **THEN** 可选择模型、识别集合和显示反映新范围，设置持久化且 OAuth credential 不变

#### Scenario: Logout fails to delete credential
- **WHEN** 宿主 credential 删除失败
- **THEN** 命令报告失败而不虚报已安全退出，旧积分结果不能恢复 UI，用户能够采取重新退出措施

### Requirement: UX-03 Optional billing never blocks critical plane
积分 SHALL 使用宿主 WorkBuddy credential 和刷新生命周期，不读取旧凭据或自行刷新 Token。WorkBuddy UsageProvider SHALL 设置 `retainLastGoodOnFailure: false`，将 accountId 映射为 Billing `X-User-Id`，且没有 live 证据时不得擅自发送 Billing `X-Enterprise-Id`。积分、Widget、TUI 不可用 SHALL 不阻塞 session startup 或正常 Chat。

#### Scenario: Billing is slow or unavailable
- **WHEN** 积分请求挂起、超时、5xx，或 UI 渲染失败
- **THEN** session 启动和有效认证下的 Chat 继续，不等待 Billing 网络完成，也不把 Billing 错误传播为模型认证失败

#### Scenario: Billing needs renewed credentials
- **WHEN** 积分查询时宿主认证需要刷新
- **THEN** 使用宿主公开认证生命周期获得同一账号凭据，插件不产生第二条 refresh 或 Desktop fallback 链

### Requirement: UX-04 Stale async results cannot restore old state
logout、账号切换、scope 变化与 session teardown 后，旧异步结果 SHALL 失效；结果应用时 SHALL 检查当前账号、会话、范围和显示条件，不让旧账号积分恢复 Widget、status 或登录状态。

#### Scenario: Account and scope change during billing
- **WHEN** A 的积分查询未完成时切换到 B 或修改 scope
- **THEN** A 或旧范围的迟到结果被忽略，Widget 不显示旧身份或覆盖新目录状态

#### Scenario: Session closes or model switches away
- **WHEN** 积分查询期间会话关闭或当前模型离开 WorkBuddy
- **THEN** 后续结果不会在已结束会话或非 WorkBuddy 会话中重新显示 Widget

### Requirement: UX-05 Session and turn lifecycle display
Widget/status SHALL 在 session_start 和 turn_start 根据当前模型显示或隐藏，不依赖 model_select。允许模型切换到下一 turn_start 才刷新，但不可因此改变认证或调用链。

#### Scenario: Switch into and out of WorkBuddy
- **WHEN** 用户切换模型并进入下一 turn
- **THEN** 当前为 WorkBuddy 时显示对应 Widget，否则清除 Widget/status，且启动不等待积分

### Requirement: UX-06 Headless needs no UI
Headless 或 subagent 中 auth、model、payload、transport SHALL 独立工作；没有 UI 时 MUST NOT 调用 select、notify、setWidget 或 setStatus 等交互能力来完成认证或请求。

#### Scenario: Non-interactive model execution
- **WHEN** 有宿主凭据的无 UI 进程加载扩展并发起模型及工具请求
- **THEN** 认证、模型解析、payload 和 transport 均正常，无任何 UI 访问依赖

### Requirement: UX-07 Non-sensitive settings follow host directories
scope 及非敏感设置 SHALL 使用 OMP agent 目录规则，默认 `~/.omp/agent` 并尊重 `PI_CODING_AGENT_DIR`，不得发明 `OMP_CODING_AGENT_DIR` 或保存 Token/credential；正常重启 SHALL 保留 scope。

#### Scenario: Custom agent directory and restart
- **WHEN** 用户设置 `PI_CODING_AGENT_DIR`、切换 scope 后重启
- **THEN** 从该宿主目录恢复非敏感设置，不写入项目目录或旧 `.pi/agent` 默认路径，不保存认证秘密
