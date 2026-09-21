# Spec Delta

## MODIFIED Requirements

### Requirement: MODEL-04 Catalog and request budgets agree
每个 realm 的 contextWindow 与 maxTokens SHALL 与其 Gateway 请求预算一致。已获目标 realm 服务端证据的特定模型上限 SHALL 同时约束该 realm 的目录与请求，较小用户预算不得被上调。模型 ID 相同不足以把一个 realm 的 token clamp 应用到另一个 realm。

#### Scenario: Evidence-backed model token clamp
- **WHEN** 某模型在目标 realm 有已确认上限且请求预算高于或低于该上限
- **THEN** 该 realm 目录暴露有效上限，真实请求不超过上限且保留较小合法预算

#### Scenario: Same model ID lacks matching evidence
- **WHEN** 国际站模型已有 token clamp 而中国站出现相同 model ID 但没有相同上限证据
- **THEN** 中国站不继承国际站 clamp，并在能力未确认时不把该模型注册为已验证可用

### Requirement: MODEL-06 Explicit source and controlled fallback
每个 realm 的目录 SHALL 使用其证据与 ADR 选定的来源，并在 UI/日志如实说明 `remote`、`desktop-cache`、`builtin-fallback`、`empty` 或 `unavailable`。国际站保留已验证的 Desktop cache 到 builtin fallback。中国站缓存缺失、不可读或无效且没有独立验证的 builtin 时 SHALL 返回 empty/unavailable，不得使用国际站缓存、builtin IDs 或来源标签，也不得把来源缺失当作免费证据。

#### Scenario: Missing or malformed local cache
- **WHEN** 中国站选择本地目录路径，但缓存缺失、不可读或格式损坏，且没有已验证中国站 builtin
- **THEN** 中国站目录为空并报告 unavailable/empty 及原因，不回退国际站目录或注册未知模型

#### Scenario: International controlled fallback remains
- **WHEN** 国际站本地产品缓存缺失、不可读或格式损坏
- **THEN** 使用明确标记的国际站 builtin 目录并保持既有免费证据约束，中国站目录不受影响

#### Scenario: Online path selected by ADR
- **WHEN** 某 realm 的 ADR 决定使用可信在线目录
- **THEN** 只通过该 realm 已验证的发现与缓存路径提供目录并如实显示来源，不绕过其 scope 与认证约束

### Requirement: MODEL-07 Scope update consistency and persistence
每个 realm 的 free/all 切换 SHALL 独立同步自身目录、Provider 注册、请求识别集合、选择器与持久化 scope，不修改任一 OAuth credential 或另一个 realm 的状态；下一次对应管理命令 SHALL 反映已提交范围。空列表 SHALL 真正清除该 realm 旧选择集合，重启后两个 realm 的 scope 分别保持。被新 scope 移除但仍由 session 持有的旧 Model object MUST NOT 再发起目标 realm 请求，直到用户明确选择范围内模型。

#### Scenario: Re-register while authenticated
- **WHEN** 用户切换中国站 scope，而国际站和中国站均已认证
- **THEN** 仅中国站目录及请求识别集合改变，两个 credential 与国际站目录、scope 和模型引用保持不变

#### Scenario: Current model removed by scope
- **WHEN** 用户切换某 realm 范围后当前模型不在新目录
- **THEN** 明确提示重新选择，不自动选择另一个 realm 或任意付费模型；旧模型对象的下一次 Chat 在该 realm transport 前被阻断

#### Scenario: Restart after empty free scope
- **WHEN** 任一 realm 的免费集合为空并保存 free 后重启
- **THEN** 两个 realm 分别恢复自身 scope，空目录不恢复 all、另一个 realm 或任意 fallback 模型

## ADDED Requirements

### Requirement: MODEL-08 Catalog identity is realm-bound
模型目录项 SHALL 由 Provider ID 与 model ID 的组合标识其 realm，目录加载、缓存解析、免费证据、能力 metadata、错误和来源状态 SHALL 保持 realm 归属。系统 MUST NOT 仅按 model ID 合并两个 realm 的目录或共享 mutable catalog state。

#### Scenario: Both realms publish the same model ID
- **WHEN** 国际站和中国站目录包含相同 model ID
- **THEN** 选择器保留两个不同 Provider 的模型，其 endpoint、能力、价格证据、scope 和请求约束分别来自各自 realm
