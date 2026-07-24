# ADR-0002：fetch-SSE 鉴权、Replay 与 Core 重启握手

- 状态：Accepted
- 日期：2026-07-23
- 适用阶段：P0 起

## 背景

Web 渲染层必须脱离 Electron 独立调试，因此 Core 采用 localhost HTTP。实时 Agent 更新是单向流，SSE 比 WebSocket 更简单。

但浏览器原生 `EventSource` 不能设置 `Authorization` header。把 bearer token 放进 URL 会进入历史、日志和错误信息；同时，仅依赖 EventSource 自动重连不能解决漏事件、Core 重启和 journal 已清理等问题。

## 决策

### 1. 使用 fetch-based SSE

- SSE 是 wire format，不使用浏览器原生 `EventSource`。
- Web 使用可设置 header、读取 ReadableStream、控制 retry 的 fetch-SSE 客户端。
- bearer token 只放 `Authorization` header，不进入 URL、localStorage 或日志。
- UI 只建立一条全局流，按 sessionId/turnId 分发。

```text
GET /api/events?afterSeq=<lastAppliedSeq>
Authorization: Bearer <token>
Accept: text/event-stream
```

### 2. Replay 协议

- 每个 SSE frame 提供 `id: <seq>`，data 为 `AgentEventEnvelope`。
- UI 只在事件成功应用后推进 lastAppliedSeq。
- 断线按带 jitter 的指数退避重连，并传 afterSeq。
- Core 每 15 秒发送 heartbeat，heartbeat 不推进 seq。
- Core 必须按 seq 升序返回 `(afterSeq, currentSeq]` 的 journal 事件，再切换到 live fan-out，二者之间不得出现窗口。

如果 afterSeq 早于 journal 最小可用 seq，Core 在建立流前返回：

```text
409 REPLAY_GAP
{ minAvailableSeq, latestSeq }
```

全局事件流出现 gap 时，单 Session 快照不能安全推进全局 seq：客户端不知道缺失区间还影响了哪些后台 Session。因此 UI 必须调用：

```text
GET /api/snapshot?includeSessionId=<open-a>&includeSessionId=<open-b>
```

Core 在一个 SQLite read transaction 中返回：

```ts
{
  snapshotSeq: number;
  sessions: SessionSummary[];
  includedSessions: SessionSnapshot[];
  activeTurns: TurnSnapshot[];
  pendingApprovals: ApprovalSnapshot[];
}
```

`sessions` 覆盖全部会话摘要；`includedSessions` 包含 UI 请求的已打开会话，并由 Core 自动补入所有存在非终态 Turn 的会话。快照中的所有读模型必须已经包含 `[0, snapshotSeq]` 的全部已提交事件。

UI 收到快照后完整替换 session summary、已打开/活跃会话、Turn 和审批状态，以 snapshotSeq 作为唯一全局基线，再连接事件流。

`GET /api/sessions/:id` 返回的 `sessionSnapshotSeq` 只用于该 Session 的局部装载：UI 在请求期间缓冲该 Session 的 live 事件，应用快照后仅重放 `seq > sessionSnapshotSeq` 的缓冲事件。它不得赋值给全局 lastAppliedSeq。

### 3. Core ready/restart

- Electron main 每次启动生成 256-bit token。
- Core 绑定 `127.0.0.1:0`，完成迁移、监听和 Registry 初始化后，通过 parentPort 回报 `{instanceId, port}`。
- Preload 暴露 `getCoreConnection()` 与 `onCoreRestart()`。
- Core 重启必须生成新的 instanceId、port 和 token。
- Renderer 收到 restart 后立即中止旧 fetch，清除旧 token，获取全局一致快照并重新连接。
- Electron 在 ready 前只显示启动/诊断界面，不提前展示可交互主界面。

### 4. localhost 安全

- 生产 renderer 注册为安全、标准、支持 CORS 的 `app://dougoos` scheme。
- Core 校验 bearer token、Origin 和 Host；生产只允许 `app://dougoos`，dev 只允许显式配置的 Vite origin。
- BrowserWindow 使用 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true` 和严格 CSP。
- `.dev-token` 仅 dev 模式生成，权限 0600、每次启动轮换并加入 gitignore。
- 所有请求设置 body、prompt、上传和 batch 大小上限。

## 备选与取舍

### 原生 EventSource + URL token

实现最少，但 token 会泄露到 URL 相关日志和诊断信息，因此否决。

### HttpOnly Cookie

可以使用原生 EventSource，但 localhost、Vite dev origin、Electron 自定义 origin 和 CSRF 策略会增加复杂度。本期选择 header token。

### WebSocket

可以统一双向通信，但当前客户端到 Core 的低频命令使用 REST 足够；WebSocket 增加协议和恢复复杂度，因此后置。

### Electron IPC 直连

省去本地端口和鉴权，但会破坏 Web/Core 独立调试以及未来换壳能力，因此否决。

## 影响

- shared 增加 replay gap 错误 DTO 和 GlobalSnapshot DTO。
- Web API client 必须维护 instanceId、lastAppliedSeq 和 AbortController。
- Core event hub 必须实现“先 replay、无缝接 live”的原子切换。
- 测试必须可注入断线、重复 frame、Core crash 和 journal retention gap。

## 验收

- token 不出现在 URL、localStorage、日志和错误遥测中。
- 在任意事件处断线重连，最终 reducer 状态不丢失、不重复。
- Core 崩溃重启后旧 token 失效，新实例可恢复。
- afterSeq 超出保留窗口时返回 REPLAY_GAP；全局快照覆盖所有 session summaries、已打开/活跃会话和 pending approvals，恢复后可继续接收 live 事件。
- 单 Session 快照不能改变全局 lastAppliedSeq。
