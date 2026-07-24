import { z } from "zod";

import { ErrorPayloadSchema } from "./errors.js";
import { CONTRACT_LIMITS } from "./limits.js";
import {
  ArtifactRefSchema,
  ClientRequestIdSchema,
  CwdSchema,
  InternalIdSchema,
  IsoTimestampSchema,
  MessageBodySchema,
  MessageIdSchema,
  OpaqueIdSchema,
  PathSchema,
  ProviderIdSchema,
  SessionIdSchema,
  ShortLabelSchema,
  TitleSchema,
  ToolOutputSchema,
  TurnIdSchema,
  boundedString,
  boundedMultilineString,
  utf8ByteLength,
} from "./primitives.js";
import { ProviderCapabilitySnapshotSchema } from "./providers.js";

export const TurnStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "awaiting_approval",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

export const ACTIVE_TURN_STATUSES = [
  "queued",
  "starting",
  "running",
  "awaiting_approval",
  "cancelling",
] as const satisfies readonly TurnStatus[];
export const ActiveTurnStatusSchema = z.enum(ACTIVE_TURN_STATUSES);
export type ActiveTurnStatus = z.infer<typeof ActiveTurnStatusSchema>;

export const TERMINAL_TURN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const satisfies readonly TurnStatus[];

const activeTurnStatuses = new Set<TurnStatus>(ACTIVE_TURN_STATUSES);
const terminalTurnStatuses = new Set<TurnStatus>(TERMINAL_TURN_STATUSES);

const allowedTurnTransitions: Readonly<Record<TurnStatus, ReadonlySet<TurnStatus>>> = {
  awaiting_approval: new Set(["running", "cancelling", "interrupted"]),
  cancelled: new Set(),
  cancelling: new Set(["cancelled", "interrupted"]),
  completed: new Set(),
  failed: new Set(),
  interrupted: new Set(),
  queued: new Set(["starting", "interrupted"]),
  running: new Set(["awaiting_approval", "cancelling", "completed", "failed", "interrupted"]),
  starting: new Set(["running", "interrupted"]),
};

export function isActiveTurnStatus(status: TurnStatus): boolean {
  return activeTurnStatuses.has(status);
}

export function isTerminalTurnStatus(status: TurnStatus): boolean {
  return terminalTurnStatuses.has(status);
}

export function isTurnTransitionAllowed(from: TurnStatus, to: TurnStatus): boolean {
  return allowedTurnTransitions[from].has(to);
}

export const StopReasonSchema = z.enum([
  "cancelled",
  "end_turn",
  "error",
  "interrupted",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "unknown",
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const SessionStateSchema = z.enum([
  "starting",
  "idle",
  "running",
  "awaiting_approval",
  "cancelling",
  "crashed",
  "closed",
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const TokenUsageSchema = z
  .object({
    cachedInputTokens: z.number().int().safe().nonnegative().optional(),
    inputTokens: z.number().int().safe().nonnegative(),
    outputTokens: z.number().int().safe().nonnegative(),
    quality: z.enum(["estimated", "exact", "mixed", "unavailable"]),
  })
  .strict();
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const SessionSchema = z
  .object({
    capabilities: ProviderCapabilitySnapshotSchema.nullable(),
    createdAt: IsoTimestampSchema,
    cwd: CwdSchema,
    id: SessionIdSchema,
    providerId: ProviderIdSchema,
    providerSessionId: OpaqueIdSchema.nullable(),
    source: boundedString(128, { label: "session source" }),
    state: SessionStateSchema,
    title: TitleSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt must not precede createdAt",
        path: ["updatedAt"],
      });
    }
    const initialized = value.state !== "starting";
    const runtimeIdentityPresent = value.providerSessionId !== null;
    const capabilitiesPresent = value.capabilities !== null;
    if (
      (initialized && (!runtimeIdentityPresent || !capabilitiesPresent)) ||
      (!initialized && (runtimeIdentityPresent || capabilitiesPresent))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "starting Session must be uninitialized; every other state requires providerSessionId and negotiated capabilities",
        path: ["providerSessionId"],
      });
    }
  });
export type Session = z.infer<typeof SessionSchema>;

export const SessionSummarySchema = z
  .object({
    activeTurnId: TurnIdSchema.nullable(),
    cwd: CwdSchema,
    firstUserMessagePreview: boundedString(CONTRACT_LIMITS.titleChars, {
      label: "first user message preview",
    }).optional(),
    id: SessionIdSchema,
    lastMessagePreview: boundedString(512, {
      allowEmpty: true,
      label: "message preview",
    }).optional(),
    messageCount: z.number().int().safe().nonnegative(),
    providerId: ProviderIdSchema,
    state: SessionStateSchema,
    title: TitleSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const requiresActiveTurn =
      value.state === "running" ||
      value.state === "awaiting_approval" ||
      value.state === "cancelling";
    if (requiresActiveTurn && value.activeTurnId === null) {
      context.addIssue({
        code: "custom",
        message: "running, awaiting_approval, and cancelling summaries require activeTurnId",
        path: ["activeTurnId"],
      });
    }
    if (
      (value.state === "starting" || value.state === "crashed" || value.state === "closed") &&
      value.activeTurnId !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "starting, crashed, and closed summaries must not carry activeTurnId",
        path: ["activeTurnId"],
      });
    }
  });
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const TurnSchema = z
  .object({
    clientRequestId: ClientRequestIdSchema,
    createdAt: IsoTimestampSchema,
    endedAt: IsoTimestampSchema.nullable(),
    error: ErrorPayloadSchema.nullable(),
    id: TurnIdSchema,
    sessionId: SessionIdSchema,
    startedAt: IsoTimestampSchema.nullable(),
    status: TurnStatusSchema,
    stopReason: StopReasonSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const terminal = isTerminalTurnStatus(value.status);
    if (terminal !== (value.endedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "terminal Turn status and endedAt must agree",
        path: ["endedAt"],
      });
    }
    if (value.status === "queued" && value.startedAt !== null) {
      context.addIssue({
        code: "custom",
        message: "queued Turn must not have startedAt",
        path: ["startedAt"],
      });
    }
    if (value.status !== "queued" && value.status !== "starting" && value.startedAt === null) {
      context.addIssue({
        code: "custom",
        message: `${value.status} Turn requires startedAt`,
        path: ["startedAt"],
      });
    }
    if (value.status === "failed" && value.error === null) {
      context.addIssue({
        code: "custom",
        message: "failed Turn requires a structured error",
        path: ["error"],
      });
    }
    if (value.status !== "failed" && value.error !== null) {
      context.addIssue({
        code: "custom",
        message: "only failed Turn may carry error",
        path: ["error"],
      });
    }
    if (terminal !== (value.stopReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "terminal Turn status and stopReason must agree",
        path: ["stopReason"],
      });
    }
    if (value.status === "cancelled" && value.stopReason !== "cancelled") {
      context.addIssue({
        code: "custom",
        message: "cancelled Turn must use cancelled stopReason",
        path: ["stopReason"],
      });
    }
    if (value.status === "interrupted" && value.stopReason !== "interrupted") {
      context.addIssue({
        code: "custom",
        message: "interrupted Turn must use interrupted stopReason",
        path: ["stopReason"],
      });
    }
    if (value.status === "failed" && value.stopReason !== "error") {
      context.addIssue({
        code: "custom",
        message: "failed Turn must use error stopReason",
        path: ["stopReason"],
      });
    }
    if (
      value.status === "completed" &&
      (value.stopReason === "cancelled" ||
        value.stopReason === "error" ||
        value.stopReason === "interrupted")
    ) {
      context.addIssue({
        code: "custom",
        message: "completed Turn must use a completion stopReason",
        path: ["stopReason"],
      });
    }
    if (value.startedAt !== null && Date.parse(value.startedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "startedAt must not precede createdAt",
        path: ["startedAt"],
      });
    }
    if (
      value.startedAt !== null &&
      value.endedAt !== null &&
      Date.parse(value.endedAt) < Date.parse(value.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "endedAt must not precede startedAt",
        path: ["endedAt"],
      });
    }
  });
export type Turn = z.infer<typeof TurnSchema>;
export const TurnSnapshotSchema = TurnSchema;
export type TurnSnapshot = Turn;

export const ApprovalOptionSchema = z
  .object({
    kind: z.enum(["allow", "reject"]),
    label: ShortLabelSchema,
    optionId: OpaqueIdSchema,
  })
  .strict();
export type ApprovalOption = z.infer<typeof ApprovalOptionSchema>;

export const ApprovalOptionsSchema = z
  .array(ApprovalOptionSchema)
  .min(1)
  .max(CONTRACT_LIMITS.approvalOptions)
  .superRefine((options, context) => {
    const optionIds = new Set<string>();
    let hasReject = false;
    for (const [index, option] of options.entries()) {
      if (optionIds.has(option.optionId)) {
        context.addIssue({
          code: "custom",
          message: "approval optionId values must be unique",
          path: [index, "optionId"],
        });
      }
      optionIds.add(option.optionId);
      hasReject ||= option.kind === "reject";
    }
    if (!hasReject) {
      context.addIssue({
        code: "custom",
        message: "approval options must include a reject choice",
      });
    }
  });
export type ApprovalOptions = z.infer<typeof ApprovalOptionsSchema>;

const SelectApprovalDecisionSchema = z
  .object({
    optionId: OpaqueIdSchema,
    type: z.literal("option"),
  })
  .strict();

const RejectApprovalDecisionSchema = z
  .object({
    type: z.literal("reject"),
  })
  .strict();

export const ApprovalDecisionSchema = z.discriminatedUnion("type", [
  SelectApprovalDecisionSchema,
  RejectApprovalDecisionSchema,
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalStatusSchema = z.enum([
  "pending",
  "allowed",
  "rejected",
  "expired",
  "cancelled",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z
  .object({
    decision: ApprovalDecisionSchema.nullable(),
    description: MessageBodySchema.optional(),
    expiresAt: IsoTimestampSchema,
    id: InternalIdSchema,
    options: ApprovalOptionsSchema,
    requestId: OpaqueIdSchema,
    resolvedAt: IsoTimestampSchema.nullable(),
    sessionId: SessionIdSchema,
    status: ApprovalStatusSchema,
    title: TitleSchema,
    turnId: TurnIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const pending = value.status === "pending";
    const userResolved = value.status === "allowed" || value.status === "rejected";
    if (pending && (value.decision !== null || value.resolvedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "pending approval must be unresolved",
        path: ["decision"],
      });
    }
    if (userResolved && (value.decision === null || value.resolvedAt === null)) {
      context.addIssue({
        code: "custom",
        message: "allowed or rejected approval must carry a decision and resolvedAt",
        path: ["decision"],
      });
    }
    if ((value.status === "expired" || value.status === "cancelled") && value.decision !== null) {
      context.addIssue({
        code: "custom",
        message: "expired or cancelled approval must not carry a user decision",
        path: ["decision"],
      });
    }
    if (value.status !== "pending" && value.resolvedAt === null) {
      context.addIssue({
        code: "custom",
        message: "terminal approval requires resolvedAt",
        path: ["resolvedAt"],
      });
    }
    if (
      value.resolvedAt !== null &&
      Date.parse(value.resolvedAt) > Date.parse(value.expiresAt) &&
      (value.status === "allowed" || value.status === "rejected")
    ) {
      context.addIssue({
        code: "custom",
        message: "approval resolved after expiry must be expired",
        path: ["resolvedAt"],
      });
    }
    const decision = value.decision;
    if (decision?.type === "option") {
      const option = value.options.find((candidate) => candidate.optionId === decision.optionId);
      if (option === undefined) {
        context.addIssue({
          code: "custom",
          message: "approval decision optionId is not in the request whitelist",
          path: ["decision", "optionId"],
        });
      } else if (
        (value.status === "allowed" && option.kind !== "allow") ||
        (value.status === "rejected" && option.kind !== "reject")
      ) {
        context.addIssue({
          code: "custom",
          message: "approval status must match the selected option kind",
          path: ["status"],
        });
      }
    }
    if (value.decision?.type === "reject" && value.status !== "rejected") {
      context.addIssue({
        code: "custom",
        message: "explicit reject decision requires rejected status",
        path: ["status"],
      });
    }
  });
export type Approval = z.infer<typeof ApprovalSchema>;
export const ApprovalSnapshotSchema = ApprovalSchema;
export type ApprovalSnapshot = Approval;

export type ApprovalDecisionCheck =
  | { readonly ok: true; readonly option: ApprovalOption | null }
  | {
      readonly ok: false;
      readonly code: "APPROVAL_ALREADY_RESOLVED" | "APPROVAL_OPTION_INVALID";
    };

/**
 * Schema validation cannot prove option membership or one-shot resolution.
 * Call this at the approval command boundary after parsing both objects.
 */
export function checkApprovalDecision(
  approval: Approval,
  decision: ApprovalDecision,
): ApprovalDecisionCheck {
  if (approval.status !== "pending") {
    return { code: "APPROVAL_ALREADY_RESOLVED", ok: false };
  }
  if (decision.type === "reject") {
    return { ok: true, option: null };
  }
  const option = approval.options.find((candidate) => candidate.optionId === decision.optionId);
  return option === undefined
    ? { code: "APPROVAL_OPTION_INVALID", ok: false }
    : { ok: true, option };
}

export const ToolKindSchema = z.enum([
  "delete",
  "edit",
  "mcp",
  "network",
  "other",
  "read",
  "search",
  "shell",
  "write",
]);
export type ToolKind = z.infer<typeof ToolKindSchema>;

export const ToolStatusSchema = z.enum(["pending", "running", "done", "error", "cancelled"]);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

const MessageBaseSchema = z
  .object({
    createdAt: IsoTimestampSchema,
    id: MessageIdSchema,
    sessionId: SessionIdSchema,
    turnId: TurnIdSchema,
  })
  .strict();

export const UserMessageSchema = MessageBaseSchema.extend({
  body: MessageBodySchema,
  kind: z.literal("user"),
}).strict();
export type UserMessage = z.infer<typeof UserMessageSchema>;

export const TextMessageSchema = MessageBaseSchema.extend({
  body: MessageBodySchema,
  kind: z.literal("text"),
  state: z.enum(["streaming", "complete"]),
}).strict();
export type TextMessage = z.infer<typeof TextMessageSchema>;

export const NoteMessageSchema = MessageBaseSchema.extend({
  body: MessageBodySchema,
  kind: z.literal("note"),
  level: z.enum(["info", "success", "warn"]),
}).strict();
export type NoteMessage = z.infer<typeof NoteMessageSchema>;

export const ThinkMessageSchema = MessageBaseSchema.extend({
  body: MessageBodySchema,
  kind: z.literal("think"),
  state: z.enum(["streaming", "complete"]),
}).strict();
export type ThinkMessage = z.infer<typeof ThinkMessageSchema>;

export const ToolResultSchema = z.discriminatedUnion("type", [
  z.object({ output: ToolOutputSchema, type: z.literal("inline") }).strict(),
  z.object({ artifact: ArtifactRefSchema, type: z.literal("artifact") }).strict(),
]);
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ToolMessageSchema = MessageBaseSchema.extend({
  displayInput: boundedMultilineString(CONTRACT_LIMITS.toolOutputChars, {
    allowEmpty: true,
    label: "tool display input",
  }).optional(),
  kind: z.literal("tool"),
  result: ToolResultSchema.optional(),
  status: ToolStatusSchema,
  title: TitleSchema,
  toolCallId: OpaqueIdSchema,
  toolKind: ToolKindSchema,
}).strict();
export type ToolMessage = z.infer<typeof ToolMessageSchema>;

export const DiffPayloadSchema = z.union([
  z
    .object({
      newText: boundedMultilineString(CONTRACT_LIMITS.diffEventBytes, {
        allowEmpty: true,
        label: "new diff text",
      }),
      oldText: boundedMultilineString(CONTRACT_LIMITS.diffEventBytes, {
        allowEmpty: true,
        label: "old diff text",
      }).nullable(),
      path: PathSchema,
      type: z.literal("inline"),
    })
    .strict()
    .superRefine((value, context) => {
      const byteLength =
        utf8ByteLength(value.path) +
        utf8ByteLength(value.oldText ?? "") +
        utf8ByteLength(value.newText);
      if (byteLength > CONTRACT_LIMITS.diffEventBytes) {
        context.addIssue({
          code: "custom",
          message: `diff exceeds ${CONTRACT_LIMITS.diffEventBytes} UTF-8 bytes`,
        });
      }
      if (value.oldText !== null && value.oldText === value.newText) {
        context.addIssue({
          code: "custom",
          message: "inline diff must change content",
        });
      }
    }),
  z
    .object({
      artifact: ArtifactRefSchema,
      path: PathSchema,
      type: z.literal("artifact"),
    })
    .strict(),
]);
export type DiffPayload = z.infer<typeof DiffPayloadSchema>;

export const DiffMessageSchema = MessageBaseSchema.extend({
  diff: DiffPayloadSchema,
  kind: z.literal("diff"),
}).strict();
export type DiffMessage = z.infer<typeof DiffMessageSchema>;

export const ApprovalMessageSchema = MessageBaseSchema.extend({
  description: MessageBodySchema.optional(),
  kind: z.literal("approval"),
  requestId: OpaqueIdSchema,
}).strict();
export type ApprovalMessage = z.infer<typeof ApprovalMessageSchema>;

export const MessageSchema = z.discriminatedUnion("kind", [
  UserMessageSchema,
  TextMessageSchema,
  NoteMessageSchema,
  ThinkMessageSchema,
  ToolMessageSchema,
  DiffMessageSchema,
  ApprovalMessageSchema,
]);
export type Message = z.infer<typeof MessageSchema>;
export const MessageSnapshotSchema = MessageSchema;
export type MessageSnapshot = Message;
