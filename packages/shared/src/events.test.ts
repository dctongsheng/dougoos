import { describe, expect, it } from "vitest";

import {
  ACTIVE_TURN_STATUSES,
  AgentEventEnvelopeSchema,
  AgentRuntimeEventSchema,
  AgentUiEventSchema,
  ApprovalResolvedEventSchema,
  ApprovalSchema,
  MAX_DIFF_EVENT_UTF8_BYTES,
  TERMINAL_TURN_STATUSES,
  checkApprovalResolvedEvent,
  jsonUtf8ByteLength,
} from "./index.js";

const now = "2026-07-24T00:00:00.000Z";

const error = {
  code: "AGENT_PROCESS_CRASHED",
  message: "Agent process exited",
  retryable: true,
} as const;

const events = [
  {
    body: "Refactor auth",
    messageId: "message:user",
    type: "user_message",
  },
  {
    messageId: "message:text",
    text: "Working",
    type: "message_delta",
  },
  {
    messageId: "message:think",
    text: "Inspecting",
    type: "thought_delta",
  },
  {
    level: "info",
    messageId: "message:note",
    text: "Tests started",
    type: "note",
  },
  {
    kind: "read",
    status: "running",
    title: "Read file",
    toolCallId: "tool/call:1",
    type: "tool_call",
  },
  {
    result: { output: "done", type: "inline" },
    status: "done",
    toolCallId: "tool/call:1",
    type: "tool_update",
  },
  {
    diff: {
      newText: "new",
      oldText: "old",
      path: "src/a.ts",
      type: "inline",
    },
    messageId: "message:diff",
    type: "diff",
  },
  {
    expiresAt: "2026-07-24T01:00:00.000Z",
    options: [
      { kind: "allow", label: "Allow once", optionId: "allow/once" },
      { kind: "reject", label: "Reject", optionId: "reject" },
    ],
    requestId: "request/1",
    title: "Run command?",
    type: "approval_request",
  },
  {
    decision: { optionId: "allow/once", type: "option" },
    requestId: "request/1",
    status: "allowed",
    type: "approval_resolved",
  },
  {
    from: "queued",
    status: "starting",
    type: "turn_state",
  },
  {
    from: "running",
    status: "completed",
    stopReason: "end_turn",
    type: "turn_end",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      quality: "exact",
    },
  },
  {
    state: "idle",
    type: "session_state",
  },
  {
    error,
    type: "session_error",
  },
] as const;

describe("AgentUiEvent", () => {
  it("parses every strict normalized event member", () => {
    expect(events.map((event) => AgentUiEventSchema.parse(event).type)).toEqual([
      "user_message",
      "message_delta",
      "thought_delta",
      "note",
      "tool_call",
      "tool_update",
      "diff",
      "approval_request",
      "approval_resolved",
      "turn_state",
      "turn_end",
      "session_state",
      "session_error",
    ]);
  });

  it("rejects unknown event members, keys, status, and non-ISO expiry", () => {
    expect(AgentUiEventSchema.safeParse({ type: "raw_acp_update" }).success).toBe(false);
    expect(AgentUiEventSchema.safeParse({ ...events[1], _meta: { vendor: true } }).success).toBe(
      false,
    );
    expect(
      AgentUiEventSchema.safeParse({
        ...events[7],
        expiresAt: 1_721_779_200_000,
      }).success,
    ).toBe(false);
    expect(
      AgentUiEventSchema.safeParse({
        from: "running",
        status: "queued",
        type: "turn_state",
      }).success,
    ).toBe(false);
  });

  it("uses turn_state only for initial/nonterminal transitions and turn_end for terminal ones", () => {
    const nonterminal = [
      ["queued", "starting"],
      ["starting", "running"],
      ["running", "awaiting_approval"],
      ["running", "cancelling"],
      ["awaiting_approval", "running"],
      ["awaiting_approval", "cancelling"],
    ] as const;
    for (const [from, status] of nonterminal) {
      expect(
        AgentUiEventSchema.safeParse({
          from,
          status,
          type: "turn_state",
        }).success,
        `${from} -> ${status}`,
      ).toBe(true);
    }
    expect(
      AgentUiEventSchema.safeParse({
        from: null,
        status: "queued",
        type: "turn_state",
      }).success,
    ).toBe(true);
    for (const status of TERMINAL_TURN_STATUSES) {
      for (const from of ACTIVE_TURN_STATUSES) {
        expect(
          AgentUiEventSchema.safeParse({
            from,
            status,
            type: "turn_state",
          }).success,
        ).toBe(false);
      }
    }
    expect(
      AgentUiEventSchema.safeParse({
        from: "running",
        status: "completed",
        stopReason: "end_turn",
        type: "turn_end",
      }).success,
    ).toBe(true);
    expect(
      AgentUiEventSchema.safeParse({
        from: "running",
        status: "completed",
        stopReason: "max_turn_requests",
        type: "turn_end",
      }).success,
    ).toBe(true);
    expect(
      AgentUiEventSchema.safeParse({
        error,
        from: "running",
        status: "failed",
        stopReason: "error",
        type: "turn_end",
      }).success,
    ).toBe(true);
    for (const from of ["starting", "awaiting_approval", "cancelling"] as const) {
      expect(
        AgentUiEventSchema.safeParse({
          error,
          from,
          status: "failed",
          stopReason: "error",
          type: "turn_end",
        }).success,
        `${from} -> failed`,
      ).toBe(false);
    }
    expect(
      AgentUiEventSchema.safeParse({
        from: "queued",
        status: "interrupted",
        stopReason: "interrupted",
        type: "turn_end",
      }).success,
    ).toBe(true);
  });

  it("prevents a late transition from reviving terminal state", () => {
    expect(
      AgentUiEventSchema.safeParse({
        from: "queued",
        status: "completed",
        stopReason: "end_turn",
        type: "turn_end",
      }).success,
    ).toBe(false);
    expect(
      AgentUiEventSchema.safeParse({
        from: "cancelling",
        status: "completed",
        stopReason: "end_turn",
        type: "turn_end",
      }).success,
    ).toBe(false);
  });

  it("enforces the full serialized diff event at exactly 1 MiB", () => {
    const shell = {
      diff: { newText: "", oldText: null, path: "x", type: "inline" },
      messageId: "message:diff-limit",
      type: "diff",
    } as const;
    const overhead = jsonUtf8ByteLength(shell);
    const exact = {
      ...shell,
      diff: {
        ...shell.diff,
        newText: "a".repeat(MAX_DIFF_EVENT_UTF8_BYTES - overhead),
      },
    };
    expect(jsonUtf8ByteLength(exact)).toBe(MAX_DIFF_EVENT_UTF8_BYTES);
    expect(AgentUiEventSchema.safeParse(exact).success).toBe(true);
    expect(
      AgentUiEventSchema.safeParse({
        ...exact,
        diff: { ...exact.diff, newText: `${exact.diff.newText}a` },
      }).success,
    ).toBe(false);
  });

  it("checks approval request identity, one-shot state, membership, and status", () => {
    const approval = ApprovalSchema.parse({
      decision: null,
      expiresAt: "2026-07-24T01:00:00.000Z",
      id: "approval:1",
      options: [
        { kind: "allow", label: "Allow once", optionId: "allow/once" },
        { kind: "reject", label: "Reject", optionId: "reject" },
      ],
      requestId: "request/1",
      resolvedAt: null,
      sessionId: "session:one",
      status: "pending",
      title: "Run command?",
      turnId: "turn:one",
    });
    expect(
      checkApprovalResolvedEvent(approval, ApprovalResolvedEventSchema.parse(events[8])),
    ).toEqual({ ok: true });
    expect(
      checkApprovalResolvedEvent(approval, {
        decision: { optionId: "unknown", type: "option" },
        requestId: "request/1",
        status: "allowed",
        type: "approval_resolved",
      }),
    ).toEqual({ code: "APPROVAL_OPTION_INVALID", ok: false });
    expect(
      checkApprovalResolvedEvent(approval, {
        decision: { optionId: "reject", type: "option" },
        requestId: "request/1",
        status: "allowed",
        type: "approval_resolved",
      }),
    ).toEqual({ code: "APPROVAL_STATUS_MISMATCH", ok: false });
  });
});

describe("AgentRuntimeEvent and AgentEventEnvelope v1", () => {
  it("keeps runtime events unsequenced and upgrades only in the envelope", () => {
    const runtime = {
      event: events[1],
      occurredAt: now,
      sessionId: "session:one",
      turnId: "turn:one",
    };
    expect(AgentRuntimeEventSchema.parse(runtime)).toEqual(runtime);
    for (const forbidden of [
      { eventId: "event:one" },
      { seq: 1 },
      { v: 1 },
      { _meta: {} },
      { rawAcpEnvelope: {} },
    ]) {
      expect(AgentRuntimeEventSchema.safeParse({ ...runtime, ...forbidden }).success).toBe(false);
    }
  });

  it("requires turnId for turn-scoped events but permits session-scoped null", () => {
    expect(
      AgentRuntimeEventSchema.safeParse({
        event: events[0],
        occurredAt: now,
        sessionId: "session:one",
        turnId: null,
      }).success,
    ).toBe(false);
    expect(
      AgentRuntimeEventSchema.safeParse({
        event: { state: "idle", type: "session_state" },
        occurredAt: now,
        sessionId: "session:one",
        turnId: null,
      }).success,
    ).toBe(true);
  });

  it("round-trips a v1 envelope with seq 1 through JSON", () => {
    const envelope = {
      event: events[1],
      eventId: "event:one",
      occurredAt: now,
      seq: 1,
      sessionId: "session:one",
      turnId: "turn:one",
      v: 1,
    };
    const parsed = AgentEventEnvelopeSchema.parse(JSON.parse(JSON.stringify(envelope)) as unknown);
    expect(parsed).toEqual(envelope);
  });

  it("rejects unknown versions and every unsafe seq shape", () => {
    const envelope = {
      event: events[1],
      eventId: "event:one",
      occurredAt: now,
      seq: 1,
      sessionId: "session:one",
      turnId: "turn:one",
      v: 1,
    };
    for (const v of [0, 2, "1"]) {
      expect(AgentEventEnvelopeSchema.safeParse({ ...envelope, v }).success).toBe(false);
    }
    for (const seq of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(AgentEventEnvelopeSchema.safeParse({ ...envelope, seq }).success).toBe(false);
    }
  });

  it("rejects raw ACP/private fields at every envelope boundary", () => {
    const envelope = {
      event: events[1],
      eventId: "event:one",
      occurredAt: now,
      seq: 1,
      sessionId: "session:one",
      turnId: "turn:one",
      v: 1,
    };
    expect(
      AgentEventEnvelopeSchema.safeParse({ ...envelope, _meta: { vendor: true } }).success,
    ).toBe(false);
    expect(
      AgentEventEnvelopeSchema.safeParse({
        ...envelope,
        event: { ...events[1], rawAcpEnvelope: {} },
      }).success,
    ).toBe(false);
  });
});
