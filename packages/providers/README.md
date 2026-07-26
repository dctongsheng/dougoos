# @dougoos/providers

Codex、Cursor Agent、Grok、Hermes、OpenClaw、OpenCode 和 Pi 是
`@dougoos/acp` 所定义 `AgentProvider` 端口的具体实现；Claude Agent 在 0.2.0 中保留
一个可诊断、不可启动的占位项。依赖方向固定为 providers → acp → shared。

Codex 和 Pi 使用精确锁版的 ACP adapter；Cursor Agent、Grok、Hermes、OpenClaw 和
OpenCode 使用各自 CLI 自带的 ACP stdio 入口。可执行 Provider 都通过参数数组和
`shell: false` 启动精确命令，只返回自己声明的环境变量白名单。doctor 只输出状态、
版本、安全修复建议，以及探测期间真实协商出的 capability snapshot，绝不输出环境变量
值或 adapter 原始错误。

Claude Agent 在 DougoOS 0.2.0 中暂不可用。当前版本不依赖、不打包、也不启动 Claude
Agent adapter 或 Anthropic Agent SDK；consumer、OAuth、API key、Bedrock/Vertex 云凭据
和本机 Claude CLI 都不能启用该占位项。`doctor claude-code` 会直接返回
`unavailable`，不会创建进程或读取这些认证来源。

## 本地 CLI 自动检测

Core 启动后会自动检测一份有边界的已知 Agent CLI 清单，不会遍历整台机器的所有
可执行文件。探测顺序为显式 Provider 环境变量、当前 `PATH`、常见用户级安装目录
以及 NVM/FNM Node 版本目录；检测到命令后以 3 秒超时运行一次 `--version`。
结果缓存 30 秒，也可从设置页手动重新检测。

查看当前机器的检测结果：

```bash
pnpm --filter @dougoos/providers run discover
```

输出包含本地绝对路径，只通过受 bearer 保护的 loopback Core API 和本地设置页使用，
不会进入云端上报。创建 Session 前会再次解析对应 CLI 的精确可执行文件路径；所有启动
仍使用参数数组和 `shell: false`。原生 ACP CLI 还会强制让 `localhost`、
`127.0.0.1` 和 `::1` 绕过继承的 HTTP 代理，避免 CLI 内部服务或本地 Gateway 被误送
到代理端口。

Electron 包把生产依赖放在 `app.asar.unpacked`，Provider 会把虚拟 asar adapter
入口映射为真实文件路径，使 Codex 和 Pi 的原生子进程及可选平台包可被安全 spawn。

当前命令映射：

- Cursor Agent：`cursor-agent acp`
- Grok：`grok --no-auto-update agent stdio`
- Hermes：`hermes acp`
- OpenClaw：`openclaw acp`，要求本机 OpenClaw Gateway 已健康启动
- OpenCode：`opencode acp`
- Pi：锁定的 `pi-acp` adapter 调用检测到的 `pi` 可执行文件

OpenClaw CLI 被检测到不代表其 Gateway 可用。若 doctor 返回
`handshake_failed`，先运行 `openclaw gateway status`；Gateway 使用的模型密钥也必须
能被其服务进程读取。

## Provider doctor

检查全部八个 Provider 槽位（其中 Claude Agent 在 0.2.0 中固定返回
`unavailable`）：

```bash
pnpm --filter @dougoos/providers run doctor all
```

单独探测，并可指定安全的工作目录：

```bash
pnpm --filter @dougoos/providers run doctor codex /path/to/fixture
pnpm --filter @dougoos/providers run doctor claude-code /path/to/fixture
pnpm --filter @dougoos/providers run doctor opencode /path/to/fixture
pnpm --filter @dougoos/providers run doctor openclaw /path/to/fixture
```

四类失败状态保持可区分：

- `unavailable`：bundled adapter 无法访问。
- `unauthenticated`：ACP 返回标准 `auth_required`。
- `incompatible`：Node、锁定的 adapter 或协商协议版本不兼容。
- `handshake_failed`：可执行文件存在，但 ACP 探测因其他原因失败。

## 验证

```bash
pnpm --filter @dougoos/providers debug
pnpm --filter @dougoos/providers test
pnpm --filter @dougoos/providers typecheck
pnpm --filter @dougoos/providers lint
```
