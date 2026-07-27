# DougoOS 功能迭代路线 & AI 开发规范

> **本文档的用途**：所有后续功能开发（无论由人还是 AI 执行）都必须遵守本规范。
> 仓库初始化后，将本文档第二部分（开发规范）精简为仓库根目录的 `CLAUDE.md` / `AGENTS.md`，
> 完整版保留在 `docs/AI_DEV_SPEC.md`，两者同步维护。
> 架构背景见 [ARCHITECTURE.md](./ARCHITECTURE.md)，本文中的术语（core、Registry、HarnessModule 等）均以其为准。

---

# 第一部分：后续功能迭代路线（P4 之后）

P0–P3 见 ARCHITECTURE.md 第 5 节。以下是 P4 起的功能 backlog，**按优先级排序**，每项都标注了它使用的扩展点——新功能如果无法映射到已有扩展点，先写 ADR 再动手。

## P4 — Agent 生态补全（高优先级）

| 功能 | 使用的扩展点 | 说明 |
|---|---|---|
| AgentProvider 基线（已完成） | 扩展点 a（AgentProvider） | Codex / Cursor / Grok / Hermes / OpenClaw / OpenCode / Pi 已按 Checklist A 接入；Claude Agent 在 0.2.0 中是 fail-closed、不可启动的状态槽位；后续 Provider 继续复用同一注册表与 doctor 门禁 |
| GenericAcpProvider（用户自定义 CLI） | 扩展点 a | 设置页 JSON 配置（command/args/env）→ 动态注册；校验失败要给出 doctor 级诊断信息 |
| LlmTaskRouter | TaskRouter 策略接口 | 最小 agent loop + Vercel AI SDK structured output；置信度 < 阈值时 UI 弹确认；保留 RulesTaskRouter 作为降级路径 |
| 会话恢复（session/load / resume / list / close） | @dougoos/acp | 只按 initialize 实际协商能力启用；load 与 resume 语义不同。不支持时允许用户显式创建新会话并附带历史摘要，禁止静默伪装成原会话恢复 |

## P5 — Session Manager 深化

| 功能 | 使用的扩展点 | 说明 |
|---|---|---|
| Insights（LLM 洞察提炼） | StatsDataSource + 新增 analysis_queue 表 | 照 code-insights：durable 队列 + 重试 + resetStale；分析结果归一化管线（exact→alias→Levenshtein→透传） |
| Patterns（重复模式） | 同上 | 依赖 Insights 数据积累，后于 Insights |
| Export（Agent Rules / Knowledge Brief） | 新增 export 子模块 | 导出物写回 CLAUDE.md/.cursorrules 的落盘机制需先出 ADR（涉及写用户文件，需审批交互） |
| 更多外部 SessionProvider（Codex/Cursor 会话文件） | SessionProvider 注册表 | 按 Checklist D |

## P6 — Harness 子模块逐个激活（建议顺序）

激活顺序按"依赖少 → 依赖多"排列，每个模块按 Checklist B 执行：

1. **Rules**（只读展示项目规则文件，无运行时介入，最简单）
2. **MCP**（注册表 CRUD + 状态探测；与 ACP session/new 的 mcpServers 参数打通）
3. **Skills**（清单管理；与 Agent 会话的关联统计）
4. **Hooks**（第一个介入会话运行时的模块——阻断型能力必须实现 `@dougoos/acp` 的 `SessionInterceptor`，由 core 组合根注入；Registry 事件总线只用于观察型统计，禁止当作阻断点。安全边界已由 [ADR-0003](./adr/0003-session-interceptor-hooks.md) 确定，实现前逐条对照执行）
5. **SubAgents / Goals / Workflows**（依赖任务编排能力成熟后再做）

## P7 — 平台能力

| 功能 | 说明 |
|---|---|
| 定时任务（Cron）/ 长程任务（Queue） | 任务编排层扩展；复用 tasks 表 + TaskEngine，新增调度器（node-cron 级别即可，不引入外部队列） |
| Memory（记忆 + 图谱） | 新顶层模块，独立包 `packages/memory`；数据模型参考原型（omi/note 双类 + 关联对） |
| Compare（同题多发对比） | 依赖多会话并发（P1 已具备）；一个 compare 记录关联 N 个 session |
| 云端备份（加密快照） | 复用 outbox 通道 kind:"snapshot"；客户端加密先出 ADR（密钥管理方案） |
| 预算护栏 | usage_stats 聚合 + 阈值告警；先做提醒，不做强制熔断 |

## 迭代原则

- **每个 Phase 结束必须可发布**：功能可以少，但已有功能必须完整可用。
- **先桩后实**：新模块先以 planned 占位卡进 UI，再逐步 active——用户始终能看到产品全貌。
- **不跳扩展点**：如果一个功能"哪个扩展点都放不进去"，说明架构需要演进，先写 ADR 讨论，禁止旁路 hack。

---

# 第二部分：AI 开发规范

## 0. 开工前必读

任何开发任务开始前，按顺序确认：

1. 读 `docs/ARCHITECTURE.md`，确认功能落在哪个包、用哪个扩展点。
2. 查 `docs/adr/` 是否已有相关决策——已决策的事项不重新讨论，直接遵守。
3. 本次改动如果跨 ≥3 个包或引入新依赖方向，**先写 ADR 草案征求确认，再写代码**。

## 1. 架构铁律（违反即返工）

1. **依赖方向单向**：包依赖必须形成最终收敛到 shared 的有向无环图；`providers → acp → shared`，其他功能包只依赖更低层端口。`apps/web` 只能依赖 `@dougoos/shared` 的协议类型；任何包不得反向依赖 `core`；`core` 是唯一组合根。
2. **进程边界**：SQLite 访问、ACP 子进程管理只存在于 core 进程。渲染层零 Node 权限（`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`），与 core 只通过 HTTP/fetch-SSE 通信。Electron main/preload 里禁止出现业务逻辑。
3. **唯一写者**：只有 core 进程写 `~/.dougoos/data.db`。任何"渲染层直接读库""脚本旁路写库"的实现一律拒绝。
4. **事件即接口**：模块间运行时通信只走两种方式——TS interface 直接调用，或 Core journal 发布的 `AgentEventEnvelope`。acp → core 的直接接口使用 `AgentRuntimeEvent`，由 Core 持久化并分配 eventId/seq 后升级为 envelope；禁止裸 `AgentUiEvent` 跨包传播、下层包自行生成全局 seq、全局单例状态和环形回调。
5. **每个包必须可单独调试**：新增包必须附带 headless 入口（REPL / doctor / dry-run 脚本之一），并在包 README 写明一条可复制运行的调试命令。做不到的设计不予合并。

## 2. 类型与数据规范

1. **类型单一真源**：HTTP/SSE/DB/云协议类型只定义在 `@dougoos/shared`；运行时端口定义在拥有该抽象的最低层包（如 AgentProvider、SessionInterceptor 属于 acp），其他包 import，禁止复制粘贴。所有对外 DTO / 协议消息必须有对应 zod schema，运行时边界（HTTP 入口、ACP 事件入口、云上报出口）必须过 zod 校验。
2. **DTO 变更流程**：改 shared 类型 → 同步改 zod schema → `pnpm -r typecheck` 全绿 → 检查 fetch-SSE 事件消费方（web + session-collector + event journal）是否需要适配。
3. **数据库迁移铁律**（照 code-insights 经验）：
   - 新列必须可空或有默认值（向后兼容）；
   - 迁移只增不改：不修改历史迁移文件，只追加新版本；
   - 模块自带迁移以独立 `migrations` export 交给 core 组合根，迁移 ID 使用 `<module-id>:<sequence>` 并进入 storage 全局 manifest；禁止模块私自建库/建连接；
   - 时间戳一律 ISO 8601 字符串；数组/嵌套对象存 JSON 字符串列。
4. **mock/真实数据源**：任何"当前用 mock、将来切真库"的功能必须走类型化 DataSource 接口模式——mock 实现与真实现共用同一 zod schema 校验的行结构，切换只能通过 settings 配置，禁止代码内 if/else 分叉和 `unknown` DataSource。
5. **Turn、幂等与单活跃约束**：所有 prompt/task 写入口必须接收 clientRequestId，并以数据库唯一约束保证重试不重复创建。`turns` 必须用 partial unique index 原子保证同一 Session 仅存在一个 `queued/starting/running/awaiting_approval/cancelling` Turn，禁止只靠内存检查或事务外“先查后插”。消息、审批、usage 必须能追溯到 turnId；启动时全部非终态 Turn 一律在恢复事务中转 interrupted，除非用户随后显式走 ACP load/resume。
6. **全局事件基线**：`lastAppliedSeq` 属于全局事件流，只能由 `AgentEventEnvelope` 或 `GlobalSnapshot.snapshotSeq` 推进。单 Session 的 `sessionSnapshotSeq` 只用于局部缓冲事件重放，不得推进全局 seq；REPLAY_GAP 后必须获取包含全部 session summaries、已打开/活跃会话、activeTurns 和 pendingApprovals 的全局一致快照。

## 3. 新增功能决策树

```
这是什么功能？
├─ 接入一个新 Agent CLI            → Checklist A
├─ Harness 新子模块                → Checklist B
├─ 新 API / 新表 / 新实体           → Checklist C
├─ 新的会话数据来源 / 统计指标      → Checklist D
├─ 新的云端上报事件                → Checklist E
└─ 以上都不是                      → 停下，写 ADR，确认扩展点设计后再动手
```

### Checklist A：新增 Agent Provider

1. 在 `packages/providers/src/` 新建 `<agent-id>.ts`，实现由 `@dougoos/acp` 定义的 `AgentProvider` 接口（id、displayName、processPolicy、available、resolveCommand、chooseAuthMethod）；依赖方向必须是 `providers → acp → shared`。
2. 认证策略**必须**依 `initialize.authMethods` 动态选择，禁止硬编码认证方式（grok-html-demo 的踩坑教训）。
3. 可执行文件发现按三级兜底：npm 包 bin 解析 → PATH 查找 → 约定家目录路径；全部失败时 `available()` 返回带修复建议的 reason。启动只能使用 spawn/execFile 参数数组，禁止 shell 字符串拼接。
4. Provider 静态 processPolicy 与 initialize 返回的动态 ACP capabilities 分开保存；所有未声明 capability 视为不支持。协议解析使用官方 `@agentclientprotocol/sdk` 稳定 v1，Provider 不得自带另一套 JSON-RPC/schema。
5. 该 Agent 有私有 `_meta` 命名空间的，实现 `normalizeMeta()` 归一化到 `AgentUiEvent`；原始 `_meta` 不穿过 UI DTO。工具输出截断上限 30,000 字符，diff 超限改存 artifact。
6. 在 `providers/index.ts` 注册。
7. 验证：`doctor.ts` 探测通过 + `acp repl -- --provider <id>` 跑通一轮含审批与取消的对话，并保存 capability snapshot fixture。
8. **禁止**：为单个 provider 修改 `@dougoos/acp` 核心协议层——协议差异只能在 provider 层消化；确实是协议层缺口的，单独提 ADR。

### Checklist B：新增 Harness 子模块

1. 新建包 `packages/harness/<module-id>/`，实现 `HarnessModule` 接口。
2. API 一律挂 `/api/harness/<module-id>/*`（`createApiRouter`），禁止占用其他命名空间。
3. 自带表通过包级独立 `migrations` export 进入 core 收集的全局 manifest；`HarnessModule` 本身不持有数据库连接或 storage 类型。
4. 需要 mock 起步的，实现 `createDataSource(mode)` 双实现（见 §2.4）。
5. 前端页面放 `apps/web/src/features/harness/<module-id>/`，路由 `/harness/<module-id>`；侧栏项自动来自 `GET /api/harness/modules`，不要手写侧栏配置。
6. 将 kernel 注册表中对应的 `placeholder("<id>")` 替换为真实模块，status 改 `active`。
7. 只读/统计能力订阅 Registry 事件总线；需要在 prompt 或 permission 前阻断的模块（如 Hooks）必须实现 `@dougoos/acp` 的 `SessionInterceptor`，由 core 组合根注入。禁止把观察型订阅伪装成 PreToolUse 安全拦截，也禁止模块直接持有 Registry/CoreDeps。
8. 验证：模块 API 用 curl 独立可测；UI 在 mock 与 local 两种 dataMode 下渲染一致。

### Checklist C：新增 API / 表 / 实体

1. 实体类型 + zod schema 进 `shared`。
2. 迁移文件进 `storage/migrations/`（遵守 §2.3 铁律）。
3. API 路由进 core 对应 router，需要鉴权（默认全部需要 bearer token）。
4. SSE 新事件类型：扩展 `AgentUiEvent` 联合类型，但跨边界必须包装为 `AgentEventEnvelope`；检查 web、collector、journal 的 exhaustive switch、序列化大小和 replay 行为。
5. 长任务 API 必须先写清同步/异步响应、clientRequestId 幂等、409 冲突和取消语义；prompt 默认返回 202 {turnId}，不得用一个 HTTP 请求一直等待完整 Turn。
6. 新增或修改全局事件流时，必须同步验证 GlobalSnapshot DTO、REPLAY_GAP 完整替换、单 Session 快照不推进全局 seq。
7. 验证：vitest 对临时 db 跑迁移 + CRUD；curl 实测端点；同 clientRequestId 重试只产生一条业务记录；同 Session 两个并发新请求最多一个成功，另一个返回 `409 SESSION_BUSY`。

### Checklist D：新增会话来源 / 统计指标

1. 新会话来源：实现 `SessionProvider{providerName, discover, parse}`，注册进 collector registry；每条记录提供 sourceRecordId，增量状态走 `sync_state(file_id,size,mtime,offset,generation)`；必须覆盖文件截断、轮转和原地重写。解析时注意"user 条目 ≠ 真人输入"，复用消息分类器。
2. 新统计指标：聚合逻辑写成**纯函数**放 `aggregation.ts`（输入行数组、输出聚合结果，不碰 SQL、不碰 UI），SQL 只负责取行，UI 只吃聚合结果。
3. 估算值必须带质量标记（exact/estimated/mixed/unavailable），禁止把估算冒充精确值展示。
4. 验证：聚合纯函数表驱动单测；`collect.ts --dry-run` 核对解析输出。

### Checklist E：未来新增云端上报事件（当前 MVP 禁止）

当前 MVP 的 Worker 仅允许 `GET/HEAD /v1/health`，没有 ingest、outbox 调度器、D1/KV/Queue
或任何业务 payload。以下清单只在 P3+ 经独立 ADR、隐私评审和用户授权后适用：

1. 事件 schema 进 shared 云协议（zod discriminated union + `.strict()`），只允许审查过的 metrics 字段；协议版本号变更规则：加可选字段不升版，改语义必升版。
2. 入队必须与业务写**同一 SQLite 事务**；只能走 outbox，禁止任何直接 fetch 上报。
3. **allowlist + redaction 审查（强制）**：先由白名单 schema 构造 payload，再逐字段过红线清单（§5）；redaction 仅作第二道兜底。PR 描述中贴出 dry-run 的实际上报样本。
4. 尊重 `localOnly` 与 syncMode 配置：metrics 档禁止携带任何文本内容类字段。

## 4. 编码与测试规范

- **语言/工具链**：TypeScript strict；ESM only；Node ≥ 22；pnpm workspace + turborepo；Electron 锁定官方仍受支持稳定线的精确 patch，不写“旧版本以上”的宽泛范围。
- **命名**：包名 `@dougoos/<kebab>`；事件类型 snake_case（与 ACP 一致）；DB 表和列 snake_case；TS 标识符 camelCase。
- **错误处理**：core API 返回结构化错误 `{ code, message, details? }`，HTTP 状态码语义化（400/404/409/503），禁止一律 500；ACP 层错误转 `session_error` 事件，禁止吞错。
- **注释**：只写"代码本身表达不了的约束"；禁止叙述性注释（"下一行做了什么"）。
- **测试底线**（合并门槛）：
  - 纯函数（路由规则、聚合、归一化、redaction）：表驱动单测，必须有；
  - 协议边界（ACP client、云协议）：基于 fixture 的集成测试；
  - 事件状态机：必须覆盖乱序/重复事件、全局 snapshot + replay gap、单 Session 快照不推进全局 seq、cancel 后迟到更新；
  - Turn 恢复：queued/starting/running/awaiting_approval/cancelling 五种非终态必须覆盖 Core 重启 interrupted 恢复；
  - UI：7 种消息类型可用 Storybook/固定 fixture 人工核验，但事件 reducer、Turn/审批状态机必须有单测；
  - 桌面烟测：至少覆盖 Core ready/restart 握手、token 轮换、better-sqlite3 加载和 fake Agent 进程树关闭；
  - 修 bug 必须先写复现测试。
- **依赖引入**：新增运行时依赖需在 PR 中说明"为什么不能用已有依赖实现"；参考仓（pi、code-insights）是设计蓝本，**禁止直接 npm 依赖它们**。

## 5. 数据与隐私红线（不可协商）

device_id 是可重置的伪匿名标识，不得在产品或代码注释中宣称“完全匿名”。以下字段/内容**永远不允许**出现在云端上报 payload 中：

- prompt / 消息文本、系统提示词原文、工具输入输出
- 文件路径、cwd、目录名、仓库名、git remote
- API key、token、环境变量值（redaction 正则：私钥块、`sk-`/`gh?_`/`AIza`、Bearer、password/secret 键值）
- 用户名、home 路径（出现路径类字符串一律替换为 `~`）
- 任何可关联到账号的标识（本产品只有可重置的伪匿名 device_id）

当前版本不得启动 outbox 调度器或构造 metrics payload。未来若实现，
`localOnly=true` 时 outbox 调度器不得启动，metrics payload 必须由严格白名单 schema
从头构造，禁止把业务对象 spread 后再依赖 redaction 清洗。Agent 权限必须使用
Provider 声明的原生权限档；可控 Provider 的新 Session 默认最高权限，自动允许的作用域、
审计、失效处理与外部管理例外遵循 ADR-0004。

## 6. 明确禁止清单

- 运行时动态插件加载（Harness 扩展 = 编译期注册）
- 微服务 / 外部消息队列（outbox 表即队列）
- 账号体系 / 登录（除非产品决策变更 + ADR）
- 任务 Agent ACP 化（编排 Agent 一律 in-process）
- WebSocket（出现真双向流需求前，一律 REST + fetch-SSE）
- 浏览器原生 EventSource（无法携带 bearer header；统一使用 fetch-based SSE + afterSeq）
- 渲染层出现 `require`/Node API / 直连 SQLite
- 绕过 TaskRouter 直接创建"路由过的任务"
- 轮询判静默类的时序 hack（turn 结束以协议信号为准）
- 把 Registry 事件订阅当成可阻断的 PreToolUse Hook
- 在 UI URL、localStorage、日志或错误上报中保存 Core bearer token

## 7. Definition of Done（每个 PR 的验收）

- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` 全绿
- [ ] 对应 Checklist 的每一条已执行（PR 描述中列出）
- [ ] 有 headless 验证记录（repl / curl / dry-run 输出贴在 PR）
- [ ] 涉及上报的：贴 redaction 后的样本
- [ ] 涉及 shared 类型变更的：列出受影响消费方及适配情况
- [ ] 涉及 Turn/事件的：验证 clientRequestId 幂等、单 Session 活跃 Turn 原子唯一、global snapshot/event seq/replay、五种非终态的 cancel/interrupt 状态
- [ ] 涉及 Electron/Core 的：验证 ready/restart、token 轮换和完整子进程树回收
- [ ] 新增包的：README 含一条可复制的单独调试命令
- [ ] 跨 ≥3 包或新依赖方向的：附 ADR 链接

## 8. 文档维护规则

- **ADR**：关键决策（新扩展点、协议升版、安全边界、外部依赖）写入 `docs/adr/NNNN-<slug>.md`，格式：背景 / 决策 / 备选与取舍 / 影响。已合并的 ADR 是既定事实，推翻需新 ADR 引用旧编号。
- **本文档**：新增 Checklist、修改铁律需与架构负责人确认；每次修改在文末变更记录追加一行。
- **ARCHITECTURE.md**：实现与文档不一致时，以"先改文档再改代码"为原则；禁止代码悄悄漂移。

---

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-27 | 权限策略改为 Provider 原生档位；可控 Provider 的新 Session 默认最高权限，按 ADR-0004 限定作用域与审计 |
| 2026-07-23 | 四处收口：partial unique index 保证单 Session 单活跃 Turn；五种非终态统一 interrupted；REPLAY_GAP 改用全局一致快照；移除 P2 的旧 AcpSessionRecorder |
| 2026-07-23 | 一致性修订：P6 Hooks 描述与 ADR-0003 对齐（阻断走 SessionInterceptor，事件总线仅观察；安全边界 ADR 已存在，不再重复要求先出 ADR） |
| 2026-07-23 | 架构加固：Turn/Event envelope、fetch-SSE replay、ACP 官方 SDK v1、SessionInterceptor、Core 重启握手、严格 metrics allowlist |
| 2026-07-23 | 初版：迭代路线 P4–P7 + AI 开发规范（铁律/决策树/五个 Checklist/红线/DoD） |
