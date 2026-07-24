import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { AgentEventEnvelopeSchema } from "@dougoos/shared";

import { StorageError } from "./errors.js";
import { inspectDatabase } from "./inspect.js";
import { openStorage } from "./store.js";
import {
  createInitializedSession,
  createRunningTurn,
  createTestContext,
  time,
} from "./test-utils/helpers.js";

function expectCode(action: () => unknown, code: StorageError["code"]): void {
  try {
    action();
    throw new Error("expected StorageError");
  } catch (error) {
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe(code);
  }
}

function createJournalFixture() {
  const context = createTestContext();
  createInitializedSession(context.store, "session-journal-integrity");
  createRunningTurn(context.store, "session-journal-integrity", "journal-integrity");
  return context;
}

describe("journal continuity and receipt integrity", () => {
  it.each(["first", "middle", "latest"] as const)(
    "fails open and inspection on a retained $position sequence hole",
    (position) => {
      const context = createJournalFixture();
      try {
        const sequences = context.store.replay(0).events.map((event) => Number(event.seq));
        const target =
          position === "first"
            ? sequences[0]
            : position === "latest"
              ? sequences.at(-1)
              : sequences[Math.floor(sequences.length / 2)];
        expect(target).toBeDefined();
        context.store.close();

        const raw = new BetterSqlite3(context.databasePath);
        raw.prepare(`DELETE FROM session_events WHERE seq = ?`).run(target);
        raw.close();

        expectCode(() => openStorage(context.databasePath), "CORRUPT_READ_MODEL");
        expectCode(() => inspectDatabase(context.databasePath), "CORRUPT_READ_MODEL");
      } finally {
        context.cleanup();
      }
    },
  );

  it("fails replay and snapshots when a retained hole appears on an open connection", () => {
    const context = createJournalFixture();
    try {
      const events = context.store.replay(0).events;
      const target = events[Math.floor(events.length / 2)]?.seq;
      expect(target).toBeDefined();
      const raw = new BetterSqlite3(context.databasePath);
      raw.prepare(`DELETE FROM session_events WHERE seq = ?`).run(target);
      raw.close();

      expectCode(() => context.store.replay(0), "CORRUPT_READ_MODEL");
      expectCode(
        () => context.store.getSessionSnapshot("session-journal-integrity"),
        "CORRUPT_READ_MODEL",
      );
      expectCode(() => context.store.getGlobalSnapshot(), "CORRUPT_READ_MODEL");
    } finally {
      context.cleanup();
    }
  });

  it.each([
    {
      mutate(db: BetterSqlite3.Database, latestSequence: number) {
        db.prepare(
          `INSERT INTO event_receipts(
             event_id, seq, payload_sha256, payload_bytes, received_at
           ) VALUES ('event-orphan-receipt', ?, ?, 1, ?)`,
        ).run(latestSequence + 1, "0".repeat(64), time(100));
      },
      name: "orphan receipt",
    },
    {
      mutate(db: BetterSqlite3.Database, latestSequence: number) {
        db.prepare(`UPDATE event_receipts SET seq = ? WHERE seq = 1`).run(latestSequence + 1);
      },
      name: "receipt sequence mismatch",
    },
    {
      mutate(db: BetterSqlite3.Database) {
        db.prepare(`UPDATE event_receipts SET payload_sha256 = ? WHERE seq = 1`).run(
          "0".repeat(64),
        );
      },
      name: "receipt hash mismatch",
    },
    {
      mutate(db: BetterSqlite3.Database) {
        db.prepare(
          `UPDATE event_receipts SET payload_bytes = payload_bytes + 1 WHERE seq = 1`,
        ).run();
      },
      name: "receipt byte-count mismatch",
    },
  ])("fails open and inspection on a $name", (testCase) => {
    const context = createJournalFixture();
    try {
      const latestSequence = context.store.replay(0).latestSeq;
      context.store.close();
      const raw = new BetterSqlite3(context.databasePath);
      testCase.mutate(raw, latestSequence);
      raw.close();

      expectCode(() => openStorage(context.databasePath), "CORRUPT_READ_MODEL");
      expectCode(() => inspectDatabase(context.databasePath), "CORRUPT_READ_MODEL");
    } finally {
      context.cleanup();
    }
  });

  it("accepts a legal retained prefix boundary across replay, inspection, and reopen", () => {
    const context = createJournalFixture();
    try {
      const before = context.store.replay(0);
      const retention = context.store.pruneJournal({
        maxAgeMs: 1_000_000_000,
        maxEvents: 2,
        now: time(200),
      });
      expect(retention).toEqual({
        deletedEvents: before.events.length - 2,
        latestSeq: before.latestSeq,
        minAvailableSeq: before.latestSeq - 2,
      });
      const retained = context.store.replay(retention.minAvailableSeq);
      expect(retained.events).toHaveLength(2);
      expect(AgentEventEnvelopeSchema.parse(retained.events[0])).toEqual(retained.events[0]);
      context.store.close();

      expect(inspectDatabase(context.databasePath).journal).toEqual({
        eventCount: 2,
        latestSeq: before.latestSeq,
        minAvailableSeq: before.latestSeq - 2,
        receiptCount: before.latestSeq,
      });
      const reopened = openStorage(context.databasePath);
      expect(reopened.replay(retention.minAvailableSeq).events).toEqual(retained.events);
      reopened.close();
    } finally {
      context.cleanup();
    }
  });

  it("keeps hot retained-link checks indexed when durable receipts greatly outnumber events", () => {
    const context = createJournalFixture();
    const syntheticLatest = 20_000;
    const syntheticFloor = syntheticLatest - 2;
    try {
      const before = context.store.replay(0);
      const retention = context.store.pruneJournal({
        maxAgeMs: 1_000_000_000,
        maxEvents: 2,
        now: time(200),
      });
      expect(retention.minAvailableSeq).toBe(before.latestSeq - 2);
      context.store.close();

      const raw = new BetterSqlite3(context.databasePath);
      raw.transaction(() => {
        raw
          .prepare(`UPDATE event_receipts SET seq = ? WHERE seq = ?`)
          .run(syntheticLatest - 1, retention.minAvailableSeq + 1);
        raw
          .prepare(`UPDATE event_receipts SET seq = ? WHERE seq = ?`)
          .run(syntheticLatest, retention.minAvailableSeq + 2);
        raw
          .prepare(`UPDATE session_events SET seq = ? WHERE seq = ?`)
          .run(syntheticLatest - 1, retention.minAvailableSeq + 1);
        raw
          .prepare(`UPDATE session_events SET seq = ? WHERE seq = ?`)
          .run(syntheticLatest, retention.minAvailableSeq + 2);
        const insertReceipt = raw.prepare(
          `INSERT INTO event_receipts(
             event_id, seq, payload_sha256, payload_bytes, received_at
           ) VALUES (?, ?, ?, 1, ?)`,
        );
        for (let sequence = before.latestSeq - 1; sequence <= syntheticFloor; sequence += 1) {
          insertReceipt.run(
            `event-pruned-synthetic-${sequence}`,
            sequence,
            "0".repeat(64),
            time(100),
          );
        }
        raw
          .prepare(
            `UPDATE journal_state
             SET last_seq = ?, min_replay_seq = ?
             WHERE singleton = 1`,
          )
          .run(syntheticLatest, syntheticFloor);
      })();

      const queryPlan = raw
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT 1
           FROM session_events AS e
           LEFT JOIN event_receipts AS r ON r.event_id = e.event_id
           WHERE e.seq > ? AND e.seq <= ?
             AND (r.event_id IS NULL OR r.seq <> e.seq)
           LIMIT 1`,
        )
        .all(syntheticFloor, syntheticLatest) as { readonly detail: string }[];
      expect(queryPlan.some((step) => /SEARCH r .*event_id/u.test(step.detail))).toBe(true);
      expect(queryPlan.some((step) => /SCAN r/u.test(step.detail))).toBe(false);
      raw.close();

      const reopened = openStorage(context.databasePath);
      expect(reopened.replay(syntheticFloor).events).toHaveLength(2);
      expect(reopened.getGlobalSnapshot().snapshotSeq).toBe(syntheticLatest);
      reopened.close();
    } finally {
      context.cleanup();
    }
  });
});
