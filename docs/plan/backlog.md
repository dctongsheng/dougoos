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

## Early Access 0.2.0 production release

- 来源：[`early-access-0.2.0` Release Review 03](./reviews/early-access-0.2.0-03.md)
- 优先级：P3
- 状态：accepted / non-blocking
- GitHub Actions：`actions/*@v4` 出现 Node runtime 弃用警告；后续升级到受维护版本或
  固定完整 commit SHA。
- R2 恢复：immutable 对象在 promotion 前发生部分上传后，同 Tag 重跑可能需要人工清理
  残留对象；当前发布保持 fail-closed。
- 官网产品边界：登录、文档和在线体验等 demo/no-op 入口应继续明确标注或在后续实现，
  避免被理解为已上线业务功能。
- 影响：不影响 0.2.0 DMG 下载、SHA-256/Ed25519 校验、安装包打开或更新器信任边界。
