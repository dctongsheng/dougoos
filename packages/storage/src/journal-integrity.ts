import type BetterSqlite3 from "better-sqlite3";

import {
  AgentEventEnvelopeSchema,
  AgentRuntimeEventSchema,
  IsoTimestampSchema,
} from "@dougoos/shared";

import { canonicalJson, sha256 } from "./canonical.js";
import { StorageError, isStorageError } from "./errors.js";

interface RangeAggregate {
  readonly maximum: bigint | null;
  readonly minimum: bigint | null;
  readonly rowCount: bigint;
}

interface JournalLinkRow {
  readonly committedAt: string;
  readonly eventJson: string;
  readonly eventType: string;
  readonly payloadBytes: bigint | null;
  readonly payloadSha256: string | null;
  readonly persistedEventId: string;
  readonly persistedSessionId: string;
  readonly persistedTurnId: string | null;
  readonly receiptReceivedAt: string | null;
  readonly receiptSequenceNumber: bigint | null;
  readonly sequenceNumber: bigint;
  readonly occurredAt: string;
}

interface JournalWatermarkRow {
  readonly latestSequence: bigint;
  readonly replayFloor: bigint;
}

function corrupt(reason: string): never {
  throw new StorageError("CORRUPT_READ_MODEL", { details: { reason } });
}

function safeSequence(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return corrupt("journal_sequence_range");
  }
  return Number(value);
}

function readRange(db: BetterSqlite3.Database, table: "event_receipts" | "session_events") {
  return db
    .prepare(
      `SELECT COUNT(*) AS rowCount, MIN(seq) AS minimum, MAX(seq) AS maximum
       FROM ${table}`,
    )
    .safeIntegers(true)
    .get() as RangeAggregate;
}

function expectExactRange(
  range: RangeAggregate,
  expectedCount: bigint,
  expectedMinimum: bigint | null,
  expectedMaximum: bigint | null,
  reason: string,
): void {
  if (
    range.rowCount !== expectedCount ||
    range.minimum !== expectedMinimum ||
    range.maximum !== expectedMaximum
  ) {
    corrupt(reason);
  }
}

function readWatermark(db: BetterSqlite3.Database): JournalWatermarkRow {
  const watermark = db
    .prepare(
      `SELECT last_seq AS latestSequence, min_replay_seq AS replayFloor
       FROM journal_state
       WHERE singleton = 1`,
    )
    .safeIntegers(true)
    .get() as JournalWatermarkRow | undefined;
  if (
    watermark === undefined ||
    watermark.replayFloor < 0n ||
    watermark.latestSequence < watermark.replayFloor ||
    watermark.latestSequence > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    corrupt("journal_watermark");
  }
  return watermark;
}

function verifyRetainedRange(db: BetterSqlite3.Database, watermark: JournalWatermarkRow): void {
  const retainedCount = watermark.latestSequence - watermark.replayFloor;
  expectExactRange(
    readRange(db, "session_events"),
    retainedCount,
    retainedCount === 0n ? null : watermark.replayFloor + 1n,
    retainedCount === 0n ? null : watermark.latestSequence,
    "journal_retained_range",
  );
}

export function verifyJournalCoverage(db: BetterSqlite3.Database): void {
  try {
    verifyRetainedRange(db, readWatermark(db));
  } catch (error) {
    if (isStorageError(error)) throw error;
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  }
}

/**
 * Proves that the replay watermark, retained event interval, durable receipts,
 * and retained payload fingerprints describe one contiguous journal.
 */
export function verifyJournalIntegrity(
  db: BetterSqlite3.Database,
  mode: "deep" | "links" = "deep",
): void {
  try {
    const watermark = readWatermark(db);
    verifyRetainedRange(db, watermark);
    if (mode === "deep") {
      expectExactRange(
        readRange(db, "event_receipts"),
        watermark.latestSequence,
        watermark.latestSequence === 0n ? null : 1n,
        watermark.latestSequence === 0n ? null : watermark.latestSequence,
        "journal_receipt_range",
      );
    }
    const brokenLink = db
      .prepare(
        `SELECT 1
         FROM session_events AS e
         LEFT JOIN event_receipts AS r ON r.event_id = e.event_id
         WHERE e.seq > ? AND e.seq <= ?
           AND (r.event_id IS NULL OR r.seq <> e.seq)
         LIMIT 1`,
      )
      .get(watermark.replayFloor, watermark.latestSequence);
    if (brokenLink !== undefined) corrupt("journal_receipt_link");
    if (mode === "links") return;

    const rows = db
      .prepare(
        `SELECT
           e.seq AS sequenceNumber,
           e.event_id AS persistedEventId,
           e.session_id AS persistedSessionId,
           e.turn_id AS persistedTurnId,
           e.type AS eventType,
           e.event_json AS eventJson,
           e.occurred_at AS occurredAt,
           e.committed_at AS committedAt,
           r.seq AS receiptSequenceNumber,
           r.payload_sha256 AS payloadSha256,
           r.payload_bytes AS payloadBytes,
           r.received_at AS receiptReceivedAt
         FROM session_events AS e
         LEFT JOIN event_receipts AS r ON r.event_id = e.event_id
         WHERE e.seq > ? AND e.seq <= ?
         ORDER BY e.seq`,
      )
      .safeIntegers(true)
      .all(watermark.replayFloor, watermark.latestSequence) as JournalLinkRow[];

    let expectedSequence = watermark.replayFloor + 1n;
    for (const row of rows) {
      if (
        row.sequenceNumber !== expectedSequence ||
        row.receiptSequenceNumber !== row.sequenceNumber ||
        row.payloadSha256 === null ||
        row.payloadBytes === null ||
        row.receiptReceivedAt === null
      ) {
        corrupt("journal_receipt_link");
      }
      const envelope = AgentEventEnvelopeSchema.parse({
        event: JSON.parse(row.eventJson) as unknown,
        eventId: row.persistedEventId,
        occurredAt: row.occurredAt,
        seq: safeSequence(row.sequenceNumber),
        sessionId: row.persistedSessionId,
        turnId: row.persistedTurnId,
        v: 1,
      });
      if (envelope.event.type !== row.eventType) {
        corrupt("journal_event_type");
      }
      const runtimeEvent = AgentRuntimeEventSchema.parse({
        event: envelope.event,
        occurredAt: envelope.occurredAt,
        sessionId: envelope.sessionId,
        turnId: envelope.turnId,
      });
      const canonical = canonicalJson(runtimeEvent);
      if (
        sha256(canonical) !== row.payloadSha256 ||
        BigInt(Buffer.byteLength(canonical, "utf8")) !== row.payloadBytes
      ) {
        corrupt("journal_receipt_fingerprint");
      }
      const committedAt = IsoTimestampSchema.parse(row.committedAt);
      const receivedAt = IsoTimestampSchema.parse(row.receiptReceivedAt);
      if (Date.parse(committedAt) !== Date.parse(receivedAt)) {
        corrupt("journal_commit_timestamp");
      }
      expectedSequence += 1n;
    }
    if (expectedSequence !== watermark.latestSequence + 1n) {
      corrupt("journal_retained_range");
    }
  } catch (error) {
    if (isStorageError(error)) throw error;
    throw new StorageError("CORRUPT_READ_MODEL", { cause: error });
  }
}
