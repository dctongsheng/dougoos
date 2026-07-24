import type BetterSqlite3 from "better-sqlite3";

import { StorageError } from "./errors.js";

const BASE_REQUIRED_COLUMNS = {
  approval_requests: [
    "id",
    "session_id",
    "turn_id",
    "request_id",
    "status",
    "title",
    "description",
    "options_json",
    "decision_json",
    "expires_at",
    "resolved_at",
    "created_seq",
    "updated_seq",
  ],
  devices: ["singleton", "device_id", "created_at", "app_version"],
  event_receipts: ["event_id", "seq", "payload_sha256", "payload_bytes", "received_at"],
  journal_state: ["singleton", "last_seq", "min_replay_seq"],
  messages: [
    "id",
    "session_id",
    "turn_id",
    "source_message_id",
    "kind",
    "body",
    "stream_state",
    "note_level",
    "tool_call_id",
    "tool_kind",
    "tool_status",
    "title",
    "display_input",
    "result_json",
    "diff_json",
    "request_id",
    "created_at",
    "created_seq",
    "updated_seq",
  ],
  providers_status: ["provider_id", "provider_json", "checked_at"],
  schema_migrations: ["id", "ordinal", "checksum", "applied_at"],
  session_events: [
    "seq",
    "event_id",
    "session_id",
    "turn_id",
    "type",
    "event_json",
    "occurred_at",
    "committed_at",
  ],
  sessions: [
    "id",
    "source",
    "provider_id",
    "cwd",
    "title",
    "create_payload_sha256",
    "initialization_payload_sha256",
    "provider_session_id",
    "capability_snapshot_json",
    "state",
    "last_error_json",
    "created_at",
    "updated_at",
  ],
  storage_metadata: ["key", "value"],
  usage_stats: [
    "turn_id",
    "session_id",
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "quality",
  ],
  turns: [
    "id",
    "session_id",
    "client_request_id",
    "request_payload_sha256",
    "status",
    "created_at",
    "started_at",
    "ended_at",
    "stop_reason",
    "error_json",
  ],
} as const;

const CURRENT_EXPECTED_COLUMNS = {
  ...BASE_REQUIRED_COLUMNS,
} as const;

const BASE_REQUIRED_INDEX_SQL = {
  approval_requests_pending:
    "CREATE INDEX approval_requests_pending ON approval_requests(session_id, turn_id) WHERE status = 'pending'",
  approval_requests_session_turn:
    "CREATE INDEX approval_requests_session_turn ON approval_requests(session_id, turn_id, request_id)",
  messages_session_created:
    "CREATE INDEX messages_session_created ON messages(session_id, created_at, id)",
  one_active_turn_per_session:
    "CREATE UNIQUE INDEX one_active_turn_per_session ON turns(session_id) WHERE status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')",
  session_events_committed_seq:
    "CREATE INDEX session_events_committed_seq ON session_events(committed_at, seq)",
  session_events_session_seq:
    "CREATE INDEX session_events_session_seq ON session_events(session_id, seq)",
  turns_session_created: "CREATE INDEX turns_session_created ON turns(session_id, created_at, id)",
  usage_stats_session: "CREATE INDEX usage_stats_session ON usage_stats(session_id, turn_id)",
} as const;

const CURRENT_REQUIRED_INDEX_SQL = {
  ...BASE_REQUIRED_INDEX_SQL,
} as const;

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").replace(/;$/u, "").trim().toLowerCase();
}

function corrupt(details: Readonly<Record<string, boolean | number | string | null>>): never {
  throw new StorageError("CORRUPT_READ_MODEL", { details });
}

function verifyDatabaseHealth(db: BetterSqlite3.Database): void {
  const quickCheck = db.pragma("quick_check") as { readonly quick_check: string }[];
  if (quickCheck.length !== 1 || quickCheck[0]?.quick_check.toLowerCase() !== "ok") {
    corrupt({ check: "quick_check", errors: quickCheck.length });
  }
  const foreignKeyViolations = (db.pragma("foreign_key_check") as unknown[]).length;
  if (foreignKeyViolations > 0) {
    corrupt({ check: "foreign_key_check", errors: foreignKeyViolations });
  }
}

function readColumns(db: BetterSqlite3.Database, table: string): readonly string[] {
  const tableRow = db
    .prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`)
    .get(table);
  if (tableRow === undefined) corrupt({ entity: table, reason: "missing_table" });
  return (db.pragma(`table_info("${table}")`) as { readonly name: string }[]).map(
    (column) => column.name,
  );
}

function verifyIndexes(
  db: BetterSqlite3.Database,
  expectedIndexes: Readonly<Record<string, string>>,
): void {
  for (const [index, expectedSql] of Object.entries(expectedIndexes)) {
    const row = db
      .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?`)
      .get(index) as { readonly sql: string | null } | undefined;
    if (row?.sql === null || row === undefined) {
      corrupt({ entity: index, reason: "missing_index" });
    }
    if (normalizeSql(row.sql) !== normalizeSql(expectedSql)) {
      corrupt({ entity: index, reason: "index_drift" });
    }
  }
}

function verifyOwnerAndJournal(db: BetterSqlite3.Database): void {
  const owner = db.prepare(`SELECT value FROM storage_metadata WHERE key = 'owner'`).get() as
    { readonly value: string } | undefined;
  if (owner?.value !== "@dougoos/storage:v1") {
    corrupt({ entity: "storage_metadata", reason: "owner" });
  }
  const journalRows = db
    .prepare(
      `SELECT last_seq AS lastSeq, min_replay_seq AS minReplaySeq
       FROM journal_state`,
    )
    .all() as { readonly lastSeq: number; readonly minReplaySeq: number }[];
  const journal = journalRows[0];
  if (
    journalRows.length !== 1 ||
    journal === undefined ||
    journal.lastSeq < 0 ||
    journal.minReplaySeq < 0 ||
    journal.minReplaySeq > journal.lastSeq
  ) {
    corrupt({ entity: "journal_state", reason: "singleton" });
  }
}

/**
 * Immutable storage:0001 invariants checked inside every migration
 * transaction. Current/future migrations may add columns or objects, but they
 * may not remove the base columns, rewrite base indexes, or damage ownership
 * and singleton state.
 */
export function verifyStorageBaseInvariants(db: BetterSqlite3.Database): void {
  verifyDatabaseHealth(db);
  for (const [table, requiredColumns] of Object.entries(BASE_REQUIRED_COLUMNS)) {
    const columns = readColumns(db, table);
    if (requiredColumns.some((column) => !columns.includes(column))) {
      corrupt({ entity: table, reason: "missing_base_column" });
    }
  }
  verifyIndexes(db, BASE_REQUIRED_INDEX_SQL);
  verifyOwnerAndJournal(db);
}

export function verifyStorageSchema(db: BetterSqlite3.Database): void {
  verifyStorageBaseInvariants(db);
  for (const [table, expectedColumns] of Object.entries(CURRENT_EXPECTED_COLUMNS)) {
    const columns = readColumns(db, table);
    if (
      columns.length !== expectedColumns.length ||
      columns.some((column, index) => column !== expectedColumns[index])
    ) {
      corrupt({ entity: table, reason: "column_drift" });
    }
  }

  verifyIndexes(db, CURRENT_REQUIRED_INDEX_SQL);

  const currentTables = new Set(Object.keys(CURRENT_EXPECTED_COLUMNS));
  const currentIndexes = new Set(Object.keys(CURRENT_REQUIRED_INDEX_SQL));
  const unexpectedCoreIndex = (
    db
      .prepare(
        `SELECT name, tbl_name AS tableName
         FROM sqlite_schema
         WHERE type = 'index' AND sql IS NOT NULL
         ORDER BY name`,
      )
      .all() as { readonly name: string; readonly tableName: string }[]
  ).find((row) => currentTables.has(row.tableName) && !currentIndexes.has(row.name));
  if (unexpectedCoreIndex !== undefined) {
    corrupt({
      entity: unexpectedCoreIndex.name,
      reason: "unexpected_core_index",
    });
  }
  const unexpectedCoreTrigger = (
    db
      .prepare(
        `SELECT name, tbl_name AS tableName
         FROM sqlite_schema
         WHERE type = 'trigger'
         ORDER BY name`,
      )
      .all() as { readonly name: string; readonly tableName: string }[]
  ).find((row) => currentTables.has(row.tableName));
  if (unexpectedCoreTrigger !== undefined) {
    corrupt({
      entity: unexpectedCoreTrigger.name,
      reason: "unexpected_core_trigger",
    });
  }
}

export const STORAGE_SCHEMA_TABLES = Object.freeze(Object.keys(CURRENT_EXPECTED_COLUMNS));
