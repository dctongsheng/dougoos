# ADR-0003：SessionInterceptor 与 Harness Hooks 安全边界

- 状态：Accepted
- 日期：2026-07-23
- 适用阶段：P0 留接口，P6 激活 Hooks

## 背景

Registry 事件订阅只能观察已经发生的状态变化。它适合统计、日志和 UI，但无法可靠实现：

- prompt 发送前检查；
- ACP permission request 返回前执行策略；
- PreToolUse 式阻断；
- 超时、错误和多个 Hook 的确定性决策。

同时，ACP Agent 可能在自身进程内直接执行工具。如果 Agent 没有发起 `session/request_permission`，客户端无法凭事件流阻止该工具。

## 决策

### 1. 拦截接口属于 ACP 运行时

`SessionInterceptor` 定义在 `@dougoos/acp`，由 Core 组合根按编译期注册顺序注入 Registry：

```ts
interface SessionInterceptor {
  beforePrompt?(ctx: PromptContext): Promise<"allow" | "reject">;
  onPermissionRequest?(ctx: PermissionContext): Promise<PermissionVerdict>;
  afterEvent?(event: AgentRuntimeEvent): Promise<void>;
}
```

HarnessModule 基础接口不接收 CoreDeps、数据库连接或 Registry。未来 Hooks 模块可以额外导出 `SessionInterceptor[]`，但仍只能使用为它定义的窄端口。

### 2. 执行语义

- `beforePrompt` 与 `onPermissionRequest` 按注册顺序串行运行。
- 每个阻断 Hook 有明确超时；超时或异常默认 fail closed，并产生用户可见的结构化错误。
- 任一 `beforePrompt` 返回 reject，Turn 在发送 ACP prompt 前失败。
- `onPermissionRequest` 本期只能继续展示给用户或拒绝，不能代替用户自动允许。
- 用户选择必须校验 requestId 和 optionId，并且只允许解决一次。
- `afterEvent` 是观察型回调，通过有界队列异步执行；失败只记录日志，不阻塞 journal 和 SSE。

### 3. 能力边界必须可见

Provider capability snapshot 和会话 UI 必须区分：

- Agent 会请求客户端审批，可以执行 permission interceptor；
- Agent 不保证请求审批，只能显示事件，客户端无法强制阻断内部工具；
- Agent 的文件系统/终端能力通过客户端代理，可在代理边界实施额外策略。

产品不得把“安装了 Hooks”描述为对所有 Provider 的完整安全沙箱。

### 4. 安全策略与用户审批

- 默认审批策略永远是询问。
- Hook 可以缩小权限或拒绝，不能静默扩大权限。
- 如果未来增加 auto-allow，必须单独 ADR，限定 Provider、工具、cwd、时效和可撤销性。
- Hook 输入输出不得包含未声明的 secrets；日志使用安全摘要，禁止完整记录工具参数。

## 备选与取舍

### 只订阅 Registry 事件总线

无法在操作前阻断，时序上已经太晚，因此只保留为观察通道。

### 在每个 Provider 内实现 Hook

会复制策略、产生不一致行为，并迫使协议层为单个 Provider 修改，因此否决。

### 动态加载第三方 Hook 插件

会引入本地代码执行、签名、权限和兼容性问题。本期坚持编译期注册。

## 影响

- P0 在 acp 包建立空 interceptor chain 和 fake interceptor 测试。
- P1 approval handler 必须经过 interceptor，再等待用户选择。
- P6 Hooks 模块不修改 Registry 内部状态，只提供 interceptor 和配置存储。
- 统计型 Harness 模块继续使用 envelope 事件流，不依赖拦截接口。

## 验收

- beforePrompt reject 时 ACP 子进程未收到 prompt。
- permission interceptor 超时或异常时请求被拒绝且 UI 显示原因。
- 多 interceptor 顺序稳定，第一条 reject 后后续阻断 Hook 不再运行。
- afterEvent 抛错不会延迟 journal 写入或 SSE。
- 对不支持审批的 Provider，UI 明确显示“无法强制阻断 Agent 内部工具”。
