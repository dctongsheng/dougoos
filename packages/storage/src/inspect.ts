import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { StorageError } from "./errors.js";
import { verifyJournalIntegrity } from "./journal-integrity.js";
import {
  preflightMigrationDatabase,
  verifyMigrationHistory,
  verifyOwnedMigrationHistory,
  type Migration,
} from "./migrations.js";
import { verifyStorageSchema } from "./schema.js";

export interface DatabaseInspection {
  readonly counts: Readonly<Record<string, number>>;
  readonly foreignKeyViolations: number;
  readonly integrity: "ok";
  readonly journal: {
    readonly eventCount: number;
    readonly latestSeq: number;
    readonly minAvailableSeq: number;
    readonly receiptCount: number;
  };
  readonly migrations: readonly {
    readonly checksum: string;
    readonly id: string;
    readonly ordinal: number;
  }[];
  readonly pragmas: {
    readonly journalMode: string;
    readonly queryOnly: true;
    readonly synchronous: number;
    readonly userVersion: number;
  };
  readonly sqliteVersion: string;
}

function tableExists(db: BetterSqlite3.Database, table: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`).get(table) !==
    undefined
  );
}

function safeCount(db: BetterSqlite3.Database, table: string): number {
  if (!tableExists(db, table)) return 0;
  const allowed = new Set([
    "approval_requests",
    "devices",
    "event_receipts",
    "messages",
    "providers_status",
    "session_events",
    "sessions",
    "turns",
    "usage_stats",
  ]);
  if (!allowed.has(table)) throw new StorageError("VALIDATION_FAILED");
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    readonly count: number;
  };
  return Number(row.count);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String(error.code) === "ENOENT"
  );
}

function fileStamp(filePath: string): string | null {
  try {
    const stat = statSync(filePath, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

/**
 * Captures main + WAL without opening the source database. Avoiding a source
 * SQLite connection is important: even a readonly WAL reader can change SHM
 * read marks. A stable metadata window gives orphaned post-crash WALs a safe
 * path and causes continuously-changing writers/checkpoints to fail closed.
 */
function copyStableDatabaseSnapshot(sourcePath: string, destinationPath: string): void {
  const sourceWalPath = `${sourcePath}-wal`;
  const destinationWalPath = `${destinationPath}-wal`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    rmSync(destinationPath, { force: true });
    rmSync(destinationWalPath, { force: true });
    rmSync(`${destinationPath}-shm`, { force: true });

    const beforeMain = fileStamp(sourcePath);
    const beforeWal = fileStamp(sourceWalPath);
    if (beforeMain === null) {
      throw new StorageError("NOT_FOUND", {
        details: { entity: "database" },
      });
    }
    try {
      copyFileSync(sourcePath, destinationPath);
      if (beforeWal !== null) copyFileSync(sourceWalPath, destinationWalPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
      }
      continue;
    }

    const afterMain = fileStamp(sourcePath);
    const afterWal = fileStamp(sourceWalPath);
    if (beforeMain === afterMain && beforeWal === afterWal) return;
  }
  throw new StorageError("DATABASE_BUSY", {
    details: { reason: "database_changed_during_snapshot" },
  });
}

export function inspectDatabase(
  filePath: string,
  migrations?: readonly Migration[],
): DatabaseInspection {
  if (!isAbsolute(filePath) || filePath === ":memory:") {
    throw new StorageError("VALIDATION_FAILED", {
      details: { field: "databasePath" },
    });
  }
  if (!existsSync(filePath)) {
    throw new StorageError("NOT_FOUND", { details: { entity: "database" } });
  }
  const inspectionDirectory = mkdtempSync(join(tmpdir(), "dougoos-db-inspect-"));
  const inspectionPath = join(inspectionDirectory, "data.db");
  try {
    copyStableDatabaseSnapshot(filePath, inspectionPath);
  } catch (error) {
    rmSync(inspectionDirectory, { force: true, recursive: true });
    throw error;
  }
  let db: BetterSqlite3.Database;
  try {
    db = new BetterSqlite3(inspectionPath, { fileMustExist: true });
  } catch (error) {
    rmSync(inspectionDirectory, { force: true, recursive: true });
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  }
  try {
    db.pragma("query_only = ON");
    preflightMigrationDatabase(db);
    const applied =
      migrations === undefined
        ? verifyOwnedMigrationHistory(db)
        : verifyMigrationHistory(db, migrations);
    if (migrations !== undefined) verifyStorageSchema(db);
    verifyJournalIntegrity(db);
    const integrityRows = db.pragma("integrity_check") as { readonly integrity_check: string }[];
    if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check.toLowerCase() !== "ok") {
      throw new StorageError("CORRUPT_READ_MODEL", {
        details: { integrityErrors: integrityRows.length },
      });
    }
    const journalState = tableExists(db, "journal_state")
      ? (db
          .prepare(
            `SELECT last_seq AS latestSeq, min_replay_seq AS minAvailableSeq
             FROM journal_state
             WHERE singleton = 1`,
          )
          .get() as { readonly latestSeq: number; readonly minAvailableSeq: number } | undefined)
      : undefined;
    const sqliteVersion = db.prepare(`SELECT sqlite_version() AS version`).get() as {
      readonly version: string;
    };
    const foreignKeyViolations = (db.pragma("foreign_key_check") as unknown[]).length;
    if (foreignKeyViolations > 0) {
      throw new StorageError("CORRUPT_READ_MODEL", {
        details: { foreignKeyViolations },
      });
    }
    return {
      counts: {
        approvals: safeCount(db, "approval_requests"),
        devices: safeCount(db, "devices"),
        messages: safeCount(db, "messages"),
        providers: safeCount(db, "providers_status"),
        sessions: safeCount(db, "sessions"),
        turns: safeCount(db, "turns"),
        usageStats: safeCount(db, "usage_stats"),
      },
      foreignKeyViolations,
      integrity: "ok",
      journal: {
        eventCount: safeCount(db, "session_events"),
        latestSeq: journalState?.latestSeq ?? 0,
        minAvailableSeq: journalState?.minAvailableSeq ?? 0,
        receiptCount: safeCount(db, "event_receipts"),
      },
      migrations: applied.map(({ checksum, id, ordinal }) => ({ checksum, id, ordinal })),
      pragmas: {
        journalMode: String(db.pragma("journal_mode", { simple: true })),
        queryOnly: true,
        synchronous: Number(db.pragma("synchronous", { simple: true })),
        userVersion: Number(db.pragma("user_version", { simple: true })),
      },
      sqliteVersion: sqliteVersion.version,
    };
  } finally {
    db.close();
    rmSync(inspectionDirectory, { force: true, recursive: true });
  }
}
