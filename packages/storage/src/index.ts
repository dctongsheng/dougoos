export { StorageError, isStorageError, type StorageErrorCode } from "./errors.js";
export { inspectDatabase, type DatabaseInspection } from "./inspect.js";
export { DEFAULT_MIGRATIONS, type AppliedMigration, type Migration } from "./migrations.js";
export {
  JOURNAL_RETENTION_MAX_AGE_MS,
  JOURNAL_RETENTION_MAX_EVENTS,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_SYNCHRONOUS,
  SQLITE_WAL_AUTOCHECKPOINT_PAGES,
  openStorage,
  readStoragePragmas,
  type AppendAndProjectInput,
  type AppendAndProjectResult,
  type CheckpointResult,
  type CreateInitializedSessionInput,
  type CreateTurnInput,
  type CreateTurnResult,
  type DougoStorage,
  type ReplayResult,
  type RetentionResult,
  type StorageOpenOptions,
} from "./store.js";

export const packageManifest = {
  kind: "package",
  name: "@dougoos/storage",
  status: "implemented",
} as const;
