# ADR-0001：Turn、事件 Envelope 与本地 Journal

- 状态：Accepted
- 日期：2026-07-23
- 适用阶段：P0 起

## 背景

ACP 的 `session/prompt` 是一个持续到 Turn 结束的长请求，中间通过 `session/update` 产生消息、工具、diff、审批和 usage 更新。只用 sessionId 和 UI 消息类型无法可靠处理：

- HTTP 重试导致重复创建 Turn；
- SSE 断线后的漏事件、重复事件和乱序；
- Core 或 Agent 子进程崩溃后的状态恢复；
- 审批、消息、usage 与具体 Turn 的归属；
- 外部 ACP sessionId 与 DougoOS 内部 sessionId 的碰撞。

## 决策

### 1. Session、Turn、Event 分层

- Session 表示一段可持续多轮的 Agent 会话。
- Turn 表示一次用户输入到 ACP `session/prompt` 完成的生命周期。
- Event 表示 Turn 或 Session 的一次不可变状态变化。
- Message 是 Event Journal 折叠出的物化读模型，不作为实时事件真源。

Turn 状态机固定为：

```text
queued → starting → running ↔ awaiting_approval
running                  → completed | failed
running|awaiting_approval → cancelling → cancelled
任意非终态               → interrupted（进程恢复）
```

同一 Session 本期最多一个非终态 Turn。数据库建立 partial unique index：

```sql
CREATE UNIQUE INDEX one_active_turn_per_session
ON turns(session_id)
WHERE status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling');
```

创建 Turn 必须在同一事务中先按 `(session_id, client_request_id)` 查重，再插入 queued。相同请求返回原 turnId；活跃槽位冲突返回 `409 SESSION_BUSY`，不做隐式排队。这是数据库不变量，不能仅靠内存状态或事务外的预查询。

### 2. 两层事件类型

`@dougoos/acp` 产生不带全局序号的进程内事件：

```ts
interface AgentRuntimeEvent {
  sessionId: string;
  turnId: string | null;
  occurredAt: string;
  event: AgentUiEvent;
}
```

Core 在同一写入链中将其追加到 journal，分配 eventId 和全局单调 seq，再发布：

```ts
interface AgentEventEnvelope {
  v: 1;
  eventId: string;
  seq: number;
  sessionId: string;
  turnId: string | null;
  occurredAt: string;
  event: AgentUiEvent;
}
```

下层包不得自行生成全局 seq。Provider 原始 `_meta` 不进入 envelope。

### 3. API 幂等与异步响应

```text
POST /api/sessions/:sessionId/turns
{ clientRequestId, content[] }
→ 202 { turnId }
```

- `turns(session_id, client_request_id)` 建唯一索引；活跃 Turn 另受 `one_active_turn_per_session` partial unique index 约束。
- 相同 clientRequestId 重试返回原 turnId。
- HTTP 响应只确认 Turn 已接受，不等待完整 ACP prompt。
- Turn 完成、失败和取消统一通过事件流和快照表达。

Tasks 使用相同原则，`tasks(client_request_id)` 建唯一约束。

### 4. Journal 与物化

- Event 必须先成功写入 `session_events`，才能向 SSE fan-out。
- `session_events.seq` 是 replay cursor；`event_id` 是幂等身份。
- Journal append 与 Projector 更新 messages、turns、approval_requests、usage_stats 在同一 SQLite 事务完成，保证任意 snapshot 都与返回的 snapshotSeq 一致。
- 高频文本 delta 在 ACP 归一化层以不超过 50ms 的窗口合并，避免逐 token 写库；崩溃最多损失尚未形成 runtime event 的当前窗口。
- Journal 默认保留最近 7 天或 100,000 条，先到者为准；删除前必须确认物化成功。
- UI reducer 必须按 eventId 去重，并拒绝比当前 seq 更旧的状态覆盖。

### 5. 崩溃恢复

Core 启动时在同一恢复事务中将遗留的 queued、starting、running、awaiting_approval、cancelling Turn 统一标为 interrupted，并产生对应事件；事务提交后释放 partial unique index 的活跃槽位。只有 Provider 实际协商支持 ACP load/resume 时，用户才能显式恢复；否则只能创建新会话，禁止显示为原 Turn 仍在运行。

## 备选与取舍

### 只存 messages，不存 events

实现简单，但无法可靠 replay 工具状态、审批和取消，也无法解释崩溃前发生了什么，因此否决。

### 所有 Token delta 永久保存

审计最完整，但数据库增长过快。采用有保留上限的 journal，并在 Turn 完成后物化、压缩。

### POST prompt 一直等待 Turn 完成

接口表面简单，但会把 Agent 生命周期绑定到 HTTP 连接，难以处理取消、重连和 Core 重启，因此否决。

## 影响

- P0 必须先完成 Turn/Event schema、journal 和 replay fixture。
- 所有 UI 状态由 snapshot + ordered envelope 构建。
- Session Collector、统计和观察型 Hooks 统一消费 envelope 或已物化读模型，不再各自解析 ACP 原始消息；阻断型 Hooks 使用 SessionInterceptor。
- 新事件类型需要同时更新 shared schema、journal fixture、projector 和 UI reducer。

## 验收

- 相同 clientRequestId 重试不会重复创建 Turn。
- 同一 Session 两个并发新请求最多一个插入成功，另一个稳定返回 SESSION_BUSY。
- 重复投递同一 eventId 不改变最终状态。
- SSE 中断后从 afterSeq 恢复，最终状态与不中断一致。
- Core 在 queued、starting、running、awaiting_approval、cancelling 五种状态崩溃后，重启均产生 interrupted。
