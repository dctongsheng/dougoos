# Delivery Backlog

本文件只记录已接受的 non-blocking review finding。Blocking finding 不得进入 backlog，必须在当前任务中修复并重新验证。

## Desktop E2E Core crash-recovery evidence

- 来源：[`ui-regression-001` Independent Review 01](./reviews/ui-regression-001-01.md)
- 优先级：P3
- 状态：accepted / non-blocking
- 限制：补充执行完整 `pnpm test:desktop` 时，首次运行先下载 Electron；随后本次改动涉及的
  fake-provider 用例和 secure-window 用例均通过，但与候选 diff 无关的
  `app.spec.ts` Core crash-recovery case 超过 30 秒超时。
- 影响：不影响 `ui-regression-001` 或当前 release candidate 的必需离线门禁；Desktop E2E
  目前不属于 release-baseline CI。
- 后续：若未来将完整 Desktop E2E 提升为 release-baseline CI 门禁，单独复查并稳定该恢复用例。
