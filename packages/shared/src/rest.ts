import { z } from "zod";

import { AgentCliInstallationSchema } from "./clis.js";
import {
  ApprovalSnapshotSchema,
  MessageSnapshotSchema,
  SessionSchema,
  SessionSummarySchema,
  TurnSnapshotSchema,
  isActiveTurnStatus,
} from "./domain.js";
import { CONTRACT_LIMITS } from "./limits.js";
import {
  ClientRequestIdSchema,
  CwdSchema,
  DeviceIdSchema,
  GlobalSeqSchema,
  IsoTimestampSchema,
  OpaqueIdSchema,
  PathSchema,
  PromptSchema,
  ProviderIdSchema,
  SessionIdSchema,
  SessionSnapshotSeqSchema,
  TurnIdSchema,
  boundedString,
  jsonUtf8ByteLength,
  utf8ByteLength,
} from "./primitives.js";
import {
  PermissionProfileIdSchema,
  ProviderDoctorResultSchema as DoctorResultSchema,
  ProviderPreferenceSchema,
  ProviderSchema,
} from "./providers.js";

function addBodyLimitIssue(
  value: unknown,
  context: z.RefinementCtx,
  maxBytes = CONTRACT_LIMITS.requestBodyBytes,
): void {
  if (jsonUtf8ByteLength(value) > maxBytes) {
    context.addIssue({
      code: "custom",
      message: `body exceeds ${maxBytes} UTF-8 bytes`,
    });
  }
}

function findDuplicateIndex<T>(values: readonly T[], key: (value: T) => string): number | null {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const id = key(value);
    if (seen.has(id)) return index;
    seen.add(id);
  }
  return null;
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function approvalRouteKey(value: {
  readonly requestId: string;
  readonly sessionId: string;
  readonly turnId: string;
}): string {
  return JSON.stringify([value.sessionId, value.turnId, value.requestId]);
}

function turnRouteKey(value: { readonly id: string; readonly sessionId: string }): string {
  return JSON.stringify([value.sessionId, value.id]);
}

function approvalTurnRouteKey(value: {
  readonly sessionId: string;
  readonly turnId: string;
}): string {
  return JSON.stringify([value.sessionId, value.turnId]);
}

export const HealthLiveResponseSchema = z
  .object({
    checkedAt: IsoTimestampSchema,
    instanceId: boundedString(128, { label: "instance id" }),
    status: z.literal("live"),
  })
  .strict();
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;

const HealthReadySchema = z
  .object({
    checkedAt: IsoTimestampSchema,
    instanceId: boundedString(128, { label: "instance id" }),
    status: z.literal("ready"),
  })
  .strict();

const HealthNotReadySchema = z
  .object({
    checkedAt: IsoTimestampSchema,
    code: z.literal("CORE_NOT_READY"),
    status: z.literal("not_ready"),
  })
  .strict();

export const HealthReadyResponseSchema = z.discriminatedUnion("status", [
  HealthReadySchema,
  HealthNotReadySchema,
]);
export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;

const ABSOLUTE_DIRECTORY_PATTERN = /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u;

export const ConversationDirectorySchema = PathSchema.refine(
  (value) => ABSOLUTE_DIRECTORY_PATTERN.test(value),
  {
    error: "conversation directory must be an absolute path",
  },
);
export type ConversationDirectory = z.infer<typeof ConversationDirectorySchema>;

export const PreferencesResponseSchema = z
  .object({
    conversationDirectory: ConversationDirectorySchema,
  })
  .strict();
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;

export const UpdatePreferencesRequestSchema = z
  .object({
    conversationDirectory: ConversationDirectorySchema,
  })
  .strict()
  .superRefine((value, context) => addBodyLimitIssue(value, context));
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>;

export const ListProvidersResponseSchema = z
  .object({
    providers: z.array(ProviderSchema).max(CONTRACT_LIMITS.providers),
  })
  .strict();
export type ListProvidersResponse = z.infer<typeof ListProvidersResponseSchema>;

export const ListProviderPreferencesResponseSchema = z
  .object({
    preferences: z.array(ProviderPreferenceSchema).max(CONTRACT_LIMITS.providers),
  })
  .strict();
export type ListProviderPreferencesResponse = z.infer<typeof ListProviderPreferencesResponseSchema>;

export const ProviderPreferenceRouteParamsSchema = z
  .object({
    providerId: ProviderIdSchema,
  })
  .strict();
export type ProviderPreferenceRouteParams = z.infer<typeof ProviderPreferenceRouteParamsSchema>;

export const UpdateProviderPreferenceRequestSchema = z
  .object({
    permissionProfileId: PermissionProfileIdSchema,
    visibleInSidebar: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => addBodyLimitIssue(value, context));
export type UpdateProviderPreferenceRequest = z.infer<typeof UpdateProviderPreferenceRequestSchema>;

export const ProviderPreferenceResponseSchema = z
  .object({
    preference: ProviderPreferenceSchema,
  })
  .strict();
export type ProviderPreferenceResponse = z.infer<typeof ProviderPreferenceResponseSchema>;

export const ListAgentCliInstallationsResponseSchema = z
  .object({
    checkedAt: IsoTimestampSchema,
    clis: z.array(AgentCliInstallationSchema).max(64),
  })
  .strict();
export type ListAgentCliInstallationsResponse = z.infer<
  typeof ListAgentCliInstallationsResponseSchema
>;

export const ProviderDoctorResponseSchema = z
  .object({
    result: DoctorResultSchema,
  })
  .strict();
export type ProviderDoctorResponse = z.infer<typeof ProviderDoctorResponseSchema>;

export const CreateSessionRequestSchema = z
  .object({
    cwd: CwdSchema,
    permissionProfileId: PermissionProfileIdSchema.optional(),
    providerId: ProviderIdSchema,
  })
  .strict()
  .superRefine((value, context) => addBodyLimitIssue(value, context));
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const CreateSessionResponseSchema = z
  .object({
    session: SessionSchema,
  })
  .strict();
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const SessionRouteParamsSchema = z.object({ sessionId: SessionIdSchema }).strict();
export type SessionRouteParams = z.infer<typeof SessionRouteParamsSchema>;

export const TurnRouteParamsSchema = z.object({ turnId: TurnIdSchema }).strict();
export type TurnRouteParams = z.infer<typeof TurnRouteParamsSchema>;

export const ApprovalRouteParamsSchema = z
  .object({
    requestId: OpaqueIdSchema,
    turnId: TurnIdSchema,
  })
  .strict();
export type ApprovalRouteParams = z.infer<typeof ApprovalRouteParamsSchema>;

export const SessionSnapshotSchema = z
  .object({
    approvals: z.array(ApprovalSnapshotSchema).max(CONTRACT_LIMITS.approvalsPerSessionSnapshot),
    messages: z.array(MessageSnapshotSchema).max(CONTRACT_LIMITS.messagesPerSessionSnapshot),
    session: SessionSchema,
    sessionSnapshotSeq: SessionSnapshotSeqSchema,
    turns: z.array(TurnSnapshotSchema).max(CONTRACT_LIMITS.turnsPerSessionSnapshot),
  })
  .strict()
  .superRefine((value, context) => {
    const turnIds = new Set(value.turns.map((turn) => turn.id));
    const activeTurns = value.turns.filter((turn) => isActiveTurnStatus(turn.status));
    if (activeTurns.length > 1) {
      context.addIssue({
        code: "custom",
        message: "SessionSnapshot may contain at most one active Turn",
        path: ["turns"],
      });
    }
    const activeTurn = activeTurns[0];
    if (value.session.state === "starting" && value.turns.length > 0) {
      context.addIssue({
        code: "custom",
        message: "uninitialized starting Session must not contain Turns",
        path: ["turns"],
      });
    }
    const expectedSessionState =
      activeTurn === undefined
        ? null
        : {
            awaiting_approval: "awaiting_approval",
            cancelled: null,
            cancelling: "cancelling",
            completed: null,
            failed: null,
            interrupted: null,
            queued: "idle",
            running: "running",
            starting: "idle",
          }[activeTurn.status];
    if (expectedSessionState !== null && value.session.state !== expectedSessionState) {
      context.addIssue({
        code: "custom",
        message: "Session state must agree with its active Turn state",
        path: ["session", "state"],
      });
    }
    if (
      expectedSessionState === null &&
      (value.session.state === "running" ||
        value.session.state === "awaiting_approval" ||
        value.session.state === "cancelling")
    ) {
      context.addIssue({
        code: "custom",
        message: "turn-driven Session state requires an active Turn",
        path: ["session", "state"],
      });
    }
    for (const [index, turn] of value.turns.entries()) {
      if (turn.sessionId !== value.session.id) {
        context.addIssue({
          code: "custom",
          message: "Turn belongs to a different Session",
          path: ["turns", index, "sessionId"],
        });
      }
    }
    for (const [index, message] of value.messages.entries()) {
      if (message.sessionId !== value.session.id || !turnIds.has(message.turnId)) {
        context.addIssue({
          code: "custom",
          message: "Message ownership must reference this Session and one of its Turns",
          path: ["messages", index],
        });
      }
      if (
        message.kind === "approval" &&
        !value.approvals.some(
          (approval) => approvalRouteKey(approval) === approvalRouteKey(message),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "approval message must reference an approval in the same snapshot",
          path: ["messages", index, "requestId"],
        });
      }
    }
    for (const [index, approval] of value.approvals.entries()) {
      if (approval.sessionId !== value.session.id || !turnIds.has(approval.turnId)) {
        context.addIssue({
          code: "custom",
          message: "Approval ownership must reference this Session and one of its Turns",
          path: ["approvals", index],
        });
      }
    }
    for (const [field, ids] of [
      ["turns", value.turns.map((item) => item.id)],
      ["messages", value.messages.map((item) => item.id)],
      ["approvals", value.approvals.map((item) => item.id)],
      ["approvals", value.approvals.map(approvalRouteKey)],
    ] as const) {
      const duplicateIndex = findDuplicateIndex(ids, (id) => id);
      if (duplicateIndex !== null) {
        context.addIssue({
          code: "custom",
          message: `${field} contain a duplicate identifier`,
          path: [field, duplicateIndex],
        });
      }
    }
    if (jsonUtf8ByteLength(value) > CONTRACT_LIMITS.sessionSnapshotBytes) {
      context.addIssue({
        code: "custom",
        message: `SessionSnapshot exceeds ${CONTRACT_LIMITS.sessionSnapshotBytes} UTF-8 bytes`,
      });
    }
  });
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

export const GetSessionResponseSchema = SessionSnapshotSchema;
export type GetSessionResponse = SessionSnapshot;

export const GlobalSnapshotSchema = z
  .object({
    activeTurns: z.array(TurnSnapshotSchema).max(CONTRACT_LIMITS.activeSessions),
    includedSessions: z.array(SessionSnapshotSchema).max(CONTRACT_LIMITS.includedSessions),
    pendingApprovals: z.array(ApprovalSnapshotSchema).max(CONTRACT_LIMITS.maxPendingApprovals),
    sessions: z.array(SessionSummarySchema).max(CONTRACT_LIMITS.sessions),
    snapshotSeq: GlobalSeqSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const summaryIds = new Set(value.sessions.map((session) => session.id));
    const summariesById = new Map(value.sessions.map((summary) => [summary.id, summary]));
    const includedIds = new Set(value.includedSessions.map((snapshot) => snapshot.session.id));
    const includedById = new Map(
      value.includedSessions.map((snapshot) => [snapshot.session.id, snapshot]),
    );
    const activeTurnKeys = new Set(value.activeTurns.map(turnRouteKey));
    const activeTurnsBySessionId = new Map(value.activeTurns.map((turn) => [turn.sessionId, turn]));
    const pendingApprovalKeys = new Set(value.pendingApprovals.map(approvalRouteKey));

    for (const [index, snapshot] of value.includedSessions.entries()) {
      if (!summaryIds.has(snapshot.session.id)) {
        context.addIssue({
          code: "custom",
          message: "included Session must appear in the complete summary list",
          path: ["includedSessions", index, "session", "id"],
        });
      }
      if (Number(snapshot.sessionSnapshotSeq) !== Number(value.snapshotSeq)) {
        context.addIssue({
          code: "custom",
          message: "global included Session baseline must equal snapshotSeq",
          path: ["includedSessions", index, "sessionSnapshotSeq"],
        });
      }
      const summary = summariesById.get(snapshot.session.id);
      const includedActiveTurn = snapshot.turns.find((turn) => isActiveTurnStatus(turn.status));
      if (
        summary !== undefined &&
        (summary.cwd !== snapshot.session.cwd ||
          summary.providerId !== snapshot.session.providerId ||
          summary.state !== snapshot.session.state ||
          summary.title !== snapshot.session.title ||
          summary.updatedAt !== snapshot.session.updatedAt ||
          summary.messageCount !== snapshot.messages.length ||
          summary.activeTurnId !== (includedActiveTurn?.id ?? null))
      ) {
        context.addIssue({
          code: "custom",
          message: "included Session read model must agree with its summary",
          path: ["includedSessions", index],
        });
      }
    }
    for (const [index, turn] of value.activeTurns.entries()) {
      if (!isActiveTurnStatus(turn.status)) {
        context.addIssue({
          code: "custom",
          message: "activeTurns may contain only nonterminal Turn states",
          path: ["activeTurns", index, "status"],
        });
      }
      if (!includedIds.has(turn.sessionId)) {
        context.addIssue({
          code: "custom",
          message: "active Turn Session must be auto-included",
          path: ["activeTurns", index, "sessionId"],
        });
      }
      const includedTurn = includedById
        .get(turn.sessionId)
        ?.turns.find((candidate) => candidate.id === turn.id);
      if (includedTurn === undefined || !sameCanonicalJson(includedTurn, turn)) {
        context.addIssue({
          code: "custom",
          message: "active Turn index must match the included Session snapshot",
          path: ["activeTurns", index],
        });
      }
    }
    for (const [sessionIndex, snapshot] of value.includedSessions.entries()) {
      for (const turn of snapshot.turns) {
        const indexedTurn = value.activeTurns.find(
          (candidate) => turnRouteKey(candidate) === turnRouteKey(turn),
        );
        if (
          isActiveTurnStatus(turn.status) &&
          (indexedTurn === undefined || !sameCanonicalJson(indexedTurn, turn))
        ) {
          context.addIssue({
            code: "custom",
            message: "every active Turn in an included Session must appear in activeTurns",
            path: ["includedSessions", sessionIndex, "turns"],
          });
        }
      }
    }
    for (const [index, approval] of value.pendingApprovals.entries()) {
      if (approval.status !== "pending") {
        context.addIssue({
          code: "custom",
          message: "pendingApprovals may contain only pending approvals",
          path: ["pendingApprovals", index, "status"],
        });
      }
      if (
        !includedIds.has(approval.sessionId) ||
        !activeTurnKeys.has(approvalTurnRouteKey(approval))
      ) {
        context.addIssue({
          code: "custom",
          message: "pending Approval must reference an included active Turn",
          path: ["pendingApprovals", index],
        });
      }
      const includedApproval = includedById
        .get(approval.sessionId)
        ?.approvals.find((candidate) => approvalRouteKey(candidate) === approvalRouteKey(approval));
      if (includedApproval === undefined || !sameCanonicalJson(includedApproval, approval)) {
        context.addIssue({
          code: "custom",
          message: "pending Approval index must match the included Session snapshot",
          path: ["pendingApprovals", index],
        });
      }
    }
    for (const [sessionIndex, snapshot] of value.includedSessions.entries()) {
      for (const approval of snapshot.approvals) {
        if (approval.status === "pending" && !pendingApprovalKeys.has(approvalRouteKey(approval))) {
          context.addIssue({
            code: "custom",
            message:
              "every pending Approval in an included Session must appear in pendingApprovals",
            path: ["includedSessions", sessionIndex, "approvals"],
          });
        }
      }
    }
    for (const [index, summary] of value.sessions.entries()) {
      const activeTurn = activeTurnsBySessionId.get(summary.id);
      if ((activeTurn?.id ?? null) !== summary.activeTurnId) {
        context.addIssue({
          code: "custom",
          message: "Session summary activeTurnId must match activeTurns",
          path: ["sessions", index, "activeTurnId"],
        });
      }
    }

    for (const [field, ids] of [
      ["sessions", value.sessions.map((item) => item.id)],
      ["includedSessions", value.includedSessions.map((item) => item.session.id)],
      ["activeTurns", value.activeTurns.map((item) => item.id)],
      ["activeTurns", value.activeTurns.map(turnRouteKey)],
      ["pendingApprovals", value.pendingApprovals.map((item) => item.id)],
      ["pendingApprovals", value.pendingApprovals.map(approvalRouteKey)],
    ] as const) {
      const duplicateIndex = findDuplicateIndex(ids, (id) => id);
      if (duplicateIndex !== null) {
        context.addIssue({
          code: "custom",
          message: `${field} contain a duplicate identifier`,
          path: [field, duplicateIndex],
        });
      }
    }
    const includedTurns = value.includedSessions.flatMap((snapshot) => snapshot.turns);
    const duplicateIncludedTurnId = findDuplicateIndex(includedTurns, (turn) => turn.id);
    if (duplicateIncludedTurnId !== null) {
      context.addIssue({
        code: "custom",
        message: "included Sessions contain a duplicate internal Turn id",
        path: ["includedSessions"],
      });
    }
    const includedApprovals = value.includedSessions.flatMap((snapshot) => snapshot.approvals);
    for (const key of [
      (approval: (typeof includedApprovals)[number]) => approval.id,
      approvalRouteKey,
    ]) {
      if (findDuplicateIndex(includedApprovals, key) !== null) {
        context.addIssue({
          code: "custom",
          message: "included Sessions contain a duplicate Approval identity",
          path: ["includedSessions"],
        });
      }
    }
    if (jsonUtf8ByteLength(value) > CONTRACT_LIMITS.globalSnapshotBytes) {
      context.addIssue({
        code: "custom",
        message: `GlobalSnapshot exceeds ${CONTRACT_LIMITS.globalSnapshotBytes} UTF-8 bytes`,
      });
    }
  });
export type GlobalSnapshot = z.infer<typeof GlobalSnapshotSchema>;

export const SnapshotQuerySchema = z
  .object({
    includeSessionId: z.array(SessionIdSchema).max(CONTRACT_LIMITS.requestedSessions).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const duplicateIndex = findDuplicateIndex(value.includeSessionId, (id) => id);
    if (duplicateIndex !== null) {
      context.addIssue({
        code: "custom",
        message: "includeSessionId values must be unique",
        path: ["includeSessionId", duplicateIndex],
      });
    }
  });
export type SnapshotQuery = z.infer<typeof SnapshotQuerySchema>;

export type GlobalSnapshotCoverageCheck =
  { readonly ok: true } | { readonly missingSessionIds: readonly string[]; readonly ok: false };

/**
 * GlobalSnapshotSchema proves automatic active-session/index completeness.
 * The request handler must additionally call this with the parsed query because
 * a response value alone cannot know which inactive Sessions were requested.
 */
export function checkGlobalSnapshotCoverage(
  snapshot: GlobalSnapshot,
  query: SnapshotQuery,
): GlobalSnapshotCoverageCheck {
  const includedIds = new Set(snapshot.includedSessions.map((included) => included.session.id));
  const summaryIds = new Set(snapshot.sessions.map((session) => session.id));
  const missingSessionIds = query.includeSessionId.filter(
    (sessionId) => !summaryIds.has(sessionId) || !includedIds.has(sessionId),
  );
  return missingSessionIds.length === 0 ? { ok: true } : { missingSessionIds, ok: false };
}

export const PromptTextContentSchema = z
  .object({
    text: PromptSchema,
    type: z.literal("text"),
  })
  .strict();
export type PromptTextContent = z.infer<typeof PromptTextContentSchema>;

export const CreateTurnRequestSchema = z
  .object({
    clientRequestId: ClientRequestIdSchema,
    content: z.array(PromptTextContentSchema).min(1).max(CONTRACT_LIMITS.promptContentParts),
  })
  .strict()
  .superRefine((value, context) => {
    const promptBytes = value.content.reduce((total, part) => total + utf8ByteLength(part.text), 0);
    if (promptBytes > CONTRACT_LIMITS.promptUtf8Bytes) {
      context.addIssue({
        code: "custom",
        message: `aggregate prompt exceeds ${CONTRACT_LIMITS.promptUtf8Bytes} UTF-8 bytes`,
        path: ["content"],
      });
    }
    addBodyLimitIssue(value, context);
  });
export type CreateTurnRequest = z.infer<typeof CreateTurnRequestSchema>;

export const CreateTurnResponseSchema = z
  .object({
    turnId: TurnIdSchema,
  })
  .strict();
export type CreateTurnResponse = z.infer<typeof CreateTurnResponseSchema>;

export const CancelTurnRequestSchema = z.object({}).strict();
export type CancelTurnRequest = z.infer<typeof CancelTurnRequestSchema>;

export const CancelTurnResponseSchema = z
  .object({
    accepted: z.literal(true),
    status: z.enum(["cancelled", "cancelling"]),
    turnId: TurnIdSchema,
  })
  .strict();
export type CancelTurnResponse = z.infer<typeof CancelTurnResponseSchema>;

export const ResolveApprovalRequestSchema = z
  .object({
    optionId: OpaqueIdSchema,
  })
  .strict()
  .superRefine((value, context) => addBodyLimitIssue(value, context));
export type ResolveApprovalRequest = z.infer<typeof ResolveApprovalRequestSchema>;

export const ResolveApprovalResponseSchema = z
  .object({
    accepted: z.literal(true),
    requestId: OpaqueIdSchema,
  })
  .strict();
export type ResolveApprovalResponse = z.infer<typeof ResolveApprovalResponseSchema>;

const CursorStringSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/u, { error: "cursor must be an unsigned decimal integer" })
  .refine((value) => Number.isSafeInteger(Number(value)), {
    error: "cursor exceeds JavaScript safe integer range",
  });

export const EventStreamQuerySchema = z
  .object({
    afterSeq: CursorStringSchema,
    sessionId: SessionIdSchema.optional(),
  })
  .strict();
export type EventStreamQuery = z.infer<typeof EventStreamQuerySchema>;

export function parseEventStreamAfterSeq(query: EventStreamQuery) {
  return GlobalSeqSchema.parse(Number(query.afterSeq));
}

export const DeviceIdentityResponseSchema = z
  .object({
    classification: z.literal("pseudonymous"),
    deviceId: DeviceIdSchema,
    resettable: z.literal(true),
  })
  .strict();
export type DeviceIdentityResponse = z.infer<typeof DeviceIdentityResponseSchema>;

export const ResetDeviceIdentityRequestSchema = z.object({}).strict();
export type ResetDeviceIdentityRequest = z.infer<typeof ResetDeviceIdentityRequestSchema>;

export const ResetDeviceIdentityResponseSchema = DeviceIdentityResponseSchema;
export type ResetDeviceIdentityResponse = DeviceIdentityResponse;

export const RestSuccessResponseSchema = z.union([
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  PreferencesResponseSchema,
  ListProviderPreferencesResponseSchema,
  ProviderPreferenceResponseSchema,
  ListAgentCliInstallationsResponseSchema,
  ListProvidersResponseSchema,
  ProviderDoctorResponseSchema,
  CreateSessionResponseSchema,
  SessionSnapshotSchema,
  GlobalSnapshotSchema,
  CreateTurnResponseSchema,
  CancelTurnResponseSchema,
  ResolveApprovalResponseSchema,
  DeviceIdentityResponseSchema,
]);
