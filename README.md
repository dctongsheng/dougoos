# DougoOS

DougoOS 是一个本地优先的桌面 AgentOS monorepo。仓库包含 Electron desktop shell、React SaaS
renderer、Core/ACP/provider/storage packages，以及严格的 TypeScript、workspace、构建、E2E
和视觉证据门禁。

- 当前项目版本：`0.2.0 Early Access`
- `v0.2.0` 已发布：R2 固定下载、Ed25519 签名、公开源码 Tag 与
  [dougoos.com](https://dougoos.com/) 生产入口均已验证；等待干净 Mac 首次启动验收
- P0/P1 产品实现：历史 checkpoint 已验证
- `p0-p1-mvp` release baseline：`done`；三轮独立 review 已关闭全部 finding，exact-Node
  clean checkout 已重现全部离线门禁，annotated tag 可用于回退

## 下载 Early Access

macOS 13+ Apple Silicon 用户可从以下固定入口下载：

[下载 DougoOS 0.2.0 Early Access](https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg)

当前版本采用 ad-hoc bundle signing，但**没有 Apple Developer ID 签名，也未经 Apple
公证**。首次安装：

1. 下载并打开 DMG。
2. 将 DougoOS 拖入 Applications。
3. 首次尝试启动。
4. 如果被 macOS 拦截，打开“系统设置 → 隐私与安全性”，选择“仍要打开”。

不要关闭 Gatekeeper，也不需要执行 `xattr` 绕过命令。应用会在启动 30 秒后检查更新，
之后每 6 小时检查一次；也可在 DougoOS 菜单选择“检查更新…”。新版会在后台下载，并
通过文件大小、SHA-256 和独立 Ed25519 发布签名校验。校验成功后，用户可打开新版 DMG，
退出 DougoOS 并将新版拖入 Applications 替换旧版本。Early Access 不会自覆盖正在运行的
应用、申请管理员权限或修改 quarantine 属性。

## 开源许可与源码

DougoOS 自有源码采用 **GNU Affero General Public License v3.0 only**
（SPDX：`AGPL-3.0-only`）发布：

- 源码：<https://github.com/dctongsheng/dougoos>
- 0.2.0 对应源码：<https://github.com/dctongsheng/dougoos/tree/v0.2.0>
- 完整许可：[LICENSE](./LICENSE)
- 第三方软件与独立条款：[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

AGPL 要求分发修改版本时继续提供对应源码；通过网络向用户提供修改版本功能时，也必须
向这些用户提供正在运行版本的对应源码。DougoOS 的 AGPL 许可不重许可 Electron、
Chromium、字体、Agent adapters 或其他第三方依赖，它们继续受各自许可或服务条款约束。

## 工具链

- Release/CI Node.js：`.nvmrc` 是 exact version 的唯一真源
- Node.js package compatibility：`>=22.13.0`
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

应用 ready 后可在 Agent 会话页使用 Codex、Cursor Agent、Grok、Hermes、OpenClaw、
OpenCode 或 Pi，选择 cwd、新建会话并发送消息。Claude Agent 槽位仍会显示，但在
DougoOS 0.2.0 中暂不可用：当前版本不包含或启动它的 adapter，也不会接受 consumer、
OAuth、API key、云凭据或本机 Claude CLI 来启用它。其余 CLI 仍须在本机完成各自支持的
认证或模型配置；OpenClaw 还要求其 Gateway 健康运行。可先运行 Provider doctor 查看
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
当前内置 Provider 为 Codex、Cursor Agent、Grok、Hermes、OpenClaw、OpenCode 和 Pi；
另保留 0.2.0 中固定不可用的 Claude Agent 占位项。

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

Worker 提供 `GET/HEAD /v1/health`，并让已废弃的 shell 安装入口 `GET/HEAD /install`
返回 `410 Gone` 与官网下载提示；没有账号、ingest、D1、业务 payload 或后台上报：

```bash
pnpm --filter @dougoos/cloud dev:worker
curl --fail http://127.0.0.1:8787/v1/health
curl --include http://127.0.0.1:8787/install
pnpm --filter @dougoos/cloud build
```

Cloudflare 登录有效时可从同一构建配置部署：

```bash
pnpm --filter @dougoos/cloud exec wrangler deploy
```

## 常用验证

```bash
pnpm check
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

- `check` 可直接在 frozen clean checkout 运行：lint、format 和 workspace contract 通过后，
  先按 workspace 拓扑构建 `dist`，再执行全部 typecheck、当前 356 个 package tests 和
  6 个 R2 不可变对象恢复测试；不依赖旧构建产物，也不跳过类型检查。
- `test:e2e` 构建正式 Web bundle，并在真实 Chromium 中验证键盘、审批、响应式、持久状态、
  本地副作用边界与 release URL 安全。
- `test:desktop` 通过 Playwright 启动 Electron，验证 renderer 与安全配置。
- `test:desktop:real` 默认调用 Codex（可通过 `DOUGOOS_REAL_PROVIDER_ID` 选择其他可用
  Provider），验证可见 UI → Core → ACP → Agent → Journal → SSE → UI，并覆盖持久化、
  审批和取消；它不是离线 CI 门禁。
- `test:visual` 先构建正式与 visual-only 两个隔离输出，再验证 156 个 prototype
  reference case、155 个 production reference case 和 16 个 production-only
  语义/副作用 case，共 171 个生产 case。
- `smoke:build` 验证 workspace TypeScript 产物可作为 ESM 导入。
- `smoke:package` 验证 Electron 打包产物合同。

本机已配置 Codex 后，还可验证打包应用中的真实 Provider、SQLite、Journal 和完整子进程
树回收：

```bash
pnpm smoke:package:provider
```

该命令默认调用 Codex，也可显式传入其他可用 Provider；不属于离线 CI 门禁。输出仅包含
锁定版本、协议、终态、stopReason、消息种类和结构化错误码。

视觉真源位于 `prototypes/agentos/`。reference evidence 会把两个原型 HTML、`support.js` 和原型
README 一起纳入 source hash；正式应用不加载或嵌入这些文件。生产页面源码在
`apps/web/src/saas/`，visual-only 驱动在 `apps/web/src/visual/`，两者通过构建与静态门禁隔离。

## Release baseline

轻量 release manifest 从 `.nvmrc` 读取 exact Node release version，并另列 package engine
compatibility；同时记录版本、Git 可发布输入 hash、锁定工具链/关键依赖和通过的测试摘要。
它不包含 `.artifacts/`、视觉 actual/diff、数据库、日志或 Provider 诊断：

```bash
pnpm release:manifest:check
```

需要在有意改变发布输入后重建 manifest 时运行：

```bash
pnpm release:manifest
pnpm release:manifest:check
```

`.github/workflows/clean-checkout.yml` 从完整历史 checkout 和 frozen lockfile 安装开始，
仅运行无凭据门禁：baseline/当前 tag manifest check、`pnpm check`、E2E、视觉回归和
build smoke。真实 Provider、Cloudflare deploy、桌面发布签名与 Apple 公证不进入该 CI。

`v0.2.0` tag 由 `.github/workflows/release-macos.yml` 在 `macos-14` Apple Silicon runner
构建。流水线验证完整离线门禁与 packaged smoke，生成 ad-hoc DMG，使用只存在于 GitHub
Secret 的 Ed25519 私钥签署制品摘要，上传 R2 不可变版本文件，从公网重新下载校验，最后
才更新 `latest.json` 和固定下载别名。所需 Secrets：

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `RELEASE_ED25519_PRIVATE_KEY`

R2 bucket 为 `dougoos-releases`，公开自定义域名为 `downloads.dougoos.com`。版本化制品使用
长期缓存，`latest.json`、固定 DMG 与签名别名使用 `no-cache`。

完整的 P0 + P1 自动化、视觉、真实 Provider、打包与生产 Cloud 证据见
[最终验证报告](./docs/VALIDATION_REPORT.md)。
