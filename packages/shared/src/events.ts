import { z } from "zod";

import {
  ActiveTurnStatusSchema,
  ApprovalDecisionSchema,
  ApprovalOptionsSchema,
  type Approval,
  DiffPayloadSchema,
  SessionStateSchema,
  StopReasonSchema,
  TERMINAL_TURN_STATUSES,
  TokenUsageSchema,
  ToolKindSchema,
  ToolResultSchema,
  ToolStatusSchema,
  checkApprovalDecision,
  isTurnTransitionAllowed,
} from "./domain.js";
import { ErrorPayloadSchema } from "./errors.js";
import { CONTRACT_LIMITS } from "./limits.js";
import {
  EventIdSchema,
  GlobalSeqSchema,
  IsoTimestampSchema,
  MessageBodySchema,
  MessageIdSchema,
  OpaqueIdSchema,
  ProtocolVersionSchema,
  SessionIdSchema,
  TitleSchema,
  TurnIdSchema,
  boundedMultilineString,
  jsonUtf8ByteLength,
} from "./primitives.js";

export const UserMessageEventSchema = z
  .object({
    body: MessageBodySchema,
    messageId: MessageIdSchema,
    type: z.literal("user_message"),
  })
  .strict();

export const MessageDeltaEventSchema = z
  .object({
    messageId: MessageIdSchema,
    text: MessageBodySchema,
    type: z.literal("message_delta"),
  })
  .strict();

export const ThoughtDeltaEventSchema = z
  .object({
    messageId: MessageIdSchema,
    text: MessageBodySchema,
    type: z.literal("thought_delta"),
  })
  .strict();

export const NoteEventSchema = z
  .object({
    level: z.enum(["info", "success", "warn"]),
    messageId: MessageIdSchema,
    text: MessageBodySchema,
    type: z.literal("note"),
  })
  .strict();

export const ToolCallEventSchema = z
  .object({
    displayInput: boundedMultilineString(CONTRACT_LIMITS.toolOutputChars, {
      allowEmpty: true,
      label: "tool display input",
    }).optional(),
    kind: ToolKindSchema,
    status: z.enum(["pending", "running"]),
    title: TitleSchema,
    toolCallId: OpaqueIdSchema,
    type: z.literal("tool_call"),
  })
  .strict();

export const ToolUpdateEventSchema = z
  .object({
    result: ToolResultSchema.optional(),
    status: ToolStatusSchema.exclude(["pending"]),
    toolCallId: OpaqueIdSchema,
    type: z.literal("tool_update"),
  })
  .strict();

export const DiffEventSchema = z
  .object({
    diff: DiffPayloadSchema,
    messageId: MessageIdSchema,
    type: z.literal("diff"),
  })
  .strict();

export const ApprovalRequestEventSchema = z
  .object({
    description: MessageBodySchema.optional(),
    expiresAt: IsoTimestampSchema,
    options: ApprovalOptionsSchema,
    requestId: OpaqueIdSchema,
    title: TitleSchema,
    type: z.literal("approval_request"),
  })
  .strict();

export const ApprovalResolvedEventSchema = z
  .object({
    decision: ApprovalDecisionSchema.nullable(),
    requestId: OpaqueIdSchema,
    status: z.enum(["allowed", "cancelled", "expired", "rejected"]),
    type: z.literal("approval_resolved"),
  })
  .strict();

export const TurnStateEventSchema = z
  .object({
    from: ActiveTurnStatusSchema.nullable(),
    status: ActiveTurnStatusSchema,
    type: z.literal("turn_state"),
  })
  .strict();

export const TurnEndEventSchema = z
  .object({
    error: ErrorPayloadSchema.optional(),
    from: ActiveTurnStatusSchema,
    status: z.enum(TERMINAL_TURN_STATUSES),
    stopReason: StopReasonSchema,
    type: z.literal("turn_end"),
    usage: TokenUsageSchema.optional(),
  })
  .strict();

export const SessionStateEventSchema = z
  .object({
    state: SessionStateSchema,
    type: z.literal("session_state"),
  })
  .strict();

export const SessionErrorEventSchema = z
  .object({
    error: ErrorPayloadSchema,
    type: z.literal("session_error"),
  })
  .strict();

export const AgentUiEventSchema = z
  .discriminatedUnion("type", [
    UserMessageEventSchema,
    MessageDeltaEventSchema,
    ThoughtDeltaEventSchema,
    NoteEventSchema,
    ToolCallEventSchema,
    ToolUpdateEventSchema,
    DiffEventSchema,
    ApprovalRequestEventSchema,
    ApprovalResolvedEventSchema,
    TurnStateEventSchema,
    TurnEndEventSchema,
    SessionStateEventSchema,
    SessionErrorEventSchema,
  ])
  .superRefine((event, context) => {
    if (event.type === "turn_state") {
      if (event.from === null && event.status !== "queued") {
        context.addIssue({
          code: "custom",
          message: "only queued may be the initial Turn state",
          path: ["status"],
        });
      }
      if (
        event.from !== null &&
        (event.from === event.status || !isTurnTransitionAllowed(event.from, event.status))
      ) {
        context.addIssue({
          code: "custom",
          message: `illegal Turn transition ${event.from} -> ${event.status}`,
          path: ["status"],
        });
      }
    }
    if (event.type === "turn_end") {
      if (!isTurnTransitionAllowed(event.from, event.status)) {
        context.addIssue({
          code: "custom",
          message: `illegal terminal Turn transition ${event.from} -> ${event.status}`,
          path: ["status"],
        });
      }
      if ((event.status === "failed") !== (event.error !== undefined)) {
        context.addIssue({
          code: "custom",
          message: "failed turn_end requires error; other terminal states must not carry one",
          path: ["error"],
        });
      }
      if (event.status === "cancelled" && event.stopReason !== "cancelled") {
        context.addIssue({
          code: "custom",
          message: "cancelled turn_end requires cancelled stopReason",
          path: ["stopReason"],
        });
      }
      if (event.status === "interrupted" && event.stopReason !== "interrupted") {
        context.addIssue({
          code: "custom",
          message: "interrupted turn_end requires interrupted stopReason",
          path: ["stopReason"],
        });
      }
      if (event.status === "failed" && event.stopReason !== "error") {
        context.addIssue({
          code: "custom",
          message: "failed turn_end requires error stopReason",
          path: ["stopReason"],
        });
      }
      if (
        event.status === "completed" &&
        (event.stopReason === "cancelled" ||
          event.stopReason === "error" ||
          event.stopReason === "interrupted")
      ) {
        context.addIssue({
          code: "custom",
          message: "completed turn_end requires a completion stopReason",
          path: ["stopReason"],
        });
      }
    }
    if (event.type === "diff" && jsonUtf8ByteLength(event) > CONTRACT_LIMITS.diffEventBytes) {
      context.addIssue({
        code: "custom",
        message: `serialized diff event exceeds ${CONTRACT_LIMITS.diffEventBytes} UTF-8 bytes`,
      });
    }
    if (
      event.type === "approval_resolved" &&
      (event.status === "allowed" || event.status === "rejected") &&
      event.decision === null
    ) {
      context.addIssue({
        code: "custom",
        message: "user-resolved approval event requires a decision",
        path: ["decision"],
      });
    }
    if (
      event.type === "approval_resolved" &&
      (event.status === "cancelled" || event.status === "expired") &&
      event.decision !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "system-resolved approval event must not carry a user decision",
        path: ["decision"],
      });
    }
  });
export type AgentUiEvent = z.infer<typeof AgentUiEventSchema>;
export type ApprovalResolvedEvent = z.infer<typeof ApprovalResolvedEventSchema>;

export type ApprovalResolvedEventCheck =
  | { readonly ok: true }
  | {
      readonly code:
        | "APPROVAL_ALREADY_RESOLVED"
        | "APPROVAL_OPTION_INVALID"
        | "APPROVAL_EVENT_MISMATCH"
        | "APPROVAL_STATUS_MISMATCH";
      readonly ok: false;
    };

/**
 * Projectors must call this before appending approval_resolved. It checks the
 * request identity, one-shot pending state, option membership, and whether the
 * selected option kind agrees with the projected terminal status.
 */
export function checkApprovalResolvedEvent(
  approval: Approval,
  event: ApprovalResolvedEvent,
): ApprovalResolvedEventCheck {
  if (approval.requestId !== event.requestId) {
    return { code: "APPROVAL_EVENT_MISMATCH", ok: false };
  }
  if (approval.status !== "pending") {
    return { code: "APPROVAL_ALREADY_RESOLVED", ok: false };
  }
  if (event.status === "cancelled" || event.status === "expired") {
    return event.decision === null ? { ok: true } : { code: "APPROVAL_STATUS_MISMATCH", ok: false };
  }
  if (event.decision === null) {
    return { code: "APPROVAL_STATUS_MISMATCH", ok: false };
  }
  const decisionCheck = checkApprovalDecision(approval, event.decision);
  if (!decisionCheck.ok) return decisionCheck;
  if (event.decision.type === "reject") {
    return event.status === "rejected"
      ? { ok: true }
      : { code: "APPROVAL_STATUS_MISMATCH", ok: false };
  }
  const expectedStatus = decisionCheck.option?.kind === "allow" ? "allowed" : "rejected";
  return event.status === expectedStatus
    ? { ok: true }
    : { code: "APPROVAL_STATUS_MISMATCH", ok: false };
}

const TURN_SCOPED_EVENTS = new Set<AgentUiEvent["type"]>([
  "approval_request",
  "approval_resolved",
  "diff",
  "message_delta",
  "note",
  "thought_delta",
  "tool_call",
  "tool_update",
  "turn_end",
  "turn_state",
  "user_message",
]);

export const AgentRuntimeEventSchema = z
  .object({
    event: AgentUiEventSchema,
    occurredAt: IsoTimestampSchema,
    sessionId: SessionIdSchema,
    turnId: TurnIdSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (TURN_SCOPED_EVENTS.has(value.event.type) && value.turnId === null) {
      context.addIssue({
        code: "custom",
        message: `${value.event.type} requires turnId`,
        path: ["turnId"],
      });
    }
  });
export type AgentRuntimeEvent = z.infer<typeof AgentRuntimeEventSchema>;

export const AgentEventEnvelopeSchema = z
  .object({
    event: AgentUiEventSchema,
    eventId: EventIdSchema,
    occurredAt: IsoTimestampSchema,
    seq: GlobalSeqSchema,
    sessionId: SessionIdSchema,
    turnId: TurnIdSchema.nullable(),
    v: ProtocolVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.seq < 1) {
      context.addIssue({
        code: "custom",
        message: "event envelope seq must be at least 1",
        path: ["seq"],
      });
    }
    if (TURN_SCOPED_EVENTS.has(value.event.type) && value.turnId === null) {
      context.addIssue({
        code: "custom",
        message: `${value.event.type} requires turnId`,
        path: ["turnId"],
      });
    }
  });
export type AgentEventEnvelope = z.infer<typeof AgentEventEnvelopeSchema>;
