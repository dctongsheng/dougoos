import type BetterSqlite3 from "better-sqlite3";

import {
  ApprovalSchema,
  ErrorPayloadSchema,
  MessageSchema,
  SessionSchema,
  TurnSchema,
  type Approval,
  type Message,
  type Session,
  type Turn,
} from "@dougoos/shared";

import { StorageError } from "./errors.js";

export interface SessionRow {
  readonly capabilitySnapshotJson: string | null;
  readonly createdAt: string;
  readonly cwd: string;
  readonly id: string;
  readonly lastErrorJson: string | null;
  readonly providerId: string;
  readonly providerSessionId: string | null;
  readonly source: string;
  readonly state: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface TurnRow {
  readonly clientRequestId: string;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly errorJson: string | null;
  readonly id: string;
  readonly requestPayloadSha256: string;
  readonly sessionId: string;
  readonly startedAt: string | null;
  readonly status: string;
  readonly stopReason: string | null;
}

export interface MessageRow {
  readonly body: string | null;
  readonly createdAt: string;
  readonly diffJson: string | null;
  readonly displayInput: string | null;
  readonly id: string;
  readonly kind: string;
  readonly noteLevel: string | null;
  readonly requestId: string | null;
  readonly resultJson: string | null;
  readonly sessionId: string;
  readonly sourceMessageId: string;
  readonly streamState: string | null;
  readonly title: string | null;
  readonly toolCallId: string | null;
  readonly toolKind: string | null;
  readonly toolStatus: string | null;
  readonly turnId: string;
}

export interface ApprovalRow {
  readonly decisionJson: string | null;
  readonly description: string | null;
  readonly expiresAt: string;
  readonly id: string;
  readonly optionsJson: string;
  readonly requestId: string;
  readonly resolvedAt: string | null;
  readonly sessionId: string;
  readonly status: string;
  readonly title: string;
  readonly turnId: string;
}

const SESSION_COLUMNS = `
  id,
  source,
  provider_id AS providerId,
  cwd,
  title,
  provider_session_id AS providerSessionId,
  capability_snapshot_json AS capabilitySnapshotJson,
  state,
  last_error_json AS lastErrorJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const TURN_COLUMNS = `
  id,
  session_id AS sessionId,
  client_request_id AS clientRequestId,
  request_payload_sha256 AS requestPayloadSha256,
  status,
  created_at AS createdAt,
  started_at AS startedAt,
  ended_at AS endedAt,
  stop_reason AS stopReason,
  error_json AS errorJson
`;

const MESSAGE_COLUMNS = `
  id,
  session_id AS sessionId,
  turn_id AS turnId,
  source_message_id AS sourceMessageId,
  kind,
  body,
  stream_state AS streamState,
  note_level AS noteLevel,
  tool_call_id AS toolCallId,
  tool_kind AS toolKind,
  tool_status AS toolStatus,
  title,
  display_input AS displayInput,
  result_json AS resultJson,
  diff_json AS diffJson,
  request_id AS requestId,
  created_at AS createdAt
`;

const APPROVAL_COLUMNS = `
  id,
  session_id AS sessionId,
  turn_id AS turnId,
  request_id AS requestId,
  status,
  title,
  description,
  options_json AS optionsJson,
  decision_json AS decisionJson,
  expires_at AS expiresAt,
  resolved_at AS resolvedAt
`;

export function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  }
}

function parseReadModel<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  }
}

export function mapSession(row: SessionRow): Session {
  return parseReadModel(() => {
    if (row.lastErrorJson !== null) {
      ErrorPayloadSchema.parse(parseStoredJson(row.lastErrorJson));
    }
    return SessionSchema.parse({
      capabilities:
        row.capabilitySnapshotJson === null ? null : parseStoredJson(row.capabilitySnapshotJson),
      createdAt: row.createdAt,
      cwd: row.cwd,
      id: row.id,
      providerId: row.providerId,
      providerSessionId: row.providerSessionId,
      source: row.source,
      state: row.state,
      title: row.title,
      updatedAt: row.updatedAt,
    });
  });
}

export function mapTurn(row: TurnRow): Turn {
  return parseReadModel(() =>
    TurnSchema.parse({
      clientRequestId: row.clientRequestId,
      createdAt: row.createdAt,
      endedAt: row.endedAt,
      error: row.errorJson === null ? null : parseStoredJson(row.errorJson),
      id: row.id,
      sessionId: row.sessionId,
      startedAt: row.startedAt,
      status: row.status,
      stopReason: row.stopReason,
    }),
  );
}

export function mapMessage(row: MessageRow): Message {
  return parseReadModel(() => {
    const base = {
      createdAt: row.createdAt,
      id: row.id,
      sessionId: row.sessionId,
      turnId: row.turnId,
    };
    switch (row.kind) {
      case "user":
        return MessageSchema.parse({ ...base, body: row.body, kind: "user" });
      case "text":
        return MessageSchema.parse({
          ...base,
          body: row.body,
          kind: "text",
          state: row.streamState,
        });
      case "note":
        return MessageSchema.parse({
          ...base,
          body: row.body,
          kind: "note",
          level: row.noteLevel,
        });
      case "think":
        return MessageSchema.parse({
          ...base,
          body: row.body,
          kind: "think",
          state: row.streamState,
        });
      case "tool":
        return MessageSchema.parse({
          ...base,
          ...(row.displayInput === null ? {} : { displayInput: row.displayInput }),
          kind: "tool",
          ...(row.resultJson === null ? {} : { result: parseStoredJson(row.resultJson) }),
          status: row.toolStatus,
          title: row.title,
          toolCallId: row.toolCallId,
          toolKind: row.toolKind,
        });
      case "diff":
        return MessageSchema.parse({
          ...base,
          diff: row.diffJson === null ? null : parseStoredJson(row.diffJson),
          kind: "diff",
        });
      case "approval":
        return MessageSchema.parse({
          ...base,
          ...(row.body === null ? {} : { description: row.body }),
          kind: "approval",
          requestId: row.requestId,
        });
      default:
        throw new StorageError("CORRUPT_READ_MODEL");
    }
  });
}

export function mapApproval(row: ApprovalRow): Approval {
  return parseReadModel(() =>
    ApprovalSchema.parse({
      decision: row.decisionJson === null ? null : parseStoredJson(row.decisionJson),
      ...(row.description === null ? {} : { description: row.description }),
      expiresAt: row.expiresAt,
      id: row.id,
      options: parseStoredJson(row.optionsJson),
      requestId: row.requestId,
      resolvedAt: row.resolvedAt,
      sessionId: row.sessionId,
      status: row.status,
      title: row.title,
      turnId: row.turnId,
    }),
  );
}

export function readSessionRow(
  db: BetterSqlite3.Database,
  sessionId: string,
): SessionRow | undefined {
  return db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(sessionId) as
    SessionRow | undefined;
}

export function readSession(db: BetterSqlite3.Database, sessionId: string): Session {
  const row = readSessionRow(db, sessionId);
  if (row === undefined) {
    throw new StorageError("NOT_FOUND", { details: { entity: "session" } });
  }
  return mapSession(row);
}

export function readTurnRow(db: BetterSqlite3.Database, turnId: string): TurnRow | undefined {
  return db.prepare(`SELECT ${TURN_COLUMNS} FROM turns WHERE id = ?`).get(turnId) as
    TurnRow | undefined;
}

export function readTurn(db: BetterSqlite3.Database, turnId: string): Turn {
  const row = readTurnRow(db, turnId);
  if (row === undefined) {
    throw new StorageError("NOT_FOUND", { details: { entity: "turn" } });
  }
  return mapTurn(row);
}

export function readMessageRow(
  db: BetterSqlite3.Database,
  sessionId: string,
  sourceMessageId: string,
): MessageRow | undefined {
  return db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages
       WHERE session_id = ? AND source_message_id = ?`,
    )
    .get(sessionId, sourceMessageId) as MessageRow | undefined;
}

export function readApprovalRow(
  db: BetterSqlite3.Database,
  sessionId: string,
  turnId: string,
  requestId: string,
): ApprovalRow | undefined {
  return db
    .prepare(
      `SELECT ${APPROVAL_COLUMNS}
       FROM approval_requests
       WHERE session_id = ? AND turn_id = ? AND request_id = ?`,
    )
    .get(sessionId, turnId, requestId) as ApprovalRow | undefined;
}

export function readApprovalForTurnRow(
  db: BetterSqlite3.Database,
  turnId: string,
  requestId: string,
): ApprovalRow | undefined {
  return db
    .prepare(
      `SELECT ${APPROVAL_COLUMNS}
       FROM approval_requests
       WHERE turn_id = ? AND request_id = ?`,
    )
    .get(turnId, requestId) as ApprovalRow | undefined;
}

export function listTurnRows(db: BetterSqlite3.Database, sessionId: string): TurnRow[] {
  return db
    .prepare(
      `SELECT ${TURN_COLUMNS}
       FROM turns
       WHERE session_id = ?
       ORDER BY julianday(created_at), id`,
    )
    .all(sessionId) as TurnRow[];
}

export function listMessageRows(db: BetterSqlite3.Database, sessionId: string): MessageRow[] {
  return db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages
       WHERE session_id = ?
       ORDER BY created_seq, id`,
    )
    .all(sessionId) as MessageRow[];
}

export function listApprovalRows(db: BetterSqlite3.Database, sessionId: string): ApprovalRow[] {
  return db
    .prepare(
      `SELECT ${APPROVAL_COLUMNS}
       FROM approval_requests
       WHERE session_id = ?
       ORDER BY created_seq, id`,
    )
    .all(sessionId) as ApprovalRow[];
}

export function listSessionRows(db: BetterSqlite3.Database): SessionRow[] {
  return db
    .prepare(
      `SELECT ${SESSION_COLUMNS}
       FROM sessions
       ORDER BY julianday(updated_at) DESC, id`,
    )
    .all() as SessionRow[];
}

export const ROW_SQL = {
  approvalColumns: APPROVAL_COLUMNS,
  messageColumns: MESSAGE_COLUMNS,
  sessionColumns: SESSION_COLUMNS,
  turnColumns: TURN_COLUMNS,
} as const;
