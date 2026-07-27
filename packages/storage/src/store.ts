import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import {
  AgentEventEnvelopeSchema,
  AgentRuntimeEventSchema,
  CONTRACT_LIMITS,
  ConversationDirectorySchema,
  CreateTurnRequestSchema,
  DeviceIdentityResponseSchema,
  EventIdSchema,
  GlobalSeqSchema,
  IsoTimestampSchema,
  MessageIdSchema,
  OpaqueIdSchema,
  ProviderIdSchema,
  ProviderPreferenceSchema,
  ProviderSchema,
  SessionIdSchema,
  SessionSchema,
  SnapshotQuerySchema,
  TokenUsageSchema,
  TurnIdSchema,
  type Approval,
  type AgentEventEnvelope,
  type AgentRuntimeEvent,
  type CreateTurnRequest,
  type DeviceIdentityResponse,
  type Provider,
  type ProviderPreference,
  type Session,
  type TokenUsage,
  type Turn,
} from "@dougoos/shared";

import { canonicalJson, sha256 } from "./canonical.js";
import {
  StorageError,
  asStorageWriteError,
  isSqliteBusyError,
  isSqliteFullError,
  isStorageError,
} from "./errors.js";
import {
  DEFAULT_MIGRATIONS,
  applyMigrations,
  preflightMigrationDatabase,
  validateMigrationManifest,
  verifyMigrationHistory,
  type AppliedMigration,
  type Migration,
} from "./migrations.js";
import { verifyJournalCoverage, verifyJournalIntegrity } from "./journal-integrity.js";
import { projectEnvelope } from "./projector.js";
import {
  mapApproval,
  mapTurn,
  readApprovalForTurnRow,
  readSession,
  readSessionRow,
  readTurnRow,
} from "./rows.js";
import { verifyStorageBaseInvariants, verifyStorageSchema } from "./schema.js";
import { buildGlobalSnapshot, buildSessionSnapshot } from "./snapshots.js";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;
export const SQLITE_SYNCHRONOUS = "FULL" as const;
export const SQLITE_WAL_AUTOCHECKPOINT_PAGES = 1_000;
export const JOURNAL_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const JOURNAL_RETENTION_MAX_EVENTS = 100_000;
const CONVERSATION_DIRECTORY_SETTING_KEY = "conversation.directory";
const JOURNAL_RETENTION_MAX_CONFIGURABLE_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

export interface StorageOpenOptions {
  readonly clock?: () => string;
  readonly eventIdFactory?: () => string;
  readonly migrations?: readonly Migration[];
}

export interface AppendAndProjectInput {
  readonly eventId: string;
  readonly runtimeEvent: AgentRuntimeEvent;
}

export interface AppendAndProjectResult {
  readonly duplicate: boolean;
  readonly envelope: AgentEventEnvelope;
}

export interface CreateInitializedSessionInput {
  readonly eventId: string;
  readonly session: Session;
}

interface CreateTurnUserMessageIdentity {
  readonly eventId: string;
  readonly messageId: string;
}

interface CreateTurnContext {
  readonly occurredAt: string;
  readonly sessionId: string;
}

interface CreateTurnCommand {
  readonly queuedEventId: string;
  readonly request: CreateTurnRequest;
  readonly turnId: string;
  readonly userMessages: readonly CreateTurnUserMessageIdentity[];
}

export type CreateTurnInput = Readonly<CreateTurnContext & CreateTurnCommand>;

export interface CreateTurnResult {
  readonly created: boolean;
  readonly envelopes: readonly AgentEventEnvelope[];
  readonly turnId: string;
}

export interface ReplayResult {
  readonly events: readonly AgentEventEnvelope[];
  readonly latestSeq: number;
  readonly minAvailableSeq: number;
}

export interface RetentionResult {
  readonly deletedEvents: number;
  readonly latestSeq: number;
  readonly minAvailableSeq: number;
}

export interface CheckpointResult {
  readonly busy: number;
  readonly checkpointed: number;
  readonly log: number;
  readonly mode: "PASSIVE" | "TRUNCATE";
}

interface ReceiptRow {
  readonly payloadBytes: bigint;
  readonly payloadSha256: string;
  readonly seq: bigint;
}

interface WatermarkRow {
  readonly lastSeq: bigint;
  readonly minReplaySeq: bigint;
}

type EventRowReceiptIdentity = Pick<AgentEventEnvelope, "eventId" | "seq">;
type EventRowRuntimeIdentity = Pick<AgentRuntimeEvent, "occurredAt" | "sessionId" | "turnId">;
type EventRow = EventRowReceiptIdentity &
  EventRowRuntimeIdentity & {
    readonly eventJson: string;
  };

interface ExistingTurnRow {
  readonly id: string;
  readonly requestPayloadSha256: string;
}

interface RecoveryTurnRow {
  readonly id: string;
  readonly sessionId: string;
  readonly status: "awaiting_approval" | "cancelling" | "queued" | "running" | "starting";
}

function parseInput<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (isStorageError(error)) throw error;
    throw new StorageError("VALIDATION_FAILED", { cause: error });
  }
}

function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StorageError("SEQUENCE_EXHAUSTED");
  }
  return Number(value);
}

function validateFilePath(filePath: string): void {
  if (!isAbsolute(filePath) || filePath === ":memory:" || filePath.length === 0) {
    throw new StorageError("VALIDATION_FAILED", {
      details: { field: "databasePath" },
    });
  }
}

function runtimeFingerprint(runtimeEvent: AgentRuntimeEvent): {
  readonly bytes: number;
  readonly canonical: string;
  readonly digest: string;
} {
  const canonical = canonicalJson(runtimeEvent);
  return {
    bytes: Buffer.byteLength(canonical, "utf8"),
    canonical,
    digest: sha256(canonical),
  };
}

function requestFingerprint(input: {
  readonly request: CreateTurnRequest;
  readonly sessionId: string;
}): string {
  return sha256(
    canonicalJson({
      request: input.request,
      sessionId: input.sessionId,
    }),
  );
}

function readWatermark(db: BetterSqlite3.Database): { latestSeq: number; minAvailableSeq: number } {
  const row = db
    .prepare(
      `SELECT last_seq AS lastSeq, min_replay_seq AS minReplaySeq
       FROM journal_state
       WHERE singleton = 1`,
    )
    .safeIntegers(true)
    .get() as WatermarkRow | undefined;
  if (row === undefined) throw new StorageError("CORRUPT_READ_MODEL");
  return {
    latestSeq: safeNumber(row.lastSeq),
    minAvailableSeq: safeNumber(row.minReplaySeq),
  };
}

function allocateSequence(db: BetterSqlite3.Database): number {
  const { latestSeq } = readWatermark(db);
  if (latestSeq >= Number.MAX_SAFE_INTEGER) {
    throw new StorageError("SEQUENCE_EXHAUSTED");
  }
  const next = latestSeq + 1;
  const result = db
    .prepare(`UPDATE journal_state SET last_seq = ? WHERE singleton = 1 AND last_seq = ?`)
    .run(next, latestSeq);
  if (result.changes !== 1) throw new StorageError("PROJECTION_CONFLICT");
  return next;
}

export class DougoStorage {
  readonly appliedMigrations: readonly AppliedMigration[];

  #closed = false;
  readonly #clock: () => string;
  readonly #db: BetterSqlite3.Database;
  readonly #eventIdFactory: () => string;

  constructor(
    db: BetterSqlite3.Database,
    appliedMigrations: readonly AppliedMigration[],
    options: StorageOpenOptions,
  ) {
    this.#db = db;
    this.appliedMigrations = appliedMigrations;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#eventIdFactory = options.eventIdFactory ?? randomUUID;
  }

  #assertOpen(): void {
    if (this.#closed) throw new StorageError("STORAGE_CLOSED");
  }

  #validatedNow(): string {
    return parseInput(() => new Date(IsoTimestampSchema.parse(this.#clock())).toISOString());
  }

  #readReceipt(
    eventId: string,
    runtimeEvent: AgentRuntimeEvent,
  ): AppendAndProjectResult | undefined {
    const fingerprint = runtimeFingerprint(runtimeEvent);
    const receipt = this.#db
      .prepare(
        `SELECT seq, payload_sha256 AS payloadSha256, payload_bytes AS payloadBytes
         FROM event_receipts
         WHERE event_id = ?`,
      )
      .safeIntegers(true)
      .get(eventId) as ReceiptRow | undefined;
    if (receipt === undefined) return undefined;
    if (
      receipt.payloadSha256 !== fingerprint.digest ||
      receipt.payloadBytes !== BigInt(fingerprint.bytes)
    ) {
      throw new StorageError("EVENT_ID_CONFLICT", {
        details: { eventId },
      });
    }
    return {
      duplicate: true,
      envelope: AgentEventEnvelopeSchema.parse({
        ...runtimeEvent,
        eventId,
        seq: safeNumber(receipt.seq),
        v: 1,
      }),
    };
  }

  #appendWithinTransaction(
    input: AppendAndProjectInput,
    options: {
      readonly allowInitialTurnState?: boolean;
      readonly allowUserMessage?: boolean;
    } = {},
  ): AppendAndProjectResult {
    const eventId = parseInput(() => EventIdSchema.parse(input.eventId));
    const runtimeEvent = parseInput(() => AgentRuntimeEventSchema.parse(input.runtimeEvent));
    const fingerprint = runtimeFingerprint(runtimeEvent);
    const receipt = this.#readReceipt(eventId, runtimeEvent);
    if (receipt !== undefined) return receipt;

    readSession(this.#db, runtimeEvent.sessionId);
    if (runtimeEvent.turnId !== null) {
      const turn = readTurnRow(this.#db, runtimeEvent.turnId);
      if (turn === undefined || turn.sessionId !== runtimeEvent.sessionId) {
        throw new StorageError("PROJECTION_CONFLICT", {
          details: { reason: "turn_ownership" },
        });
      }
    }

    const seq = allocateSequence(this.#db);
    const committedAt = this.#validatedNow();
    const envelope = AgentEventEnvelopeSchema.parse({
      ...runtimeEvent,
      eventId,
      seq,
      v: 1,
    });
    this.#db
      .prepare(
        `INSERT INTO event_receipts(
           event_id, seq, payload_sha256, payload_bytes, received_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(eventId, seq, fingerprint.digest, fingerprint.bytes, committedAt);
    this.#db
      .prepare(
        `INSERT INTO session_events(
           seq, event_id, session_id, turn_id, type, event_json, occurred_at, committed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq,
        eventId,
        runtimeEvent.sessionId,
        runtimeEvent.turnId,
        runtimeEvent.event.type,
        canonicalJson(runtimeEvent.event),
        runtimeEvent.occurredAt,
        committedAt,
      );
    projectEnvelope(this.#db, envelope, options);
    return { duplicate: false, envelope };
  }

  appendAndProject(input: AppendAndProjectInput): AppendAndProjectResult {
    this.#assertOpen();
    const parsed = parseInput(() => ({
      eventId: EventIdSchema.parse(input.eventId),
      runtimeEvent: AgentRuntimeEventSchema.parse(input.runtimeEvent),
    }));
    const transaction = this.#db.transaction(() => this.#appendWithinTransaction(parsed));
    try {
      return transaction.immediate();
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  createInitializedSession(input: CreateInitializedSessionInput): AppendAndProjectResult {
    this.#assertOpen();
    const session = parseInput(() => SessionSchema.parse(input.session));
    const eventId = parseInput(() => EventIdSchema.parse(input.eventId));
    if (session.state !== "idle") {
      throw new StorageError("VALIDATION_FAILED", {
        details: { reason: "initialized_session_must_be_idle" },
      });
    }
    const runtimeEvent = AgentRuntimeEventSchema.parse({
      event: { state: "idle", type: "session_state" },
      occurredAt: session.updatedAt,
      sessionId: session.id,
      turnId: null,
    });
    const sessionPayloadHash = sha256(canonicalJson(session));
    const transaction = this.#db.transaction(() => {
      const receipt = this.#readReceipt(eventId, runtimeEvent);
      if (receipt !== undefined) {
        const persisted = this.#db
          .prepare(
            `SELECT
               create_payload_sha256 AS createPayloadHash,
               initialization_payload_sha256 AS initializationPayloadHash
             FROM sessions
             WHERE id = ?`,
          )
          .get(session.id) as
          | {
              readonly createPayloadHash: string;
              readonly initializationPayloadHash: string | null;
            }
          | undefined;
        if (
          persisted?.createPayloadHash !== sessionPayloadHash ||
          persisted.initializationPayloadHash !== sessionPayloadHash
        ) {
          throw new StorageError("EVENT_ID_CONFLICT", {
            details: { eventId },
          });
        }
        return receipt;
      }
      if (readSessionRow(this.#db, session.id) !== undefined) {
        throw new StorageError("IDEMPOTENCY_CONFLICT", {
          details: { entity: "session" },
        });
      }
      this.#db
        .prepare(
          `INSERT INTO sessions(
             id, source, provider_id, cwd, title, create_payload_sha256,
             initialization_payload_sha256, provider_session_id,
             capability_snapshot_json, state, last_error_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?)`,
        )
        .run(
          session.id,
          session.source,
          session.providerId,
          session.cwd,
          session.title,
          sessionPayloadHash,
          sessionPayloadHash,
          session.providerSessionId,
          canonicalJson(session.capabilities),
          session.createdAt,
          session.updatedAt,
        );
      if (session.permission !== null) {
        this.#db
          .prepare(
            `INSERT INTO session_permission_snapshots(session_id, permission_json)
             VALUES (?, ?)`,
          )
          .run(session.id, canonicalJson(session.permission));
      }
      return this.#appendWithinTransaction({ eventId, runtimeEvent });
    });
    try {
      return transaction.immediate();
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  createTurn(input: CreateTurnInput): CreateTurnResult {
    this.#assertOpen();
    const parsed = parseInput(() => {
      const request = CreateTurnRequestSchema.parse(input.request);
      const userMessages = input.userMessages.map((identity) => ({
        eventId: EventIdSchema.parse(identity.eventId),
        messageId: MessageIdSchema.parse(identity.messageId),
      }));
      const queuedEventId = EventIdSchema.parse(input.queuedEventId);
      if (userMessages.length !== request.content.length) {
        throw new TypeError("one user-message identity is required per content part");
      }
      const eventIds = new Set([queuedEventId, ...userMessages.map((item) => item.eventId)]);
      const messageIds = new Set(userMessages.map((item) => item.messageId));
      if (eventIds.size !== userMessages.length + 1 || messageIds.size !== userMessages.length) {
        throw new TypeError("turn event and message identities must be unique");
      }
      return {
        occurredAt: IsoTimestampSchema.parse(input.occurredAt),
        queuedEventId,
        request,
        sessionId: SessionIdSchema.parse(input.sessionId),
        turnId: TurnIdSchema.parse(input.turnId),
        userMessages,
      };
    });
    const payloadHash = requestFingerprint({
      request: parsed.request,
      sessionId: parsed.sessionId,
    });
    const queuedRuntime = AgentRuntimeEventSchema.parse({
      event: { from: null, status: "queued", type: "turn_state" },
      occurredAt: parsed.occurredAt,
      sessionId: parsed.sessionId,
      turnId: parsed.turnId,
    });
    const userEvents = parsed.request.content.map((content, index) => {
      const identity = parsed.userMessages[index];
      if (identity === undefined) {
        throw new StorageError("VALIDATION_FAILED", {
          details: { reason: "user_message_identity_count" },
        });
      }
      return {
        eventId: identity.eventId,
        runtimeEvent: AgentRuntimeEventSchema.parse({
          event: {
            body: content.text,
            messageId: identity.messageId,
            type: "user_message",
          },
          occurredAt: parsed.occurredAt,
          sessionId: parsed.sessionId,
          turnId: parsed.turnId,
        }),
      };
    });

    const transaction = this.#db.transaction((): CreateTurnResult => {
      const existing = this.#db
        .prepare(
          `SELECT id, request_payload_sha256 AS requestPayloadSha256
           FROM turns
           WHERE session_id = ? AND client_request_id = ?`,
        )
        .get(parsed.sessionId, parsed.request.clientRequestId) as ExistingTurnRow | undefined;
      if (existing !== undefined) {
        if (existing.requestPayloadSha256 !== payloadHash) {
          throw new StorageError("IDEMPOTENCY_CONFLICT", {
            details: { entity: "turn" },
          });
        }
        return { created: false, envelopes: [], turnId: existing.id };
      }

      const session = readSession(this.#db, parsed.sessionId);
      if (session.state !== "idle") {
        const active = this.#db
          .prepare(
            `SELECT id FROM turns
             WHERE session_id = ?
               AND status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')`,
          )
          .get(parsed.sessionId) as { readonly id: string } | undefined;
        if (active !== undefined) {
          throw new StorageError("SESSION_BUSY", {
            details: { activeTurnId: active.id },
          });
        }
        throw new StorageError("PROJECTION_CONFLICT", {
          details: { reason: "session_not_idle" },
        });
      }

      const activeForSession = this.#db
        .prepare(
          `SELECT id FROM turns
           WHERE session_id = ?
             AND status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')`,
        )
        .get(parsed.sessionId) as { readonly id: string } | undefined;
      if (activeForSession !== undefined) {
        throw new StorageError("SESSION_BUSY", {
          details: { activeTurnId: activeForSession.id },
        });
      }

      const activeSessions = Number(
        (
          this.#db
            .prepare(
              `SELECT COUNT(DISTINCT session_id) AS count
               FROM turns
               WHERE status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')`,
            )
            .get() as { readonly count: number }
        ).count,
      );
      if (activeSessions >= CONTRACT_LIMITS.activeSessions) {
        throw new StorageError("ACTIVE_SESSION_LIMIT_REACHED", {
          details: { limit: CONTRACT_LIMITS.activeSessions },
        });
      }

      this.#db
        .prepare(
          `INSERT INTO turns(
             id, session_id, client_request_id, request_payload_sha256, status,
             created_at, started_at, ended_at, stop_reason, error_json
           ) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL, NULL)`,
        )
        .run(
          parsed.turnId,
          parsed.sessionId,
          parsed.request.clientRequestId,
          payloadHash,
          parsed.occurredAt,
        );
      const queued = this.#appendWithinTransaction(
        { eventId: parsed.queuedEventId, runtimeEvent: queuedRuntime },
        { allowInitialTurnState: true },
      );
      const users = userEvents.map((userEvent) =>
        this.#appendWithinTransaction(userEvent, { allowUserMessage: true }),
      );
      return {
        created: true,
        envelopes: [queued.envelope, ...users.map((user) => user.envelope)],
        turnId: parsed.turnId,
      };
    });
    try {
      return transaction.immediate();
    } catch (error) {
      if (isSqliteBusyError(error)) {
        throw new StorageError("DATABASE_BUSY", { cause: error });
      }
      throw asStorageWriteError(error);
    }
  }

  recoverInterruptedTurns(occurredAt = this.#validatedNow()): readonly AgentEventEnvelope[] {
    this.#assertOpen();
    const timestamp = parseInput(() => IsoTimestampSchema.parse(occurredAt));
    const transaction = this.#db.transaction(() => {
      const turns = this.#db
        .prepare(
          `SELECT id, session_id AS sessionId, status
           FROM turns
           WHERE status IN ('queued', 'starting', 'running', 'awaiting_approval', 'cancelling')
           ORDER BY julianday(created_at), id`,
        )
        .all() as RecoveryTurnRow[];
      const envelopes: AgentEventEnvelope[] = [];
      for (const turn of turns) {
        const eventId = EventIdSchema.parse(this.#eventIdFactory());
        const runtimeEvent = AgentRuntimeEventSchema.parse({
          event: {
            from: turn.status,
            status: "interrupted",
            stopReason: "interrupted",
            type: "turn_end",
          },
          occurredAt: timestamp,
          sessionId: turn.sessionId,
          turnId: turn.id,
        });
        envelopes.push(this.#appendWithinTransaction({ eventId, runtimeEvent }).envelope);
      }
      return envelopes;
    });
    try {
      return transaction.immediate();
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  replay(afterSeq: number, sessionId?: string): ReplayResult {
    this.#assertOpen();
    const cursor = parseInput(() => GlobalSeqSchema.parse(afterSeq));
    const parsedSessionId =
      sessionId === undefined ? undefined : parseInput(() => SessionIdSchema.parse(sessionId));
    const transaction = this.#db.transaction(() => {
      verifyJournalIntegrity(this.#db, "links");
      const boundary = readWatermark(this.#db);
      if (cursor > boundary.latestSeq) {
        throw new StorageError("REPLAY_CURSOR_AHEAD", {
          details: { afterSeq: cursor, latestSeq: boundary.latestSeq },
        });
      }
      if (cursor < boundary.minAvailableSeq) {
        throw new StorageError("REPLAY_GAP", {
          details: {
            latestSeq: boundary.latestSeq,
            minAvailableSeq: boundary.minAvailableSeq,
          },
        });
      }
      const rows =
        parsedSessionId === undefined
          ? (this.#db
              .prepare(
                `SELECT
                   seq, event_id AS eventId, session_id AS sessionId, turn_id AS turnId,
                   event_json AS eventJson, occurred_at AS occurredAt
                 FROM session_events
                 WHERE seq > ? AND seq <= ?
                 ORDER BY seq`,
              )
              .all(cursor, boundary.latestSeq) as EventRow[])
          : (this.#db
              .prepare(
                `SELECT
                   seq, event_id AS eventId, session_id AS sessionId, turn_id AS turnId,
                   event_json AS eventJson, occurred_at AS occurredAt
                 FROM session_events
                 WHERE seq > ? AND seq <= ? AND session_id = ?
                 ORDER BY seq`,
              )
              .all(cursor, boundary.latestSeq, parsedSessionId) as EventRow[]);
      const events = rows.map((row) =>
        AgentEventEnvelopeSchema.parse({
          event: JSON.parse(row.eventJson) as unknown,
          eventId: row.eventId,
          occurredAt: row.occurredAt,
          seq: row.seq,
          sessionId: row.sessionId,
          turnId: row.turnId,
          v: 1,
        }),
      );
      return {
        events,
        latestSeq: boundary.latestSeq,
        minAvailableSeq: boundary.minAvailableSeq,
      };
    });
    try {
      return transaction.deferred();
    } catch (error) {
      if (isStorageError(error)) throw error;
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  pruneJournal(
    options: {
      readonly maxAgeMs?: number;
      readonly maxEvents?: number;
      readonly now?: string;
    } = {},
  ): RetentionResult {
    this.#assertOpen();
    const maxAgeMs = options.maxAgeMs ?? JOURNAL_RETENTION_MAX_AGE_MS;
    const maxEvents = options.maxEvents ?? JOURNAL_RETENTION_MAX_EVENTS;
    if (
      !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 0 ||
      maxAgeMs > JOURNAL_RETENTION_MAX_CONFIGURABLE_AGE_MS ||
      !Number.isSafeInteger(maxEvents) ||
      maxEvents < 1
    ) {
      throw new StorageError("VALIDATION_FAILED", {
        details: { reason: "retention_options" },
      });
    }
    const now = parseInput(() => IsoTimestampSchema.parse(options.now ?? this.#validatedNow()));
    const threshold = parseInput(() => new Date(Date.parse(now) - maxAgeMs).toISOString());
    const transaction = this.#db.transaction((): RetentionResult => {
      verifyJournalIntegrity(this.#db, "links");
      const boundary = readWatermark(this.#db);
      const count = Number(
        (
          this.#db.prepare(`SELECT COUNT(*) AS count FROM session_events`).get() as {
            readonly count: number;
          }
        ).count,
      );
      let countCutoff = boundary.minAvailableSeq;
      if (count > maxEvents) {
        const firstKept = this.#db
          .prepare(
            `SELECT seq
             FROM session_events
             ORDER BY seq DESC
             LIMIT 1 OFFSET ?`,
          )
          .get(maxEvents - 1) as { readonly seq: number } | undefined;
        if (firstKept !== undefined) countCutoff = firstKept.seq - 1;
      }

      let ageCutoff = boundary.minAvailableSeq;
      if (count > 0) {
        const firstNotExpired = this.#db
          .prepare(
            `SELECT seq
             FROM session_events
             WHERE julianday(committed_at) >= julianday(?)
             ORDER BY seq
             LIMIT 1`,
          )
          .get(threshold) as { readonly seq: number } | undefined;
        ageCutoff = firstNotExpired === undefined ? boundary.latestSeq : firstNotExpired.seq - 1;
      }
      const cutoff = Math.max(boundary.minAvailableSeq, countCutoff, ageCutoff);
      const deleted =
        cutoff > boundary.minAvailableSeq
          ? Number(
              this.#db.prepare(`DELETE FROM session_events WHERE seq <= ?`).run(cutoff).changes,
            )
          : 0;
      if (cutoff > boundary.minAvailableSeq) {
        this.#db
          .prepare(`UPDATE journal_state SET min_replay_seq = ? WHERE singleton = 1`)
          .run(cutoff);
      }
      verifyJournalIntegrity(this.#db, "links");
      return {
        deletedEvents: deleted,
        latestSeq: boundary.latestSeq,
        minAvailableSeq: cutoff,
      };
    });
    try {
      return transaction.immediate();
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  getTurn(turnId: string): Turn | null {
    this.#assertOpen();
    const parsedTurnId = parseInput(() => TurnIdSchema.parse(turnId));
    const row = readTurnRow(this.#db, parsedTurnId);
    if (row === undefined) return null;
    try {
      return mapTurn(row);
    } catch (error) {
      if (isStorageError(error)) throw error;
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  getApproval(turnId: string, requestId: string): Approval | null {
    this.#assertOpen();
    const parsed = parseInput(() => ({
      requestId: OpaqueIdSchema.parse(requestId),
      turnId: TurnIdSchema.parse(turnId),
    }));
    const turnRow = readTurnRow(this.#db, parsed.turnId);
    if (turnRow === undefined) return null;
    try {
      const turn = mapTurn(turnRow);
      const approvalRow = readApprovalForTurnRow(this.#db, parsed.turnId, parsed.requestId);
      if (approvalRow === undefined) return null;
      if (approvalRow.sessionId !== turn.sessionId) {
        throw new StorageError("CORRUPT_READ_MODEL", {
          details: { reason: "approval_turn_ownership" },
        });
      }
      return mapApproval(approvalRow);
    } catch (error) {
      if (isStorageError(error)) throw error;
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  getSessionSnapshot(sessionId: string) {
    this.#assertOpen();
    const parsedSessionId = parseInput(() => SessionIdSchema.parse(sessionId));
    const transaction = this.#db.transaction(() => {
      verifyJournalCoverage(this.#db);
      const { latestSeq } = readWatermark(this.#db);
      return buildSessionSnapshot(this.#db, parsedSessionId, latestSeq);
    });
    try {
      return transaction.deferred();
    } catch (error) {
      if (isStorageError(error)) throw error;
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  getGlobalSnapshot(includeSessionIds: readonly string[] = []) {
    this.#assertOpen();
    const query = parseInput(() =>
      SnapshotQuerySchema.parse({ includeSessionId: includeSessionIds }),
    );
    const transaction = this.#db.transaction(() => {
      verifyJournalCoverage(this.#db);
      const { latestSeq } = readWatermark(this.#db);
      return buildGlobalSnapshot(this.#db, query.includeSessionId, latestSeq);
    });
    try {
      return transaction.deferred();
    } catch (error) {
      if (isStorageError(error)) throw error;
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  getConversationDirectory(): string | null {
    this.#assertOpen();
    const row = this.#db
      .prepare(`SELECT value_json AS valueJson FROM settings WHERE key = ?`)
      .get(CONVERSATION_DIRECTORY_SETTING_KEY) as { readonly valueJson: string } | undefined;
    if (row === undefined) return null;
    try {
      return ConversationDirectorySchema.parse(JSON.parse(row.valueJson) as unknown);
    } catch (error) {
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  setConversationDirectory(conversationDirectory: string): string {
    this.#assertOpen();
    const parsed = parseInput(() => ConversationDirectorySchema.parse(conversationDirectory));
    try {
      this.#db
        .prepare(
          `INSERT INTO settings(key, value_json)
           VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
        )
        .run(CONVERSATION_DIRECTORY_SETTING_KEY, canonicalJson(parsed));
      return parsed;
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  getProviderPreference(providerId: string): ProviderPreference | null {
    this.#assertOpen();
    const parsedProviderId = parseInput(() => ProviderIdSchema.parse(providerId));
    const row = this.#db
      .prepare(
        `SELECT
           provider_id AS providerId,
           permission_profile_id AS permissionProfileId,
           visible_in_sidebar AS visibleInSidebar
         FROM provider_preferences
         WHERE provider_id = ?`,
      )
      .get(parsedProviderId) as
      | {
          readonly permissionProfileId: string;
          readonly providerId: string;
          readonly visibleInSidebar: number;
        }
      | undefined;
    if (row === undefined) return null;
    try {
      return ProviderPreferenceSchema.parse({
        permissionProfileId: row.permissionProfileId,
        providerId: row.providerId,
        visibleInSidebar: row.visibleInSidebar === 1,
      });
    } catch (error) {
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  listProviderPreferences(): readonly ProviderPreference[] {
    this.#assertOpen();
    const rows = this.#db
      .prepare(
        `SELECT
           provider_id AS providerId,
           permission_profile_id AS permissionProfileId,
           visible_in_sidebar AS visibleInSidebar
         FROM provider_preferences
         ORDER BY provider_id`,
      )
      .all() as readonly {
      readonly permissionProfileId: string;
      readonly providerId: string;
      readonly visibleInSidebar: number;
    }[];
    try {
      return rows.map((row) =>
        ProviderPreferenceSchema.parse({
          permissionProfileId: row.permissionProfileId,
          providerId: row.providerId,
          visibleInSidebar: row.visibleInSidebar === 1,
        }),
      );
    } catch (error) {
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  upsertProviderPreference(preference: ProviderPreference): ProviderPreference {
    this.#assertOpen();
    const parsed = parseInput(() => ProviderPreferenceSchema.parse(preference));
    try {
      this.#db
        .prepare(
          `INSERT INTO provider_preferences(
             provider_id, permission_profile_id, visible_in_sidebar
           ) VALUES (?, ?, ?)
           ON CONFLICT(provider_id) DO UPDATE SET
             permission_profile_id = excluded.permission_profile_id,
             visible_in_sidebar = excluded.visible_in_sidebar`,
        )
        .run(parsed.providerId, parsed.permissionProfileId, parsed.visibleInSidebar ? 1 : 0);
      return parsed;
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  upsertProviderStatus(provider: Provider): Provider {
    this.#assertOpen();
    const parsed = parseInput(() => ProviderSchema.parse(provider));
    try {
      this.#db
        .prepare(
          `INSERT INTO providers_status(provider_id, provider_json, checked_at)
           VALUES (?, ?, ?)
           ON CONFLICT(provider_id) DO UPDATE SET
             provider_json = excluded.provider_json,
             checked_at = excluded.checked_at`,
        )
        .run(parsed.id, canonicalJson(parsed), parsed.checkedAt);
      return parsed;
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  listProviderStatuses(): readonly Provider[] {
    this.#assertOpen();
    const rows = this.#db
      .prepare(
        `SELECT provider_json AS providerJson
         FROM providers_status
         ORDER BY provider_id`,
      )
      .all() as { readonly providerJson: string }[];
    try {
      return rows.map((row) => ProviderSchema.parse(JSON.parse(row.providerJson) as unknown));
    } catch (error) {
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  getTurnUsage(turnId: string): TokenUsage | null {
    this.#assertOpen();
    const parsedTurnId = parseInput(() => TurnIdSchema.parse(turnId));
    let row:
      | {
          readonly cachedInputTokens: number | null;
          readonly inputTokens: number;
          readonly outputTokens: number;
          readonly quality: string;
        }
      | undefined;
    try {
      row = this.#db
        .prepare(
          `SELECT
             input_tokens AS inputTokens,
             output_tokens AS outputTokens,
             cached_input_tokens AS cachedInputTokens,
             quality
           FROM usage_stats
           WHERE turn_id = ?`,
        )
        .get(parsedTurnId) as typeof row;
    } catch (error) {
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
    if (row === undefined) return null;
    try {
      return TokenUsageSchema.parse({
        ...(row.cachedInputTokens === null ? {} : { cachedInputTokens: row.cachedInputTokens }),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        quality: row.quality,
      });
    } catch (error) {
      throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
    }
  }

  getOrCreateDeviceIdentity(
    appVersion: string,
    deviceIdFactory: () => string = randomUUID,
  ): DeviceIdentityResponse {
    this.#assertOpen();
    const version = parseInput(() => {
      if (appVersion.length === 0 || appVersion.length > 128) throw new TypeError("app version");
      return appVersion;
    });
    const transaction = this.#db.transaction(() => {
      const existing = this.#db
        .prepare(`SELECT device_id AS deviceId FROM devices WHERE singleton = 1`)
        .get() as { readonly deviceId: string } | undefined;
      if (existing !== undefined) {
        return DeviceIdentityResponseSchema.parse({
          classification: "pseudonymous",
          deviceId: existing.deviceId,
          resettable: true,
        });
      }
      const identity = DeviceIdentityResponseSchema.parse({
        classification: "pseudonymous",
        deviceId: deviceIdFactory(),
        resettable: true,
      });
      this.#db
        .prepare(
          `INSERT INTO devices(singleton, device_id, created_at, app_version)
           VALUES (1, ?, ?, ?)`,
        )
        .run(identity.deviceId, this.#validatedNow(), version);
      return identity;
    });
    try {
      return transaction.immediate();
    } catch (error) {
      throw asStorageWriteError(error);
    }
  }

  resetDeviceIdentity(
    appVersion: string,
    deviceIdFactory: () => string = randomUUID,
  ): DeviceIdentityResponse {
    this.#assertOpen();
    if (appVersion.length === 0 || appVersion.length > 128) {
      throw new StorageError("VALIDATION_FAILED", {
        details: { field: "appVersion" },
      });
    }
    const transaction = this.#db.transaction(() => {
      const current = this.#db
        .prepare(`SELECT device_id AS deviceId FROM devices WHERE singleton = 1`)
        .get() as { readonly deviceId: string } | undefined;
      const next = DeviceIdentityResponseSchema.parse({
        classification: "pseudonymous",
        deviceId: deviceIdFactory(),
        resettable: true,
      });
      if (next.deviceId === current?.deviceId) {
        throw new StorageError("DEVICE_RESET_FAILED", {
          details: { reason: "identity_not_changed" },
        });
      }
      this.#db.prepare(`DELETE FROM devices WHERE singleton = 1`).run();
      this.#db
        .prepare(
          `INSERT INTO devices(singleton, device_id, created_at, app_version)
           VALUES (1, ?, ?, ?)`,
        )
        .run(next.deviceId, this.#validatedNow(), appVersion);
      return next;
    });
    try {
      return transaction.immediate();
    } catch (error) {
      if (isSqliteBusyError(error)) throw new StorageError("DATABASE_BUSY", { cause: error });
      if (isSqliteFullError(error)) throw new StorageError("DATABASE_FULL", { cause: error });
      throw new StorageError("DEVICE_RESET_FAILED", { cause: error });
    }
  }

  checkpoint(mode: "PASSIVE" | "TRUNCATE" = "PASSIVE"): CheckpointResult {
    this.#assertOpen();
    const rows = this.#db.pragma(`wal_checkpoint(${mode})`) as unknown[];
    const row = rows[0] as
      { readonly busy: number; readonly checkpointed: number; readonly log: number } | undefined;
    if (row === undefined) throw new StorageError("CORRUPT_READ_MODEL");
    return { ...row, mode };
  }

  close(): void {
    if (this.#closed) return;
    try {
      this.checkpoint("TRUNCATE");
    } finally {
      this.#db.close();
      this.#closed = true;
    }
  }
}

function migrationLedgerExists(db: BetterSqlite3.Database): boolean {
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

function validateExistingDatabaseReadOnly(
  filePath: string,
  migrations: readonly Migration[],
): void {
  let db: BetterSqlite3.Database;
  try {
    db = new BetterSqlite3(filePath, {
      fileMustExist: true,
      readonly: true,
    });
  } catch (error) {
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  }
  try {
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.pragma("foreign_keys = ON");
    db.pragma("query_only = ON");
    db.pragma("trusted_schema = OFF");
    preflightMigrationDatabase(db);
    if (!migrationLedgerExists(db)) return;
    verifyMigrationHistory(db, migrations);
    verifyStorageBaseInvariants(db);
    verifyJournalIntegrity(db);
  } catch (error) {
    if (isStorageError(error)) throw error;
    if (isSqliteBusyError(error)) throw new StorageError("DATABASE_BUSY", { cause: error });
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  } finally {
    db.close();
  }
}

export function openStorage(filePath: string, options: StorageOpenOptions = {}): DougoStorage {
  validateFilePath(filePath);
  const migrations = options.migrations ?? DEFAULT_MIGRATIONS;
  validateMigrationManifest(migrations);
  if (options.clock !== undefined) {
    parseInput(() => IsoTimestampSchema.parse(options.clock?.()));
  }
  if (existsSync(filePath)) {
    validateExistingDatabaseReadOnly(filePath, migrations);
  }
  mkdirSync(dirname(filePath), { mode: 0o700, recursive: true });
  let db = new BetterSqlite3(filePath);
  try {
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.pragma("foreign_keys = ON");
    db.pragma(`synchronous = ${SQLITE_SYNCHRONOUS}`);
    db.pragma("trusted_schema = OFF");
    const migrationClock = options.clock ?? (() => new Date().toISOString());
    const applied = applyMigrations(db, migrations, migrationClock, verifyJournalIntegrity);
    verifyMigrationHistory(db, migrations);
    verifyStorageBaseInvariants(db);
    verifyStorageSchema(db);
    verifyJournalIntegrity(db);

    // Schema-changing statements on a connection can retain internal SQLite
    // statement locks until that connection closes. Reopen before switching
    // the persistent journal mode, then revalidate under the writable lock.
    db.close();
    db = new BetterSqlite3(filePath, { fileMustExist: true });
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.pragma("foreign_keys = ON");
    db.pragma(`synchronous = ${SQLITE_SYNCHRONOUS}`);
    db.pragma("trusted_schema = OFF");
    db.transaction(() => {
      verifyMigrationHistory(db, migrations);
      verifyStorageBaseInvariants(db);
      verifyStorageSchema(db);
      verifyJournalIntegrity(db);
    }).immediate();

    // SQLite's quick_check statement keeps an internal table lock on this
    // connection after it returns. A final reopen releases that read lock
    // before journal_mode is changed.
    db.close();
    db = new BetterSqlite3(filePath, { fileMustExist: true });
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.pragma("foreign_keys = ON");
    db.pragma(`synchronous = ${SQLITE_SYNCHRONOUS}`);
    db.pragma("trusted_schema = OFF");
    const journalMode = String(db.pragma("journal_mode = WAL", { simple: true })).toLowerCase();
    if (journalMode !== "wal") {
      throw new StorageError("MIGRATION_FAILED", {
        details: { reason: "wal_unavailable" },
      });
    }
    db.pragma(`synchronous = ${SQLITE_SYNCHRONOUS}`);
    db.pragma(`wal_autocheckpoint = ${SQLITE_WAL_AUTOCHECKPOINT_PAGES}`);
    return new DougoStorage(db, applied, options);
  } catch (error) {
    if (db.open) db.close();
    if (isStorageError(error)) throw error;
    if (isSqliteBusyError(error)) throw new StorageError("DATABASE_BUSY", { cause: error });
    throw new StorageError("MIGRATION_FAILED", { cause: error });
  }
}

export function readStoragePragmas(filePath: string): {
  readonly busyTimeoutMs: number;
  readonly foreignKeys: boolean;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly walAutocheckpointPages: number;
} {
  validateFilePath(filePath);
  const db = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
  try {
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.pragma("foreign_keys = ON");
    db.pragma(`synchronous = ${SQLITE_SYNCHRONOUS}`);
    db.pragma(`wal_autocheckpoint = ${SQLITE_WAL_AUTOCHECKPOINT_PAGES}`);
    return {
      busyTimeoutMs: Number(db.pragma("busy_timeout", { simple: true })),
      foreignKeys: Number(db.pragma("foreign_keys", { simple: true })) === 1,
      journalMode: String(db.pragma("journal_mode", { simple: true })),
      synchronous: Number(db.pragma("synchronous", { simple: true })),
      walAutocheckpointPages: Number(db.pragma("wal_autocheckpoint", { simple: true })),
    };
  } finally {
    db.close();
  }
}
