# DougoOS P0 + P1 Agents 聊天 MVP 交付计划

- 状态：P0/P1 产品实现历史 checkpoint 已验证；当前 RC 离线门禁全绿，Git release baseline 等待独立 release review
- 日期：2026-07-24
- Goal 完成边界：`P0 骨架 + P1 ACP 聊天 + prototypes/agentos UI 一比一复刻`
- 当前事实：P0/P1 产品任务、版本化、clean-checkout CI、release manifest 和 RC 离线门禁均已完成；
  独立 release review 和 tag 由
  [`release-baseline-001`](docs/plan/tasks/release-baseline-001.md) 单独收口
- 当前 RC 证据：`pnpm check` 的 319 个包级测试、E2E 15/15、visual 9/9
  （156 个 prototype reference、155 个 production reference、16 个 production-only）和
  8 个 build-smoke ESM 入口均通过；没有 visual blocking finding
- 发布状态：`release-baseline-001` 仍为 `in-progress`，尚未执行独立 release review，也未创建
  `p0-p1-mvp` tag
- 本文件职责：保留 P0/P1 产品 Goal 的范围、任务依赖、实现顺序、验证门禁和最终完成标准；
  不把产品工作区验证等同于可回退的 Git release baseline

## 1. Goal 结果

交付一个可在本机运行的 DougoOS 桌面聊天 MVP：

1. Electron 启动本地 Core，Core ready 后展示 React 主界面。
2. 用户可以选择 Claude Code 或 Codex、选择工作目录、创建会话并连续聊天。
3. 聊天过程通过官方 ACP 稳定 v1 接入，实时展示 7 类消息，支持审批、拒绝和取消。
4. 会话、Turn、消息、审批和事件写入本地 SQLite；应用或 Core 重启后能恢复到一致状态。
5. Web 与 Core 通过带 bearer token 的 REST + fetch-SSE 通信，可在断线、replay gap 和 Core 重启后恢复。
6. Fake Agent 覆盖确定性自动化验证；至少一个本机可用且已认证的真实 Agent 完成端到端对话。
7. `prototypes/agentos` 中桌面 SaaS 与 Landing 的视觉、布局、主题、状态和原型交互在生产 React 实现中一比一复刻。

只有第 12 节的 Definition of Done 全部满足，本 Goal 才能标记完成。

## 2. 规范来源与优先级

开始实现前必须完整阅读：

1. `docs/adr/0001-turn-event-journal.md`
2. `docs/adr/0002-fetch-sse-auth-replay.md`
3. `docs/adr/0003-session-interceptor-hooks.md`
4. `docs/ARCHITECTURE.md`
5. `docs/AI_DEV_SPEC.md`
6. `CLAUDE.md`
7. `prototypes/agentos/README.md`
8. `prototypes/agentos/project/AgentOS SaaS.dc.html`
9. `prototypes/agentos/project/AgentOS Landing.dc.html`
10. `prototypes/agentos/project/support.js`

约束优先级：

1. Accepted ADR 决定协议、安全和状态不变量。
2. `docs/ARCHITECTURE.md` 决定模块边界和技术路线。
3. `docs/AI_DEV_SPEC.md` 决定编码、测试、隐私和 DoD。
4. `prototypes/agentos` 是 UI 的像素级真源，决定信息架构、可见文案、布局、视觉 token、状态和原型交互。
5. 本文件只负责交付编排，不得覆盖上述架构决策。

若实现需要推翻 Accepted ADR、改变依赖方向、增加新的跨包扩展点或改变安全边界，必须先更新设计并新增 ADR，不允许让代码悄悄漂移。

UI 原型与后端阶段范围冲突时，采用“视觉完整、能力分期”的处理：保持原型可见结构和演示交互，但只有 P0 + P1 聊天接真实数据；P2+、云同步和账号相关控件不得因此获得真实后端能力。

## 3. 范围

### 3.1 P0 必须交付

- pnpm workspace + Turborepo，TypeScript strict，ESM only，Node >= 22。
- `apps/desktop`、`apps/web`、`apps/cloud`。
- `packages/shared`、`packages/storage`、`packages/acp`、`packages/providers`、`packages/core`。
- shared DTO、zod schema、Turn/Event 状态与结构化错误。
- better-sqlite3 WAL、版本化迁移、Event Journal、物化读模型、崩溃恢复。
- Hono Core、健康检查、全局快照、单 Session 快照、REST + fetch-SSE replay。
- React 一比一复刻 `AgentOS SaaS.dc.html` 的完整桌面壳、所有可见页面、主题和原型交互。
- 一比一复刻 `AgentOS Landing.dc.html` 的完整落地页。
- P2+、云同步和账号相关页面使用与原型一致的 fixture/demo 状态，不接入超出本 Goal 的真实后端。
- Electron `utilityProcess` 启动 Core、ready/restart、token 轮换和安全配置。
- 可重置伪匿名 `device_id`。
- Cloudflare Worker 仅实现 `/v1/health`；不接入真实云端持久化。
- Fake Agent 与打包 smoke。

### 3.2 P1 必须交付

- 官方 `@agentclientprotocol/sdk` 稳定 v1 的精确锁定版本。
- ACP initialize/authenticate/session-new/prompt/cancel/update/request_permission 基线。
- 多 Session Registry、每 Session 单活跃 Turn、空 `SessionInterceptor` 链。
- Claude Code Provider、Codex Provider、Provider Registry 和 doctor。
- Headless ACP REPL。
- Agents 聊天 UI：
  - Agent 会话页必须保持 `AgentOS SaaS.dc.html` 的尺寸、层级、文案和视觉样式；
  - Provider 选择；
  - 工作目录选择；
  - 会话创建与切换；
  - user、text、note、think、tool、diff、approval 七类消息；
  - 流式输出；
  - 审批允许/拒绝；
  - Turn 取消；
  - interrupted/crashed/error/reconnecting 状态；
  - 多会话之间相互隔离。
- Fake Agent 全路径自动化验收。
- 真实 Agent 端到端烟测。

### 3.3 明确不做

- P2 Task Agent、TaskRouter、Session Collector、外部会话导入。
- P3 真实云端 ingest、D1、outbox 上报调度和数据同步。
- P4 及之后的 LLM 路由、更多 Provider、深度 Session Manager、Harness 激活。
- 真实账号、登录、团队、多设备同步、备份、计费后端；原型中对应 UI 只做一比一演示态。
- Generic ACP Provider 设置 UI。
- 运行时插件、微服务、消息队列、WebSocket。
- 自动允许全部工具、绕过 ACP permission 的伪安全承诺。
- macOS 签名/公证、Windows 签名、自动更新；本 Goal 只做当前开发机的未签名打包 smoke。
- 为未协商能力伪造 session load/resume/list/delete/close 等支持。

## 4. 不可破坏的架构不变量

1. `core` 是唯一组合根，也是 SQLite 的唯一写者。
2. Renderer 零 Node 权限；`apps/web` 不得 import core/acp/providers/storage，只通过 HTTP + fetch-SSE 使用 shared DTO。
3. Electron main/preload 只负责窗口、目录选择和 Core 生命周期，不包含业务逻辑。
4. `AgentProvider` 端口属于 `packages/acp`；`packages/providers` 只实现端口；`acp` 不得反向依赖具体 Provider。
5. ACP 使用官方稳定 v1 SDK；不得自研平行 JSON-RPC/schema，不得使用 experimental v2 主链路。
6. Agent 原始事件先形成 `AgentRuntimeEvent`，由 Core 调用 storage 在同一事务中 append + project，提交后才产生并发布 `AgentEventEnvelope`。
7. 全局 `seq` 只能由 Core/Journal 分配；Provider 和 acp 不得生成全局序号。
8. 所有外部 DTO 和运行时边界都使用 shared zod schema 验证。
9. Turn 创建以 `(session_id, client_request_id)` 幂等；单 Session 活跃 Turn 由 SQLite partial unique index 原子保证。
10. `queued/starting/running/awaiting_approval/cancelling` 五种非终态在 Core 启动恢复事务中统一转为 `interrupted`。
11. UI 的 `lastAppliedSeq` 只能由 envelope 或 `GlobalSnapshot.snapshotSeq` 推进；`sessionSnapshotSeq` 永远不能推进全局 cursor。
12. fetch-SSE 使用 Authorization header；token 不进入 URL、localStorage、日志和遥测。
13. 审批默认永远是询问。Interceptor 可以缩小权限或拒绝，不能静默扩大权限。
14. 子进程只使用 `spawn`/`execFile` 的参数数组和环境变量 allowlist，禁止拼接 shell 命令。
15. prompt、消息、cwd、文件路径、工具输入输出、密钥和账号标识不得进入任何云端 payload。
16. UI 必须以 `prototypes/agentos` 为视觉真源重建，禁止把 `.dc.html` 放进 iframe、直接注入生产 DOM 或把 `support.js` 作为生产运行时。
17. 一比一复刻不得改变依赖边界：原型中的 mock 数据必须通过显式 fixture/DataSource 提供，真实聊天只能走 shared DTO 与 Core API。
18. 不得以“设计系统优化”“组件库默认样式”“响应式重排”或“更现代”为理由主动改变原型的颜色、尺寸、间距、字体、圆角、阴影、层级、文案和动效。

## 5. MVP 用户体验合同

### 5.1 原型真源与一比一标准

`prototypes/agentos` 整个目录都是本 Goal 的 UI 真源：

| 原型文件 | 生产落点 | 复刻范围 |
|---|---|---|
| `project/AgentOS SaaS.dc.html` | `apps/web` + Electron renderer | 完整桌面壳、全部页面、状态、主题、动效和原型交互 |
| `project/AgentOS Landing.dc.html` | `apps/cloud` 的静态落地页 | Header、Hero、产品窗口、Agents、Features、Routing、Memory、Stats、CTA、Footer、登录弹层 |
| `project/support.js` | 仅用于理解 `.dc.html` 原型运行语义 | 不进入生产 bundle，不作为应用运行时 |

“一比一复刻”表示：

- 生产代码使用 React/TypeScript 重建，不嵌入或直接运行 `.dc.html`。
- 默认文案、信息密度、区域顺序、240px 侧栏、内容最大宽度和滚动边界与原型一致。
- `Instrument Sans`、`JetBrains Mono` 及中文 fallback 与原型一致；字体加载失败必须有确定 fallback，不得造成布局跳变。
- dark/light 两套主题、四个 accent、CSS 变量、颜色、渐变、边框、圆角、阴影、透明度和 scrollbar 一致。
- hover、focus、active、展开/收起、dropdown、notification overlay、login modal、theme toggle 和 prototype 中已有动画一致。
- 原型中出现的页面都必须可到达并完成视觉复刻；P2+ 页面使用固定 fixture 保持原型状态，不得删掉、改版或接入越界后端。
- 原型中账号、Cloud Sync、自动路由等越界控件只复刻展示与本地演示交互，不发网络请求、不持久化敏感状态、不宣称能力已上线。
- 对原型没有定义的 Core 启动、断线、错误和 capability warning 状态，采用相同 token 和组件语言扩展，不能破坏默认态的一比一截图。

### 5.2 SaaS 桌面壳

```text
┌──────── Sidebar 240px ───────┬──────────────── Main ──────────────────────┐
│ ◈ AgentOS                    │ 页面标题 / 副标题       通知 · 状态 · 操作 │
│   workspace / local          ├────────────────────────────────────────────┤
│                              │                                            │
│ ＋ 新建任务                   │ Agent 会话：                               │
│ ▦ 总览                       │  Agent 图标、名称、状态、模型/cwd/usage    │
│ ▤ 任务编排                   │  [会话] [历史]                    [配置]   │
│   ├ 定时任务                 │                                            │
│   └ 长程任务                 │  user / text / note / think / tool        │
│ ❐ Sessions Manager           │  diff / approval 按原型样式有序渲染       │
│   └ 7 个子页面               │                                            │
│ Harness                      │  ┌ 权限请求 ────────────────────────────┐ │
│   └ 8 个子模块               │  │ $ command       [批准执行] [拒绝]   │ │
│ Memory                       │  └──────────────────────────────────────┘ │
│                              │                                            │
│ PROJECTS / PINNED / 对话     │  [向 Agent 派发任务 · Enter 发送] [发送]  │
│ AGENTS / 6 个原型入口        │                                            │
│                              │                                            │
│ Usage · Profile              │                                            │
└──────────────────────────────┴────────────────────────────────────────────┘
```

必须复刻 `AgentOS SaaS.dc.html` 中所有可见页面和子视图：

- 新建任务、总览、Agent 会话及历史；
- 定时任务、长程任务；
- Sessions Manager 的 Dashboard、Sessions、Insights、Analytics、Patterns、Export、Cloud Sync；
- Harness 的 System Prompt、Skills、MCP、SubAgents、Goals、Workflows、Hooks、Rules；
- Memory、设置、项目、用量统计、结果对比；
- Sidebar 的 Projects、Pinned、会话树、Agents、折叠状态；
- 顶栏、通知浮层、主题、accent、配置项和原型演示状态。

其中只有 Claude Code/Codex 的 Agent 会话和 P0 基础状态接真实数据。其他页面继续使用显式 fixture/DataSource 复刻原型，不得假装已具备 P2+ 后端。

### 5.3 Landing

```text
┌──────────────────────────── max-width 1120px ──────────────────────────────┐
│ ◈ AgentOS       功能 · Agents · Memory · 文档       主题 · 登录 · 免费下载 │
├────────────────────────────────────────────────────────────────────────────┤
│                      v2.0 · 本地优先 · macOS / Linux                       │
│                         多个 Agent CLI，一个控制台                         │
│                    描述文案 · 双 CTA · install command                     │
│                                                                            │
│              ┌──────── 漂浮的 AgentOS 产品窗口演示 ────────┐              │
│              │ Sidebar · KPI · Agent cards · composer      │              │
│              └──────────────────────────────────────────────┘              │
│ Agents chips                                                               │
│ Features 6 cards                                                           │
│ Smart Routing 双栏                                                         │
│ Memory 双栏 · Stats 4 列                                                    │
│ 最终 CTA                                                                    │
│ Footer                                                                      │
└────────────────────────────────────────────────────────────────────────────┘

登录触发时：
┌──────────────────────────── viewport overlay ──────────────────────────────┐
│                   ┌──────────── 登录 modal ────────────┐                   │
│                   │ 邮箱 / 密码 / 登录                 │                   │
│                   │ GitHub / Google / 注册链接         │                   │
│                   └────────────────────────────────────┘                   │
└────────────────────────────────────────────────────────────────────────────┘
```

Landing 必须复刻 grid/radial 背景、产品窗口 drift、pulse、主题切换、登录弹层和所有 section。登录按钮只演示原型交互，不实现账号系统。

### 5.4 启动和故障界面

```text
┌──────────────────────────────────────────────────────────┐
│ DougoOS                                                  │
│                                                          │
│ 正在启动本地 Core…                                       │
│ 数据库迁移 → HTTP 监听 → Provider Registry               │
│                                                          │
│ [失败时显示结构化原因]                    [重试] [诊断]   │
└──────────────────────────────────────────────────────────┘
```

Core 未 ready 前不得展示可交互聊天界面。Core 重启时保留 UI 壳，禁用写操作，显示重连状态；拿到新连接后执行全局 snapshot + replay，再恢复输入。

### 5.5 交互

| 输入或操作 | 范围 | 行为 |
|---|---|---|
| `Enter` | Composer | 非输入法组合状态下发送 |
| `Shift+Enter` | Composer | 换行 |
| 发送 | 空闲会话 | 生成 `clientRequestId`，异步创建 Turn |
| 发送 | 已有非终态 Turn | 禁止重复发送并说明 Session busy |
| 停止 | running/awaiting_approval | 幂等请求取消，UI 进入 cancelling |
| 审批选项 | approval card | 只提交服务端返回的 optionId，提交后禁用重复点击 |
| 新建会话 | Sidebar | 选择 Provider 和 cwd 后创建 |
| 切换会话 | Sidebar | 局部快照期间缓冲该 Session 的 live 事件 |
| Core 重启 | 全局 | 中止旧 fetch，丢弃旧 token，获取新连接并全局恢复 |
| 主题/accent | SaaS 与 Landing | 与原型变量和选中态一致；仅保存非敏感展示偏好 |
| 原型导航 | P2+ 页面 | 切换到对应 fixture 页面，不发业务 API |
| 登录/Cloud Sync/自动路由 | 越界控件 | 只执行原型演示态，不建立真实账号、同步或路由能力 |

### 5.6 必须覆盖的状态

- Loading：Core 启动、会话快照加载、Provider 探测。
- Empty：无会话、无消息、Provider 不可用。
- Busy：running、awaiting_approval、cancelling。
- Error：结构化 API 错误、Agent crashed、ACP error、数据库迁移失败。
- Recovery：SSE reconnect、REPLAY_GAP、Core restart、Turn interrupted。
- Constrained：窄窗口下侧栏可折叠，聊天和审批操作仍可访问。
- Capability warning：Provider 不保证发起 permission request 时，明确显示客户端无法强制阻断其内部工具。

### 5.7 视觉回归验收

实现阶段必须建立可重复的 Playwright 视觉回归：

1. 在同一 Chromium、同一 OS、同一字体和同一 viewport 下分别渲染原型与生产实现。
2. 冻结时钟、随机数据、光标、滚动位置和动画采样时刻；只允许 mask 真正不可稳定的系统像素。
3. SaaS 至少覆盖 `1440×900`、`1280×800`；Landing 至少覆盖 `1440×1000`、`1024×768`。
4. 默认 dark + green 覆盖全部页面；light 主题、其余三个 accent 覆盖桌面壳、Agent 会话和 Landing 关键页。
5. 关键区域 bounding box 偏差不得超过 1px；颜色通道偏差不得超过 1；不得存在肉眼可见的结构、文案或状态差异。
6. 全页 screenshot diff 仅容许字体抗锯齿等渲染噪声：差异像素比例不高于 0.5%，SSIM 不低于 0.995。阈值不是主动改版许可。
7. 每个视觉 case 保存 reference、actual、diff 和 viewport 元数据；视觉测试进入 `pnpm test:visual`。

一比一验收关注视觉输出和原型交互，不要求复制 `.dc.html` 的内部标签结构。P2+ 页面可以是 fixture，但其默认画面和交互状态必须与原型一致。

## 6. 目标目录

```text
.
├─ apps/
│  ├─ desktop/
│  ├─ web/
│  └─ cloud/
├─ packages/
│  ├─ shared/
│  ├─ storage/
│  ├─ acp/
│  ├─ providers/
│  └─ core/
├─ tests/
│  ├─ fixtures/
│  ├─ integration/
│  ├─ e2e/
│  └─ visual/
├─ docs/
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
└─ turbo.json
```

不得为了“目录看起来完整”创建 P2+ 后端空包。未来能力只保留现有文档和一比一复刻所需的 fixture/demo UI，不实现对应业务服务。

## 7. 执行与验证门禁

### 7.1 状态流

每项任务只允许使用以下状态：

```text
planned → in_development → awaiting_verification
        → fix_required → in_development
        → verified
        → blocked
```

- 实现完成不等于任务完成。
- 只有验证通过后才能把任务标记为 `verified`。
- 发现问题后先记录可复现证据，再回到实现阶段修复并重新验证。
- blocking 问题未关闭时，不得开始依赖它的下游任务。
- 执行过程中直接更新第 9 节状态表，保证 `plan.md` 是进度真源。

### 7.2 Develop → Verify

每个任务必须经过两个明确分离的阶段：

1. Develop：实现、补测试、执行目标包检查，提交待验证说明。
2. Verify：独立检查 diff/当前文件、复跑测试、核对架构不变量和任务验收条件。

若执行环境允许且权限策略允许，可把 Develop 与 Verify 交给不同 Agent；否则也必须串行执行两个独立 pass，不能用“代码已写完”代替审查。

仓库现已初始化 Git。后续任务使用 `docs/plan/` 的 develop/verify/review 流程；路径有重叠时
仍须串行，未经用户明确要求不 push、不发 PR。P0/P1 产品任务的 `verified` 只说明本节
验证合同已经满足，不代表 release commit、tag 或 clean-checkout review 已完成。

### 7.3 依赖和版本

- 只从官方来源确认 Electron、ACP SDK 等当前支持版本，并在 lockfile 锁定精确版本。
- 新运行时依赖必须记录用途和不能复用现有依赖的原因。
- 参考仓只用于理解协议或模式，禁止把参考仓作为 npm/git 依赖，也禁止整段照搬未知许可代码。
- 不得硬编码用户机器上的绝对路径、凭据或 Provider token。

## 8. 集成清单

下列每条“创建/调用/注入/消费”关系都必须由对应任务实现并验证：

| 集成关系 | 合同 | 负责任务 |
|---|---|---|
| Electron main → Core | utilityProcess、parentPort ready/restart、完整进程树回收 | `desktop-001` |
| preload → Web | `getCoreConnection`、`onCoreRestart`、目录选择；无业务 API | `desktop-001` |
| Web → Core | bearer REST + 单条 fetch-SSE | `web-001`, `stream-001` |
| Core → shared | 请求/响应/事件 schema 校验 | `shared-001`, `core-001` |
| Core → storage | Turn 事务、appendAndProject、snapshot、恢复 | `storage-001`, `core-001` |
| Core → ACP Registry | 创建会话、启动/取消 Turn、解决审批、订阅事件 | `acp-001`, `chat-integration-001` |
| Core → SessionInterceptor | 编译期注入空链；审批先过 interceptor | `acp-001`, `chat-integration-001` |
| Registry → Provider | 按 Provider policy 解析命令并 spawn ACP 子进程 | `providers-001` |
| ACP → Core → Journal → SSE → UI | runtime event 升级为 envelope 后有序发布和渲染 | `chat-integration-001` |
| Provider doctor → UI/API | 可用性、版本、原因、真实 capability snapshot | `providers-001`, `chat-ui-001` |
| Web reducer → snapshots | global/局部 cursor 语义、去重、gap 恢复 | `stream-001`, `web-001` |
| prototypes/agentos → UI contract | 源文件盘点、token/布局/状态提取、reference 截图 | `ui-reference-001` |
| UI contract → SaaS React | 全部页面使用 fixture 一比一重建，不运行 support.js | `saas-ui-001` |
| Core DTO → Agent 会话页 | 在不改变原型视觉的前提下把 fixture 替换为真实聊天数据 | `web-001`, `chat-ui-001` |
| UI contract → Landing | 完整页面和登录演示弹层一比一重建 | `landing-ui-001` |
| Cloud health + Landing → smoke | 静态页可访问；无账号、无业务数据、无真实 ingest | `cloud-001`, `landing-ui-001` |

任何一条关系只有两端都完成并通过集成测试后，才算交付；只创建接口或只完成一端不算完成。

## 9. 任务图与状态

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| `repo-001` | Monorepo 与质量基线 | — | verified |
| `ui-reference-001` | 原型 UI 合同与视觉基线 | `repo-001` | verified |
| `saas-ui-001` | SaaS 全页面一比一 React 复刻 | `ui-reference-001` | verified |
| `landing-ui-001` | Landing 一比一 React 复刻 | `ui-reference-001` | verified |
| `shared-001` | 协议、DTO、schema 单一真源 | `repo-001` | verified |
| `storage-001` | SQLite、Journal、Projector、恢复 | `shared-001` | verified |
| `core-001` | Core 组合根与 REST 基线 | `shared-001`, `storage-001` | verified |
| `stream-001` | 全局 snapshot + fetch-SSE replay | `core-001` | verified |
| `web-001` | 真实数据接入、API client、事件 reducer | `shared-001`, `stream-001`, `saas-ui-001` | verified |
| `desktop-001` | Electron 薄壳与 Core 生命周期 | `core-001` | verified |
| `fake-e2e-001` | P0 Fake Agent 端到端闭环 | `web-001`, `desktop-001` | verified |
| `acp-001` | 官方 ACP SDK 包装与 REPL | `shared-001` | verified |
| `providers-001` | Claude Code/Codex Provider 与 doctor | `acp-001` | verified |
| `chat-integration-001` | Core、Registry、Journal、审批/取消集成 | `storage-001`, `core-001`, `acp-001`, `providers-001` | verified |
| `chat-ui-001` | 原型 Agent 会话页的真实聊天闭环 | `web-001`, `chat-integration-001`, `saas-ui-001` | verified |
| `real-e2e-001` | 真实 Agent 与恢复场景验收 | `desktop-001`, `chat-ui-001` | verified |
| `cloud-001` | Landing 托管、Cloud health 桩与 device_id 边界 | `repo-001`, `shared-001`, `landing-ui-001` | verified |
| `release-001` | P0/P1 工作区全量验证、打包 smoke、文档收口 | 以上全部 | verified |

本表记录的是 P0/P1 产品实现。Git/CI/manifest/review/tag 发布基线不在本表中，其状态以
[`docs/plan/tasks/release-baseline-001.md`](docs/plan/tasks/release-baseline-001.md)
为准。

## 10. 任务说明

### `repo-001` — Monorepo 与质量基线

范围：

- 建立 workspace、Turborepo、统一 tsconfig、lint/format/test/build/typecheck 脚本。
- 建立目标目录和每个包的最小 README。
- 锁定 Node/pnpm 策略、ESM 和 strict。
- 配置 `.gitignore`，至少排除 `.dev-token`、数据库、日志、构建产物和真实 Provider 诊断输出。
- 建立 Vitest、Playwright、桌面/E2E 和视觉回归测试入口。

验证：

- workspace 图没有循环依赖。
- `pnpm -r typecheck && pnpm -r test && pnpm -r build` 可执行并通过。
- 每个新增包 README 有一条可复制的单独调试命令。

### `ui-reference-001` — 原型 UI 合同与视觉基线

范围：

- 完整阅读 `prototypes/agentos/README.md`、两份 `.dc.html` 和其引用的 `support.js`。
- 盘点所有页面、子视图、overlay、交互状态、dark/light、四个 accent、动画和固定 fixture。
- 从源码提取 token、字体、尺寸、间距、边框、圆角、阴影、渐变、z-index、滚动与最大宽度合同。
- 建立第 5.7 节的 Playwright case 清单、稳定 viewport、字体等待、时钟/随机数冻结和截图目录。
- 对原型源文件生成 reference screenshot 与关键区域 computed-style/bounding-box 基线；不得修改原型。
- 标注每个控件的数据模式：`real-p0-p1`、`fixture-p2-plus` 或 `demo-only`。

验证：

- 原型的每个可达页面和状态在 case 清单中至少出现一次。
- reference 可重复生成；连续两次生成无非预期差异。
- UI 合同明确覆盖 Landing、SaaS 全壳、Agent 七类消息、通知/login overlay 和主题变体。
- `support.js` 不被加入任何生产依赖或 bundle。

### `saas-ui-001` — SaaS 全页面一比一 React 复刻

范围：

- 在 `apps/web` 使用 React/TypeScript 重建 `AgentOS SaaS.dc.html`，不得嵌入原型 DOM。
- 复刻第 5.2 节列出的全部页面、子视图、sidebar tree、topbar、overlay、主题、accent 和动效。
- 使用显式 fixture/DataSource 复刻原型默认数据、状态变化和 P2+ 演示交互。
- 把 token 和低层视觉 primitive 收口，保证共享不会改变页面的 computed style。
- 保持原型桌面优先布局；仅为小于参考尺寸的窗口增加不破坏桌面截图的 overflow/可达性处理。
- 为 Core loading/error/reconnecting 等新增状态复用同一视觉语言，但默认态不得偏离原型。

验证：

- 默认 dark + green 的所有页面通过第 5.7 节 screenshot diff 与关键区域几何断言。
- light 及 cyan/orange/purple accent 的关键页通过视觉回归。
- hover/focus/active、折叠、菜单、通知、tab 和设置切换与原型一致。
- 所有 P2+ 页面可到达，但没有对应真实业务 API 请求。
- 没有 iframe、原型 HTML 注入、生产 `support.js` 或组件库默认样式泄漏。

### `landing-ui-001` — Landing 一比一 React 复刻

范围：

- 在 `apps/cloud` 的静态前端重建 `AgentOS Landing.dc.html` 的全部 section 与登录 overlay。
- 复刻 1120px 容器、32px 横向 padding、背景 grid/radial、产品窗口、cards、双栏、stats、CTA 和 footer。
- 复刻 theme toggle、drift/pulse、hover、登录弹层开关与原型登录成功演示态。
- 登录、下载、在线体验、GitHub 等按钮在没有已批准真实目标时只做安全演示或显式无副作用处理；不得建立账号系统。
- Worker 负责静态资源和 health，不得因此增加真实 ingest。

验证：

- dark/light、关键 viewport、login closed/open/logged-in 演示态通过视觉回归。
- 页面 section 顺序、文案、字体、尺寸、动效和滚动位置与原型一致。
- 登录演示不发认证请求、不保存账号凭据。

### `shared-001` — 协议、DTO、schema 单一真源

范围：

- 定义并导出 Session、Turn、Message、Approval、Provider、capability、结构化错误。
- 定义 `AgentRuntimeEvent`、`AgentEventEnvelope v1`、`AgentUiEvent`。
- 定义 REST DTO、`GlobalSnapshot`、`SessionSnapshot`、REPLAY_GAP。
- 所有对外类型有对应 zod schema 和大小限制。
- Provider 私有 `_meta` 和原始 ACP envelope 不进入 UI DTO。

验证：

- schema 正反例测试覆盖未知版本、超大 tool output/diff、非法 approval option 和错误 DTO。
- 消费方只能 import shared，不允许复制协议类型。

### `storage-001` — SQLite、Journal、Projector、恢复

范围：

- better-sqlite3 WAL、busy timeout、synchronous、checkpoint 和只增不改的迁移器。
- 实现 P0/P1 所需表；P2/P3 表可后置，不为未来范围空实现业务。
- 实现 `(session_id, client_request_id)` 唯一约束和单 Session 活跃 Turn partial unique index。
- 实现 `appendAndProject`，在同一事务中写 journal 并投影 messages/turns/approvals/usage。
- 实现 global/session snapshot read transaction、journal replay、保留边界和启动恢复。
- 建立伪匿名 device_id 的创建与重置存储接口。

验证：

- 相同 `clientRequestId` 返回同一 turnId。
- 同 Session 两个并发创建最多一个成功，另一个稳定映射为 `409 SESSION_BUSY`。
- 相同 eventId 重复投递不改变最终读模型。
- 五种非终态分别在重启恢复为 interrupted，且活跃槽位释放。
- 任意 snapshot 的 seq 与事务内读模型一致。
- 临时数据库集成测试和 `db-inspect` 均通过。

### `core-001` — Core 组合根与 REST 基线

范围：

- 建立 Hono headless Core；只绑定 `127.0.0.1`。
- 实现 live/ready、Provider 列表、会话、Turn、cancel、approval、session snapshot、global snapshot API。
- 实现 bearer、Origin、Host、body/prompt 大小校验和结构化错误。
- 组合 storage、Registry 端口、event hub；Core 是唯一全局 seq 分配和 fan-out 发起者。
- HTTP 创建 Turn 只返回 `202 {turnId}`，不等待 ACP 完成。

验证：

- curl/headless 集成测试覆盖 400/401/404/409/503 和成功路径。
- 重试、SESSION_BUSY、未知 approval、重复 cancel 均符合合同。
- Core 未完成迁移或 registry 初始化时 ready 必须失败。

### `stream-001` — 全局 snapshot + fetch-SSE replay

范围：

- 实现单条全局 fetch-SSE 流、15 秒 heartbeat、Authorization header 和 `afterSeq`。
- 保证 replay `(afterSeq, currentSeq]` 到 live fan-out 无窗口、按 seq 升序。
- journal gap 返回结构化 `409 REPLAY_GAP`。
- 全局快照包含全部 session summaries、请求打开的会话、Core 自动补入的活跃会话、activeTurns 和 pendingApprovals。

验证：

- 任意事件点断线后最终状态等价于不中断。
- 重复 frame、乱序/旧事件、replay/live 交界并发写入不造成重复或丢失。
- REPLAY_GAP 后完整替换全局基线再继续 live。
- 单 Session 快照测试明确证明不会推进全局 seq。

### `web-001` — 真实数据接入、API client、事件 reducer

范围：

- 保留 `saas-ui-001` 的一比一 DOM/CSS 输出，把 P0/P1 区域从 fixture DataSource 切换到真实 API DataSource。
- API client 管理 connection、token、instanceId、AbortController、retry 和结构化错误。
- 全局 reducer 按 eventId 去重、按 seq 应用；会话局部加载使用缓冲 + `sessionSnapshotSeq`。
- 实现 Core loading/error/reconnecting/restart UI。
- 用 fixtures 建立七类消息组件的可视化测试入口。

验证：

- reducer 单测覆盖 duplicate、old seq、gap、局部快照、cancel 后迟到更新。
- token 不出现在 URL、localStorage、日志或错误 UI。
- 窄窗口、键盘操作、空/忙/错误/恢复状态可访问。
- 接入真实 DataSource 前后的原型默认态视觉 diff 不得退化。

### `desktop-001` — Electron 薄壳与 Core 生命周期

范围：

- 注册安全标准 `app://dougoos` scheme。
- `utilityProcess.fork` 启动 Core；每次启动生成 256-bit token，等待 `{instanceId, port}` ready。
- Core 崩溃后指数退避重启并轮换 instanceId/port/token。
- preload 只暴露 Core connection/restart、目录选择和窗口控制。
- 强制 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、严格 CSP、导航/弹窗/权限限制。
- 正确处理 cwd、asar unpack、better-sqlite3 ABI 和完整 Agent 进程树回收。
- dev `.dev-token` 仅在显式浏览器调试模式写入，0600 且每次轮换。

验证：

- ready 前只有启动/诊断界面。
- kill Core 后新连接三元组全部变化，旧 token 失效，UI 可恢复。
- 退出应用后 Core 和 Fake Agent 子进程树全部结束。
- renderer 中不存在 Node/SQLite/ACP 直接访问。

### `fake-e2e-001` — P0 Fake Agent 端到端闭环

范围：

- 提供协议行为可控的 Fake Agent/Provider fixture。
- 贯通 Desktop → Core → Journal → fetch-SSE → Web。
- 可脚本化产生七类消息、审批、取消、延迟事件、崩溃和 replay gap。

验证：

- 自动 E2E 覆盖创建会话、发送、流式文本、工具、diff、审批、拒绝、取消、完成。
- 打包后应用可启动、Core ready、better-sqlite3 加载并创建/关闭 Fake 会话。
- Fake 只能作为测试 Provider，不得被包装成真实 P1 完成证据。

### `acp-001` — 官方 ACP SDK 包装与 REPL

范围：

- 使用官方稳定 v1 SDK 的稳定入口，精确锁版。
- 实现 initialize/authenticate/session-new/prompt/cancel/update/request_permission。
- 实现 `AgentSessionRegistry`、`AgentSessionHandle`、`AgentTurnHandle` 和每 Session TurnState。
- 实现稳定有界的事件归一化与不超过 50ms 的文本 delta 合并。
- 实现空 interceptor chain 及 beforePrompt/onPermissionRequest/afterEvent 的超时和错误语义。
- 实现 requestId 绑定、optionId 白名单、一次性解决和会话关闭清理。
- 实现 headless REPL。

验证：

- 官方 fixture/本地 fake stdio 集成测试覆盖握手、认证选择、prompt stopReason、取消、审批、进程退出。
- beforePrompt reject 时子进程未收到 prompt。
- permission interceptor 超时/异常 fail closed。
- afterEvent 失败不阻塞 journal 主链。
- 不使用轮询判静默，不把 stdout 日志混入 ACP。

### `providers-001` — Claude Code/Codex Provider 与 doctor

范围：

- 实现 Claude Code 和 Codex 的 `AgentProvider`。
- `available()` 报告可用性、版本和可执行诊断原因。
- `resolveCommand()` 使用参数数组与环境变量 allowlist。
- 认证方法仅从 initialize 返回的 authMethods 与本机安全环境中选择。
- 静态 processPolicy 与动态 capability snapshot 分开保存。
- 仅在确有需要时实现有 fixture 的 `_meta` 归一化。
- doctor 可单独探测两个 Provider，不输出 token 或环境变量值。

验证：

- 不可用、未认证、版本不兼容、协议握手失败均有不同的用户可读诊断。
- 未声明 capability 一律视为不支持。
- Provider 包只依赖 acp/shared 允许的端口，不复制官方协议。

### `chat-integration-001` — Core、Registry、Journal、审批/取消集成

范围：

- Core 创建会话时通过 Registry 启动相应 Provider。
- Turn 先在数据库幂等入队，再调用 ACP；ACP runtime event 经 journal/projector 后才 SSE 发布。
- Turn 状态完整实现 queued → starting → running ↔ awaiting_approval → completed/failed/cancelling/cancelled/interrupted。
- approval 必须先过 interceptor，再等待用户选项；cancel 幂等并正确处理迟到事件。
- 默认最大并发 4 个 Agent 子进程；达到上限显示显式 queued，不无限 spawn。
- 实现关闭、崩溃、熔断、stderr 有界脱敏日志和完整进程树回收。

验证：

- 所有第 8 节后端集成关系有端到端测试。
- journal commit 失败时事件不得出现在 SSE。
- Agent crash 产生 session_error，Turn 不得永久停在 running。
- 同一 Session 永远不出现两个非终态 Turn。

### `chat-ui-001` — 完整 Agents 聊天界面

范围：

- 在 `saas-ui-001` 的 Agent 会话页上完成第 5 节真实聊天交互，不重新设计页面。
- Provider 列表由 `/api/providers` 动态生成；不可用项显示诊断。
- 创建会话必须明确 Provider 和 cwd；会话切换不串消息。
- 七类消息、流式内容、approval options、cancel、Turn/Session 状态全部来自 shared 合同。
- capability warning 真实反映协商结果，不做超出 ACP 能力的安全承诺。
- 动态内容必须沿用原型气泡、tool、diff、approval、composer、header 和状态样式；真实数据不得引入第二套 UI。

验证：

- 七类消息固定 fixture 人工核验和组件测试通过。
- approval 重复点击、过期、服务端拒绝均有确定状态。
- 多会话并行时全局事件流可正确分发。
- 页面刷新、SSE 断线、Core 重启后不会出现幽灵 running 状态或重复消息。
- 七类消息、审批前后、running/cancelling/interrupted/reconnecting 的 screenshot case 通过。

### `real-e2e-001` — 真实 Agent 与恢复场景验收

范围：

- 在仓库内一次性、可清理的 smoke fixture 目录运行真实 Provider，禁止改动用户其他项目。
- 对每个本机可用且已认证 Provider 执行最小真实文本对话。
- 至少一个真实 Provider 完成 UI 端到端聊天；能力支持时还要完成一次审批和一次取消。
- Claude Code 与 Codex 两个 adapter 都必须实现并通过 fixture/doctor；本机不可用者记录精确外部阻塞证据。

完成下限：

- 如果两个真实 Provider 都不可用或未认证，不能把 Goal 标记完成。
- 至少一个真实 Provider 必须通过 Desktop UI → Core → ACP → Agent → Journal → SSE → UI 的完整路径。
- Fake Agent 的成功不能替代这条完成下限。

验证：

- 记录执行命令、Provider 版本、协商 capability、stopReason 和脱敏结果。
- 验证真实对话持久化、重开会话可读、取消后不再接受迟到状态覆盖。
- 若 Provider 支持 permission request，验证 requestId/optionId 和一次性解决闭环。

### `cloud-001` — Landing 托管、Cloud health 桩与 device_id 边界

范围：

- 托管 `landing-ui-001` 生成的静态 Landing，并保持本地/部署构建输出一致。
- Worker 只提供 `/v1/health`。
- 本地 device_id 可生成和重置，产品文案称“伪匿名”而非“完全匿名”。
- 不实现真实 ingest、D1、业务 payload 或后台上报调度。

验证：

- Landing 路由、静态资源、字体与 theme 行为 smoke 通过。
- health smoke 通过。
- 搜索构建产物和日志，确认无 prompt/cwd/token 被构造成云端 payload。

### `release-001` — P0/P1 工作区全量验证、打包 smoke、文档收口

范围：

- 执行第 11、12 节全部检查。
- 修复所有 blocking review findings。
- 让 README 提供安装、开发、headless Core、ACP REPL、Provider doctor、桌面启动和测试命令。
- 实现与文档不一致时先更新文档；重大差异必须 ADR。
- 输出最终验证报告，区分自动化、视觉回归、人工核验、真实 Provider 证据和未纳入范围事项。

验证：

- 只有第 12 节全部勾选后，`release-001` 才能为 `verified`。
- 该状态不替代 clean checkout、独立 release review 或 `p0-p1-mvp` tag；这些由
  `release-baseline-001` 完成。

## 11. 验证矩阵

| 场景 | 自动化要求 | 人工/真实环境要求 |
|---|---|---|
| Workspace | typecheck/test/build 全绿 | 无 |
| Turn 幂等 | 相同 clientRequestId 返回同一 turnId | curl 记录 |
| Session busy | 并发 POST 最多一个成功 | UI 禁止重复发送 |
| Journal | append + project 原子性、eventId 去重 | DB inspect |
| 恢复 | 五种非终态全部转 interrupted | kill Core 后观察 UI |
| SSE | 断线、重复、交界竞态、REPLAY_GAP | 网络重连状态可见 |
| Snapshot | global 完整替换、local 不推进 global seq | 多会话切换 |
| Approval | allow/reject/expire/duplicate/fail-closed | 真实 Provider 支持时跑一次 |
| Cancel | 幂等取消、迟到事件 | 真实 Provider 跑一次 |
| 七类消息 | fixture/component/E2E | UI 视觉核验 |
| SaaS 一比一 | 全页面 screenshot diff + geometry/style 断言 | 与 `.dc.html` 同 viewport 逐页对照 |
| Landing 一比一 | 全 section、主题、登录 overlay screenshot diff | 桌面与窄 viewport 滚动核验 |
| 主题与 accent | dark/light + 4 accent 关键页回归 | 检查 hover/focus/动画 |
| Core restart | 新 instanceId/port/token、旧 token 失效 | kill utility process |
| Security | Origin/Host/token/CSP/Node isolation | DevTools 检查 |
| Provider | fake ACP fixtures、doctor | 至少一个真实 UI 对话 |
| Packaging | 启动、ready、SQLite、Fake session、进程树关闭 | 当前 macOS 开发机 smoke |
| Cloud | `/v1/health` | 无真实数据上报 |

全量命令至少包括：

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm test:e2e
pnpm test:visual
pnpm smoke:package
```

具体包可以增加更窄的测试命令，但不能删减上述全量门禁。若某命令名称在 `repo-001` 中合理调整，必须同步更新本节和根 README，且保留等价覆盖。

## 12. Definition of Done

本节是 P0/P1 产品 Goal 的完成标准。可回退发布版本还必须通过
`release-baseline-001` 的 manifest、clean-checkout CI、独立 review 与 tag 门禁。

### 12.1 构建与质量

- [x] 所有第 9 节任务状态均为 `verified`。
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` 全绿。
- [x] E2E 和当前开发机 package smoke 全绿。
- [x] `pnpm test:visual` 全绿，reference/actual/diff 证据完整。
- [x] 没有未关闭的 blocking review finding。
- [x] 新增包都有 README 和可复制的 headless 调试命令。

### 12.2 P0

- [x] Electron 只在 Core ready 后展示聊天主界面。
- [x] kill Core 后 instanceId/port/token 全部轮换，旧 token 失效，UI 通过 global snapshot + replay 恢复。
- [x] SQLite、journal、projector、快照和五种非终态恢复均通过自动化测试。
- [x] 相同 clientRequestId 幂等；同 Session 并发 Turn 稳定返回一个成功和一个 `409 SESSION_BUSY`。
- [x] fetch-SSE 可从 afterSeq 无缝恢复；REPLAY_GAP 使用完整全局快照恢复。
- [x] 单 Session 快照不会推进全局 `lastAppliedSeq`。
- [x] 打包应用可加载 better-sqlite3、创建/关闭 Fake Agent 会话并回收进程树。
- [x] Worker `/v1/health` 可用，未实现真实云端持久化或业务上报。

### 12.3 P1 聊天

- [x] ACP 主链只使用官方稳定 v1 SDK 的精确锁定版本。
- [x] Claude Code 和 Codex Provider adapter、Registry、doctor 均已实现和验证。
- [x] ACP REPL 能运行会话、审批和取消 fixture；对本机可用 Provider 可真实运行。
- [x] Desktop UI 可选择 Provider/cwd、新建与切换会话、发送多轮消息。
- [x] user/text/note/think/tool/diff/approval 七类消息正确渲染。
- [x] 审批 allow/reject、取消、错误、crashed、interrupted 和 reconnect 状态闭环。
- [x] 多会话不会共享 activeTurn、pending approval 或消息状态。
- [x] 至少一个本机可用且已认证的真实 Provider 完成完整 Desktop UI 端到端聊天。
- [x] 对每个本机可用且已认证的 Provider 都执行真实 smoke；不可用者有脱敏诊断证据。

### 12.4 UI 一比一复刻

- [x] `AgentOS SaaS.dc.html` 的完整桌面壳和全部页面/子视图均已在 React 中重建且可到达。
- [x] `AgentOS Landing.dc.html` 的全部 section、产品窗口、CTA、Footer 和登录 overlay 均已重建。
- [x] 默认 dark + green 的所有页面达到第 5.7 节 visual diff、SSIM、几何与颜色阈值。
- [x] light 主题和 cyan/orange/purple accent 的关键页面达到相同验收标准。
- [x] 字体、文案、240px 侧栏、最大宽度、间距、圆角、边框、阴影、渐变、透明度、滚动和动效与原型一致。
- [x] hover/focus/active、导航、折叠、tab、dropdown、notification、theme toggle 和 login modal 行为与原型一致。
- [x] 七类真实聊天消息及 approval/cancel/reconnect/interrupted 状态沿用原型视觉，没有第二套聊天 UI。
- [x] P2+、Cloud Sync 和账号相关页面只使用 fixture/demo 状态，没有越界后端请求。
- [x] 生产代码没有 iframe/HTML 注入，没有加载 `support.js`，原型源文件未被修改。
- [x] 视觉验收保存了 reference、actual、diff 和 viewport 元数据，并在最终报告中列出。

### 12.5 安全与边界

- [x] Renderer 无 Node 权限，不直连 SQLite/ACP。
- [x] token 不在 URL、localStorage、日志、错误上报或持久化配置中。
- [x] Core 只监听 loopback，并验证 bearer、Origin 和 Host。
- [x] Provider 进程不通过 shell 字符串启动，环境变量按 allowlist 透传。
- [x] 默认审批策略是询问；不支持强制审批的 Provider 有清晰能力提示。
- [x] 没有实现 P2+ 业务、账号体系、WebSocket、运行时插件或真实云端 ingest。
- [x] 没有把 prompt、消息、cwd、路径、工具内容或 secrets 发送到 DougoOS 云端。

### 12.6 文档与交付报告

- [x] README 能让新开发者完成安装、开发启动、Core headless、ACP REPL、doctor、测试和打包 smoke。
- [x] 实现与 ARCHITECTURE/ADR/AI_DEV_SPEC 一致；必要变更已经先写入文档。
- [x] 最终报告列出通过的命令、视觉回归结果、真实 Provider 证据、打包结果、已知非阻塞限制和明确未做范围。

## 13. 阻塞处理

- 外部 Provider 未安装、未认证或协议版本不兼容时，记录 provider、版本、doctor 输出和可执行的恢复建议；不得记录 token。
- 单个 Provider 外部阻塞不妨碍继续完成所有不依赖它的任务。
- 但两个真实 Provider 都无法完成真实 UI 对话时，不满足本 Goal 的完成下限；应保持 Goal 未完成并明确说明外部阻塞。
- 遇到架构冲突、数据丢失风险、安全边界变化或需要大幅扩展范围时，停止该分支实现，先更新设计并请求用户确认。
- 不得用跳过测试、删除断言、扩大 mock、静默降级能力或修改 DoD 的方式“解除阻塞”。

## 14. Goal 结束时的输出

最终交付说明必须简洁回答：

1. P0 + P1 是否全部完成。
2. 用户现在如何启动桌面应用。
3. SaaS 与 Landing 的一比一视觉回归是否全部通过。
4. 哪些自动化、打包和真实 Provider 验证已通过。
5. 是否存在 blocking 问题；若有，为什么 Goal 不能标记完成。
6. 哪些能力明确留在 P2+，没有混入本次 MVP。
