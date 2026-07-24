# @dougoos/web

DougoOS 的 React SaaS renderer。当前实现包含新建任务、Agent 会话、审批、任务队列、
Memory、Harness、Sessions Manager、Settings 与响应式 Shell。

应用通过 `SaasDataSource` 读取 snapshot。普通浏览器调试没有 preload 时使用
`FixtureDataSource`，只在内存中工作；Electron preload 暴露 `window.dougoos` 后自动切换为
`CoreDataSource`。

真实数据源通过 `CoreApiClient` 使用 bearer REST + fetch-SSE：

- token 只存在 renderer 内存并只进入 `Authorization` header；
- 全局 reducer 按 `eventId` 去重、按 `seq` 应用；
- `REPLAY_GAP` 使用完整全局快照替换基线；
- 局部 Session 加载会缓冲 live 事件，且 `sessionSnapshotSeq` 不会推进全局 cursor；
- Core restart 会丢弃旧 client，并从新的 instanceId/port/token 重建快照与事件流。

P2+ 页面仍使用明确的展示 fixture；Electron 中的 Agent 会话页已通过同一数据边界接通
真实 Provider/cwd 选择、会话创建与切换、多轮发送、审批、取消和恢复后的历史展示。

## 本地调试

```bash
pnpm --filter @dougoos/web dev
pnpm --filter @dougoos/web debug
pnpm --filter @dougoos/web typecheck
pnpm --filter @dougoos/web test
pnpm --filter @dougoos/web build
```

`build` 生成 `dist/site`，并强制运行 release 静态门禁。门禁确保正式 bundle 不包含 prototype
runtime、visual case ID 或 URL 场景注入入口。

视觉测试使用独立入口和输出，不进入正式 bundle：

```bash
pnpm --filter @dougoos/web build:visual
```

该命令生成 `dist/visual-site`。完整的 140 个 prototype-reference case 始终从
`dist/site` 捕获；15 个 production-only 语义 case 才使用 `dist/visual-site`。

仓库级真实浏览器验证命令：

```bash
pnpm test:e2e
pnpm test:visual
```
