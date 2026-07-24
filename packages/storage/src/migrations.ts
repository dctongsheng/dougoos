import { createHash } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

import { IsoTimestampSchema } from "@dougoos/shared";

import { StorageError, isSqliteBusyError, isStorageError } from "./errors.js";
import {
  STORAGE_SCHEMA_TABLES,
  verifyStorageBaseInvariants,
  verifyStorageSchema,
} from "./schema.js";

export interface Migration {
  readonly expectedCoreSchemaSha256?: string;
  readonly id: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly appliedAt: string;
  readonly checksum: string;
  readonly id: string;
  readonly ordinal: number;
}

const MIGRATION_BOOTSTRAP_SQL = `
  CREATE TABLE storage_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  INSERT INTO storage_metadata(key, value)
  VALUES ('owner', '@dougoos/storage:v1');

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 1),
    checksum TEXT NOT NULL CHECK (length(checksum) = 64),
    applied_at TEXT NOT NULL
  ) STRICT;
`;

interface SchemaObjectRow {
  readonly name: string;
  readonly sql: string | null;
  readonly tableName: string;
  readonly type: string;
}

interface CoreTableState {
  readonly columns: readonly string[];
  readonly rows: readonly string[];
}

interface CoreState {
  readonly schemaSha256: string;
  readonly tables: ReadonlyMap<string, CoreTableState>;
}

export const STORAGE_BASE_CORE_SCHEMA_SHA256 =
  "611fc2d9aece5d71db632bfd442df1e801cbf320017242c086b4e8f1ba297b1e";

const STORAGE_SCHEMA_TABLE_SET = new Set(STORAGE_SCHEMA_TABLES);

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function coreSchemaRows(db: BetterSqlite3.Database): readonly SchemaObjectRow[] {
  return (
    db
      .prepare(
        `SELECT type, name, tbl_name AS tableName, sql
         FROM sqlite_schema
         ORDER BY type, name`,
      )
      .all() as SchemaObjectRow[]
  ).filter(
    (row) => STORAGE_SCHEMA_TABLE_SET.has(row.name) || STORAGE_SCHEMA_TABLE_SET.has(row.tableName),
  );
}

function coreSchemaFingerprint(db: BetterSqlite3.Database): string {
  return createHash("sha256")
    .update(JSON.stringify(coreSchemaRows(db)), "utf8")
    .digest("hex");
}

function captureCoreState(db: BetterSqlite3.Database): CoreState {
  const existingTables = new Set(
    (
      db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`).all() as {
        readonly name: string;
      }[]
    ).map((row) => row.name),
  );
  const tables = new Map<string, CoreTableState>();
  for (const table of STORAGE_SCHEMA_TABLES) {
    if (!existingTables.has(table)) continue;
    const columns = (
      db.pragma(`table_info(${quoteIdentifier(table)})`) as { readonly name: string }[]
    ).map((column) => column.name);
    const selection = columns.map(quoteIdentifier).join(", ");
    const rows = (
      db.prepare(`SELECT ${selection} FROM ${quoteIdentifier(table)}`).all() as Readonly<
        Record<string, unknown>
      >[]
    )
      .map((row) => JSON.stringify(row))
      .sort();
    tables.set(table, { columns, rows });
  }
  return { schemaSha256: coreSchemaFingerprint(db), tables };
}

function assertExactModuleCoreState(before: CoreState, after: CoreState): void {
  if (before.schemaSha256 !== after.schemaSha256) {
    throw new StorageError("MIGRATION_DRIFT", {
      details: { reason: "module_core_schema_mutation" },
    });
  }
  for (const table of STORAGE_SCHEMA_TABLES) {
    const beforeTable = before.tables.get(table);
    const afterTable = after.tables.get(table);
    if (JSON.stringify(beforeTable) !== JSON.stringify(afterTable)) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { entity: table, reason: "module_core_data_mutation" },
      });
    }
  }
}

function assertStorageRowsPreserved(before: CoreState, db: BetterSqlite3.Database): void {
  for (const [table, beforeTable] of before.tables) {
    const afterColumns = (
      db.pragma(`table_info(${quoteIdentifier(table)})`) as { readonly name: string }[]
    ).map((column) => column.name);
    if (beforeTable.columns.some((column) => !afterColumns.includes(column))) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { entity: table, reason: "storage_core_column_removal" },
      });
    }
    const selection = beforeTable.columns.map(quoteIdentifier).join(", ");
    const remainingRows = new Map<string, number>();
    for (const row of db
      .prepare(`SELECT ${selection} FROM ${quoteIdentifier(table)}`)
      .all() as Readonly<Record<string, unknown>>[]) {
      const serialized = JSON.stringify(row);
      remainingRows.set(serialized, (remainingRows.get(serialized) ?? 0) + 1);
    }
    for (const serialized of beforeTable.rows) {
      const count = remainingRows.get(serialized) ?? 0;
      if (count === 0) {
        throw new StorageError("MIGRATION_DRIFT", {
          details: { entity: table, reason: "storage_core_data_rewrite" },
        });
      }
      remainingRows.set(serialized, count - 1);
    }
  }
}

function schemaFingerprint(db: BetterSqlite3.Database): string {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
       ORDER BY type, name`,
    )
    .all() as SchemaObjectRow[];
  return createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");
}

function writeSchemaFingerprint(db: BetterSqlite3.Database): void {
  const fingerprint = schemaFingerprint(db);
  db.prepare(
    `INSERT INTO storage_metadata(key, value)
     VALUES ('schema_fingerprint', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(fingerprint);
}

export function verifySchemaFingerprint(db: BetterSqlite3.Database): void {
  const stored = db
    .prepare(`SELECT value FROM storage_metadata WHERE key = 'schema_fingerprint'`)
    .get() as { readonly value: string } | undefined;
  if (stored?.value !== schemaFingerprint(db)) {
    throw new StorageError("CORRUPT_READ_MODEL", {
      details: { reason: "schema_fingerprint" },
    });
  }
}

const INITIAL_SCHEMA_SQL = `
  CREATE TABLE journal_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_seq INTEGER NOT NULL CHECK (last_seq >= 0),
    min_replay_seq INTEGER NOT NULL CHECK (
      min_replay_seq >= 0 AND min_replay_seq <= last_seq
    )
  ) STRICT;

  INSERT INTO journal_state(singleton, last_seq, min_replay_seq) VALUES (1, 0, 0);

  CREATE TABLE devices (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    device_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    app_version TEXT NOT NULL
  ) STRICT;

  CREATE TABLE providers_status (
    provider_id TEXT PRIMARY KEY,
    provider_json TEXT NOT NULL CHECK (json_valid(provider_json)),
    checked_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    create_payload_sha256 TEXT NOT NULL CHECK (length(create_payload_sha256) = 64),
    initialization_payload_sha256 TEXT CHECK (
      initialization_payload_sha256 IS NULL OR length(initialization_payload_sha256) = 64
    ),
    provider_session_id TEXT,
    capability_snapshot_json TEXT,
    state TEXT NOT NULL CHECK (
      state IN ('starting', 'idle', 'running', 'awaiting_approval', 'cancelling', 'crashed', 'closed')
    ),
    last_error_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (capability_snapshot_json IS NULL OR json_valid(capability_snapshot_json)),
    CHECK (last_error_json IS NULL OR json_valid(last_error_json)),
    CHECK (
      (
        state = 'starting'
        AND provider_session_id IS NULL
        AND capability_snapshot_json IS NULL
      )
      OR
      (
        state <> 'starting'
        AND provider_session_id IS NOT NULL
        AND capability_snapshot_json IS NOT NULL
      )
    )
  ) STRICT;

  CREATE TABLE turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    client_request_id TEXT NOT NULL,
    request_payload_sha256 TEXT NOT NULL CHECK (length(request_payload_sha256) = 64),
    status TEXT NOT NULL CHECK (
      status IN (
        'queued', 'starting', 'running', 'awaiting_approval', 'cancelling',
        'completed', 'failed', 'cancelled', 'interrupted'
      )
    ),
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    stop_reason TEXT,
    error_json TEXT,
    CHECK (error_json IS NULL OR json_valid(error_json)),
    UNIQUE(session_id, client_request_id),
    UNIQUE(session_id, id)
  ) STRICT;

  CREATE UNIQUE INDEX one_active_turn_per_session
  ON turns(session_id)
  WHERE status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling');

  CREATE INDEX turns_session_created
  ON turns(session_id, created_at, id);

  CREATE TABLE usage_stats (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    cached_input_tokens INTEGER CHECK (cached_input_tokens >= 0),
    quality TEXT NOT NULL CHECK (quality IN ('estimated', 'exact', 'mixed', 'unavailable')),
    FOREIGN KEY(session_id, turn_id) REFERENCES turns(session_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX usage_stats_session
  ON usage_stats(session_id, turn_id);

  CREATE TABLE event_receipts (
    event_id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE CHECK (seq >= 1),
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
    payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 1),
    received_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE session_events (
    seq INTEGER PRIMARY KEY CHECK (seq >= 1),
    event_id TEXT NOT NULL UNIQUE REFERENCES event_receipts(event_id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    turn_id TEXT,
    type TEXT NOT NULL,
    event_json TEXT NOT NULL CHECK (json_valid(event_json)),
    occurred_at TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    FOREIGN KEY(session_id, turn_id) REFERENCES turns(session_id, id)
  ) STRICT;

  CREATE INDEX session_events_session_seq
  ON session_events(session_id, seq);

  CREATE INDEX session_events_committed_seq
  ON session_events(committed_at, seq);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('user', 'text', 'note', 'think', 'tool', 'diff', 'approval')),
    body TEXT,
    stream_state TEXT CHECK (stream_state IS NULL OR stream_state IN ('streaming', 'complete')),
    note_level TEXT CHECK (note_level IS NULL OR note_level IN ('info', 'success', 'warn')),
    tool_call_id TEXT,
    tool_kind TEXT CHECK (
      tool_kind IS NULL OR tool_kind IN (
        'delete', 'edit', 'mcp', 'network', 'other', 'read', 'search', 'shell', 'write'
      )
    ),
    tool_status TEXT CHECK (
      tool_status IS NULL OR tool_status IN ('pending', 'running', 'done', 'error', 'cancelled')
    ),
    title TEXT,
    display_input TEXT,
    result_json TEXT,
    diff_json TEXT,
    request_id TEXT,
    created_at TEXT NOT NULL,
    created_seq INTEGER NOT NULL CHECK (created_seq >= 1),
    updated_seq INTEGER NOT NULL CHECK (updated_seq >= created_seq),
    CHECK (result_json IS NULL OR json_valid(result_json)),
    CHECK (diff_json IS NULL OR json_valid(diff_json)),
    UNIQUE(session_id, source_message_id),
    FOREIGN KEY(session_id, turn_id) REFERENCES turns(session_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX messages_session_created
  ON messages(session_id, created_at, id);

  CREATE TABLE approval_requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'allowed', 'rejected', 'expired', 'cancelled')
    ),
    title TEXT NOT NULL,
    description TEXT,
    options_json TEXT NOT NULL CHECK (json_valid(options_json)),
    decision_json TEXT CHECK (decision_json IS NULL OR json_valid(decision_json)),
    expires_at TEXT NOT NULL,
    resolved_at TEXT,
    created_seq INTEGER NOT NULL CHECK (created_seq >= 1),
    updated_seq INTEGER NOT NULL CHECK (updated_seq >= created_seq),
    UNIQUE(session_id, turn_id, request_id),
    FOREIGN KEY(session_id, turn_id) REFERENCES turns(session_id, id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX approval_requests_session_turn
  ON approval_requests(session_id, turn_id, request_id);

  CREATE INDEX approval_requests_pending
  ON approval_requests(session_id, turn_id)
  WHERE status = 'pending';
`;

export const DEFAULT_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    expectedCoreSchemaSha256: STORAGE_BASE_CORE_SCHEMA_SHA256,
    id: "storage:0001",
    sql: INITIAL_SCHEMA_SQL,
  }),
]);

function migrationTableExists(db: BetterSqlite3.Database): boolean {
  return (
    db
      .prepare(
        `SELECT 1
         FROM sqlite_schema
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get() !== undefined
  );
}

export function preflightMigrationDatabase(db: BetterSqlite3.Database): void {
  const userTables = (
    db
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as { readonly name: string }[]
  ).map((row) => row.name);
  if (migrationTableExists(db)) {
    if (!userTables.includes("storage_metadata")) {
      throw new StorageError("MIGRATION_UNKNOWN", {
        details: { userVersion: Number(db.pragma("user_version", { simple: true })) },
      });
    }
    let owner: { readonly value: string } | undefined;
    try {
      owner = db.prepare(`SELECT value FROM storage_metadata WHERE key = 'owner'`).get() as
        { readonly value: string } | undefined;
    } catch (error) {
      throw new StorageError("MIGRATION_UNKNOWN", { cause: error });
    }
    if (owner?.value !== "@dougoos/storage:v1") {
      throw new StorageError("MIGRATION_UNKNOWN", {
        details: { userVersion: Number(db.pragma("user_version", { simple: true })) },
      });
    }
    return;
  }
  const userVersion = Number(db.pragma("user_version", { simple: true }));
  if (userVersion !== 0 || userTables.length > 0) {
    throw new StorageError("MIGRATION_UNKNOWN", {
      details: { userVersion },
    });
  }
}

function migrationChecksum(migration: Migration): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        expectedCoreSchemaSha256: migration.expectedCoreSchemaSha256 ?? null,
        sql: migration.sql,
      }),
      "utf8",
    )
    .digest("hex");
}

const MIGRATION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?:[0-9]{4,}$/u;
const MIGRATION_CHECKSUM_PATTERN = /^[a-f0-9]{64}$/u;

export function validateMigrationManifest(migrations: readonly Migration[]): void {
  const ids = new Set<string>();
  for (const migration of migrations) {
    if (ids.has(migration.id)) {
      throw new StorageError("MIGRATION_DUPLICATE_ID", {
        details: { migrationId: migration.id },
      });
    }
    ids.add(migration.id);
    if (!MIGRATION_ID_PATTERN.test(migration.id)) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { migrationId: migration.id, reason: "invalid_id" },
      });
    }
    if (migration.sql.trim().length === 0) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { migrationId: migration.id, reason: "empty_sql" },
      });
    }
    if (
      migration.id.startsWith("storage:") &&
      (migration.expectedCoreSchemaSha256 === undefined ||
        !MIGRATION_CHECKSUM_PATTERN.test(migration.expectedCoreSchemaSha256))
    ) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { migrationId: migration.id, reason: "missing_core_schema_fingerprint" },
      });
    }
  }
  for (const [index, base] of DEFAULT_MIGRATIONS.entries()) {
    const candidate = migrations[index];
    if (
      candidate === undefined ||
      candidate.id !== base.id ||
      migrationChecksum(candidate) !== migrationChecksum(base)
    ) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { ordinal: index + 1, reason: "base_prefix" },
      });
    }
  }
}

function readApplied(db: BetterSqlite3.Database): AppliedMigration[] {
  return db
    .prepare(
      `SELECT id, ordinal, checksum, applied_at AS appliedAt
       FROM schema_migrations
       ORDER BY ordinal`,
    )
    .all() as AppliedMigration[];
}

function verifyAppliedLedgerShape(db: BetterSqlite3.Database): readonly AppliedMigration[] {
  preflightMigrationDatabase(db);
  if (!migrationTableExists(db)) {
    throw new StorageError("MIGRATION_UNKNOWN");
  }

  let applied: readonly AppliedMigration[];
  try {
    applied = readApplied(db);
  } catch (error) {
    throw new StorageError("MIGRATION_DRIFT", {
      cause: error,
      details: { reason: "unreadable_ledger" },
    });
  }

  for (const [index, row] of applied.entries()) {
    if (
      row.ordinal !== index + 1 ||
      !MIGRATION_ID_PATTERN.test(row.id) ||
      !MIGRATION_CHECKSUM_PATTERN.test(row.checksum)
    ) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { migrationId: row.id, ordinal: row.ordinal },
      });
    }
    try {
      IsoTimestampSchema.parse(row.appliedAt);
    } catch (error) {
      throw new StorageError("MIGRATION_DRIFT", {
        cause: error,
        details: {
          migrationId: row.id,
          ordinal: row.ordinal,
          reason: "invalid_applied_at",
        },
      });
    }
  }

  const userVersion = Number(db.pragma("user_version", { simple: true }));
  if (!Number.isSafeInteger(userVersion) || userVersion < 0) {
    throw new StorageError("MIGRATION_UNKNOWN", {
      details: { userVersion },
    });
  }
  if (userVersion !== applied.length) {
    throw new StorageError("MIGRATION_DRIFT", {
      details: { appliedCount: applied.length, userVersion },
    });
  }
  return applied;
}

/**
 * Verifies an owned database without executing or trusting SQL from migrations
 * that are not available to the inspector. This is intentionally read-only:
 * the immutable base prefix, append-only ledger shape, owner marker, current
 * schema fingerprint, and required storage schema must all agree.
 */
export function verifyOwnedMigrationHistory(
  db: BetterSqlite3.Database,
): readonly AppliedMigration[] {
  const applied = verifyAppliedLedgerShape(db);
  for (const [index, base] of DEFAULT_MIGRATIONS.entries()) {
    const row = applied[index];
    if (row === undefined || row.id !== base.id || row.checksum !== migrationChecksum(base)) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { ordinal: index + 1, reason: "base_prefix" },
      });
    }
  }
  verifySchemaFingerprint(db);
  const latestStorage = [...applied].reverse().find((row) => row.id.startsWith("storage:"));
  const expectedCoreSchemaSha256 =
    latestStorage === undefined
      ? undefined
      : DEFAULT_MIGRATIONS.find((migration) => migration.id === latestStorage.id)
          ?.expectedCoreSchemaSha256;
  if (
    latestStorage !== undefined &&
    (expectedCoreSchemaSha256 === undefined ||
      coreSchemaFingerprint(db) !== expectedCoreSchemaSha256)
  ) {
    throw new StorageError("MIGRATION_DRIFT", {
      details: { migrationId: latestStorage.id, reason: "core_schema_fingerprint" },
    });
  }
  verifyStorageSchema(db);
  return applied;
}

export function verifyMigrationHistory(
  db: BetterSqlite3.Database,
  migrations: readonly Migration[] = DEFAULT_MIGRATIONS,
): readonly AppliedMigration[] {
  validateMigrationManifest(migrations);
  const applied = verifyAppliedLedgerShape(db);
  const manifestById = new Map(
    migrations.map((migration, index) => [migration.id, { index, migration }]),
  );

  for (const row of applied) {
    const expected = manifestById.get(row.id);
    if (expected === undefined) {
      throw new StorageError("MIGRATION_UNKNOWN", {
        details: { migrationId: row.id, ordinal: row.ordinal },
      });
    }
    if (
      row.ordinal !== expected.index + 1 ||
      row.checksum !== migrationChecksum(expected.migration)
    ) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { migrationId: row.id, ordinal: row.ordinal },
      });
    }
  }

  const userVersion = Number(db.pragma("user_version", { simple: true }));
  if (userVersion > migrations.length) {
    throw new StorageError("MIGRATION_UNKNOWN", {
      details: { userVersion },
    });
  }
  verifySchemaFingerprint(db);
  const latestStorage = [...applied].reverse().find((row) => row.id.startsWith("storage:"));
  if (latestStorage !== undefined) {
    const expectedCoreSchemaSha256 = manifestById.get(latestStorage.id)?.migration
      .expectedCoreSchemaSha256;
    if (
      expectedCoreSchemaSha256 === undefined ||
      coreSchemaFingerprint(db) !== expectedCoreSchemaSha256
    ) {
      throw new StorageError("MIGRATION_DRIFT", {
        details: { migrationId: latestStorage.id, reason: "core_schema_fingerprint" },
      });
    }
  }
  return applied;
}

export function applyMigrations(
  db: BetterSqlite3.Database,
  migrations: readonly Migration[] = DEFAULT_MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
  verifyCurrentState: (database: BetterSqlite3.Database) => void = () => undefined,
): readonly AppliedMigration[] {
  validateMigrationManifest(migrations);
  preflightMigrationDatabase(db);
  let activeMigration = migrations[0];
  let activeOrdinal = 1;
  let applyingMigration = false;

  const applyOne = (migration: Migration, ordinal: number): void => {
    const appliedAt = new Date(IsoTimestampSchema.parse(now())).toISOString();
    const before = captureCoreState(db);
    db.exec(migration.sql);
    verifyStorageBaseInvariants(db);
    if (migration.id.startsWith("storage:")) {
      assertStorageRowsPreserved(before, db);
      if (coreSchemaFingerprint(db) !== migration.expectedCoreSchemaSha256) {
        throw new StorageError("MIGRATION_DRIFT", {
          details: {
            migrationId: migration.id,
            reason: "core_schema_fingerprint",
          },
        });
      }
    } else {
      assertExactModuleCoreState(before, captureCoreState(db));
    }
    db.prepare(
      `INSERT INTO schema_migrations(id, ordinal, checksum, applied_at)
       VALUES (?, ?, ?, ?)`,
    ).run(migration.id, ordinal, migrationChecksum(migration), appliedAt);
    db.pragma(`user_version = ${ordinal}`);
    writeSchemaFingerprint(db);
    verifySchemaFingerprint(db);
  };

  const applyFrom = (nextIndex: number): readonly AppliedMigration[] => {
    for (let index = nextIndex; index < migrations.length; index += 1) {
      const migration = migrations[index];
      if (migration === undefined) continue;
      activeMigration = migration;
      activeOrdinal = index + 1;
      applyingMigration = true;
      applyOne(migration, activeOrdinal);
    }
    verifyStorageSchema(db);
    verifySchemaFingerprint(db);
    return readApplied(db);
  };

  try {
    if (!migrationTableExists(db)) {
      applyingMigration = true;
      return db
        .transaction(() => {
          preflightMigrationDatabase(db);
          if (migrationTableExists(db)) {
            throw new StorageError("MIGRATION_DRIFT", {
              details: { reason: "bootstrap_race" },
            });
          }
          db.exec(MIGRATION_BOOTSTRAP_SQL);
          return applyFrom(0);
        })
        .immediate();
    }

    return db
      .transaction(() => {
        const applied = verifyMigrationHistory(db, migrations);
        verifyStorageBaseInvariants(db);
        verifyCurrentState(db);
        return applyFrom(applied.length);
      })
      .immediate();
  } catch (error) {
    if (isSqliteBusyError(error)) {
      throw new StorageError("DATABASE_BUSY", { cause: error });
    }
    if (!applyingMigration && isStorageError(error)) throw error;
    throw new StorageError("MIGRATION_FAILED", {
      cause: error,
      details: {
        migrationId: activeMigration?.id ?? "unknown",
        ordinal: activeOrdinal,
      },
    });
  }
}
