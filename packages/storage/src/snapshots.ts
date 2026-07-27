import type BetterSqlite3 from "better-sqlite3";

import {
  CONTRACT_LIMITS,
  GlobalSnapshotSchema,
  SessionSnapshotSchema,
  SessionSnapshotSeqSchema,
  SnapshotQuerySchema,
  checkGlobalSnapshotCoverage,
  isActiveTurnStatus,
  normalizeSingleLinePreview,
  type GlobalSnapshot,
  type SessionSnapshot,
  type SessionSummary,
} from "@dougoos/shared";

import { StorageError, isStorageError } from "./errors.js";
import {
  ROW_SQL,
  listApprovalRows,
  listMessageRows,
  listSessionRows,
  listTurnRows,
  mapApproval,
  mapMessage,
  mapSession,
  mapTurn,
  readSession,
  type ApprovalRow,
  type MessageRow,
  type TurnRow,
} from "./rows.js";

function count(
  db: BetterSqlite3.Database,
  table: "approval_requests" | "messages" | "turns",
  sessionId: string,
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`)
    .get(sessionId) as { readonly count: number };
  return Number(row.count);
}

function assertSessionLimits(db: BetterSqlite3.Database, sessionId: string): void {
  const counts = {
    approvals: count(db, "approval_requests", sessionId),
    messages: count(db, "messages", sessionId),
    turns: count(db, "turns", sessionId),
  };
  if (
    counts.approvals > CONTRACT_LIMITS.approvalsPerSessionSnapshot ||
    counts.messages > CONTRACT_LIMITS.messagesPerSessionSnapshot ||
    counts.turns > CONTRACT_LIMITS.turnsPerSessionSnapshot
  ) {
    throw new StorageError("SNAPSHOT_LIMIT_EXCEEDED", {
      details: {
        approvalCount: counts.approvals,
        messageCount: counts.messages,
        turnCount: counts.turns,
      },
    });
  }
}

function parseSnapshot<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (isStorageError(error)) throw error;
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  }
}

export function buildSessionSnapshot(
  db: BetterSqlite3.Database,
  sessionId: string,
  snapshotSeq: number,
): SessionSnapshot {
  assertSessionLimits(db, sessionId);
  return parseSnapshot(() =>
    SessionSnapshotSchema.parse({
      approvals: listApprovalRows(db, sessionId).map(mapApproval),
      messages: listMessageRows(db, sessionId).map(mapMessage),
      session: readSession(db, sessionId),
      sessionSnapshotSeq: SessionSnapshotSeqSchema.parse(snapshotSeq),
      turns: listTurnRows(db, sessionId).map(mapTurn),
    }),
  );
}

function sessionSummary(
  db: BetterSqlite3.Database,
  sessionId: string,
  activeTurnId: string | null,
): SessionSummary {
  const session = readSession(db, sessionId);
  const messageCount = Number(
    (
      db.prepare(`SELECT COUNT(*) AS count FROM messages WHERE session_id = ?`).get(sessionId) as {
        readonly count: number;
      }
    ).count,
  );
  const last = db
    .prepare(
      `SELECT COALESCE(body, title) AS value
       FROM messages
       WHERE session_id = ? AND kind <> 'think'
       ORDER BY created_seq DESC, id DESC
       LIMIT 1`,
    )
    .get(sessionId) as { readonly value: string | null } | undefined;
  const firstUser = db
    .prepare(
      `SELECT body AS value
       FROM messages
       WHERE session_id = ? AND kind = 'user'
       ORDER BY created_seq ASC, id ASC
       LIMIT 1`,
    )
    .get(sessionId) as { readonly value: string | null } | undefined;
  const firstUserMessagePreview = normalizeSingleLinePreview(
    firstUser?.value ?? "",
    CONTRACT_LIMITS.titleChars,
  );
  const lastMessagePreview = normalizeSingleLinePreview(last?.value ?? "", 512);
  return {
    activeTurnId: activeTurnId as SessionSummary["activeTurnId"],
    cwd: session.cwd,
    ...(firstUserMessagePreview === undefined ? {} : { firstUserMessagePreview }),
    id: session.id,
    ...(lastMessagePreview === undefined ? {} : { lastMessagePreview }),
    messageCount,
    permission: session.permission,
    providerId: session.providerId,
    state: session.state,
    title: session.title,
    updatedAt: session.updatedAt,
  };
}

export function buildGlobalSnapshot(
  db: BetterSqlite3.Database,
  includeSessionIds: readonly string[],
  snapshotSeq: number,
): GlobalSnapshot {
  const query = parseSnapshot(() =>
    SnapshotQuerySchema.parse({ includeSessionId: includeSessionIds }),
  );
  const sessionRows = listSessionRows(db);
  if (sessionRows.length > CONTRACT_LIMITS.sessions) {
    throw new StorageError("SNAPSHOT_LIMIT_EXCEEDED", {
      details: { sessionCount: sessionRows.length },
    });
  }
  const sessionsById = new Map(sessionRows.map((row) => [row.id, mapSession(row)]));
  for (const requestedId of query.includeSessionId) {
    if (!sessionsById.has(requestedId)) {
      throw new StorageError("NOT_FOUND", {
        details: { entity: "session" },
      });
    }
  }

  const activeTurnRows = db
    .prepare(
      `SELECT ${ROW_SQL.turnColumns}
       FROM turns
       WHERE status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')
       ORDER BY julianday(created_at), id`,
    )
    .all() as TurnRow[];
  const activeTurns = activeTurnRows.map(mapTurn);
  if (activeTurns.length > CONTRACT_LIMITS.activeSessions) {
    throw new StorageError("SNAPSHOT_LIMIT_EXCEEDED", {
      details: { activeSessionCount: activeTurns.length },
    });
  }
  const activeTurnBySession = new Map<string, (typeof activeTurns)[number]>(
    activeTurns.map((turn) => [turn.sessionId, turn]),
  );
  const includedIds = [
    ...new Set([...query.includeSessionId, ...activeTurns.map((turn) => turn.sessionId)]),
  ];
  if (includedIds.length > CONTRACT_LIMITS.includedSessions) {
    throw new StorageError("SNAPSHOT_LIMIT_EXCEEDED", {
      details: { includedSessionCount: includedIds.length },
    });
  }
  const includedSessions = includedIds
    .sort((left, right) => left.localeCompare(right))
    .map((sessionId) => buildSessionSnapshot(db, sessionId, snapshotSeq));

  const pendingRows = db
    .prepare(
      `SELECT ${ROW_SQL.approvalColumns}
       FROM approval_requests
       WHERE status = 'pending'
       ORDER BY created_seq, id`,
    )
    .all() as ApprovalRow[];
  if (pendingRows.length > CONTRACT_LIMITS.maxPendingApprovals) {
    throw new StorageError("SNAPSHOT_LIMIT_EXCEEDED", {
      details: { pendingApprovalCount: pendingRows.length },
    });
  }
  const pendingApprovals = pendingRows.map(mapApproval);

  const summaries = sessionRows.map((row) =>
    sessionSummary(db, row.id, activeTurnBySession.get(row.id)?.id ?? null),
  );
  const snapshot = parseSnapshot(() =>
    GlobalSnapshotSchema.parse({
      activeTurns,
      includedSessions,
      pendingApprovals,
      sessions: summaries,
      snapshotSeq,
    }),
  );
  const coverage = checkGlobalSnapshotCoverage(snapshot, query);
  if (!coverage.ok) {
    throw new StorageError("CORRUPT_READ_MODEL", {
      details: { missingRequestedSessions: coverage.missingSessionIds.length },
    });
  }
  return snapshot;
}

export function validateNoDanglingActiveState(db: BetterSqlite3.Database): void {
  const activeTurns = db
    .prepare(
      `SELECT ${ROW_SQL.turnColumns}
       FROM turns
       WHERE status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')`,
    )
    .all() as TurnRow[];
  for (const row of activeTurns) {
    const turn = mapTurn(row);
    if (!isActiveTurnStatus(turn.status)) {
      throw new StorageError("CORRUPT_READ_MODEL");
    }
  }

  const orphanedMessages = db
    .prepare(
      `SELECT ${ROW_SQL.messageColumns}
       FROM messages AS m
       LEFT JOIN turns AS t ON t.id = m.turn_id AND t.session_id = m.session_id
       WHERE t.id IS NULL
       LIMIT 1`,
    )
    .get() as MessageRow | undefined;
  if (orphanedMessages !== undefined) throw new StorageError("CORRUPT_READ_MODEL");
}
