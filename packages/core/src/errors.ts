import { AcpRuntimeError } from "@dougoos/acp";
import {
  ApiErrorResponseSchema,
  ERROR_MESSAGE_BY_CODE,
  NotFoundErrorResponseSchema,
  ReplayGapErrorResponseSchema,
  SessionBusyErrorResponseSchema,
  type ApiErrorResponse,
  type KnownErrorCode,
  type NotFoundErrorResponse,
  type ReplayGapErrorResponse,
  type SafeDiagnosticDetails,
  type SessionBusyErrorResponse,
} from "@dougoos/shared";
import { isStorageError, type StorageError } from "@dougoos/storage";

type CoreApiErrorCode = Exclude<KnownErrorCode, "NOT_FOUND" | "REPLAY_GAP" | "SESSION_BUSY">;

export class CoreError extends Error {
  readonly code: CoreApiErrorCode;
  readonly details: SafeDiagnosticDetails | undefined;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    code: CoreApiErrorCode,
    options: {
      readonly details?: SafeDiagnosticDetails;
      readonly httpStatus: number;
      readonly retryable: boolean;
    },
  ) {
    super(ERROR_MESSAGE_BY_CODE[code]);
    this.name = "CoreError";
    this.code = code;
    this.details = options.details;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable;
  }
}

export function apiError(
  code: CoreApiErrorCode,
  retryable: boolean,
  details?: SafeDiagnosticDetails,
): ApiErrorResponse {
  return ApiErrorResponseSchema.parse({
    code,
    ...(details === undefined ? {} : { details }),
    message: ERROR_MESSAGE_BY_CODE[code],
    retryable,
  });
}

export function notFound(resourceType: string, resourceId: string): NotFoundErrorResponse {
  return NotFoundErrorResponseSchema.parse({
    code: "NOT_FOUND",
    message: ERROR_MESSAGE_BY_CODE.NOT_FOUND,
    resourceId,
    resourceType,
    retryable: false,
  });
}

export function sessionBusy(sessionId: string, activeTurnId: string): SessionBusyErrorResponse {
  return SessionBusyErrorResponseSchema.parse({
    activeTurnId,
    code: "SESSION_BUSY",
    message: ERROR_MESSAGE_BY_CODE.SESSION_BUSY,
    retryable: true,
    sessionId,
  });
}

export function replayGap(latestSeq: number, minAvailableSeq: number): ReplayGapErrorResponse {
  return ReplayGapErrorResponseSchema.parse({
    code: "REPLAY_GAP",
    latestSeq,
    message: ERROR_MESSAGE_BY_CODE.REPLAY_GAP,
    minAvailableSeq,
    retryable: true,
  });
}

export interface MappedCoreFailure {
  readonly body: ApiErrorResponse;
  readonly status: number;
}

function mapStorageFailure(error: StorageError): MappedCoreFailure {
  switch (error.code) {
    case "ACTIVE_SESSION_LIMIT_REACHED":
      return {
        body: apiError("ACTIVE_SESSION_LIMIT_REACHED", true, {
          limit: Number(error.details?.limit ?? 0),
          operation: "create_turn",
        }),
        status: 409,
      };
    case "DATABASE_BUSY":
      return {
        body: apiError("CORE_REQUEST_FAILED", true, {
          operation: "connect",
          phase: "storage",
          retryAfterMs: 250,
        }),
        status: 503,
      };
    case "DATABASE_FULL":
      return {
        body: apiError("CORE_REQUEST_FAILED", false, {
          operation: "connect",
          phase: "storage",
        }),
        status: 507,
      };
    case "IDEMPOTENCY_CONFLICT":
    case "PROJECTION_CONFLICT":
      return {
        body: apiError("CORE_REQUEST_FAILED", false, {
          operation: "create_turn",
          phase: "storage",
        }),
        status: 409,
      };
    case "MIGRATION_DRIFT":
    case "MIGRATION_DUPLICATE_ID":
    case "MIGRATION_FAILED":
    case "MIGRATION_UNKNOWN":
      return {
        body: apiError("SQLITE_MIGRATION_FAILED", false, {
          operation: "migrate",
          phase: "migration",
        }),
        status: 503,
      };
    case "SNAPSHOT_LIMIT_EXCEEDED":
      return {
        body: apiError("SNAPSHOT_LIMIT_EXCEEDED", false, {
          operation: "load_snapshot",
          phase: "storage",
        }),
        status: 409,
      };
    case "VALIDATION_FAILED":
      return {
        body: apiError("INTERNAL_ERROR", false, { phase: "storage" }),
        status: 500,
      };
    case "CORRUPT_READ_MODEL":
    case "DEVICE_RESET_FAILED":
    case "EVENT_ID_CONFLICT":
    case "NOT_FOUND":
    case "REPLAY_CURSOR_AHEAD":
    case "REPLAY_GAP":
    case "SEQUENCE_EXHAUSTED":
    case "SESSION_BUSY":
    case "STORAGE_CLOSED":
      return {
        body: apiError("INTERNAL_ERROR", false, {
          phase: "storage",
        }),
        status: 500,
      };
  }
}

function mapAcpFailure(error: AcpRuntimeError): MappedCoreFailure {
  const { code, details, retryable } = error.payload;
  switch (code) {
    case "ACTIVE_SESSION_LIMIT_REACHED":
    case "APPROVAL_ALREADY_RESOLVED":
    case "APPROVAL_EXPIRED":
    case "PROVIDER_CAPABILITY_UNSUPPORTED":
    case "TURN_NOT_CANCELLABLE":
      return { body: apiError(code, retryable, details), status: 409 };
    case "APPROVAL_NOT_FOUND":
      return { body: apiError(code, retryable, details), status: 404 };
    case "APPROVAL_OPTION_INVALID":
      return { body: apiError(code, retryable, details), status: 400 };
    case "ACP_HANDSHAKE_FAILED":
    case "AGENT_PROCESS_CRASHED":
    case "PROTOCOL_VERSION_UNSUPPORTED":
    case "PROVIDER_UNAVAILABLE":
      return { body: apiError(code, retryable, details), status: 503 };
    case "AGENT_FAILED":
      return { body: apiError(code, retryable, details), status: 502 };
    case "CORE_NOT_READY":
    case "CORE_REQUEST_FAILED":
    case "FORBIDDEN_HOST":
    case "FORBIDDEN_ORIGIN":
    case "INTERNAL_ERROR":
    case "INVALID_REQUEST":
    case "NOT_FOUND":
    case "PAYLOAD_TOO_LARGE":
    case "REPLAY_GAP":
    case "SESSION_BUSY":
    case "SNAPSHOT_LIMIT_EXCEEDED":
    case "SQLITE_MIGRATION_FAILED":
    case "UNAUTHORIZED":
      return { body: apiError("INTERNAL_ERROR", false), status: 500 };
  }
}

export function mapCoreFailure(error: unknown): MappedCoreFailure {
  if (error instanceof CoreError) {
    return {
      body: apiError(error.code, error.retryable, error.details),
      status: error.httpStatus,
    };
  }
  if (error instanceof AcpRuntimeError) return mapAcpFailure(error);
  if (isStorageError(error)) return mapStorageFailure(error);
  return {
    body: apiError("INTERNAL_ERROR", false),
    status: 500,
  };
}
