# DougoOS

桌面端 AgentOS（UI 显示名 AgentOS，官网 dougoos.com）："多个 Agent CLI，一个控制台"。桌面端承载 Agent 聊天 / 任务派发 / Harness / Session Manager；云端仅落地页 + 匿名统计上报。本地优先，无账号体系（匿名 device_id）。

## 当前状态

设计阶段，代码仓库尚未初始化。本目录内容：

- `docs/ARCHITECTURE.md` — 已批准的架构方案（分层图、模块划分、关键决策、目录结构、P0–P3 迭代路线）。**所有术语和模块边界以它为准。**
- `docs/AI_DEV_SPEC.md` — 功能迭代路线（P4–P7）+ 完整开发规范（本文件是其精简版，冲突时以 SPEC 完整版为准）
- `prototypes/` — 产品 HTML 原型（信息架构与 UI 真源）
- `references/pi` — 任务 Agent 的设计蓝本（勿直接 npm 依赖）

外部参考（设计蓝本，禁止作为代码依赖）：
- `/Users/biws01/Documents/install_everything/grok-html-demo` — ACP 接入参考
- `/Users/biws01/xm26/001_many_agents/13_locla_session_manager/repos/code-insights` — Session Manager 参考

## 技术栈（已定，勿重新选型）

Electron + Vite/React 19 + TanStack Query + Recharts | core 层 Node + Hono（127.0.0.1, REST+SSE, bearer token）| better-sqlite3 (WAL) | pnpm workspace + turborepo | 云端 Cloudflare Workers + Hono | TypeScript strict, ESM only, Node ≥ 22

## 架构铁律（违反即返工）

1. **依赖方向单向**：包依赖只指向 `@dougoos/shared`；`apps/web` 只 import shared 的类型；`core` 是唯一组合根。
2. **进程边界**：SQLite 与 ACP 子进程只存在于 core 进程；渲染层零 Node 权限，与 core 只通过 HTTP/SSE 通信；Electron main/preload 无业务逻辑。
3. **唯一写者**：只有 core 写 `~/.dougoos/data.db`。
4. **事件即接口**：跨模块运行时通信只走 TS interface 调用或 `AgentUiEvent` 事件流。
5. **可单独调试**：每个包必须有 headless 入口（repl/doctor/dry-run），README 写明调试命令。

## 开发流程

新功能开工前：读 ARCHITECTURE.md 确认落点 → 查 `docs/adr/` 已有决策 → 按 AI_DEV_SPEC.md §3 决策树选 Checklist：

- 新 Agent CLI 接入 → Checklist A（认证必须依 initialize.authMethods 动态选择）
- Harness 新子模块 → Checklist B（编译期注册 HarnessModule，API 挂 `/api/harness/<id>/*`）
- 新 API/表/实体 → Checklist C（类型+zod 进 shared；迁移只增不改，新列可空或有默认值）
- 新会话来源/统计指标 → Checklist D（聚合写纯函数；估算值带质量标记）
- 新云端上报事件 → Checklist E（只走 outbox，入队与业务写同事务，redaction 强制审查）
- 都不是 → 停下写 ADR，确认扩展点设计后再动手

mock/真实数据切换一律走 DataSource 接口 + settings 配置，禁止代码内分叉。

## 红线（不可协商）

上报 payload 永不包含：prompt/消息/提示词文本、文件路径/cwd、密钥 token、用户名、可关联账号的标识。`localOnly=true` 时上报调度器不得启动。审批默认策略永远是"询问"。

禁止：运行时插件加载、外部消息队列、账号体系、任务 Agent ACP 化、WebSocket（用 REST+SSE）、渲染层碰 Node/SQLite、轮询判静默类时序 hack。

## 验收（每个 PR）

`pnpm -r typecheck && pnpm -r test && pnpm -r build` 全绿；对应 Checklist 逐条执行并在 PR 列出；附 headless 验证记录（repl/curl/dry-run 输出）；涉及上报的贴 redaction 后样本；修 bug 先写复现测试。
