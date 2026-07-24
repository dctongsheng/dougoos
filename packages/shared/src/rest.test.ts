import { describe, expect, it } from "vitest";

import {
  ApiErrorResponseSchema,
  CancelTurnRequestSchema,
  CancelTurnResponseSchema,
  CONTRACT_LIMITS,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  CreateTurnRequestSchema,
  CreateTurnResponseSchema,
  DeviceIdentityResponseSchema,
  EventStreamQuerySchema,
  GlobalSnapshotSchema,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  ListProvidersResponseSchema,
  ReplayGapErrorResponseSchema,
  ResolveApprovalRequestSchema,
  ResolveApprovalResponseSchema,
  SafeDiagnosticDetailsSchema,
  SessionBusyErrorResponseSchema,
  SessionSnapshotSchema,
  SnapshotQuerySchema,
  checkGlobalSnapshotCoverage,
  parseEventStreamAfterSeq,
  redactDiagnosticText,
  utf8ByteLength,
} from "./index.js";

const now = "2026-07-24T00:00:00.000Z";
const later = "2026-07-24T00:01:00.000Z";
const expires = "2026-07-24T01:00:00.000Z";

const capability = {
  clientProxy: { config: false, fileSystem: false, terminal: false },
  negotiatedAt: now,
  permissionEnforcement: "requests_permission",
  protocolVersion: "1",
  session: { close: false, delete: false, list: false, load: false, resume: false },
  turn: { cancel: true, images: false, prompt: true },
} as const;

const session = {
  capabilities: capability,
  createdAt: now,
  cwd: "/tmp/project",
  id: "session:one",
  providerId: "codex",
  providerSessionId: "provider/session:opaque",
  source: "dougoos-acp",
  state: "awaiting_approval",
  title: "Session one",
  updatedAt: later,
} as const;

const turn = {
  clientRequestId: "client/request:one",
  createdAt: now,
  endedAt: null,
  error: null,
  id: "turn:one",
  sessionId: session.id,
  startedAt: now,
  status: "awaiting_approval",
  stopReason: null,
} as const;

const approval = {
  decision: null,
  expiresAt: expires,
  id: "approval:one",
  options: [
    { kind: "allow", label: "Allow once", optionId: "allow/once" },
    { kind: "reject", label: "Reject", optionId: "reject" },
  ],
  requestId: "request/one",
  resolvedAt: null,
  sessionId: session.id,
  status: "pending",
  title: "Run command?",
  turnId: turn.id,
} as const;

const message = {
  createdAt: now,
  id: "message:approval",
  kind: "approval",
  requestId: approval.requestId,
  sessionId: session.id,
  turnId: turn.id,
} as const;

const sessionSnapshot = {
  approvals: [approval],
  messages: [message],
  session,
  sessionSnapshotSeq: 0,
  turns: [turn],
} as const;

const globalSnapshot = {
  activeTurns: [turn],
  includedSessions: [sessionSnapshot],
  pendingApprovals: [approval],
  sessions: [
    {
      activeTurnId: turn.id,
      cwd: session.cwd,
      id: session.id,
      messageCount: 1,
      providerId: session.providerId,
      state: "awaiting_approval",
      title: session.title,
      updatedAt: session.updatedAt,
    },
  ],
  snapshotSeq: 0,
} as const;

function promptPartsForUtf8Bytes(totalBytes: number) {
  const parts: { text: string; type: "text" }[] = [];
  let remaining = totalBytes;
  while (remaining > 0) {
    const size = Math.min(remaining, CONTRACT_LIMITS.promptChars);
    parts.push({ text: "x".repeat(size), type: "text" });
    remaining -= size;
  }
  return parts;
}

describe("REST request and response DTOs", () => {
  it("parses health responses without leaking readiness internals", () => {
    expect(
      HealthLiveResponseSchema.safeParse({
        checkedAt: now,
        instanceId: "instance:one",
        status: "live",
      }).success,
    ).toBe(true);
    expect(
      HealthReadyResponseSchema.safeParse({
        checkedAt: now,
        instanceId: "instance:one",
        status: "ready",
      }).success,
    ).toBe(true);
    expect(
      HealthReadyResponseSchema.safeParse({
        checkedAt: now,
        code: "CORE_NOT_READY",
        status: "not_ready",
      }).success,
    ).toBe(true);
    expect(
      HealthReadyResponseSchema.safeParse({
        checkedAt: now,
        code: "CORE_NOT_READY",
        migrationPath: "/Users/person/data.db",
        status: "not_ready",
      }).success,
    ).toBe(false);
  });

  it("parses strict unversioned provider and session DTOs", () => {
    const provider = {
      capabilities: capability,
      checkedAt: now,
      displayName: "Codex",
      id: "codex",
      processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
      status: "available",
      version: "2.1.0",
    } as const;
    expect(ListProvidersResponseSchema.safeParse({ providers: [provider] }).success).toBe(true);
    expect(
      CreateSessionRequestSchema.safeParse({
        cwd: "/tmp/project",
        providerId: "codex",
      }).success,
    ).toBe(true);
    expect(CreateSessionResponseSchema.safeParse({ session }).success).toBe(true);
    expect(
      CreateSessionRequestSchema.safeParse({
        cwd: "/tmp/project",
        providerId: "codex",
        unknown: true,
      }).success,
    ).toBe(false);

    const providers = Array.from({ length: CONTRACT_LIMITS.providers }, (_, index) => ({
      ...provider,
      id: `provider-${index}`,
    }));
    expect(ListProvidersResponseSchema.safeParse({ providers }).success).toBe(true);
    expect(
      ListProvidersResponseSchema.safeParse({
        providers: [...providers, { ...provider, id: "provider-extra" }],
      }).success,
    ).toBe(false);
  });

  it("accepts only P1 text content and enforces prompt boundary plus one", () => {
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/one",
        content: [{ text: "x".repeat(CONTRACT_LIMITS.promptChars), type: "text" }],
      }).success,
    ).toBe(true);
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/one",
        content: [{ text: "x".repeat(CONTRACT_LIMITS.promptChars + 1), type: "text" }],
      }).success,
    ).toBe(false);

    const maximumParts = Array.from(
      { length: CONTRACT_LIMITS.promptContentParts },
      () => ({ text: "x", type: "text" }) as const,
    );
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/one",
        content: maximumParts,
      }).success,
    ).toBe(true);
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/one",
        content: [...maximumParts, { text: "x", type: "text" }],
      }).success,
    ).toBe(false);

    const exact = promptPartsForUtf8Bytes(CONTRACT_LIMITS.promptUtf8Bytes);
    expect(exact.length).toBeLessThanOrEqual(CONTRACT_LIMITS.promptContentParts);
    expect(exact.reduce((total, part) => total + utf8ByteLength(part.text), 0)).toBe(
      CONTRACT_LIMITS.promptUtf8Bytes,
    );
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/one",
        content: exact,
      }).success,
    ).toBe(true);
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/one",
        content: [...exact, { text: "x", type: "text" }],
      }).success,
    ).toBe(false);
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/one",
        content: [{ image: { artifactId: "artifact:one" }, type: "image" }],
      }).success,
    ).toBe(false);
    expect(
      CreateTurnRequestSchema.safeParse({
        clientRequestId: "request/multiline",
        content: [{ text: "first line\n\tsecond line", type: "text" }],
      }).success,
    ).toBe(true);
  });

  it("round-trips turn, cancel, and non-null approval acknowledgements", () => {
    const values = [
      [CreateTurnResponseSchema, { turnId: turn.id }],
      [CancelTurnRequestSchema, {}],
      [CancelTurnResponseSchema, { accepted: true, status: "cancelling", turnId: turn.id }],
      [ResolveApprovalRequestSchema, { optionId: "allow/once" }],
      [ResolveApprovalResponseSchema, { accepted: true, requestId: approval.requestId }],
    ] as const;
    for (const [schema, value] of values) {
      expect(schema.parse(JSON.parse(JSON.stringify(value)) as unknown)).toEqual(value);
    }
    expect(ResolveApprovalRequestSchema.safeParse({ optionId: null }).success).toBe(false);
    expect(
      ResolveApprovalRequestSchema.safeParse({ optionId: "unknown", rawDecision: {} }).success,
    ).toBe(false);
  });

  it("rejects stray version fields on unversioned REST bodies", () => {
    const samples = [
      [CreateSessionRequestSchema, { cwd: "/tmp/project", providerId: "codex" }],
      [
        CreateTurnRequestSchema,
        { clientRequestId: "request/one", content: [{ text: "hello", type: "text" }] },
      ],
      [CancelTurnRequestSchema, {}],
      [ResolveApprovalRequestSchema, { optionId: "reject" }],
    ] as const;
    for (const [schema, body] of samples) {
      expect(schema.safeParse({ ...body, v: 0 }).success).toBe(false);
      expect(schema.safeParse({ ...body, v: 2 }).success).toBe(false);
    }
  });
});

describe("snapshot cursor and ownership invariants", () => {
  it("accepts a local SessionSnapshot with cursor zero", () => {
    expect(SessionSnapshotSchema.parse(sessionSnapshot)).toEqual(sessionSnapshot);
  });

  it("rejects duplicate or cross-session read-model references", () => {
    expect(
      SessionSnapshotSchema.safeParse({
        ...sessionSnapshot,
        messages: [{ ...message, turnId: "turn:missing" }],
      }).success,
    ).toBe(false);
    expect(
      SessionSnapshotSchema.safeParse({
        ...sessionSnapshot,
        messages: [message, message],
      }).success,
    ).toBe(false);
  });

  it("treats approval identity as sessionId + turnId + requestId", () => {
    const completedTurn = {
      ...turn,
      endedAt: later,
      status: "completed",
      stopReason: "end_turn",
    } as const;
    const secondTurn = {
      ...completedTurn,
      clientRequestId: "client/request:two",
      id: "turn:two",
    } as const;
    const resolvedApproval = {
      ...approval,
      decision: { optionId: "allow/once", type: "option" },
      resolvedAt: later,
      status: "allowed",
    } as const;
    const repeatedRequest = {
      ...resolvedApproval,
      id: "approval:two",
      turnId: secondTurn.id,
    } as const;
    const historical = {
      approvals: [resolvedApproval, repeatedRequest],
      messages: [
        { ...message, id: "message:approval-one" },
        {
          ...message,
          id: "message:approval-two",
          turnId: secondTurn.id,
        },
      ],
      session: { ...session, state: "idle" },
      sessionSnapshotSeq: 0,
      turns: [completedTurn, secondTurn],
    } as const;
    expect(SessionSnapshotSchema.safeParse(historical).success).toBe(true);
    expect(
      SessionSnapshotSchema.safeParse({
        ...historical,
        approvals: [resolvedApproval, { ...repeatedRequest, turnId: completedTurn.id }],
        messages: [],
      }).success,
    ).toBe(false);
    expect(
      SessionSnapshotSchema.safeParse({
        ...historical,
        approvals: [resolvedApproval, { ...repeatedRequest, id: resolvedApproval.id }],
        messages: [],
      }).success,
    ).toBe(false);
  });

  it("bounds approval history independently from the pending index", () => {
    const completedTurn = {
      ...turn,
      endedAt: later,
      status: "completed",
      stopReason: "end_turn",
    } as const;
    const approvals = Array.from(
      { length: CONTRACT_LIMITS.approvalsPerSessionSnapshot },
      (_, index) => ({
        ...approval,
        id: `approval:history:${index}`,
        requestId: `request/history/${index}`,
        resolvedAt: later,
        status: "cancelled" as const,
      }),
    );
    const snapshot = {
      approvals,
      messages: [],
      session: { ...session, state: "idle" as const },
      sessionSnapshotSeq: 0,
      turns: [completedTurn],
    };
    expect(SessionSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      SessionSnapshotSchema.safeParse({
        ...snapshot,
        approvals: [
          ...approvals,
          {
            ...approval,
            id: "approval:history:extra",
            requestId: "request/history/extra",
            resolvedAt: later,
            status: "cancelled",
          },
        ],
      }).success,
    ).toBe(false);
    expect(CONTRACT_LIMITS.activeSessions + CONTRACT_LIMITS.requestedSessions).toBeLessThanOrEqual(
      CONTRACT_LIMITS.includedSessions,
    );
  });

  it("accepts a full GlobalSnapshot baseline at zero", () => {
    expect(GlobalSnapshotSchema.parse(globalSnapshot)).toEqual(globalSnapshot);
  });

  it("allows the same opaque approval requestId in different Turn routes", () => {
    const secondSession = {
      ...session,
      id: "session:two",
      providerSessionId: "provider/session:two",
      title: "Session two",
    } as const;
    const secondTurn = {
      ...turn,
      clientRequestId: "client/request:two",
      id: "turn:two",
      sessionId: secondSession.id,
    } as const;
    const secondApproval = {
      ...approval,
      id: "approval:two",
      sessionId: secondSession.id,
      turnId: secondTurn.id,
    } as const;
    const secondSnapshot = {
      approvals: [secondApproval],
      messages: [
        {
          ...message,
          id: "message:approval-two",
          sessionId: secondSession.id,
          turnId: secondTurn.id,
        },
      ],
      session: secondSession,
      sessionSnapshotSeq: 0,
      turns: [secondTurn],
    } as const;
    expect(
      GlobalSnapshotSchema.safeParse({
        activeTurns: [turn, secondTurn],
        includedSessions: [sessionSnapshot, secondSnapshot],
        pendingApprovals: [approval, secondApproval],
        sessions: [
          globalSnapshot.sessions[0],
          {
            activeTurnId: secondTurn.id,
            cwd: secondSession.cwd,
            id: secondSession.id,
            messageCount: 1,
            providerId: secondSession.providerId,
            state: "awaiting_approval",
            title: secondSession.title,
            updatedAt: secondSession.updatedAt,
          },
        ],
        snapshotSeq: 0,
      }).success,
    ).toBe(true);
    expect(
      GlobalSnapshotSchema.safeParse({
        activeTurns: [turn, secondTurn],
        includedSessions: [
          sessionSnapshot,
          {
            ...secondSnapshot,
            approvals: [{ ...secondApproval, id: approval.id }],
          },
        ],
        pendingApprovals: [approval, { ...secondApproval, id: approval.id }],
        sessions: [
          globalSnapshot.sessions[0],
          {
            activeTurnId: secondTurn.id,
            cwd: secondSession.cwd,
            id: secondSession.id,
            messageCount: 1,
            providerId: secondSession.providerId,
            state: "awaiting_approval",
            title: secondSession.title,
            updatedAt: secondSession.updatedAt,
          },
        ],
        snapshotSeq: 0,
      }).success,
    ).toBe(false);
  });

  it("cannot mask an omitted active Turn with a colliding id from another Session", () => {
    const otherSession = {
      ...session,
      id: "session:collision",
      providerSessionId: "provider/session:collision",
      state: "idle",
      title: "Collision Session",
    } as const;
    const collidingTurn = {
      ...turn,
      clientRequestId: "client/request:collision",
      sessionId: otherSession.id,
      startedAt: null,
      status: "queued",
    } as const;
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        includedSessions: [
          sessionSnapshot,
          {
            approvals: [],
            messages: [],
            session: otherSession,
            sessionSnapshotSeq: 0,
            turns: [collidingTurn],
          },
        ],
        sessions: [
          globalSnapshot.sessions[0],
          {
            activeTurnId: null,
            cwd: otherSession.cwd,
            id: otherSession.id,
            messageCount: 0,
            providerId: otherSession.providerId,
            state: "idle",
            title: otherSession.title,
            updatedAt: otherSession.updatedAt,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces the active Session operational boundary before snapshot capacity", () => {
    const makeActive = (index: number) => {
      const activeSession = {
        ...session,
        id: `session:active:${index}`,
        providerSessionId: `provider/session:${index}`,
        state: "running" as const,
        title: `Session ${index}`,
      };
      const activeTurn = {
        ...turn,
        clientRequestId: `client/request:${index}`,
        id: `turn:active:${index}`,
        sessionId: activeSession.id,
        status: "running" as const,
      };
      return {
        included: {
          approvals: [],
          messages: [],
          session: activeSession,
          sessionSnapshotSeq: 0,
          turns: [activeTurn],
        },
        summary: {
          activeTurnId: activeTurn.id,
          cwd: activeSession.cwd,
          id: activeSession.id,
          messageCount: 0,
          providerId: activeSession.providerId,
          state: "running" as const,
          title: activeSession.title,
          updatedAt: activeSession.updatedAt,
        },
        turn: activeTurn,
      };
    };
    const active = Array.from({ length: CONTRACT_LIMITS.activeSessions }, (_, index) =>
      makeActive(index),
    );
    const snapshot = {
      activeTurns: active.map((item) => item.turn),
      includedSessions: active.map((item) => item.included),
      pendingApprovals: [],
      sessions: active.map((item) => item.summary),
      snapshotSeq: 0,
    };
    expect(GlobalSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const extra = makeActive(CONTRACT_LIMITS.activeSessions);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...snapshot,
        activeTurns: [...snapshot.activeTurns, extra.turn],
        includedSessions: [...snapshot.includedSessions, extra.included],
        sessions: [...snapshot.sessions, extra.summary],
      }).success,
    ).toBe(false);
  });

  it("bounds the current pending Approval index independently", () => {
    const pending = Array.from({ length: CONTRACT_LIMITS.maxPendingApprovals }, (_, index) => ({
      ...approval,
      id: `approval:pending:${index}`,
      requestId: `request/pending/${index}`,
    }));
    const included = {
      ...sessionSnapshot,
      approvals: pending,
      messages: [],
    };
    const snapshot = {
      ...globalSnapshot,
      includedSessions: [included],
      pendingApprovals: pending,
      sessions: [{ ...globalSnapshot.sessions[0], messageCount: 0 }],
    };
    expect(GlobalSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const extra = {
      ...approval,
      id: "approval:pending:extra",
      requestId: "request/pending/extra",
    };
    expect(
      GlobalSnapshotSchema.safeParse({
        ...snapshot,
        includedSessions: [
          {
            ...included,
            approvals: [...pending, extra],
          },
        ],
        pendingApprovals: [...pending, extra],
      }).success,
    ).toBe(false);
  });

  it("keeps global snapshotSeq distinct from local sessionSnapshotSeq", () => {
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        includedSessions: [{ ...sessionSnapshot, sessionSnapshotSeq: 1 }],
      }).success,
    ).toBe(false);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        sessionSnapshotSeq: 0,
      }).success,
    ).toBe(false);
  });

  it("requires active Turn Sessions and pending approvals to be included", () => {
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        includedSessions: [],
      }).success,
    ).toBe(false);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        pendingApprovals: [{ ...approval, status: "cancelled", resolvedAt: later }],
      }).success,
    ).toBe(false);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        activeTurns: [],
      }).success,
    ).toBe(false);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        pendingApprovals: [],
      }).success,
    ).toBe(false);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        activeTurns: [{ ...turn, clientRequestId: "different" }],
      }).success,
    ).toBe(false);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        sessions: [{ ...globalSnapshot.sessions[0], cwd: "/tmp/contradiction" }],
      }).success,
    ).toBe(false);
    expect(
      GlobalSnapshotSchema.safeParse({
        ...globalSnapshot,
        sessions: [
          {
            ...globalSnapshot.sessions[0],
            updatedAt: "2026-07-24T00:02:00.000Z",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("maps queued/starting Turns to initialized idle Sessions only", () => {
    const queuedTurn = {
      ...turn,
      startedAt: null,
      status: "queued",
    } as const;
    const queuedSession = { ...session, state: "idle" } as const;
    const queuedIncluded = {
      approvals: [],
      messages: [],
      session: queuedSession,
      sessionSnapshotSeq: 0,
      turns: [queuedTurn],
    } as const;
    expect(
      GlobalSnapshotSchema.safeParse({
        activeTurns: [queuedTurn],
        includedSessions: [queuedIncluded],
        pendingApprovals: [],
        sessions: [
          {
            activeTurnId: queuedTurn.id,
            cwd: queuedSession.cwd,
            id: queuedSession.id,
            messageCount: 0,
            providerId: queuedSession.providerId,
            state: "idle",
            title: queuedSession.title,
            updatedAt: queuedSession.updatedAt,
          },
        ],
        snapshotSeq: 0,
      }).success,
    ).toBe(true);

    const startingTurn = { ...queuedTurn, status: "starting" } as const;
    const startingSession = queuedSession;
    const startingIncluded = {
      ...queuedIncluded,
      session: startingSession,
      turns: [startingTurn],
    } as const;
    expect(
      GlobalSnapshotSchema.safeParse({
        activeTurns: [startingTurn],
        includedSessions: [startingIncluded],
        pendingApprovals: [],
        sessions: [
          {
            activeTurnId: startingTurn.id,
            cwd: startingSession.cwd,
            id: startingSession.id,
            messageCount: 0,
            providerId: startingSession.providerId,
            state: "idle",
            title: startingSession.title,
            updatedAt: startingSession.updatedAt,
          },
        ],
        snapshotSeq: 0,
      }).success,
    ).toBe(true);

    const uninitializedSession = {
      ...session,
      capabilities: null,
      providerSessionId: null,
      state: "starting",
    } as const;
    const uninitializedIncluded = {
      approvals: [],
      messages: [],
      session: uninitializedSession,
      sessionSnapshotSeq: 0,
      turns: [],
    } as const;
    expect(SessionSnapshotSchema.safeParse(uninitializedIncluded).success).toBe(true);
    expect(
      SessionSnapshotSchema.safeParse({
        ...uninitializedIncluded,
        turns: [startingTurn],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate repeated includeSessionId values", () => {
    expect(SnapshotQuerySchema.parse({})).toEqual({ includeSessionId: [] });
    expect(SnapshotQuerySchema.safeParse({ includeSessionId: ["session:one"] }).success).toBe(true);
    expect(
      SnapshotQuerySchema.safeParse({
        includeSessionId: ["session:one", "session:one"],
      }).success,
    ).toBe(false);
    const maximum = Array.from(
      { length: CONTRACT_LIMITS.requestedSessions },
      (_, index) => `session:${index}`,
    );
    expect(SnapshotQuerySchema.safeParse({ includeSessionId: maximum }).success).toBe(true);
    expect(
      SnapshotQuerySchema.safeParse({
        includeSessionId: [...maximum, "session:extra"],
      }).success,
    ).toBe(false);
    expect(
      checkGlobalSnapshotCoverage(
        GlobalSnapshotSchema.parse(globalSnapshot),
        SnapshotQuerySchema.parse({ includeSessionId: [session.id] }),
      ),
    ).toEqual({ ok: true });
    expect(
      checkGlobalSnapshotCoverage(
        GlobalSnapshotSchema.parse(globalSnapshot),
        SnapshotQuerySchema.parse({ includeSessionId: ["session:missing"] }),
      ),
    ).toEqual({ missingSessionIds: ["session:missing"], ok: false });
  });
});

describe("fetch-SSE cursor and structured errors", () => {
  it("accepts only canonical safe unsigned decimal cursor strings", () => {
    for (const afterSeq of ["0", "1", String(Number.MAX_SAFE_INTEGER)]) {
      const query = EventStreamQuerySchema.parse({ afterSeq });
      expect(Number(parseEventStreamAfterSeq(query))).toBe(Number(afterSeq));
    }
    for (const afterSeq of [
      "",
      "01",
      "-1",
      "1.0",
      "1e3",
      " 1",
      String(Number.MAX_SAFE_INTEGER + 1),
    ]) {
      expect(EventStreamQuerySchema.safeParse({ afterSeq }).success).toBe(false);
    }
  });

  it("validates REPLAY_GAP and SESSION_BUSY by code, not HTTP status alone", () => {
    expect(
      ReplayGapErrorResponseSchema.safeParse({
        code: "REPLAY_GAP",
        latestSeq: 100,
        message: "Replay cursor is outside retention",
        minAvailableSeq: 50,
        retryable: true,
      }).success,
    ).toBe(true);
    expect(
      ReplayGapErrorResponseSchema.safeParse({
        code: "REPLAY_GAP",
        latestSeq: 49,
        message: "Replay cursor is outside retention",
        minAvailableSeq: 50,
        retryable: true,
      }).success,
    ).toBe(false);
    expect(
      SessionBusyErrorResponseSchema.safeParse({
        activeTurnId: turn.id,
        code: "SESSION_BUSY",
        message: "Session already has an active Turn",
        retryable: true,
        sessionId: session.id,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed, oversized, unknown-key, and privacy-unsafe errors", () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "INVALID_REQUEST",
        details: { field: "providerId" },
        message: "Invalid request",
        retryable: false,
      }).success,
    ).toBe(true);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "ACTIVE_SESSION_LIMIT_REACHED",
        details: {
          actual: CONTRACT_LIMITS.activeSessions + 1,
          limit: CONTRACT_LIMITS.activeSessions,
          operation: "create_turn",
        },
        message: "Active Session capacity reached",
        retryable: true,
      }).success,
    ).toBe(true);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "SNAPSHOT_LIMIT_EXCEEDED",
        details: {
          actual: CONTRACT_LIMITS.approvalsPerSessionSnapshot + 1,
          limit: CONTRACT_LIMITS.approvalsPerSessionSnapshot,
          operation: "load_snapshot",
        },
        message: "Session snapshot approval history exceeds the operational limit",
        retryable: false,
      }).success,
    ).toBe(true);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "invalid request",
        message: "Invalid request",
        retryable: false,
      }).success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "REPLAY_GAP",
        message: "Replay gap",
        retryable: true,
      }).success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "INTERNAL_ERROR",
        message: "Invalid request",
        retryable: false,
      }).success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "INTERNAL_ERROR",
        message: "Please refactor authentication",
        retryable: false,
      }).success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        retryable: false,
        stack: "Error at /Users/person/project",
      }).success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.safeParse({
        code: "INVALID_REQUEST",
        details: { note: "x".repeat(CONTRACT_LIMITS.detailsBytes + 1) },
        message: "Invalid request",
        retryable: false,
      }).success,
    ).toBe(false);
    expect(
      SafeDiagnosticDetailsSchema.safeParse({
        actual: 3,
        attempt: 2,
        capability: "turn.cancel",
        exitCode: 1,
        expected: true,
        field: "providerId",
        httpStatus: 503,
        limit: 4,
        operation: "doctor",
        phase: "provider_doctor",
        providerId: "codex",
        retryAfterMs: 1000,
        signal: "SIGTERM",
        status: "unavailable",
        version: "2.1.0",
      }).success,
    ).toBe(true);
  });

  it("rejects every documented secret/path diagnostic signature", () => {
    const unsafe = [
      "-----BEGIN PRIVATE KEY----- abc",
      "sk-secretvalue",
      "ghp_secretvalue",
      "gh_secretvalue",
      "AIzaSecretValue",
      "Bearer abc.def",
      "password=hunter2",
      "secret: value",
      "/Users/alice/project",
      "/home/alice/project",
      "C:\\Users\\alice\\project",
    ];
    for (const value of unsafe) {
      expect(SafeDiagnosticDetailsSchema.safeParse({ note: value }).success, value).toBe(false);
      expect(
        ApiErrorResponseSchema.safeParse({
          code: "INTERNAL_ERROR",
          message: value,
          retryable: false,
        }).success,
        value,
      ).toBe(false);
    }
    for (const key of [
      "prompt",
      "message_text",
      "tool_output",
      "cwd",
      "file_path",
      "api_key",
      "token",
      "env_value",
      "account_id",
      "apiKey",
      "gitRemote",
      "systemPrompt",
      "toolInput",
      "messageText",
      "accountId",
      "rawAcp",
      "acpEnvelope",
      "context",
      "credential",
      "privateKey",
      "sshKey",
      "accessKey",
      "authorization",
      "cookie",
      "email",
      "userId",
    ]) {
      expect(SafeDiagnosticDetailsSchema.safeParse({ [key]: "value" }).success).toBe(false);
    }
    expect(
      SafeDiagnosticDetailsSchema.safeParse({
        version: "/Users/alice/private-build",
      }).success,
    ).toBe(false);
  });

  it("provides redaction only as a fallback after strict allowlisting", () => {
    const redacted = redactDiagnosticText(
      "Bearer abc sk-secret password=hunter2 /Users/alice/project file:///tmp/a C:\\private\\b \\\\server\\share\\c",
    );
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("sk-secret");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("file://");
    expect(redacted).not.toContain("C:\\private");
    expect(redacted).not.toContain("server\\share");
    expect(redacted).toContain("~/project");
  });
});

describe("pseudonymous resettable device identity", () => {
  it("accepts only UUIDv4 and never labels device_id anonymous", () => {
    const value = {
      classification: "pseudonymous",
      deviceId: "123e4567-e89b-42d3-a456-426614174000",
      resettable: true,
    } as const;
    expect(DeviceIdentityResponseSchema.safeParse(value).success).toBe(true);
    expect(
      DeviceIdentityResponseSchema.safeParse({
        ...value,
        classification: "anonymous",
      }).success,
    ).toBe(false);
    expect(
      DeviceIdentityResponseSchema.safeParse({
        ...value,
        deviceId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});
