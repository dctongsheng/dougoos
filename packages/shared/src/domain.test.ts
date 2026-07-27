import { describe, expect, it } from "vitest";

import {
  ACTIVE_TURN_STATUSES,
  ApprovalDecisionSchema,
  ApprovalOptionsSchema,
  ApprovalSchema,
  CONTRACT_LIMITS,
  DiffPayloadSchema,
  MAX_DIFF_EVENT_UTF8_BYTES,
  MAX_TOOL_OUTPUT_CHARS,
  MessageSchema,
  ProviderCapabilitySnapshotSchema,
  ProviderDoctorResultSchema,
  ProviderSchema,
  SessionSchema,
  TERMINAL_TURN_STATUSES,
  ToolMessageSchema,
  TurnSchema,
  checkApprovalDecision,
  isActiveTurnStatus,
  isTerminalTurnStatus,
  isTurnTransitionAllowed,
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
  permission: {
    effectiveProfileId: "ask",
    mechanism: "launch",
    permissionEnforcement: "requests_permission",
    requestedProfileId: "ask",
  },
  providerId: "codex",
  providerSessionId: "opaque/provider:id?yes",
  source: "dougoos-acp",
  state: "idle",
  title: "Session one",
  updatedAt: later,
} as const;

const pendingApproval = {
  decision: null,
  expiresAt: expires,
  id: "approval:one",
  options: [
    { kind: "allow", label: "Allow once", optionId: "allow/once" },
    { kind: "reject", label: "Reject", optionId: "reject now" },
  ],
  requestId: "request/opaque?1",
  resolvedAt: null,
  sessionId: "session:one",
  status: "pending",
  title: "Run migration?",
  turnId: "turn:one",
} as const;

const messageBase = {
  createdAt: now,
  sessionId: "session:one",
  turnId: "turn:one",
} as const;

describe("domain read models", () => {
  it("parses a Session with normalized negotiated capabilities", () => {
    expect(SessionSchema.parse(session)).toEqual(session);
    expect(
      SessionSchema.safeParse({ ...session, capabilities: { ...capability, _meta: {} } }).success,
    ).toBe(false);
    expect(SessionSchema.safeParse({ ...session, providerSessionId: "" }).success).toBe(false);
    expect(SessionSchema.safeParse({ ...session, updatedAt: "not-a-date" }).success).toBe(false);
    expect(
      SessionSchema.safeParse({
        ...session,
        capabilities: null,
        providerSessionId: null,
      }).success,
    ).toBe(false);
    expect(
      SessionSchema.safeParse({
        ...session,
        capabilities: null,
        providerSessionId: null,
        state: "starting",
      }).success,
    ).toBe(true);
    expect(SessionSchema.safeParse({ ...session, state: "starting" }).success).toBe(false);
    expect(
      SessionSchema.safeParse({
        ...session,
        permission: {
          ...session.permission,
          permissionEnforcement: "client_enforced",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps static Provider policy separate from observed doctor capabilities", () => {
    for (const status of [
      "available",
      "handshake_failed",
      "incompatible",
      "probing",
      "unauthenticated",
      "unavailable",
    ] as const) {
      expect(
        ProviderSchema.safeParse({
          capabilities: status === "available" ? capability : null,
          checkedAt: now,
          defaultPermissionProfileId: "agent-full-access",
          displayName: "Codex",
          id: "codex",
          permissionProfiles: [
            {
              description: "Run with full local access",
              id: "agent-full-access",
              label: "Full access",
              mechanism: "launch",
              permissionEnforcement: "client_enforced",
              requiresNewSession: true,
              risk: "dangerous",
              semantic: "unrestricted",
            },
          ],
          processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
          ...(status !== "available" && status !== "probing"
            ? {
                reason: "Provider is not ready",
                remediation: "Run provider doctor",
              }
            : {}),
          status,
          ...(status === "available" ? { version: "2.1.0" } : {}),
        }).success,
      ).toBe(true);
    }
    expect(
      ProviderSchema.safeParse({
        capabilities: null,
        checkedAt: now,
        defaultPermissionProfileId: "agent-full-access",
        displayName: "Codex",
        id: "codex",
        permissionProfiles: [
          {
            description: "Run with full local access",
            id: "agent-full-access",
            label: "Full access",
            mechanism: "launch",
            permissionEnforcement: "client_enforced",
            requiresNewSession: true,
            risk: "dangerous",
            semantic: "unrestricted",
          },
        ],
        processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
        status: "available",
        version: "2.1.0",
      }).success,
    ).toBe(false);
    expect(
      ProviderSchema.safeParse({
        capabilities: capability,
        checkedAt: now,
        defaultPermissionProfileId: "missing",
        displayName: "Codex",
        id: "codex",
        permissionProfiles: [
          {
            description: "Run with full local access",
            id: "agent-full-access",
            label: "Full access",
            mechanism: "launch",
            permissionEnforcement: "client_enforced",
            requiresNewSession: true,
            risk: "dangerous",
            semantic: "unrestricted",
          },
        ],
        processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
        status: "available",
        version: "2.1.0",
      }).success,
    ).toBe(false);
    expect(
      ProviderCapabilitySnapshotSchema.safeParse({
        ...capability,
        permissionEnforcement: "trust_me",
      }).success,
    ).toBe(false);
    for (const protocolVersion of ["2", "experimental/v2"]) {
      expect(
        ProviderCapabilitySnapshotSchema.safeParse({
          ...capability,
          protocolVersion,
        }).success,
      ).toBe(false);
    }
  });

  it("distinguishes every provider doctor outcome without paths or raw capabilities", () => {
    const samples = [
      {
        capabilities: capability,
        checkedAt: now,
        providerId: "codex",
        status: "available",
        version: "2.1.0",
      },
      {
        checkedAt: now,
        providerId: "codex",
        reason: "Authentication is required",
        remediation: "Run the provider login command",
        status: "unauthenticated",
      },
      {
        checkedAt: now,
        providerId: "codex",
        reason: "Executable was not found",
        remediation: "Install the provider",
        status: "unavailable",
      },
      {
        checkedAt: now,
        providerId: "codex",
        reason: "ACP v1 is not supported",
        remediation: "Upgrade the provider",
        status: "incompatible",
      },
      {
        checkedAt: now,
        error: {
          code: "ACP_HANDSHAKE_FAILED",
          message: "Handshake failed",
          retryable: true,
        },
        providerId: "codex",
        status: "handshake_failed",
      },
    ];
    for (const sample of samples) {
      expect(ProviderDoctorResultSchema.safeParse(sample).success).toBe(true);
    }
    expect(
      ProviderDoctorResultSchema.safeParse({
        ...samples[0],
        executablePath: "/Users/person/bin/codex",
      }).success,
    ).toBe(false);
    for (const diagnostic of [
      "/Users/alice/private-project",
      "/home/alice/private-project",
      "/private/var/secret",
      "/tmp",
      "path: src/private.ts",
      "cwd = /Users/alice/private-project",
      "repo=C:\\Users\\Alice\\project",
      "file:///Users/alice/private-project",
      "\\\\server\\share\\secret.txt",
      "//server/share/secret.txt",
      "CwD = /uSeRs/Alice/private-project",
      "PATH : /TMP/secret.txt",
    ]) {
      expect(
        ProviderDoctorResultSchema.safeParse({
          ...samples[2],
          reason: diagnostic,
        }).success,
        diagnostic,
      ).toBe(false);
    }
  });

  it("parses exactly seven strict MessageSnapshot kinds", () => {
    const messages = [
      { ...messageBase, body: "request", id: "m:user", kind: "user" },
      {
        ...messageBase,
        body: "answer",
        id: "m:text",
        kind: "text",
        state: "complete",
      },
      {
        ...messageBase,
        body: "running",
        id: "m:note",
        kind: "note",
        level: "info",
      },
      {
        ...messageBase,
        body: "reasoning",
        id: "m:think",
        kind: "think",
        state: "streaming",
      },
      {
        ...messageBase,
        id: "m:tool",
        kind: "tool",
        displayInput: "src/a.ts\n--with-lines",
        result: { output: "ok", type: "inline" },
        status: "done",
        title: "Read",
        toolCallId: "opaque/tool-call",
        toolKind: "read",
      },
      {
        ...messageBase,
        diff: { newText: "new", oldText: "old", path: "src/a.ts", type: "inline" },
        id: "m:diff",
        kind: "diff",
      },
      {
        ...messageBase,
        id: "m:approval",
        kind: "approval",
        description: "Run the migration?\nThis changes the database.",
        requestId: pendingApproval.requestId,
      },
    ] as const;

    expect(messages.map((message) => MessageSchema.parse(message).kind)).toEqual([
      "user",
      "text",
      "note",
      "think",
      "tool",
      "diff",
      "approval",
    ]);
    expect(MessageSchema.safeParse({ ...messages[0], rawAcpEnvelope: {} }).success).toBe(false);
  });

  it("enforces the exact 30,000-character tool output boundary", () => {
    const base = {
      ...messageBase,
      id: "m:tool",
      kind: "tool",
      status: "done",
      title: "Shell",
      toolCallId: "tool/1",
      toolKind: "shell",
    } as const;
    expect(
      ToolMessageSchema.safeParse({
        ...base,
        result: { output: "x".repeat(MAX_TOOL_OUTPUT_CHARS), type: "inline" },
      }).success,
    ).toBe(true);
    expect(
      ToolMessageSchema.safeParse({
        ...base,
        result: { output: "x".repeat(MAX_TOOL_OUTPUT_CHARS + 1), type: "inline" },
      }).success,
    ).toBe(false);
  });

  it("enforces the inline diff content budget before event serialization", () => {
    const path = "x";
    const exact = {
      newText: "a".repeat(MAX_DIFF_EVENT_UTF8_BYTES - utf8ByteLength(path)),
      oldText: null,
      path,
      type: "inline",
    } as const;
    expect(utf8ByteLength(path) + utf8ByteLength(exact.newText)).toBe(MAX_DIFF_EVENT_UTF8_BYTES);
    expect(DiffPayloadSchema.safeParse(exact).success).toBe(true);
    expect(DiffPayloadSchema.safeParse({ ...exact, newText: `${exact.newText}a` }).success).toBe(
      false,
    );
    expect(
      DiffPayloadSchema.safeParse({
        newText: "你".repeat(Math.ceil(MAX_DIFF_EVENT_UTF8_BYTES / 3)),
        oldText: null,
        path,
        type: "inline",
      }).success,
    ).toBe(false);
  });

  it("provides a typed artifact escape hatch for oversized diff content", () => {
    expect(
      DiffPayloadSchema.safeParse({
        artifact: {
          artifactId: "artifact:one",
          byteLength: MAX_DIFF_EVENT_UTF8_BYTES + 1,
          displayName: "large.patch",
          mediaType: "text/x-diff",
          sha256: "a".repeat(64),
        },
        path: "src/a.ts",
        type: "artifact",
      }).success,
    ).toBe(true);
  });
});

describe("Turn and approval invariants", () => {
  const turnBase = {
    clientRequestId: "client/request-1",
    createdAt: now,
    error: null,
    id: "turn:one",
    sessionId: "session:one",
  } as const;

  it("accepts all nine Turn states with consistent timestamps", () => {
    const samples = [
      { ...turnBase, endedAt: null, startedAt: null, status: "queued", stopReason: null },
      { ...turnBase, endedAt: null, startedAt: null, status: "starting", stopReason: null },
      { ...turnBase, endedAt: null, startedAt: now, status: "running", stopReason: null },
      {
        ...turnBase,
        endedAt: null,
        startedAt: now,
        status: "awaiting_approval",
        stopReason: null,
      },
      {
        ...turnBase,
        endedAt: null,
        startedAt: now,
        status: "cancelling",
        stopReason: null,
      },
      {
        ...turnBase,
        endedAt: later,
        startedAt: now,
        status: "completed",
        stopReason: "end_turn",
      },
      {
        ...turnBase,
        endedAt: later,
        error: { code: "AGENT_FAILED", message: "Agent failed", retryable: true },
        startedAt: now,
        status: "failed",
        stopReason: "error",
      },
      {
        ...turnBase,
        endedAt: later,
        startedAt: now,
        status: "cancelled",
        stopReason: "cancelled",
      },
      {
        ...turnBase,
        endedAt: later,
        startedAt: now,
        status: "interrupted",
        stopReason: "interrupted",
      },
    ] as const;
    expect(samples.every((sample) => TurnSchema.safeParse(sample).success)).toBe(true);
    expect(
      TurnSchema.safeParse({
        ...samples[5],
        stopReason: "max_turn_requests",
      }).success,
    ).toBe(true);
    expect(ACTIVE_TURN_STATUSES.every(isActiveTurnStatus)).toBe(true);
    expect(TERMINAL_TURN_STATUSES.every(isTerminalTurnStatus)).toBe(true);
  });

  it("rejects inconsistent terminal/error state", () => {
    expect(
      TurnSchema.safeParse({
        ...turnBase,
        endedAt: null,
        startedAt: now,
        status: "completed",
        stopReason: "end_turn",
      }).success,
    ).toBe(false);
    expect(
      TurnSchema.safeParse({
        ...turnBase,
        endedAt: later,
        startedAt: now,
        status: "failed",
        stopReason: "error",
      }).success,
    ).toBe(false);
  });

  it("allows only the ADR transition graph and keeps terminal states immutable", () => {
    const allowed: readonly (readonly [
      Parameters<typeof isTurnTransitionAllowed>[0],
      Parameters<typeof isTurnTransitionAllowed>[1],
    ])[] = [
      ["queued", "starting"],
      ["queued", "interrupted"],
      ["starting", "running"],
      ["starting", "interrupted"],
      ["running", "awaiting_approval"],
      ["running", "completed"],
      ["running", "failed"],
      ["running", "cancelling"],
      ["running", "interrupted"],
      ["awaiting_approval", "running"],
      ["awaiting_approval", "cancelling"],
      ["awaiting_approval", "interrupted"],
      ["cancelling", "cancelled"],
      ["cancelling", "interrupted"],
    ];
    for (const [from, to] of allowed) {
      expect(isTurnTransitionAllowed(from, to), `${from} -> ${to}`).toBe(true);
    }
    for (const terminal of TERMINAL_TURN_STATUSES) {
      for (const target of [...ACTIVE_TURN_STATUSES, ...TERMINAL_TURN_STATUSES]) {
        expect(isTurnTransitionAllowed(terminal, target)).toBe(false);
      }
    }
    expect(isTurnTransitionAllowed("queued", "cancelled")).toBe(false);
    expect(isTurnTransitionAllowed("starting", "cancelling")).toBe(false);
    for (const from of ["starting", "awaiting_approval", "cancelling"] as const) {
      expect(isTurnTransitionAllowed(from, "failed"), `${from} -> failed`).toBe(false);
    }
  });

  it("validates unique server options and decision membership/one-shot semantics", () => {
    expect(ApprovalSchema.safeParse(pendingApproval).success).toBe(true);
    expect(
      ApprovalOptionsSchema.safeParse([{ kind: "reject", label: "Reject", optionId: "r" }]).success,
    ).toBe(true);
    expect(
      ApprovalOptionsSchema.safeParse([
        { kind: "allow", label: "Allow", optionId: "same" },
        { kind: "reject", label: "Reject", optionId: "same" },
      ]).success,
    ).toBe(false);
    expect(
      ApprovalOptionsSchema.safeParse([{ kind: "allow", label: "Allow", optionId: "allow" }])
        .success,
    ).toBe(false);
    expect(
      ApprovalOptionsSchema.safeParse([{ kind: "deny", label: "Deny", optionId: "deny" }]).success,
    ).toBe(false);

    const validDecision = ApprovalDecisionSchema.parse({
      optionId: "allow/once",
      type: "option",
    });
    expect(
      checkApprovalDecision(ApprovalSchema.parse(pendingApproval), validDecision),
    ).toMatchObject({ ok: true });
    const unknown = ApprovalDecisionSchema.parse({
      optionId: "unknown-but-well-formed",
      type: "option",
    });
    expect(checkApprovalDecision(ApprovalSchema.parse(pendingApproval), unknown)).toEqual({
      code: "APPROVAL_OPTION_INVALID",
      ok: false,
    });
    const resolved = ApprovalSchema.parse({
      ...pendingApproval,
      decision: validDecision,
      resolvedAt: later,
      status: "allowed",
    });
    expect(checkApprovalDecision(resolved, validDecision)).toEqual({
      code: "APPROVAL_ALREADY_RESOLVED",
      ok: false,
    });
  });

  it("enforces operational option count at boundary and boundary plus one", () => {
    const options = Array.from({ length: CONTRACT_LIMITS.approvalOptions }, (_, index) => ({
      kind: "reject" as const,
      label: `Reject ${index}`,
      optionId: `reject-${index}`,
    }));
    expect(ApprovalOptionsSchema.safeParse(options).success).toBe(true);
    expect(
      ApprovalOptionsSchema.safeParse([
        ...options,
        { kind: "reject", label: "extra", optionId: "extra" },
      ]).success,
    ).toBe(false);
  });
});
