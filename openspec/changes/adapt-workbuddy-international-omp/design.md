# Design

## Context

动机见 `proposal.md`。裁决来源为 `docs/260919 - OMP WorkBuddy Connect 国际版开发计划 V2.md`；原需求文档补充 V2 未改变的国际版端点、配置目录和命令定义。前一轮计划不是优先于 V2 的约束。

### 已观察的规划基线

| 对象 | 仓库/标识 | 精确版本或提交 | 证据与边界 |
|---|---|---|---|
| Fork | `https://github.com/ha5h6r000wn/omp-workbuddy-connect`，分支 `feat/omp-port` | `cb2398e3374144db0c088d7a4887dc0913342858` | `git log -1`；仅代表 HEAD，不代表全部工作区 |
| Upstream | `https://github.com/icekale/pi-workbuddy-connect` | `cb2398e3374144db0c088d7a4887dc0913342858` | 本地 Fork HEAD 与本次查询 upstream/main 相同；M0 冻结保留该精确 SHA，不随 main 漂移 |
| OMP | `can1357/oh-my-pi`，`v18.2.6` | `78b753124d11f8dd3ae73e2524125890ff7c977e` | `git ls-remote` 和 GitHub commits/v18.2.6 的 commit SHA 一致 |
| 包版本 | `omp-workbuddy-connect` | 当前 manifest `1.1.5` | V2 的 v1 是功能基线，不自动降级包版本 |
| 未提交修改 | `.gitignore`、`extensions/workbuddy.ts`、`package.json` | 本次观察相对 HEAD 共 22 additions / 11 deletions | 只记录已跟踪差异，不声称覆盖未跟踪文件；M0 保存完整工作区证据，不能覆盖用户工作 |

当前实现仍在一个 `extensions/workbuddy.ts` 中：`saveOwn/current/resolveCred` 维护旧凭据；refresh 从旧文件补身份并丢失身份输出；Provider 仍用 Marker、unsupported hook/refreshModels；scope 空集合回退 `FREE_IDS`；模型默认扩展到全部 effort；payload 自动插入 system。`package.json` 已有 OMP manifest/import，但 peer 为 `*`；`tsconfig.json` 只列扩展入口。现有两个测试保护 payload 隔离和启动不阻塞，但后者写旧凭据文件。

前轮已执行 `node --experimental-strip-types test/scope.test.mts` 并记录 `ERR_INVALID_TYPESCRIPT_SYNTAX`，本轮源码仍显示 login 函数缺少闭合；不重复确认已知失败。本轮不修代码、不运行真实 OAuth、不声明 M0 完成。

宿主参考：[18.2.6 Extension types](https://github.com/can1357/oh-my-pi/blob/78b753124d11f8dd3ae73e2524125890ff7c977e/packages/coding-agent/src/extensibility/extensions/types.ts)、[ModelRegistry](https://github.com/can1357/oh-my-pi/blob/78b753124d11f8dd3ae73e2524125890ff7c977e/packages/coding-agent/src/config/model-registry.ts)。已读源码表明 modifier 接收完整目录，异常被捕获并可能继续提供未投影目录；这些事实不能替代宿主运行验证。

## Goals / Non-Goals

**Goals:**
- 让宿主 credential 成为唯一 authority，身份原子性与 fail-closed 作为执行边界而非 UI 提示。
- 按六份 capability specs 形成可追溯的请求、模型、UI 与发布契约；M0 的具体宿主实验先于 M1 生产认证实现。
- 用最小职责模块隔离协议、模型、状态与显示，兼容变化可以独立验证。
- 正式验收以真实 OMP + WorkBuddy 为最终证据，文档生成完成不等于功能完成。

**Non-Goals:**
- 不改 OMP、AuthStorage 格式或 ModelRegistry，不引入 Pi shim、自定义 Chat client/transport、SSE/tool parser、全局 fetch interceptor。
- 不建 CredentialStore、TransportManager、Provider Framework、Generic Gateway Adapter 或 Custom HTTP Retry Framework。
- 不自动迁移桌面凭据，不支持国内版、真正多账号轮换或更早 OMP；不承诺精确即时 model_select UI。
- 不在规划阶段替 M0 编造在线目录/Usage 可用性或真实账号验收证据。

## Decisions

### D1 — 精确基线和宿主实验是 M0 gate

选择：开发依赖/锁文件针对 18.2.6；修复 syntax、imports、manifest 和类型不接受的字段/事件，使用官方宿主隔离配置做最小契约探针。M0 的真实 `/login workbuddy`、持久化/refresh/delete/restart 实验用于证明公开 API，不声称已经完成 M1 的生产级认证实现。不得使用手写 AuthStorage 文件、私有方法或 `any` 掩盖类型问题。

API Compatibility Matrix 至少包括：

| API/行为 | 处理 | 所需证据 |
|---|---|---|
| `omp.extensions`、`@oh-my-pi/*` | 保留已有迁移，锁定真实类型和导出路径 | 编译、官方加载 |
| Provider 顶层 `name` | 不使用；OAuth `name` 是不同字段，保留合法用途 | ProviderConfig 类型 |
| `refreshModels`、`before_provider_headers`、`model_select`、Marker | 删除旧契约 | 编译和事件加载 |
| `before_provider_request` | 保留；验证返回 payload 语义及 subagent 加载 | 真实请求和隔离测试 |
| `getApiKey`、`refreshToken` | 认证唯一入口 | 缺身份零请求、刷新持久化 |
| `modifyModels` | WorkBuddy-only 投影 | 完整目录、重建、凭据更新、异常、旧 model reference、subagent 六项实验 |
| AuthStorage public access/delete | 从公开上下文取得，不臆造方法名 | 重复登录 replace/append/rotate、删除后不可用、重启 |
| `fetchDynamicModels` | 走 D6 ADR | 官方在线端点及缓存/范围证据 |
| `usage` / UsageProvider | 走 D8 ADR | account/credits/plan/identity 表达及生命周期 |
| callback AbortSignal、shutdown、headless/role | 使用 18.2.6 实际公开能力 | 轮询取消和运行态加载 |

M0 交付拟存于 `docs/omp-port/`：`baseline-manifest.md`、`api-compatibility-matrix.md`、`credential-behavior.md`、`adr-dynamic-models.md`、`adr-credits-usage.md`、`requirement-implementation-test-matrix.md`。这里只规划这些后续证据文件，不填造实验结果。类型零错误、加载正常、以上 gate 有证据才进入 M1。替代方案“先照着 Pi API 实现再修”会把未知契约扩散到全部功能，拒绝。

### D2 — 一个 authority，三处认证边界

`auth.ts` 负责协议值映射与验证；`workbuddy-api.ts` 只负责国际版 Auth/Refresh/Billing 和 ADR 选中的产品协议。Token 不存插件文件，不在模块全局保持独立 refresh 生命周期。

映射为 access/refresh/expires/accountId/orgId；真实 email 才写 email。nickname 只保存在当前 UI generation 的非认证展示态，重启丢失昵称时展示账号，不为此扩展 credential 存储。domain 固定国际版，不根据服务端任意 domain 路由；不以 JWT email 代替 uid。已有 uid fallback 仅在确证 WorkBuddy 身份语义时保留，否则登录失败。

登录拒绝缺失或无效 access/refresh/expiry/uid/enterpriseId；刷新以传入宿主 credential 为唯一输入，保留既有身份和明确 email，新的 Token/expiry 必须合法。刷新响应缺省 refresh 的保留行为只有得到官方协议证据后才能保留，不能以旧过期时间伪造成功；响应身份与旧身份矛盾视为失败。

`getApiKey()` 在返回 access 前重验必要身份，不手动向 Chat 注入 Authorization。modifier 内校验用于诊断/投影，但因宿主可能捕获异常，绝不是唯一阻断点。缺 accountId/orgId 分别验证实际 Chat 请求计数为零。替代方案“Widget 警告后继续”违反 fail-closed，拒绝。

### D3 — 身份 generation 与单账号安全边界

`Credential Generation` 表示宿主一次可用 credential 状态（Token、accountId、orgId）。它不是新增持久化 credential 字段，也不是 UI generation。单账号刷新保留身份；账号替换需要作废旧运行态、通过宿主公开路径刷新目录/已选 model 引用并确认 subagent 获取新投影。

`modifyModels(models, credentials)` 只映射 `model.provider === 'workbuddy'`，合并固定/账号 Headers，不修改其他行。固定 Header 包括 Accept、X-Requested-With、Origin=`https://www.workbuddy.ai`、Referer=`https://www.workbuddy.ai/`、User-Agent（以已验证协议为准）、X-Product=`SaaS`、X-Domain=`www.workbuddy.ai`。不保留 Marker 或缺身份时的 `X-No-User-Id/X-No-Enterprise-Id` Chat 降级。

M0 若公开 API 可枚举 active credential，接入明确多账号拒绝，不能自动删其他凭据。若无法可靠检测，记录限制，要求 A login/request → A refresh/request → logout → B login/request → existing session B request → spawned subagent B request；不能证明无 A 身份即 gate 失败。不得把“单账号已声明”当作接受身份错配的理由。

这里不假定 `getApiKey` 和 modifier 是同一 per-request callback，也不承诺仅靠一个内存计数器解决竞态。M0 必须验证旧 model 引用、并发 refresh 与 logout/换号的行为。如果公开 API 无法维持一致性，阻断 M0/M1 并提交具体限制，不暗中 patch OMP 或放宽规格。对已经发出的 A 请求不声称能追溯改写；验证 B 登录完成后新发出的请求及迟到 A 结果不会恢复 B 的认证状态。

### D4 — Logout 和 Billing 共享宿主生命周期

通过 M0 确认的公开 provider-scoped credential 删除入口实现 logout，不直接编辑宿主存储。顺序：失效 UI generation → 删除 WorkBuddy credential → 清理 widget/status → 失效认证运行态 → 按实测需要更新目录。失败必须报告，不把删除异常吞掉后显示成功。

Billing 通过宿主公开认证解析获得有效 credential；不调用旧 `current/resolveCred`，不创建自己的 refresh 去重器。其直接 HTTP 请求所需 Authorization 只是 Billing 协议，不是给 Chat 注入 Authorization。刷新失败在 Billing 面表现为 unavailable，不能吞掉真正 Chat 的认证错误。桌面凭据和客户端数据均不修改。替代方案“仅 unlink 插件文件”无效且会重新回退 Desktop，删除。

### D5 — 类型化模型能力，不机械搬字段

`models.ts` 解析产品配置；`buildOmpModels()` 返回实际 `ProviderModelConfig` 支持的字段，provider/baseUrl 等由 Provider 注册层提供，最终 resolved Model 必须完整。不得把 V2 §6.2 的完整模型属性机械全部塞进 ProviderModelConfig；cost 按实际 schema 提供但不作为免费证据。

thinking 使用 canonical metadata，effort 只来自可信配置/证据，明确 requiresEffort/off。不再默认“supportsReasoning=true 就给全部档位”；缺 effort 列表只使用经验证的宿主默认或明确受限状态。Vision 依据 Gateway，可必要覆盖 `compat.stripImageInput=false`，通过真实图片证实。context/maxTokens 的 clamp 在目录和请求保持一致，较小预算不被上调。

free 判定只采用可信计费证据。有效目录无免费条目时返回空集合，不补 `FREE_IDS`；有效缓存的已知付费/未知结论优先于 builtin。缓存缺失/损坏时允许 builtin 作为目录来源，但硬编码 `x0.00` 并不自动证明当前免费；没有独立可靠证据则 free 仍为空。all 指当前可识别模型，不声称绝对完整。替代方案“免费列表为空就回退内置免费 ID”会产生计费风险，删除。

### D6 — Dynamic Model ADR 是有界实施分支

M0 调查范围是已有 upstream 协议、官方产品配置文档/响应及授权可访问的官方端点，不猜测 endpoint 或扫描第三方。ADR 记录稳定性、认证/identity 需求、实际能力及选择理由。

- Path A：证据支持且决定纳入 v1，使用 `fetchDynamicModels` 与宿主缓存；验证认证参数是否足以携带身份、scope 是否被缓存/静态 fallback 再次扩宽、空 free 是否清除旧列表。选择该路径后实现与测试任务在本 change 内完成。
- Path B：无可靠接口或原生接入不能满足约束，采用 Desktop product cache → builtin fallback；声明缓存依赖。桌面产品配置读取与 Desktop credential 读取是不同权限边界，后者仍禁止。

这是 V2 明确要求在 M0 做出的研究决策，不是需要用户预先选择的产品歧义；两条分支和验收已纳入 tasks，不将任意一条标为已验证。未选路径记录不采用理由而不是实现空壳。

### D7 — Gateway patch 必须逐项有证据

`payload.ts` 从 OMP 原生 payload 出发，按当前 ID 集合过滤。建立 `docs/omp-port/gateway-compatibility-evidence.md`，每条记录：适用模型/版本、未变换失败案例、最小修复、脱敏服务端结果、回归场景。reasoning replay、named tool_choice、DeepSeek clamp、字段清理均是候选，不能仅凭旧代码注释无条件保留。

移除宿主已正确完成的 stream=true、developer→system、标准 effort/max_tokens 和解析逻辑。默认不注入 system prompt；仅真实 Gateway 无 system 必失败时允许最小修正并记证据。reasoning 清理保留 tool_call_id、tool result association、assistant tool replay，完成下一轮而非仅测试 JSON 变换。

Model ID 冲突按 V2 L3 接受：非匹配 ID 请求必须完全不变；同名跨 Provider 场景明确未解决，不把隔离测试描述为所有 Provider 绝对隔离。不得因此自建 transport。

### D8 — Credits / Usage ADR 与可选管理面

M0 比较 UsageProvider 是否表达 account/remaining credits/plan、提供身份并复用认证生命周期。适合则优先宿主 Usage；否则 `credits.ts` 管理解析/状态、`workbuddy-api.ts` 请求 Billing。两条路径均满足 UX-01/03，不能为采用 Usage 丢失套餐/账号或建立第二套 refresh。

积分状态区分 available / unavailable / 未查询，不把 parse 失败或 5xx 当成 total=0。`/workbuddy` 展示全部必需字段；生命周期只发起非阻塞更新，UI/Billing 失败不进入 Chat critical path。显式状态命令可以异步取得结果，但不能锁住后台模型执行。

### D9 — 目录和 UI 是不同状态边界

Scope 更新构建新目录与 ID Set，提交 Provider/selector 状态后持久化和更新 UI；注册或写设置失败不虚报切换成功，并避免保存新 scope 却继续展示旧目录。空模型数组的真实替换语义在 M0/M2 验证。当前模型被移除时明确要求重选，绝不自动换付费或任意 fallback。

`stateGeneration` 是仅针对异步展示的内存计数，logout/account switch/scope/session teardown 递增；完成后比对 generation、当前模型和活动会话再应用结果。模型离开 WorkBuddy 时同步清理，迟到响应不能重显。使用 `session_start/turn_start`，接受下一 turn 更新限制；无 UI 时所有交互调用跳过，认证/注册/hooks 始终可用。

设置只保存 scope 等非敏感值，使用宿主 getAgentDir 等实际公开目录规则，默认 `~/.omp/agent` 并尊重 `PI_CODING_AGENT_DIR`，不引入新环境变量。

### D10 — 可取消的 OAuth 协议轮询

将宿主支持的取消信号和扩展/session 关闭连接到 AbortController；HTTP 请求和间隔等待都可取消，取消后忽略迟到成功结果。维持总轮询截止时间，分类拒绝/超时/取消/网络/5xx/429；有效 Retry-After 在剩余时间内优先遵守。这是 Plugin Auth 协议调度，不是重写 Chat Retry。所有错误输出先去秘密，保留状态与可行动原因。

### D11 — 按协议边界模块化

| 文件 | 单一职责 |
|---|---|
| `extensions/workbuddy.ts` | composition root、事件和命令装配；不再承载全部业务 |
| `src/auth.ts` | credential mapping、login callbacks、refresh、identity validation |
| `src/provider.ts` | ProviderConfig、OAuth adapter、modifyModels、注册/重注册 |
| `src/workbuddy-api.ts` | 官方 Plugin Auth/Refresh/Billing/选定 Product Config HTTP 协议；不得依赖 UI，不发送 Chat |
| `src/models.ts` | 配置解析、scope、thinking/vision、catalog |
| `src/payload.ts` | 有证据的 Gateway delta |
| `src/credits.ts` | Billing response 与积分状态 |
| `src/settings.ts` | scope/non-sensitive settings；不接触 Token |
| `src/ui.ts` | status/widget/notify/select 和 generation-aware rendering |

随里程碑迁移现有实现并更新调用者，不先建立无用抽象或占位模块。更新 tsconfig 让实际实现和必要 contract tests 接受真实类型检查；扩展目录仅有入口，避免 helper 被当扩展加载。

### D12 — 验证和证据组织

unit：映射/身份/模型/免费过滤/payload 纯行为；contract：真实 OMP ProviderConfig/OAuth/modifier/hook；integration：真实 OMP 注册、持久化、重注册、logout、subagent；Live：真实 OAuth/Chat/Refresh/Vision/Tools/Credits。现有 scope/session-start 测试迁移到新边界，保留行为而不再写旧凭据；临时目录、mock 和计时资源须隔离并清理。

V2 §13 的十二类长期回归全部保留，不用“字段被转发”或源码字符串代替行为。脱敏观测不能依赖生产全局 fetch 拦截；使用宿主允许的诊断和隔离测试观测请求，负例确认零 Chat 请求，Live 正例使用官方地址。不得把“测试 seam 可记录”写成“真实 Gateway 已通过”。

正式 `docs/omp-port/release-evidence.md` 记录 V2 §11 的十一项环境/结果字段及 §10 的全部矩阵，引用规格 ID、实现和测试证据；Live 未执行永远不是 PASS。P1 所有能力仍是 v1 gate。

## Risks / Trade-offs

- [宿主请求时 Token 与目录投影不是同一个 callback] → M0 验证换号、刷新、旧引用及子运行态；三层验证不能单独证明原子性，必须真实请求证据，无法满足即阻断，不放宽 AUTH-04。
- [公开 API 无法枚举多个有效账号] → 按 AUTH-07 记录检测限制，强制顺序换号矩阵；不宣称支持 rotation，不接受错配。
- [M0 与 M1 都涉及 OAuth] → M0 是隔离宿主契约实验，M1 是正式实现和完整真实链；M0 可复用现有协议作探针，但不能以实现未完成跳过宿主验证。
- [在线目录/Usage 尚无实际端点/能力证据] → D6/D8 已定义调查、选择和对应任务；保持决策待实测而不是伪造 API。分支不改变安全和对外验收标准。
- [空免费集合与 builtin fallback 容易冲突] → 目录 fallback 不等于免费 fallback；有效目录空免费必须保留，未知永不免费。
- [同名 model ID hook 冲突] → 明确 L3 范围，不把非匹配测试扩大为绝对保证；不改 transport。
- [不刷新 Widget 即时体验较弱] → 接受 L2，下一 turn 同步；generation 处理旧异步响应。
- [真实账号或某模型暂不可用] → 相应 live gate 保持未完成，不以 Mock 或删验收范围代替。
- [未提交用户修改与基线混淆] → 保存差异证据、不覆盖或代提交用户工作；M0 冻结后重估，不承诺总工期。

## Migration Plan

1. 仅在用户启动 apply 后进入 M0，保存准确基线，修当前加载问题并证明公开宿主契约，完成六项文档与两项 ADR。M0 预算 1–2 工程日，之后重估 M1–M5；原 12–18 日仅参考。
2. M1 单一负责人串行完成 credential/header/logout 共享状态链；一个稳定真实模型打通 V2 §23 全链再扩展。
3. M2/M3 仅在 credential、Provider 注册、model ID contract 固定后可局部并行；共享 `provider.ts` 和入口有一个集成负责人，阶段验收仍按顺序。
4. M4 完成管理面非阻塞与竞态处理，M5 执行全部发布矩阵和保留回归，再完成 README、版本/发布说明和临时实验文件清理。
5. 用户迁移需 `/login workbuddy`，不自动读取、导入或删除旧插件/Desktop 凭据；scope 可重新选择，不静默搬旧认证。
6. 发布失败时停止分发并禁用/卸载该扩展或回到明确验证过的 OMP 兼容发布；当前未通过的 Pi Fork 不冒充可用回滚版本。插件不得自动回滚宿主 credential 到旧文件，桌面登录保持原状。正式包版本按已发布历史单调推进，不因功能名 v1 把 1.1.5 降为 1.0.0。

## Planning Clarifications

- V2 明确授权 M0 ADR 分支，因此此处规划决策机制与两条实施路径，而不是把尚未运行的架构实验宣称完成。
- V2 §6.2 的完整模型语义落在 resolved Model；注册对象仍遵守真实 ProviderModelConfig，避免为字段列表引入编译错误。
- V2 对隔离的强要求与 L3 同名限制同时保留：modifier 对全部非 WorkBuddy 严格隔离；payload hook 对非匹配 ID 严格隔离，同名风险明确列示。
- 本轮只产生 OpenSpec planning artifacts；覆盖检查见 `coverage.md`，该文件不是已完成的 M0 Requirement → Implementation → Test 实验证据。
