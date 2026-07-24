import { RequestError } from "@agentclientprotocol/sdk";
import {
  ERROR_MESSAGE_BY_CODE,
  ErrorPayloadSchema,
  type ErrorPayload,
  type KnownErrorCode,
  type SafeDiagnosticDetails,
} from "@dougoos/shared";

export class AcpRuntimeError extends Error {
  readonly payload: ErrorPayload;

  constructor(payload: ErrorPayload, options?: ErrorOptions) {
    super(payload.message, options);
    this.name = "AcpRuntimeError";
    this.payload = payload;
  }
}

export function errorPayload(
  code: KnownErrorCode,
  retryable: boolean,
  details?: SafeDiagnosticDetails,
): ErrorPayload {
  return ErrorPayloadSchema.parse({
    code,
    ...(details === undefined ? {} : { details }),
    message: ERROR_MESSAGE_BY_CODE[code],
    retryable,
  });
}

export function runtimeError(
  code: KnownErrorCode,
  retryable: boolean,
  details?: SafeDiagnosticDetails,
  cause?: unknown,
): AcpRuntimeError {
  return new AcpRuntimeError(errorPayload(code, retryable, details), { cause });
}

export function toRuntimeError(error: unknown): AcpRuntimeError {
  if (error instanceof AcpRuntimeError) return error;
  if (error instanceof RequestError && error.code === -32_000) {
    return runtimeError(
      "PROVIDER_UNAVAILABLE",
      false,
      { operation: "create_turn", phase: "auth" },
      error,
    );
  }
  return runtimeError(
    "AGENT_FAILED",
    true,
    {
      ...(error instanceof RequestError ? { actual: error.code } : {}),
      operation: "create_turn",
      phase: "turn",
    },
    error,
  );
}
