# @dougoos/acp

DougoOS 的 ACP v1 客户端运行时。它负责官方 SDK transport、握手、认证、Session/Turn
生命周期、事件归一化、审批、取消、拦截器和 headless REPL；具体 CLI 的发现与命令解析
由 `@dougoos/providers` 实现。

## 协议依赖

- 只从 `@agentclientprotocol/sdk` 的稳定包根入口导入，精确锁定 `1.3.0`。
- 不导入 `experimental/v2`，不复制 JSON-RPC framing 或 ACP schema。
- 新依赖的用途是获得官方 v1 类型、运行时校验、NDJSON transport 和连接实现；现有依赖
  不提供这些 ACP 能力。
- Renderer 不得依赖本包；它只通过 Core 的 REST 与 fetch-SSE 使用归一化事件。

## 运行 REPL

REPL 接受一个明确的 ACP Agent 命令；每个额外参数单独使用 `--arg`，不会经过 shell
拼接。`providers-001` 会在组合根提供 Claude Code/Codex 的 provider 选择。

```bash
pnpm --filter @dougoos/acp repl -- \
  --provider fixture \
  --command node \
  --arg /absolute/path/to/acp-agent.mjs \
  --cwd /absolute/path/to/project
```

交互命令：

```text
普通文本
/approve <requestId> <optionId>
/cancel
/quit
```

## 验证

```bash
pnpm --filter @dougoos/acp debug
pnpm --filter @dougoos/acp typecheck
pnpm --filter @dougoos/acp lint
pnpm --filter @dougoos/acp test
```

本地 stdio fixture 覆盖 initialize、auth 选择、session/new、prompt stopReason、消息更新、
审批、拒绝、取消、进程退出和 REPL；fixture 的 stdout 只承载 ACP。stderr 与协议流隔离，
按进程做 64 KiB 上限和本地脱敏，再交给 Core 的滚动日志。
