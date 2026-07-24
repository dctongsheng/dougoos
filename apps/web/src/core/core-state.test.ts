import {
  AgentEventEnvelopeSchema,
  GlobalSnapshotSchema,
  SessionSnapshotSchema,
  type AgentEventEnvelope,
  type SessionSnapshot,
} from "@dougoos/shared";
import { describe, expect, it } from "vitest";

import {
  applyEnvelope,
  beginLocalSessionLoad,
  completeLocalSessionLoad,
  stateFromGlobalSnapshot,
} from "./core-state.js";

const NOW = "2026-07-24T08:00:00.000Z";
const SESSION_ID = "session:web";
const TURN_ID = "turn:web";
const CAPABILITIES = {
  clientProxy: { config: false, fileSystem: false, terminal: false },
  negotiatedAt: NOW,
  permissionEnforcement: "requests_permission",
  protocolVersion: "1",
  session: { close: false, delete: false, list: false, load: false, resume: false },
  turn: { cancel: true, images: false, prompt: true },
} as const;

const session = {
  capabilities: CAPABILITIES,
  createdAt: NOW,
  cwd: "/workspace",
  id: SESSION_ID,
  providerId: "fake",
  providerSessionId: "provider-session",
  source: "dougoos",
  state: "idle",
  title: "Web reducer",
  updatedAt: NOW,
} as const;

const summary = {
  activeTurnId: null,
  cwd: session.cwd,
  id: session.id,
  messageCount: 0,
  providerId: session.providerId,
  state: session.state,
  title: session.title,
  updatedAt: session.updatedAt,
} as const;

function baseline(options: { readonly include?: boolean; readonly seq?: number } = {}) {
  const seq = options.seq ?? 0;
  return GlobalSnapshotSchema.parse({
    activeTurns: [],
    includedSessions:
      options.include === true
        ? [
            {
              approvals: [],
              messages: [],
              session,
              sessionSnapshotSeq: seq,
              turns: [],
            },
          ]
        : [],
    pendingApprovals: [],
    sessions: [summary],
    snapshotSeq: seq,
  });
}

function envelope(seq: number, event: unknown, eventId = `event:${seq}`): AgentEventEnvelope {
  const eventType =
    typeof event === "object" && event !== null && "type" in event ? String(event.type) : "";
  return AgentEventEnvelopeSchema.parse({
    event,
    eventId,
    occurredAt: NOW,
    seq,
    sessionId: SESSION_ID,
    turnId: eventType === "session_state" || eventType === "session_error" ? null : TURN_ID,
    v: 1,
  });
}

describe("Core Web reducer", () => {
  it("keeps the normalized first user message as the stable Session display title", () => {
    const initial = stateFromGlobalSnapshot(baseline({ include: true }));
    const first = applyEnvelope(
      initial,
      envelope(1, {
        body: "  第一条\n任务  ",
        messageId: "message:user:first",
        type: "user_message",
      }),
    );
    const second = applyEnvelope(
      first.state,
      envelope(2, {
        body: "第二条消息不能覆盖标题",
        messageId: "message:user:second",
        type: "user_message",
      }),
    );

    expect(first.state.summaries[SESSION_ID]?.firstUserMessagePreview).toBe("第一条 任务");
    expect(second.state.summaries[SESSION_ID]?.firstUserMessagePreview).toBe("第一条 任务");
  });

  it("keeps thought and answer deltas separate without leaking thought into the preview", () => {
    const initial = stateFromGlobalSnapshot(baseline({ include: true }));
    const thought = applyEnvelope(
      initial,
      envelope(1, {
        messageId: "message:thought",
        text: "PRIVATE_REASONING_SENTINEL",
        type: "thought_delta",
      }),
    );
    const answerStart = applyEnvelope(
      thought.state,
      envelope(2, {
        messageId: "message:answer",
        text: "### 正式回答\n第一行",
        type: "message_delta",
      }),
    );
    const answerEnd = applyEnvelope(
      answerStart.state,
      envelope(3, {
        messageId: "message:answer",
        text: "\n第二行",
        type: "message_delta",
      }),
    );

    expect(answerEnd.state.sessions[SESSION_ID]?.messages).toEqual([
      {
        body: "PRIVATE_REASONING_SENTINEL",
        id: "message:thought",
        kind: "think",
        state: "streaming",
      },
      {
        body: "### 正式回答\n第一行\n第二行",
        id: "message:answer",
        kind: "text",
        state: "streaming",
      },
    ]);
    expect(answerEnd.state.summaries[SESSION_ID]?.lastMessagePreview).toBe("\n第二行");
  });

  it("preserves multiline long tool input and inline output verbatim across updates", () => {
    const longInputToken = `INPUT_${"x".repeat(12_000)}_END`;
    const displayInput = `command --first\n${longInputToken}\n--last`;
    const longResultToken = `RESULT_${"y".repeat(24_000)}_END`;
    const inlineResult = `stdout line one\n${longResultToken}\nstderr line two`;
    const initial = stateFromGlobalSnapshot(baseline({ include: true }));

    const called = applyEnvelope(
      initial,
      envelope(1, {
        displayInput,
        kind: "shell",
        status: "running",
        title: "Long multiline tool",
        toolCallId: "tool:long-multiline",
        type: "tool_call",
      }),
    );

    expect(called.state.sessions[SESSION_ID]?.messages).toEqual([
      {
        displayInput,
        id: `tool:${TURN_ID}:tool:long-multiline`,
        kind: "tool",
        result: "",
        status: "running",
        title: "Long multiline tool",
        toolCallId: "tool:long-multiline",
      },
    ]);

    const updated = applyEnvelope(
      called.state,
      envelope(2, {
        result: { output: inlineResult, type: "inline" },
        status: "done",
        toolCallId: "tool:long-multiline",
        type: "tool_update",
      }),
    );
    const message = updated.state.sessions[SESSION_ID]?.messages[0];

    expect(message).toEqual({
      displayInput,
      id: `tool:${TURN_ID}:tool:long-multiline`,
      kind: "tool",
      result: inlineResult,
      status: "done",
      title: "Long multiline tool",
      toolCallId: "tool:long-multiline",
    });
    expect(message?.kind === "tool" ? message.displayInput : "").toBe(displayInput);
    expect(message?.kind === "tool" ? message.result : "").toBe(inlineResult);
  });

  it("deduplicates by eventId, ignores old frames, and reports forward gaps", () => {
    const initial = stateFromGlobalSnapshot(baseline({ include: true }));
    const first = applyEnvelope(
      initial,
      envelope(1, { from: null, status: "queued", type: "turn_state" }),
    );
    expect(first.kind).toBe("applied");
    const afterFirst = first.state;

    const duplicate = applyEnvelope(
      afterFirst,
      envelope(1, { from: null, status: "queued", type: "turn_state" }),
    );
    expect(duplicate).toMatchObject({ kind: "ignored", reason: "duplicate" });
    expect(duplicate.state).toBe(afterFirst);

    const second = applyEnvelope(
      afterFirst,
      envelope(2, { from: "queued", status: "starting", type: "turn_state" }),
    );
    expect(second.kind).toBe("applied");
    const old = applyEnvelope(
      second.state,
      envelope(1, { from: null, status: "queued", type: "turn_state" }, "different-old-event"),
    );
    expect(old).toMatchObject({ kind: "ignored", reason: "old" });

    const gap = applyEnvelope(
      second.state,
      envelope(4, { from: "starting", status: "running", type: "turn_state" }),
    );
    expect(gap).toMatchObject({ expectedSeq: 3, kind: "gap", receivedSeq: 4 });
    expect(gap.state).toBe(second.state);
  });

  it("buffers a local Session load and never assigns its cursor to the global baseline", () => {
    const initial = beginLocalSessionLoad(
      stateFromGlobalSnapshot(baseline({ seq: 2 })),
      SESSION_ID,
    );
    const live = applyEnvelope(
      initial,
      envelope(3, { messageId: "message:live", text: "live delta", type: "message_delta" }),
    );
    expect(live.kind).toBe("applied");
    expect(live.state.lastAppliedSeq).toBe(3);

    const localSnapshot: SessionSnapshot = SessionSnapshotSchema.parse({
      approvals: [],
      messages: [],
      session,
      sessionSnapshotSeq: 2,
      turns: [],
    });
    const completed = completeLocalSessionLoad(live.state, localSnapshot);
    expect(completed.lastAppliedSeq).toBe(3);
    expect(completed.sessions[SESSION_ID]?.messages).toEqual([
      {
        body: "live delta",
        id: "message:live",
        kind: "text",
        state: "streaming",
      },
    ]);
    expect(completed.localBuffers[SESSION_ID]).toBeUndefined();
  });

  it("requires a fresh global snapshot when a summarized Session first becomes active", () => {
    const initial = stateFromGlobalSnapshot(baseline());
    const result = applyEnvelope(
      initial,
      envelope(1, { from: null, status: "queued", type: "turn_state" }),
    );
    expect(result).toMatchObject({
      kind: "snapshot-required",
      sessionId: SESSION_ID,
      state: initial,
    });
  });

  it("advances seq but ignores late content after a cancelled Turn", () => {
    let state = stateFromGlobalSnapshot(baseline({ include: true }));
    for (const event of [
      envelope(1, { from: null, status: "queued", type: "turn_state" }),
      envelope(2, { from: "queued", status: "starting", type: "turn_state" }),
      envelope(3, { from: "starting", status: "running", type: "turn_state" }),
      envelope(4, { from: "running", status: "cancelling", type: "turn_state" }),
      envelope(5, {
        from: "cancelling",
        status: "cancelled",
        stopReason: "cancelled",
        type: "turn_end",
      }),
    ]) {
      const result = applyEnvelope(state, event);
      expect(result.kind).toBe("applied");
      state = result.state;
    }
    const late = applyEnvelope(
      state,
      envelope(6, { messageId: "message:late", text: "must not render", type: "message_delta" }),
    );
    expect(late.kind).toBe("applied");
    expect(late.state.lastAppliedSeq).toBe(6);
    expect(late.state.sessions[SESSION_ID]?.messages).toEqual([]);
  });

  it("keeps server approval options and terminal decisions attached to the rendered card", () => {
    let state = stateFromGlobalSnapshot(baseline({ include: true }));
    const requested = applyEnvelope(
      state,
      envelope(1, {
        description: "Run a bounded command",
        expiresAt: "2026-07-24T08:05:00.000Z",
        options: [
          { kind: "allow", label: "Allow once", optionId: "allow-once" },
          { kind: "reject", label: "Reject", optionId: "reject" },
        ],
        requestId: "approval:one",
        title: "Run command",
        type: "approval_request",
      }),
    );
    expect(requested.kind).toBe("applied");
    state = requested.state;
    expect(state.sessions[SESSION_ID]?.messages).toContainEqual({
      description: "Run a bounded command",
      id: `approval:${TURN_ID}:approval:one`,
      kind: "approval",
      options: [
        { kind: "allow", label: "Allow once", optionId: "allow-once" },
        { kind: "reject", label: "Reject", optionId: "reject" },
      ],
      requestId: "approval:one",
      status: "pending",
      title: "Run command",
      turnId: TURN_ID,
    });

    const resolved = applyEnvelope(
      state,
      envelope(2, {
        decision: { type: "reject" },
        requestId: "approval:one",
        status: "rejected",
        type: "approval_resolved",
      }),
    );
    expect(resolved.kind).toBe("applied");
    expect(resolved.state.sessions[SESSION_ID]?.messages).toContainEqual(
      expect.objectContaining({
        kind: "approval",
        requestId: "approval:one",
        status: "rejected",
      }),
    );
    expect(resolved.state.pendingApprovals).toEqual({});

    const secondRequest = applyEnvelope(
      resolved.state,
      envelope(3, {
        description: "This request expires",
        expiresAt: "2026-07-24T08:05:00.000Z",
        options: [{ kind: "reject", label: "Reject", optionId: "reject" }],
        requestId: "approval:expired",
        title: "Expired command",
        type: "approval_request",
      }),
    );
    expect(secondRequest.kind).toBe("applied");
    const expired = applyEnvelope(
      secondRequest.state,
      envelope(4, {
        decision: null,
        requestId: "approval:expired",
        status: "expired",
        type: "approval_resolved",
      }),
    );
    expect(expired.kind).toBe("applied");
    expect(expired.state.sessions[SESSION_ID]?.messages).toContainEqual(
      expect.objectContaining({
        kind: "approval",
        requestId: "approval:expired",
        status: "expired",
      }),
    );
  });
});
