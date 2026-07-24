import { createHash } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

import {
  ApprovalSchema,
  MessageBodySchema,
  MessageSchema,
  SessionSchema,
  ToolMessageSchema,
  TurnSchema,
  checkApprovalResolvedEvent,
  type AgentEventEnvelope,
  type Message,
} from "@dougoos/shared";

import { canonicalJson } from "./canonical.js";
import { StorageError } from "./errors.js";
import {
  mapApproval,
  mapMessage,
  readApprovalRow,
  readMessageRow,
  readSession,
  readTurnRow,
} from "./rows.js";

export interface ProjectOptions {
  readonly allowInitialTurnState?: boolean;
  readonly allowUserMessage?: boolean;
}

interface MessageInsert {
  readonly body: string | null;
  readonly diffJson: string | null;
  readonly displayInput: string | null;
  readonly id: string;
  readonly kind: Message["kind"];
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

function derivedId(
  kind: "approval" | "approval-message" | "tool",
  sessionId: string,
  turnId: string,
  sourceId: string,
): string {
  const digest = createHash("sha256")
    .update(canonicalJson([kind, sessionId, turnId, sourceId]), "utf8")
    .digest("hex");
  return `${kind}-${digest.slice(0, 48)}`;
}

function sourceKey(
  kind: "approval" | "message" | "tool",
  turnId: string,
  sourceId: string,
): string {
  const digest = createHash("sha256")
    .update(canonicalJson(["projection-source", kind, turnId, sourceId]), "utf8")
    .digest("hex");
  return `projection-source-${digest}`;
}

function requireTurnOwnership(db: BetterSqlite3.Database, sessionId: string, turnId: string) {
  const turn = readTurnRow(db, turnId);
  if (turn === undefined || turn.sessionId !== sessionId) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "turn_ownership" },
    });
  }
  return turn;
}

function requireEventTurnState(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  if (envelope.turnId === null) return;
  const event = envelope.event;
  const turn = requireTurnOwnership(db, envelope.sessionId, envelope.turnId);
  let expected: "awaiting_approval" | "queued" | "running";
  switch (event.type) {
    case "user_message":
      expected = "queued";
      break;
    case "message_delta":
    case "thought_delta":
    case "note":
    case "tool_call":
    case "tool_update":
    case "diff":
      expected = "running";
      break;
    case "approval_request":
    case "approval_resolved":
      expected = "awaiting_approval";
      break;
    case "turn_state":
    case "turn_end":
    case "session_state":
    case "session_error":
      return;
    default: {
      const exhaustive: never = event;
      throw new StorageError("PROJECTION_CONFLICT", {
        details: { reason: String(exhaustive) },
      });
    }
  }
  if (turn.status !== expected) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "event_turn_state" },
    });
  }
}

function currentActiveTurn(db: BetterSqlite3.Database, sessionId: string) {
  return db
    .prepare(
      `SELECT id, status
       FROM turns
       WHERE session_id = ?
         AND status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')`,
    )
    .get(sessionId) as { readonly id: string; readonly status: string } | undefined;
}

function laterTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function touchSession(db: BetterSqlite3.Database, sessionId: string, occurredAt: string): void {
  const session = readSession(db, sessionId);
  db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
    laterTimestamp(session.updatedAt, occurredAt),
    sessionId,
  );
}

function insertMessage(
  db: BetterSqlite3.Database,
  message: Message,
  sourceMessageId: string,
  seq: number,
): void {
  const parsed = MessageSchema.parse(message);
  const row: MessageInsert = {
    body:
      parsed.kind === "user" ||
      parsed.kind === "text" ||
      parsed.kind === "note" ||
      parsed.kind === "think"
        ? parsed.body
        : parsed.kind === "approval"
          ? (parsed.description ?? null)
          : null,
    diffJson: parsed.kind === "diff" ? canonicalJson(parsed.diff) : null,
    displayInput: parsed.kind === "tool" ? (parsed.displayInput ?? null) : null,
    id: parsed.id,
    kind: parsed.kind,
    noteLevel: parsed.kind === "note" ? parsed.level : null,
    requestId: parsed.kind === "approval" ? parsed.requestId : null,
    resultJson:
      parsed.kind === "tool" && parsed.result !== undefined ? canonicalJson(parsed.result) : null,
    sessionId: parsed.sessionId,
    sourceMessageId,
    streamState: parsed.kind === "text" || parsed.kind === "think" ? parsed.state : null,
    title: parsed.kind === "tool" ? parsed.title : null,
    toolCallId: parsed.kind === "tool" ? parsed.toolCallId : null,
    toolKind: parsed.kind === "tool" ? parsed.toolKind : null,
    toolStatus: parsed.kind === "tool" ? parsed.status : null,
    turnId: parsed.turnId,
  };
  db.prepare(
    `INSERT INTO messages(
       id, session_id, turn_id, source_message_id, kind, body, stream_state, note_level,
       tool_call_id, tool_kind, tool_status, title, display_input, result_json,
       diff_json, request_id, created_at, created_seq, updated_seq
     ) VALUES (
       @id, @sessionId, @turnId, @sourceMessageId, @kind, @body, @streamState, @noteLevel,
       @toolCallId, @toolKind, @toolStatus, @title, @displayInput, @resultJson,
       @diffJson, @requestId, @createdAt, @seq, @seq
     )`,
  ).run({ ...row, createdAt: parsed.createdAt, seq });
}

function projectStreamingDelta(
  db: BetterSqlite3.Database,
  envelope: AgentEventEnvelope,
  kind: "text" | "think",
  messageId: string,
  delta: string,
): void {
  if (envelope.turnId === null) {
    throw new StorageError("PROJECTION_CONFLICT");
  }
  const key = sourceKey("message", envelope.turnId, messageId);
  const existing = readMessageRow(db, envelope.sessionId, key);
  if (existing === undefined) {
    insertMessage(
      db,
      MessageSchema.parse({
        body: delta,
        createdAt: envelope.occurredAt,
        id: messageId,
        kind,
        sessionId: envelope.sessionId,
        state: "streaming",
        turnId: envelope.turnId,
      }),
      key,
      envelope.seq,
    );
    return;
  }
  const current = mapMessage(existing);
  if (
    current.kind !== kind ||
    current.turnId !== envelope.turnId ||
    current.state !== "streaming"
  ) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "message_delta_state" },
    });
  }
  const body = MessageBodySchema.parse(current.body + delta);
  db.prepare(
    `UPDATE messages
     SET body = ?, updated_seq = ?
     WHERE id = ?`,
  ).run(body, envelope.seq, current.id);
}

function projectToolCall(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  const event = envelope.event;
  if (event.type !== "tool_call" || envelope.turnId === null) return;
  const key = sourceKey("tool", envelope.turnId, event.toolCallId);
  const existing = readMessageRow(db, envelope.sessionId, key);
  if (existing === undefined) {
    insertMessage(
      db,
      ToolMessageSchema.parse({
        createdAt: envelope.occurredAt,
        ...(event.displayInput === undefined ? {} : { displayInput: event.displayInput }),
        id: derivedId("tool", envelope.sessionId, envelope.turnId, event.toolCallId),
        kind: "tool",
        sessionId: envelope.sessionId,
        status: event.status,
        title: event.title,
        toolCallId: event.toolCallId,
        toolKind: event.kind,
        turnId: envelope.turnId,
      }),
      key,
      envelope.seq,
    );
    return;
  }
  const current = mapMessage(existing);
  if (
    current.kind !== "tool" ||
    current.turnId !== envelope.turnId ||
    current.toolCallId !== event.toolCallId ||
    current.title !== event.title ||
    current.toolKind !== event.kind ||
    current.displayInput !== event.displayInput ||
    current.status !== "pending" ||
    event.status !== "running"
  ) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "tool_call_state" },
    });
  }
  db.prepare(`UPDATE messages SET tool_status = 'running', updated_seq = ? WHERE id = ?`).run(
    envelope.seq,
    current.id,
  );
}

function projectToolUpdate(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  const event = envelope.event;
  if (event.type !== "tool_update" || envelope.turnId === null) return;
  const existing = readMessageRow(
    db,
    envelope.sessionId,
    sourceKey("tool", envelope.turnId, event.toolCallId),
  );
  if (existing === undefined) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "tool_missing" },
    });
  }
  const current = mapMessage(existing);
  if (current.kind !== "tool" || current.turnId !== envelope.turnId) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "tool_ownership" },
    });
  }
  if (current.status !== "pending" && current.status !== "running") {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "tool_terminal" },
    });
  }
  const next = ToolMessageSchema.parse({
    ...current,
    ...(event.result === undefined ? {} : { result: event.result }),
    status: event.status,
  });
  db.prepare(
    `UPDATE messages
     SET tool_status = ?, result_json = ?, updated_seq = ?
     WHERE id = ?`,
  ).run(
    next.status,
    next.result === undefined ? existing.resultJson : canonicalJson(next.result),
    envelope.seq,
    next.id,
  );
}

function projectApprovalRequest(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  const event = envelope.event;
  if (event.type !== "approval_request" || envelope.turnId === null) return;
  const turn = requireTurnOwnership(db, envelope.sessionId, envelope.turnId);
  if (turn.status !== "awaiting_approval") {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "approval_turn_state" },
    });
  }
  const approval = ApprovalSchema.parse({
    decision: null,
    ...(event.description === undefined ? {} : { description: event.description }),
    expiresAt: event.expiresAt,
    id: derivedId("approval", envelope.sessionId, envelope.turnId, event.requestId),
    options: event.options,
    requestId: event.requestId,
    resolvedAt: null,
    sessionId: envelope.sessionId,
    status: "pending",
    title: event.title,
    turnId: envelope.turnId,
  });
  db.prepare(
    `INSERT INTO approval_requests(
       id, session_id, turn_id, request_id, status, title, description, options_json,
       decision_json, expires_at, resolved_at, created_seq, updated_seq
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
  ).run(
    approval.id,
    approval.sessionId,
    approval.turnId,
    approval.requestId,
    approval.status,
    approval.title,
    approval.description ?? null,
    canonicalJson(approval.options),
    approval.expiresAt,
    envelope.seq,
    envelope.seq,
  );
  insertMessage(
    db,
    MessageSchema.parse({
      createdAt: envelope.occurredAt,
      ...(event.description === undefined ? {} : { description: event.description }),
      id: derivedId("approval-message", envelope.sessionId, envelope.turnId, event.requestId),
      kind: "approval",
      requestId: event.requestId,
      sessionId: envelope.sessionId,
      turnId: envelope.turnId,
    }),
    sourceKey("approval", envelope.turnId, event.requestId),
    envelope.seq,
  );
}

function projectApprovalResolved(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  const event = envelope.event;
  if (event.type !== "approval_resolved" || envelope.turnId === null) return;
  const row = readApprovalRow(db, envelope.sessionId, envelope.turnId, event.requestId);
  if (row === undefined) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "approval_missing" },
    });
  }
  const approval = mapApproval(row);
  const decision = checkApprovalResolvedEvent(approval, event);
  if (!decision.ok) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: decision.code },
    });
  }
  ApprovalSchema.parse({
    ...approval,
    decision: event.decision,
    resolvedAt: envelope.occurredAt,
    status: event.status,
  });
  db.prepare(
    `UPDATE approval_requests
     SET status = ?, decision_json = ?, resolved_at = ?, updated_seq = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(
    event.status,
    event.decision === null ? null : canonicalJson(event.decision),
    envelope.occurredAt,
    envelope.seq,
    approval.id,
  );
}

function sessionStateForTurn(
  status: string,
): "awaiting_approval" | "cancelling" | "idle" | "running" {
  switch (status) {
    case "queued":
    case "starting":
      return "idle";
    case "running":
      return "running";
    case "awaiting_approval":
      return "awaiting_approval";
    case "cancelling":
      return "cancelling";
    default:
      throw new StorageError("PROJECTION_CONFLICT", {
        details: { reason: "non_active_turn_state" },
      });
  }
}

function projectTurnState(
  db: BetterSqlite3.Database,
  envelope: AgentEventEnvelope,
  options: ProjectOptions,
): void {
  const event = envelope.event;
  if (event.type !== "turn_state" || envelope.turnId === null) return;
  const turn = requireTurnOwnership(db, envelope.sessionId, envelope.turnId);
  if (event.from === null) {
    if (
      options.allowInitialTurnState !== true ||
      event.status !== "queued" ||
      turn.status !== "queued"
    ) {
      throw new StorageError("PROJECTION_CONFLICT", {
        details: { reason: "initial_turn_state" },
      });
    }
  } else {
    if (turn.status !== event.from) {
      throw new StorageError("PROJECTION_CONFLICT", {
        details: { reason: "turn_compare_and_swap" },
      });
    }
    if (event.from === "awaiting_approval" && event.status === "running") {
      const pending = db
        .prepare(
          `SELECT 1
           FROM approval_requests
           WHERE turn_id = ? AND status = 'pending'
           LIMIT 1`,
        )
        .get(turn.id);
      if (pending !== undefined) {
        throw new StorageError("PROJECTION_CONFLICT", {
          details: { reason: "approval_still_pending" },
        });
      }
    }
    const startedAt =
      event.status === "starting" || event.status === "running"
        ? (turn.startedAt ?? envelope.occurredAt)
        : turn.startedAt;
    TurnSchema.parse({
      clientRequestId: turn.clientRequestId,
      createdAt: turn.createdAt,
      endedAt: null,
      error: null,
      id: turn.id,
      sessionId: turn.sessionId,
      startedAt,
      status: event.status,
      stopReason: null,
    });
    db.prepare(`UPDATE turns SET status = ?, started_at = ? WHERE id = ? AND status = ?`).run(
      event.status,
      startedAt,
      turn.id,
      event.from,
    );
  }
  const nextSessionState = sessionStateForTurn(event.status);
  const session = readSession(db, envelope.sessionId);
  SessionSchema.parse({
    ...session,
    state: nextSessionState,
    updatedAt: laterTimestamp(session.updatedAt, envelope.occurredAt),
  });
  db.prepare(`UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?`).run(
    nextSessionState,
    laterTimestamp(session.updatedAt, envelope.occurredAt),
    envelope.sessionId,
  );
}

function projectTurnEnd(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  const event = envelope.event;
  if (event.type !== "turn_end" || envelope.turnId === null) return;
  const turn = requireTurnOwnership(db, envelope.sessionId, envelope.turnId);
  if (turn.status !== event.from) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "turn_end_compare_and_swap" },
    });
  }
  const startedAt = turn.startedAt ?? envelope.occurredAt;
  const error = event.error ?? null;
  TurnSchema.parse({
    clientRequestId: turn.clientRequestId,
    createdAt: turn.createdAt,
    endedAt: envelope.occurredAt,
    error,
    id: turn.id,
    sessionId: turn.sessionId,
    startedAt,
    status: event.status,
    stopReason: event.stopReason,
  });
  db.prepare(
    `UPDATE turns
     SET status = ?, started_at = ?, ended_at = ?, stop_reason = ?, error_json = ?
     WHERE id = ? AND status = ?`,
  ).run(
    event.status,
    startedAt,
    envelope.occurredAt,
    event.stopReason,
    error === null ? null : canonicalJson(error),
    turn.id,
    event.from,
  );
  if (event.usage !== undefined) {
    db.prepare(
      `INSERT INTO usage_stats(
         turn_id, session_id, input_tokens, output_tokens, cached_input_tokens, quality
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      turn.id,
      turn.sessionId,
      event.usage.inputTokens,
      event.usage.outputTokens,
      event.usage.cachedInputTokens ?? null,
      event.usage.quality,
    );
  }

  db.prepare(
    `UPDATE messages
     SET stream_state = 'complete', updated_seq = ?
     WHERE turn_id = ? AND kind IN ('text', 'think') AND stream_state = 'streaming'`,
  ).run(envelope.seq, turn.id);
  const terminalToolStatus =
    event.status === "completed" ? "done" : event.status === "failed" ? "error" : "cancelled";
  db.prepare(
    `UPDATE messages
     SET tool_status = ?, updated_seq = ?
     WHERE turn_id = ? AND kind = 'tool' AND tool_status IN ('pending', 'running')`,
  ).run(terminalToolStatus, envelope.seq, turn.id);
  db.prepare(
    `UPDATE approval_requests
     SET status = 'cancelled', decision_json = NULL, resolved_at = ?, updated_seq = ?
     WHERE turn_id = ? AND status = 'pending'`,
  ).run(envelope.occurredAt, envelope.seq, turn.id);

  const session = readSession(db, envelope.sessionId);
  const state = event.status === "interrupted" ? "crashed" : "idle";
  SessionSchema.parse({
    ...session,
    state,
    updatedAt: laterTimestamp(session.updatedAt, envelope.occurredAt),
  });
  db.prepare(`UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?`).run(
    state,
    laterTimestamp(session.updatedAt, envelope.occurredAt),
    envelope.sessionId,
  );
}

function projectSessionState(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  const event = envelope.event;
  if (event.type !== "session_state") return;
  const session = readSession(db, envelope.sessionId);
  const activeTurn = currentActiveTurn(db, envelope.sessionId);
  const compatible =
    event.state === "starting"
      ? session.state === "starting" && activeTurn === undefined
      : event.state === "running"
        ? activeTurn?.status === "running"
        : event.state === "awaiting_approval"
          ? activeTurn?.status === "awaiting_approval"
          : event.state === "cancelling"
            ? activeTurn?.status === "cancelling"
            : event.state === "idle"
              ? activeTurn === undefined ||
                activeTurn.status === "queued" ||
                activeTurn.status === "starting"
              : activeTurn === undefined;
  if (!compatible) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "session_turn_state" },
    });
  }
  const updatedAt = laterTimestamp(session.updatedAt, envelope.occurredAt);
  SessionSchema.parse({ ...session, state: event.state, updatedAt });
  db.prepare(`UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?`).run(
    event.state,
    updatedAt,
    envelope.sessionId,
  );
}

function projectSessionError(db: BetterSqlite3.Database, envelope: AgentEventEnvelope): void {
  const event = envelope.event;
  if (event.type !== "session_error") return;
  if (currentActiveTurn(db, envelope.sessionId) !== undefined) {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "session_error_requires_turn_end" },
    });
  }
  const session = readSession(db, envelope.sessionId);
  if (session.state === "starting" || session.state === "closed") {
    throw new StorageError("PROJECTION_CONFLICT", {
      details: { reason: "session_error_state" },
    });
  }
  const updatedAt = laterTimestamp(session.updatedAt, envelope.occurredAt);
  SessionSchema.parse({ ...session, state: "crashed", updatedAt });
  db.prepare(
    `UPDATE sessions
     SET state = 'crashed', last_error_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(canonicalJson(event.error), updatedAt, envelope.sessionId);
}

export function projectEnvelope(
  db: BetterSqlite3.Database,
  envelope: AgentEventEnvelope,
  options: ProjectOptions = {},
): void {
  readSession(db, envelope.sessionId);
  if (envelope.turnId !== null) {
    requireTurnOwnership(db, envelope.sessionId, envelope.turnId);
  }
  requireEventTurnState(db, envelope);
  const event = envelope.event;
  switch (event.type) {
    case "user_message": {
      if (envelope.turnId === null) break;
      if (options.allowUserMessage !== true) {
        throw new StorageError("PROJECTION_CONFLICT", {
          details: { reason: "user_message_requires_turn_create" },
        });
      }
      insertMessage(
        db,
        MessageSchema.parse({
          body: event.body,
          createdAt: envelope.occurredAt,
          id: event.messageId,
          kind: "user",
          sessionId: envelope.sessionId,
          turnId: envelope.turnId,
        }),
        sourceKey("message", envelope.turnId, event.messageId),
        envelope.seq,
      );
      break;
    }
    case "message_delta":
      projectStreamingDelta(db, envelope, "text", event.messageId, event.text);
      break;
    case "thought_delta":
      projectStreamingDelta(db, envelope, "think", event.messageId, event.text);
      break;
    case "note": {
      if (envelope.turnId === null) break;
      insertMessage(
        db,
        MessageSchema.parse({
          body: event.text,
          createdAt: envelope.occurredAt,
          id: event.messageId,
          kind: "note",
          level: event.level,
          sessionId: envelope.sessionId,
          turnId: envelope.turnId,
        }),
        sourceKey("message", envelope.turnId, event.messageId),
        envelope.seq,
      );
      break;
    }
    case "tool_call":
      projectToolCall(db, envelope);
      break;
    case "tool_update":
      projectToolUpdate(db, envelope);
      break;
    case "diff": {
      if (envelope.turnId === null) break;
      insertMessage(
        db,
        MessageSchema.parse({
          createdAt: envelope.occurredAt,
          diff: event.diff,
          id: event.messageId,
          kind: "diff",
          sessionId: envelope.sessionId,
          turnId: envelope.turnId,
        }),
        sourceKey("message", envelope.turnId, event.messageId),
        envelope.seq,
      );
      break;
    }
    case "approval_request":
      projectApprovalRequest(db, envelope);
      break;
    case "approval_resolved":
      projectApprovalResolved(db, envelope);
      break;
    case "turn_state":
      projectTurnState(db, envelope, options);
      break;
    case "turn_end":
      projectTurnEnd(db, envelope);
      break;
    case "session_state":
      projectSessionState(db, envelope);
      break;
    case "session_error":
      projectSessionError(db, envelope);
      break;
    default: {
      const exhaustive: never = event;
      throw new StorageError("PROJECTION_CONFLICT", {
        details: { reason: String(exhaustive) },
      });
    }
  }
  touchSession(db, envelope.sessionId, envelope.occurredAt);
}

export const PROJECTOR_CLOSURE_RULES = Object.freeze({
  approval: "pending approvals become cancelled at turn_end",
  session:
    "completed, failed, and cancelled turns leave the initialized Session idle; interrupted leaves it crashed",
  streamingMessage: "streaming text and thought messages become complete at turn_end",
  tool: "active tools become done on completed, error on failed, and cancelled on cancelled or interrupted",
});

export function assertNoActiveTurn(db: BetterSqlite3.Database, sessionId: string): void {
  const active = currentActiveTurn(db, sessionId);
  if (active !== undefined) {
    throw new StorageError("SESSION_BUSY", {
      details: { activeTurnId: active.id },
    });
  }
}
