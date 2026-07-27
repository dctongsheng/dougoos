import { z } from "zod";

import { CONTRACT_LIMITS, REPLAY_GAP, SESSION_BUSY } from "./limits.js";
import {
  GlobalSeqSchema,
  InternalIdSchema,
  ProviderIdSchema,
  SessionIdSchema,
  TurnIdSchema,
  boundedString,
  jsonUtf8ByteLength,
  normalizeSecurityKey,
} from "./primitives.js";

const SENSITIVE_DIAGNOSTIC_KEY =
  /(?:^|_)(?:access_?key|account|api_?key|authorization|cookie|credential|cwd|dir|email|env|git_?remote|home|input|message|output|password|path|private_?key|prompt|repo|secret|ssh_?key|system_?prompt|token|tool|user_?id|username)(?:_|$)/iu;
const SENSITIVE_DIAGNOSTIC_VALUE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]+|\bgh[a-z]?_[A-Za-z0-9_-]+|\bAIza[A-Za-z0-9_-]+|\bBearer\s+\S+|(?:password|secret)\s*[:=]\s*\S+|\b(?:cwd|file|path|repo)\s*[:=]\s*\S+|\bfile:\/\/+\S+|(?:^|[\s"'([{=,:;,])(?:\/(?!\/)\S+|[A-Za-z]:[\\/]\S*|\\\\[^\\\s]+\\\S+|\/\/[^/\s]+\/\S+)/iu;

function findUnsafeDiagnostic(
  value: unknown,
  path: readonly PropertyKey[] = [],
): readonly PropertyKey[] | null {
  if (typeof value === "string") {
    return SENSITIVE_DIAGNOSTIC_VALUE.test(value) ? path : null;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const unsafePath = findUnsafeDiagnostic(item, [...path, index]);
      if (unsafePath !== null) return unsafePath;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_DIAGNOSTIC_KEY.test(normalizeSecurityKey(key))) return [...path, key];
      const unsafePath = findUnsafeDiagnostic(item, [...path, key]);
      if (unsafePath !== null) return unsafePath;
    }
  }
  return null;
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/giu,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\b(?:sk-|gh[a-z]?_|AIza)[A-Za-z0-9_-]+/giu, "[REDACTED CREDENTIAL]")
    .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/((?:password|secret)\s*[:=]\s*)\S+/giu, "$1[REDACTED]")
    .replace(/(\b(?:cwd|file|path|repo)\s*[:=]\s*)\S+/giu, "$1[REDACTED PATH]")
    .replace(/\bfile:\/\/+\S+/giu, "[REDACTED PATH]")
    .replace(/\\\\[^\\\s]+\\\S+/gu, "[REDACTED PATH]")
    .replace(/(^|[\s"'([{=,:;,])\/\/[^/\s]+\/\S+/gu, "$1[REDACTED PATH]")
    .replace(/\/Users\/[^/\s]+/gu, "~")
    .replace(/\/home\/[^/\s]+/gu, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gu, "~")
    .replace(/\/(?:etc|opt|private|tmp|var|Volumes)\/\S+/gu, "[REDACTED PATH]")
    .replace(/[A-Za-z]:[\\/](?!Users[\\/])\S+/giu, "[REDACTED PATH]");
}

export const SafeDiagnosticTextSchema = boundedString(CONTRACT_LIMITS.errorMessageChars, {
  label: "diagnostic text",
}).refine((value) => findUnsafeDiagnostic(value) === null, {
  error: "diagnostic text contains a sensitive value",
});

export const KNOWN_ERROR_CODES = [
  "ACTIVE_SESSION_LIMIT_REACHED",
  "ACP_HANDSHAKE_FAILED",
  "AGENT_FAILED",
  "AGENT_PROCESS_CRASHED",
  "APPROVAL_ALREADY_RESOLVED",
  "APPROVAL_EXPIRED",
  "APPROVAL_NOT_FOUND",
  "APPROVAL_OPTION_INVALID",
  "CORE_NOT_READY",
  "CORE_REQUEST_FAILED",
  "FORBIDDEN_HOST",
  "FORBIDDEN_ORIGIN",
  "INTERNAL_ERROR",
  "INVALID_REQUEST",
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "PROTOCOL_VERSION_UNSUPPORTED",
  "PROVIDER_CAPABILITY_UNSUPPORTED",
  "PROVIDER_UNAVAILABLE",
  REPLAY_GAP,
  SESSION_BUSY,
  "SNAPSHOT_LIMIT_EXCEEDED",
  "SQLITE_MIGRATION_FAILED",
  "TURN_NOT_CANCELLABLE",
  "UNAUTHORIZED",
] as const;

export const KnownErrorCodeSchema = z.enum(KNOWN_ERROR_CODES);
export type KnownErrorCode = z.infer<typeof KnownErrorCodeSchema>;

export const ERROR_MESSAGE_BY_CODE = {
  ACTIVE_SESSION_LIMIT_REACHED: "Active Session capacity reached",
  ACP_HANDSHAKE_FAILED: "Handshake failed",
  AGENT_FAILED: "Agent failed",
  AGENT_PROCESS_CRASHED: "Agent process exited",
  APPROVAL_ALREADY_RESOLVED: "Approval is already resolved",
  APPROVAL_EXPIRED: "Approval expired",
  APPROVAL_NOT_FOUND: "Approval not found",
  APPROVAL_OPTION_INVALID: "Approval option is invalid",
  CORE_NOT_READY: "Core is not ready",
  CORE_REQUEST_FAILED: "Core request failed",
  FORBIDDEN_HOST: "Host is forbidden",
  FORBIDDEN_ORIGIN: "Origin is forbidden",
  INTERNAL_ERROR: "Internal error",
  INVALID_REQUEST: "Invalid request",
  NOT_FOUND: "Resource not found",
  PAYLOAD_TOO_LARGE: "Payload is too large",
  PROTOCOL_VERSION_UNSUPPORTED: "Protocol version is unsupported",
  PROVIDER_CAPABILITY_UNSUPPORTED: "Provider capability is unsupported",
  PROVIDER_UNAVAILABLE: "Provider is unavailable",
  REPLAY_GAP: "Replay cursor is outside retention",
  SESSION_BUSY: "Session already has an active Turn",
  SNAPSHOT_LIMIT_EXCEEDED: "Session snapshot approval history exceeds the operational limit",
  SQLITE_MIGRATION_FAILED: "SQLite migration failed",
  TURN_NOT_CANCELLABLE: "Turn is not cancellable",
  UNAUTHORIZED: "Request is unauthorized",
} as const satisfies Record<KnownErrorCode, string>;

export const SafeDiagnosticMessageSchema = z.enum(ERROR_MESSAGE_BY_CODE);

function addCodeMessageIssue(
  value: { readonly code: KnownErrorCode; readonly message: string },
  context: z.RefinementCtx,
): void {
  if (value.message !== ERROR_MESSAGE_BY_CODE[value.code]) {
    context.addIssue({
      code: "custom",
      message: "error message must match the static catalog entry for code",
      path: ["message"],
    });
  }
}

const DiagnosticPhaseSchema = z.enum([
  "auth",
  "handshake",
  "http",
  "initialize",
  "journal",
  "migration",
  "provider_doctor",
  "request",
  "session",
  "spawn",
  "storage",
  "transport",
  "turn",
]);

const DiagnosticOperationSchema = z.enum([
  "cancel",
  "connect",
  "create_session",
  "create_turn",
  "doctor",
  "health",
  "initialize",
  "load_snapshot",
  "migrate",
  "replay",
  "resolve_approval",
  "spawn",
  "stream",
]);

const DiagnosticFieldSchema = z.enum([
  "afterSeq",
  "clientRequestId",
  "content",
  "cwd",
  "includeSessionId",
  "optionId",
  "providerId",
  "requestId",
  "sessionId",
  "turnId",
]);

const DiagnosticStateSchema = z.enum([
  "available",
  "cancelled",
  "cancelling",
  "closed",
  "completed",
  "crashed",
  "failed",
  "handshake_failed",
  "idle",
  "incompatible",
  "not_ready",
  "pending",
  "probing",
  "ready",
  "running",
  "starting",
  "unauthenticated",
  "unavailable",
]);

const DiagnosticCapabilitySchema = z.enum([
  "client.config",
  "client.file_system",
  "client.terminal",
  "permission.profile",
  "session.close",
  "session.delete",
  "session.list",
  "session.load",
  "session.resume",
  "turn.cancel",
  "turn.images",
  "turn.prompt",
]);

const DiagnosticScalarSchema = z.union([z.boolean(), z.number().finite(), DiagnosticStateSchema]);

const SafeDiagnosticVersionSchema = boundedString(128, {
  label: "diagnostic version",
}).refine((value) => findUnsafeDiagnostic(value) === null, {
  error: "diagnostic version contains a sensitive value",
});

/**
 * Error details are a closed machine-field allowlist. Free-form explanatory
 * text belongs only in SafeDiagnosticMessageSchema.
 */
export const SafeDiagnosticDetailsSchema = z
  .object({
    actual: DiagnosticScalarSchema.optional(),
    attempt: z.number().int().safe().nonnegative().optional(),
    capability: DiagnosticCapabilitySchema.optional(),
    exitCode: z.number().int().safe().nullable().optional(),
    expected: DiagnosticScalarSchema.optional(),
    field: DiagnosticFieldSchema.optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    limit: z.number().int().safe().nonnegative().optional(),
    operation: DiagnosticOperationSchema.optional(),
    phase: DiagnosticPhaseSchema.optional(),
    providerId: ProviderIdSchema.optional(),
    retryAfterMs: z.number().int().safe().nonnegative().optional(),
    signal: z
      .enum([
        "SIGABRT",
        "SIGBUS",
        "SIGFPE",
        "SIGHUP",
        "SIGILL",
        "SIGINT",
        "SIGKILL",
        "SIGPIPE",
        "SIGQUIT",
        "SIGSEGV",
        "SIGTERM",
      ])
      .nullable()
      .optional(),
    status: DiagnosticStateSchema.optional(),
    version: SafeDiagnosticVersionSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (jsonUtf8ByteLength(value) > CONTRACT_LIMITS.detailsBytes) {
      context.addIssue({
        code: "custom",
        message: `diagnostic details exceed ${CONTRACT_LIMITS.detailsBytes} UTF-8 bytes`,
      });
    }
    const unsafePath = findUnsafeDiagnostic(value);
    if (unsafePath !== null) {
      context.addIssue({
        code: "custom",
        message: "diagnostic details contain a sensitive value",
        path: [...unsafePath],
      });
    }
  });
export type SafeDiagnosticDetails = z.infer<typeof SafeDiagnosticDetailsSchema>;

export const ErrorPayloadSchema = z
  .object({
    code: KnownErrorCodeSchema,
    details: SafeDiagnosticDetailsSchema.optional(),
    message: SafeDiagnosticMessageSchema,
    retryable: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    addCodeMessageIssue(value, context);
    if (jsonUtf8ByteLength(value) > CONTRACT_LIMITS.detailsBytes) {
      context.addIssue({
        code: "custom",
        message: `error payload exceeds ${CONTRACT_LIMITS.detailsBytes} UTF-8 bytes`,
      });
    }
  });
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const ApiErrorResponseSchema = z
  .object({
    code: KnownErrorCodeSchema,
    details: SafeDiagnosticDetailsSchema.optional(),
    message: SafeDiagnosticMessageSchema,
    retryable: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    addCodeMessageIssue(value, context);
    if (value.code === REPLAY_GAP || value.code === SESSION_BUSY || value.code === "NOT_FOUND") {
      context.addIssue({
        code: "custom",
        message: `${value.code} must use its dedicated structured error schema`,
        path: ["code"],
      });
    }
    if (jsonUtf8ByteLength(value) > CONTRACT_LIMITS.detailsBytes) {
      context.addIssue({
        code: "custom",
        message: `error response exceeds ${CONTRACT_LIMITS.detailsBytes} UTF-8 bytes`,
      });
    }
  });
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const ReplayGapErrorResponseSchema = z
  .object({
    code: z.literal(REPLAY_GAP),
    latestSeq: GlobalSeqSchema,
    message: z.literal(ERROR_MESSAGE_BY_CODE.REPLAY_GAP),
    minAvailableSeq: GlobalSeqSchema,
    retryable: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minAvailableSeq > value.latestSeq) {
      context.addIssue({
        code: "custom",
        message: "minAvailableSeq must not exceed latestSeq",
        path: ["minAvailableSeq"],
      });
    }
  });
export type ReplayGapErrorResponse = z.infer<typeof ReplayGapErrorResponseSchema>;

export const SessionBusyErrorResponseSchema = z
  .object({
    activeTurnId: TurnIdSchema,
    code: z.literal(SESSION_BUSY),
    message: z.literal(ERROR_MESSAGE_BY_CODE.SESSION_BUSY),
    retryable: z.literal(true),
    sessionId: SessionIdSchema,
  })
  .strict();
export type SessionBusyErrorResponse = z.infer<typeof SessionBusyErrorResponseSchema>;

export const NotFoundErrorResponseSchema = z
  .object({
    code: z.literal("NOT_FOUND"),
    message: z.literal(ERROR_MESSAGE_BY_CODE.NOT_FOUND),
    resourceId: InternalIdSchema,
    resourceType: boundedString(64, { label: "resource type" }),
    retryable: z.literal(false),
  })
  .strict();
export type NotFoundErrorResponse = z.infer<typeof NotFoundErrorResponseSchema>;

export const RestErrorResponseSchema = z.union([
  ReplayGapErrorResponseSchema,
  SessionBusyErrorResponseSchema,
  NotFoundErrorResponseSchema,
  ApiErrorResponseSchema,
]);
export type RestErrorResponse = z.infer<typeof RestErrorResponseSchema>;
