# @dougoos/shared

DougoOS 跨包协议、读模型、REST DTO 和 zod v4 schema 的单一真源。包为 strict
TypeScript、ESM only；唯一运行时依赖是 `zod@4.4.3`，因为 HTTP、ACP 归一化事件和
持久化恢复边界都必须执行运行时验证，TypeScript 类型本身不能替代该检查。

## 导出合同

- 基础：版本、ISO 8601 时间、opaque/internal ID、全局与局部 cursor 品牌、
  bounded JSON、artifact reference。
- 读模型：`Session`/`SessionSummary`、`Turn`/`TurnSnapshot`、七类
  `MessageSnapshot`、`ApprovalSnapshot`、Provider 静态状态和每 Session 动态
  `ProviderCapabilitySnapshot`。
- 事件：未分配序号的 `AgentRuntimeEvent`、严格 `AgentUiEvent` 联合类型、带
  `v: 1`/eventId/全局 seq 的 `AgentEventEnvelope`。
- REST：严格但不重复携带版本字段的 health、providers/doctor、sessions、局部/全局 snapshot、Turn
  create/cancel、approval、fetch-SSE query、结构化错误和可重置伪匿名
  `device_id` DTO。

Turn 事件只有一条终态路径：`turn_state` 表示 queued 初态和非终态转换；
`turn_end` 带 `from`，一次完成 active → terminal 转换并承载 stopReason/error/usage。
Projector 不得为同一终态再追加或等待第二条 `turn_state`。

所有 wire object 和联合类型成员均为 strict schema。Provider `_meta` 和原始 ACP
envelope 不能进入 UI DTO；错误诊断 details 只允许固定机器字段、布尔/数值和枚举，
任意未知 key 或自由文本均被 strict schema 拒绝。顶层 error message 必须等于其
error code 对应的静态 catalog 文案，动态 provider 诊断文本则走独立的 bounded
sensitive-signature schema；redaction 仅作 defense-in-depth。
prompt、消息、工具输入/结果只存在于明确的本地 UI read model，不进入云 metrics 或
错误诊断 DTO。ACP 原始协议类型只能留在 `@dougoos/acp`。

## 限额

架构明确规定的精确限额：

- tool output：30,000 Unicode 字符；
- 完整序列化 diff 单事件：1,048,576 UTF-8 bytes，超过时必须用 typed artifact reference，
  禁止静默截断。

其余 ID、prompt、数组、JSON 和 snapshot 数值集中在 `OPERATIONAL_LIMITS`。这些是
当前 MVP 的实现策略，不声称是 ADR 规范值；测试覆盖边界与边界 + 1。Session snapshot
的 approval 历史使用独立 `approvalsPerSessionSnapshot` 限额，Global pending index
使用 `maxPendingApprovals`；超过历史限额返回结构化 `SNAPSHOT_LIMIT_EXCEEDED`，禁止
截断后冒充完整快照，后续分页需另行演进 DTO。Core 必须强制 `activeSessions`，超过
上限时拒绝新 active Turn，保证 GlobalSnapshot 自动纳入全部 active Session；Core
仍需在 JSON parse 之前单独限制原始 HTTP body bytes。

## 单独调试

下面的 headless 命令会用真实 schema 验证一条 queued Turn envelope 和一个创建
Turn 请求，并打印生效的关键限额：

```bash
pnpm --filter @dougoos/shared debug
```

目标包完整检查：

```bash
pnpm --filter @dougoos/shared lint
pnpm --filter @dougoos/shared typecheck
pnpm --filter @dougoos/shared test
pnpm --filter @dougoos/shared build
```

静态 consumer audit 随包测试运行：它禁止其他 app/package 重复定义协议类型，只
显式放行 SaaS/Landing 的本地 presentation/visual fixture 类型。未来 Web API
adapter 必须 import `@dougoos/shared`，再显式映射到现有原型展示模型。AST scanner
是用于捕获显式本地合约复制的轻量 CI guard，并不是对任意 JavaScript 执行的形式化证明。
