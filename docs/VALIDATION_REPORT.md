# DougoOS P0 + P1 最终验证报告

验证日期：2026-07-24（Asia/Shanghai）

## 结论

P0/P1 功能实现的历史 checkpoint 已完成，真实 Claude Code 已通过 Desktop UI → Core →
ACP → Agent → Journal → SSE → UI 全链路；Landing 与 health-only Worker 已发布到
<https://dougoos.com>。

2026-07-24 的 release candidate 离线门禁现已全绿，视觉修复也通过独立
`ui-regression-001` review。`release-baseline-001` review 01 因 Node pin 不一致而 blocked；
当前修复等待独立复审，任务保持 `in-progress`，尚未创建 `p0-p1-mvp` tag。

## 自动化与构建

Release baseline 本轮实际执行：

```bash
pnpm check
pnpm test:e2e
pnpm test:visual
pnpm smoke:build
```

四项离线门禁均通过，视觉结果见下一节。历史 checkpoint 还保存了以下本机/在线验证记录，
本轮 release baseline 不把它们加入无凭据 CI：

```bash
pnpm test:desktop
pnpm test:desktop:real
pnpm smoke:package
pnpm smoke:package:provider
pnpm --filter @dougoos/providers run doctor all
pnpm --filter @dougoos/core run smoke:providers all
```

- `pnpm check`：lint、format、workspace 拓扑、8 个包 typecheck、319 个包级测试和所有包构建通过。
- Chromium E2E：完整 15/15 通过。
- Electron E2E：3/3 离线门禁通过；真实 Provider case 默认跳过，并由独立在线命令 1/1 通过。
- build smoke：8 个编译后 ESM 入口全部可导入。
- package smoke：macOS arm64、Electron 43.2.0；正式 unsigned app 启动、Core ready、
  better-sqlite3、Fake Agent、关闭与完整进程树回收通过。

## 视觉回归

保存的 reference 清单与案例规模：

- 156 个 prototype reference case；
- 155 个 production reference case；
- 16 个 production-only 语义/副作用 case；
- Chromium 149.0.7827.55；
- SSIM 下限 0.995、最大差异像素比例 0.005、几何容差 1 px、单通道颜色容差 1。

Release candidate 当前视觉重验为 9/9，通过 committed reference 的两次 live stability
check、production full evidence 和 production-only probes。156 个 prototype reference
输入保持不变；155 个 production reference 与 16 个 production-only case 全部通过。当前
没有 visual blocking finding，修复过程没有更新 reference、扩大阈值或删除断言。

独立视觉 review 记录在
[`ui-regression-001-01.md`](./plan/reviews/ui-regression-001-01.md)，其 P3 Desktop 补充证据限制
已归档到 [backlog](./plan/backlog.md)，不影响当前离线发布门禁。

证据保存在：

- `tests/visual/reference/screenshots/` 与 `tests/visual/reference/metadata/`
- `tests/visual/production/actual/`
- `tests/visual/production/diff/`
- `tests/visual/production/metadata/`
- `tests/visual/reference/run.json`
- `tests/visual/production/run.json`

其中 reference screenshots/metadata 与 reference run 是 clean-checkout 的已提交输入；
production actual/diff/metadata/run 是本地可再生证据，受 `.gitignore` 保护，不进入 release。

## 真实 Provider

### Claude Code

- adapter：0.61.0
- ACP protocol：1
- doctor：available
- Desktop UI E2E：通过
- package Provider smoke：`completed` / `end_turn`
- 可见 UI 证据覆盖持久化重载、真实 tool/diff/approval、拒绝和取消
- 脱敏证据：`.artifacts/real-provider-ui-e2e.json`

### Codex

- adapter：1.1.7
- ACP protocol：1
- doctor：available
- real smoke：已执行
- 结果：`AGENT_FAILED` / `usage_limit` / JSON-RPC `-32603`

Codex 当前是外部额度限制，不是适配器、握手或认证失败。Claude Code 已满足至少一个真实
Provider 完整 Desktop UI 链路的完成下限。

## Cloud 与隐私边界

当前自定义域名配置：`dougoos.com`。最近一次绑定域名后的 Worker version：
`13058080-1268-42fe-833f-d90bdc57502a`。

生产 smoke：

- Landing `/`：200，正式 hashed JS/CSS 与自托管字体可访问；
- `GET /v1/health`：200，返回 `{"service":"dougoos-cloud","status":"ok","v":1}`；
- `HEAD /v1/health`：200、空 body；
- `POST /v1/health`：405，`Allow: GET, HEAD`；
- `POST /v1/ingest`：404，测试请求体不回显；
- health 响应包含 `Cache-Control: no-store` 与 `X-Content-Type-Options: nosniff`。

发布产物断言拒绝 ingest 路由、请求体读取、prompt/cwd/token/deviceId/message/toolContent
字段以及 D1/KV/Queue/R2 绑定。本期没有账号、真实 Cloud Sync、遥测、业务 payload 或
后台上报调度；本地 device_id 是可重置的伪匿名标识。

## Release baseline 状态

- 项目版本：`0.1.0`
- release name：`p0-p1-mvp`
- Release/CI Node：`.nvmrc` 是 exact version 唯一真源；package engine compatibility
  保持 `>=22.13.0`
- clean-checkout workflow：已加入 release candidate
- 轻量 release manifest：已加入 release candidate，可用 `pnpm release:manifest:check` 校验
- 当前离线门禁：`pnpm check`、E2E、视觉回归和 build smoke 全部通过
- 独立 release review：review 01 为 `blocked`；Node pin 修复等待独立复审
- Git tag：尚未创建；必须在独立 release review 通过后创建

## 启动

```bash
pnpm --filter @dougoos/web build
pnpm --filter @dougoos/desktop debug
```

Provider doctor：

```bash
pnpm --filter @dougoos/providers run doctor all
```

## 明确未纳入本期

P2+ 的任务编排 Agent、Session Manager 真实采集/统计、Harness active 模块、账号体系、
Cloud Sync、遥测/ingest、D1、云备份、WebSocket、运行时插件、签名/公证、自动更新均未混入
本次 MVP。对应页面只保留 fixture/demo 展示态。
