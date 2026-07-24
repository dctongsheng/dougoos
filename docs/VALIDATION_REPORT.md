# DougoOS P0 + P1 最终验证报告

验证日期：2026-07-24（Asia/Shanghai）

## 结论

P0/P1 功能实现的历史 checkpoint 已完成，真实 Claude Code 已通过 Desktop UI → Core →
ACP → Agent → Journal → SSE → UI 全链路；Landing 与 health-only Worker 已发布到
<https://dougoos.com>。

2026-07-24 的 release baseline 重验发现当前 production UI 与已提交视觉合同存在
blocking drift。因此本报告不再声称当前 release candidate 全绿；`release-baseline-001`
保持 `in-progress`，尚未通过独立 review，也没有创建 `p0-p1-mvp` tag。

## 自动化与构建

Release baseline 本轮实际执行：

```bash
pnpm check
pnpm test:e2e
pnpm test:visual
pnpm smoke:build
```

其中 `pnpm check`、E2E 和 build smoke 通过，视觉结果见下一节。历史 checkpoint 还保存了
以下本机/在线验证记录，本轮 release baseline 不把它们加入无凭据 CI：

```bash
pnpm test:desktop
pnpm test:desktop:real
pnpm smoke:package
pnpm smoke:package:provider
pnpm --filter @dougoos/providers run doctor all
pnpm --filter @dougoos/core run smoke:providers all
```

- `pnpm check`：lint、format、workspace 拓扑、8 个包 typecheck、317 个包级测试和所有包构建通过。
- Chromium E2E：旧的跨层文本计数合同已按可见性语义修复；focused 1/1、完整 14/14 通过。
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

Release baseline 当前重验为 7/9，通过的项目包含 committed reference 的两次 live
stability check；失败的 2 项是 production full evidence 与 production-only probes：

- 8-provider 当前 UI 相对 6-agent prototype baseline 发生大范围布局漂移；Dashboard
  screen height 偏差 166 px，Settings 多页偏差 134 px，伴随 SSIM/diff 超阈值；
- `saas-production-seven-message-types` 实际为
  `approval/diff/note/text/tool/user`，缺少合同要求的 `think`。

这是 release blocking finding。不得更新 reference、扩大阈值或删除断言来规避。

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
- clean-checkout workflow：已加入 release candidate
- 轻量 release manifest：已加入 release candidate，可用 `pnpm release:manifest:check` 校验
- 当前离线门禁：`pnpm check`、E2E、build smoke 通过；视觉回归 blocked
- 独立 release review：待执行
- Git tag：必须在独立 review 与 clean-checkout 门禁通过后创建

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
