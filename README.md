# DougoOS

DougoOS 是一个本地优先的桌面 AgentOS monorepo。仓库包含 Electron desktop shell、React SaaS
renderer、Core/ACP/provider/storage packages，以及严格的 TypeScript、workspace、构建、E2E
和视觉证据门禁。

- 当前项目版本：`0.1.0`
- P0/P1 产品实现：历史 checkpoint 已验证
- `p0-p1-mvp` release baseline：当前视觉门禁 blocked，尚未通过独立 review，未创建 tag

## 工具链

- Node.js `>=22.13.0`
- pnpm `11.16.0`

```bash
npm install --global pnpm@11.16.0
pnpm install --frozen-lockfile
```

所有外部依赖使用精确版本，并由 `pnpm-lock.yaml` 固定完整解析结果。

## 启动

构建正式 renderer，再启动带真实 Core、SQLite 和 Provider registry 的 Electron 应用：

```bash
pnpm --filter @dougoos/web build
pnpm --filter @dougoos/desktop debug
```

应用 ready 后可在 Agent 会话页选择 Claude Code、Codex、Cursor Agent、Grok、Hermes、
OpenClaw、OpenCode 或 Pi，选择 cwd、新建会话并发送消息。各 CLI 仍须在本机完成自身
登录或模型配置；OpenClaw 还要求其 Gateway 健康运行。可先运行 Provider doctor 查看
脱敏诊断。

只调试 fixture Web UI：

```bash
pnpm --filter @dougoos/web dev
```

只验证 headless Core 启动、迁移、鉴权和关闭：

```bash
pnpm --filter @dougoos/core debug
```

## ACP 与 Provider

探测本机真实 Provider，或执行临时且自动清理的真实 Core 对话：

```bash
pnpm --filter @dougoos/providers run discover
pnpm --filter @dougoos/providers run doctor all
pnpm --filter @dougoos/core run smoke:providers all
```

`discover` 会在已知 Agent CLI 清单中检测本机已安装项、绝对路径和版本；桌面端也会
在启动时自动检测，并可在设置页点击“重新检测”。它不会无边界扫描系统中的全部命令。
当前内置 Provider 为 Claude Code、Codex、Cursor Agent、Grok、Hermes、OpenClaw、
OpenCode 和 Pi。

ACP REPL 接受明确的命令和参数数组，不经过 shell 拼接：

```bash
pnpm --filter @dougoos/acp repl -- \
  --provider fixture \
  --command node \
  --arg /absolute/path/to/acp-agent.mjs \
  --cwd /absolute/path/to/project
```

REPL 支持普通文本、`/approve <requestId> <optionId>`、`/cancel` 和 `/quit`。
完整参数与真实 Provider 单独探测示例见
[ACP README](./packages/acp/README.md) 与 [Provider README](./packages/providers/README.md)。

## Landing 与 Cloud health

本期 Worker 只提供 `GET/HEAD /v1/health`；没有账号、ingest、D1、业务 payload 或后台上报：

```bash
pnpm --filter @dougoos/cloud dev:worker
curl --fail http://127.0.0.1:8787/v1/health
pnpm --filter @dougoos/cloud build
```

Cloudflare 登录有效时可从同一构建配置部署：

```bash
pnpm --filter @dougoos/cloud exec wrangler deploy
```

## 常用验证

```bash
pnpm lint
pnpm format:check
pnpm check:workspace
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm test:e2e
pnpm test:desktop
pnpm test:desktop:real
pnpm test:visual
pnpm smoke:build
pnpm smoke:package
```

- `test:e2e` 构建正式 Web bundle，并在真实 Chromium 中验证键盘、审批、响应式、持久状态、
  本地副作用边界与 release URL 安全。
- `test:desktop` 通过 Playwright 启动 Electron，验证 renderer 与安全配置。
- `test:desktop:real` 调用本机已认证的 Claude Code，验证可见 UI → Core → ACP → Agent →
  Journal → SSE → UI，并覆盖持久化、审批和取消；它不是离线 CI 门禁。
- `test:visual` 先构建正式与 visual-only 两个隔离输出，再验证 156 个 prototype
  reference case、155 个 production reference case 和 16 个 production-only
  语义/副作用 case，共 171 个生产 case。
- `smoke:build` 验证 workspace TypeScript 产物可作为 ESM 导入。
- `smoke:package` 验证 Electron 打包产物合同。

本机已经认证 Claude Code 时，还可验证打包应用中的真实 Provider、SQLite、Journal
和完整子进程树回收：

```bash
pnpm smoke:package:provider
```

该命令会调用真实 Provider，不属于离线 CI 门禁；输出仅包含锁定版本、协议、终态、
stopReason、消息种类和结构化错误码。

视觉真源位于 `prototypes/agentos/`。reference evidence 会把两个原型 HTML、`support.js` 和原型
README 一起纳入 source hash；正式应用不加载或嵌入这些文件。生产页面源码在
`apps/web/src/saas/`，visual-only 驱动在 `apps/web/src/visual/`，两者通过构建与静态门禁隔离。

## Release baseline

轻量 release manifest 记录版本、Git 可发布输入 hash、锁定工具链/关键依赖和通过的测试摘要。
它不包含 `.artifacts/`、视觉 actual/diff、数据库、日志或 Provider 诊断：

```bash
pnpm release:manifest:check
```

需要在有意改变发布输入后重建 manifest 时运行：

```bash
pnpm release:manifest
pnpm release:manifest:check
```

`.github/workflows/clean-checkout.yml` 从 checkout 和 frozen lockfile 安装开始，仅运行无凭据
门禁：manifest check、`pnpm check`、E2E、视觉回归和 build smoke。真实 Provider、
Cloudflare deploy、桌面签名与公证不进入该 CI。

完整的 P0 + P1 自动化、视觉、真实 Provider、打包与生产 Cloud 证据见
[最终验证报告](./docs/VALIDATION_REPORT.md)。
