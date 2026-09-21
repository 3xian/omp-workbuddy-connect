# WorkBuddy Release Validation Specification

## Purpose

定义国际版 OMP WorkBuddy 扩展的发布证据、安全边界及跨运行模式验收，确保文档和测试替身不会替代官方宿主及真实 Gateway 的结果，所有 v1 必需能力和长期风险均有可追溯的验证记录。

## Requirements

### Requirement: REL-01 Main subagent and headless parity
WorkBuddy SHALL 在 main agent 完成 chat、thinking、tool、streaming、refresh；在 task role/subagent 完成 OAuth、正确身份、payload hook、streaming、tool calling 和结果返回；headless SHALL 完成加载、认证、模型解析、请求和工具执行。

#### Scenario: WorkBuddy main model
- **WHEN** 官方宿主以 WorkBuddy 为主模型执行包含工具和过期刷新的一轮任务
- **THEN** 正确认证并完成 reasoning、Streaming、工具和最终回答

#### Scenario: WorkBuddy task role
- **WHEN** task role 指定 WorkBuddy 模型并 spawn subagent
- **THEN** 子进程或子运行态加载必要扩展、获得正确身份并执行 payload hook，完成工具闭环且向主任务返回结果

#### Scenario: Headless execution
- **WHEN** 无 TUI 的官方宿主使用已保存凭据执行任务
- **THEN** 完成模型调用和工具，且没有隐式交互 UI 依赖

### Requirement: REL-02 Complete release matrix
v1 SHALL 通过 V2 的全部 Release Matrix：官方安装、零类型错误、fresh OAuth、首请求身份、重启、过期刷新、无效 refresh、缺 accountId、optional orgId / no-enterprise、A→B、真正 logout、至少三个真实模型、支持的 thinking、真实图片、read/grep/bash、连续与多工具、main/subagent/headless、free/all/empty free、Billing 成功/5xx/慢或超时、Provider 隔离及秘密不泄露。支持的 parallel tools SHALL 一并验证。

#### Scenario: Required release case has no passing evidence
- **WHEN** 任一必需案例未运行、失败或仅有 Mock 结果
- **THEN** 发布状态不为通过，不将 P1 管理功能或 Agent 验收以优先级名义移出 v1

#### Scenario: Optional capability is inapplicable
- **WHEN** 某个 effort 或 parallel tool 被 Gateway 明确不支持
- **THEN** 记录能力证据与不适用原因，不伪造通过；已声明 Vision、三个模型及其他必需能力不能按可选项豁免

### Requirement: REL-03 Layered verification and permanent regressions
验证 SHALL 包含纯函数 unit、真实 OMP 类型/API contract、官方 runtime integration、真实 WorkBuddy Live E2E 四层；Mock SHALL 不替代真实 OAuth/Chat/Refresh/Vision/Tools/Credits。永久回归 SHALL 覆盖刷新身份、缺身份阻断、两种隔离、A→B 无旧身份、清理不破坏工具、付费与未知排除免费、慢 Billing 不阻塞、退出丢弃迟到积分、重注册不改 credential、headless 无 UI。

#### Scenario: Existing regression tests are migrated
- **WHEN** 旧 scope 与 session-start 测试迁移到新架构
- **THEN** 保留非目标请求不变及网络不阻塞启动的行为断言，移除对旧认证文件的依赖，测试隔离且不读取真实账号凭据

#### Scenario: Unit suite passes but live authentication fails
- **WHEN** 所有纯函数及 Mock 测试通过而真实 Gateway 登录或刷新未通过
- **THEN** 不宣布认证或发布完成，保留真实失败证据继续处理

### Requirement: REL-04 Credential privacy and official endpoints
系统 SHALL 不在日志、仓库、项目目录或第三方服务泄露 access、refresh、完整 Authorization、API key 或 credential，不修改或清除 Desktop 登录状态。网络 SHALL 仅访问请求目标 realm 功能所需的官方 endpoints；国际站与中国站 credential、identity headers 和 pending code MUST NOT 交叉发送。扩展自有输出中的 identity SHALL 脱敏。若验收时最新稳定版 OMP 独立生成的本地 HTTP 诊断保留账号标识、且没有公开 Provider API 可声明额外敏感 Header，RC MAY 在确认附件不含认证秘密、不上传第三方、不跨 realm，并于 README 和 release evidence 明示本地隐私限制后发布；不得把该风险描述为完全脱敏。

#### Scenario: Extension error logging contains sensitive upstream content
- **WHEN** OAuth、refresh、Billing 或 Chat 错误含认证秘密或身份
- **THEN** 扩展输出保留有用状态和错误分类但移除 Token/Authorization，身份脱敏，扩展生成的诊断附件亦遵守同一规则
    
#### Scenario: Official host persists a local request diagnostic
- **WHEN** 验收时最新稳定版 OMP 在 HTTP 400/413 后自动保存扩展无法配置脱敏规则的本地 request dump
- **THEN** RC 只有在附件无 access/refresh/Authorization/API key/credential、无第三方上传和跨 realm 数据，且用户文档明确文件位置、账号标识风险与处理方式时才可通过；stable publication 仍需单独最终评审

#### Scenario: Logout and release inspection
- **WHEN** 执行 logout 并检查持久化、网络与诊断产物
- **THEN** 只有宿主负责正式认证存储，项目及证据中无秘密，没有第三方凭据上传，Desktop 数据未改变

### Requirement: REL-05 Reproducible release evidence
每次正式验收 SHALL 保存 OMP version/commit、extension version/commit、Node/Bun runtime、test date、WorkBuddy account type、tested model IDs、matrix result、known limitations、redacted diagnostic evidence。每项结果 SHALL 关联规格、实现位置和测试/执行证据；尚未运行不得标为通过。

#### Scenario: Release report is reviewed
- **WHEN** 审核正式验收结果
- **THEN** 能恢复准确环境、模型、账号类型和各场景结果，并定位失败而不暴露账户秘密

### Requirement: REL-06 Honest compatibility and limitations
发布文档 SHALL 明示本次验收使用的最新稳定版官方 OMP 精确版本、国际站 `workbuddy` 与中国站 `workbuddy-cn` 的支持范围、单账号且不接受身份错配、Widget 生命周期、request-bound Provider 隔离行为、各 realm 缓存依赖与 model source、宿主本地诊断 identity 限制，以及未验证能力。项目不维护旧 OMP 兼容矩阵；下一次发布 MUST 先升级并重验届时最新稳定版。真正多账号、Desktop import、自定义 Provider transport 和即时 model-select UI SHALL 不进入关键路径；动态目录与 Usage 增强按实证说明。

#### Scenario: User reads installation and migration instructions
- **WHEN** 用户依据 README 安装或从旧 Pi/Fork 迁移
- **THEN** 获得正确 OMP 安装、登录、目录、scope、logout 与限制说明，不被告知旧环境凭据仍有效或模型零占位意味着免费
