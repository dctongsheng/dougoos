export type StorageErrorCode =
  | "ACTIVE_SESSION_LIMIT_REACHED"
  | "DATABASE_BUSY"
  | "DATABASE_FULL"
  | "CORRUPT_READ_MODEL"
  | "DEVICE_RESET_FAILED"
  | "EVENT_ID_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "MIGRATION_DRIFT"
  | "MIGRATION_DUPLICATE_ID"
  | "MIGRATION_FAILED"
  | "MIGRATION_UNKNOWN"
  | "NOT_FOUND"
  | "PROJECTION_CONFLICT"
  | "REPLAY_CURSOR_AHEAD"
  | "REPLAY_GAP"
  | "SEQUENCE_EXHAUSTED"
  | "SESSION_BUSY"
  | "SNAPSHOT_LIMIT_EXCEEDED"
  | "STORAGE_CLOSED"
  | "VALIDATION_FAILED";

const STORAGE_ERROR_MESSAGES = {
  ACTIVE_SESSION_LIMIT_REACHED: "Active Session capacity reached",
  DATABASE_BUSY: "SQLite database is busy",
  DATABASE_FULL: "SQLite database has no remaining capacity",
  CORRUPT_READ_MODEL: "Stored read model failed contract validation",
  DEVICE_RESET_FAILED: "Device identity reset failed",
  EVENT_ID_CONFLICT: "Event identity conflicts with an existing receipt",
  IDEMPOTENCY_CONFLICT: "Idempotency key was reused with a different payload",
  MIGRATION_DRIFT: "Applied migration checksum or order has drifted",
  MIGRATION_DUPLICATE_ID: "Migration manifest contains a duplicate id",
  MIGRATION_FAILED: "SQLite migration failed",
  MIGRATION_UNKNOWN: "Database contains an unknown or newer migration",
  NOT_FOUND: "Storage record was not found",
  PROJECTION_CONFLICT: "Event cannot be projected from the current read model",
  REPLAY_CURSOR_AHEAD: "Replay cursor is ahead of the journal watermark",
  REPLAY_GAP: "Replay cursor is outside retention",
  SEQUENCE_EXHAUSTED: "Journal sequence exhausted the safe integer range",
  SESSION_BUSY: "Session already has an active Turn",
  SNAPSHOT_LIMIT_EXCEEDED: "Snapshot exceeds an operational limit",
  STORAGE_CLOSED: "Storage connection is closed",
  VALIDATION_FAILED: "Storage input failed contract validation",
} as const satisfies Record<StorageErrorCode, string>;

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly details: Readonly<Record<string, boolean | number | string | null>> | undefined;

  constructor(
    code: StorageErrorCode,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, boolean | number | string | null>>;
    } = {},
  ) {
    super(STORAGE_ERROR_MESSAGES[code], { cause: options.cause });
    this.name = "StorageError";
    this.code = code;
    this.details = options.details;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

export function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String(error.code);
  return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === "SQLITE_LOCKED";
}

export function isSqliteFullError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String(error.code) === "SQLITE_FULL"
  );
}

export function asStorageWriteError(error: unknown): StorageError {
  if (isStorageError(error)) return error;
  if (isSqliteBusyError(error)) return new StorageError("DATABASE_BUSY", { cause: error });
  if (isSqliteFullError(error)) return new StorageError("DATABASE_FULL", { cause: error });
  return new StorageError("PROJECTION_CONFLICT", { cause: error });
}
