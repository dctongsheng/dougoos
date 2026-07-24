import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { CONTRACT_LIMITS } from "@dougoos/shared";

import { StorageError } from "./errors.js";
import {
  appendTurnState,
  createInitializedSession,
  createQueuedTurn,
  createRunningTurn,
  createTestContext,
  makeRuntimeEvent,
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

describe("consistent bounded snapshots", () => {
  it("derives a stable display preview from the first user message", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-first-user-preview");
      createQueuedTurn(context.store, "session-first-user-preview", "first-user-preview");

      const summary = context.store
        .getGlobalSnapshot()
        .sessions.find((session) => session.id === "session-first-user-preview");
      expect(summary?.firstUserMessagePreview).toBe("prompt-first-user-preview");
    } finally {
      context.cleanup();
    }
  });

  it("returns complete summaries plus requested and active Sessions at one watermark", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-inactive");
      createInitializedSession(context.store, "session-active");
      const turnId = createRunningTurn(context.store, "session-active", "global-active");
      appendTurnState(context.store, "session-active", turnId, "running", "awaiting_approval", 5);
      context.store.appendAndProject({
        eventId: "event-global-approval",
        runtimeEvent: makeRuntimeEvent("session-active", turnId, 6, {
          expiresAt: time(30),
          options: [
            { kind: "allow", label: "Allow", optionId: "allow" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "approval-global",
          title: "Permission",
          type: "approval_request",
        }),
      });

      const snapshot = context.store.getGlobalSnapshot(["session-inactive"]);
      const watermark = context.store.replay(0).latestSeq;
      expect(snapshot.snapshotSeq).toBe(watermark);
      expect(snapshot.sessions.map((session) => session.id).sort()).toEqual([
        "session-active",
        "session-inactive",
      ]);
      expect(snapshot.includedSessions.map((included) => included.session.id)).toEqual([
        "session-active",
        "session-inactive",
      ]);
      expect(
        snapshot.includedSessions.every(
          (included) => Number(included.sessionSnapshotSeq) === Number(snapshot.snapshotSeq),
        ),
      ).toBe(true);
      expect(snapshot.activeTurns).toEqual([
        expect.objectContaining({ id: turnId, status: "awaiting_approval" }),
      ]);
      expect(snapshot.pendingApprovals).toEqual([
        expect.objectContaining({
          requestId: "approval-global",
          sessionId: "session-active",
          turnId,
        }),
      ]);
      expect(snapshot.sessions.find((session) => session.id === "session-active")).toEqual(
        expect.objectContaining({
          activeTurnId: turnId,
          messageCount: 2,
          state: "awaiting_approval",
        }),
      );

      expectCode(
        () => context.store.getGlobalSnapshot(["session-inactive", "session-inactive"]),
        "VALIDATION_FAILED",
      );
      expectCode(() => context.store.getGlobalSnapshot(["session-does-not-exist"]), "NOT_FOUND");
      expectCode(
        () =>
          context.store.getGlobalSnapshot(
            Array.from(
              { length: CONTRACT_LIMITS.requestedSessions + 1 },
              (_, index) => `session-requested-${index}`,
            ),
          ),
        "VALIDATION_FAILED",
      );
    } finally {
      context.cleanup();
    }
  });

  it("fails closed instead of returning a corrupt valid-JSON read model", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-corrupt-snapshot");
      const raw = new BetterSqlite3(context.databasePath);
      try {
        raw
          .prepare(
            `UPDATE sessions
             SET capability_snapshot_json = '{}'
             WHERE id = 'session-corrupt-snapshot'`,
          )
          .run();
      } finally {
        raw.close();
      }
      expectCode(
        () => context.store.getSessionSnapshot("session-corrupt-snapshot"),
        "CORRUPT_READ_MODEL",
      );
      expectCode(
        () => context.store.getGlobalSnapshot(["session-corrupt-snapshot"]),
        "CORRUPT_READ_MODEL",
      );
    } finally {
      context.cleanup();
    }
  });

  it("normalizes multiline message bodies into contract-safe summary previews", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-preview-normalized");
      const turnId = createRunningTurn(
        context.store,
        "session-preview-normalized",
        "preview-normalized",
      );
      context.store.appendAndProject({
        eventId: "event-preview-normalized",
        runtimeEvent: makeRuntimeEvent("session-preview-normalized", turnId, 5, {
          messageId: "message-preview-normalized",
          text: "first line\n\tsecond line\r\nthird line",
          type: "message_delta",
        }),
      });

      const summary = context.store
        .getGlobalSnapshot()
        .sessions.find((session) => session.id === "session-preview-normalized");
      expect(summary?.lastMessagePreview).toBe("first line second line third line");
    } finally {
      context.cleanup();
    }
  });

  it("never uses private thought text as the Session summary preview", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-preview-public");
      const turnId = createRunningTurn(context.store, "session-preview-public", "preview-public");
      context.store.appendAndProject({
        eventId: "event-preview-public-answer",
        runtimeEvent: makeRuntimeEvent("session-preview-public", turnId, 5, {
          messageId: "message-preview-public-answer",
          text: "Public answer",
          type: "message_delta",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-preview-private-thought",
        runtimeEvent: makeRuntimeEvent("session-preview-public", turnId, 6, {
          messageId: "message-preview-private-thought",
          text: "PRIVATE_REASONING_SENTINEL",
          type: "thought_delta",
        }),
      });

      const summary = context.store
        .getGlobalSnapshot()
        .sessions.find((session) => session.id === "session-preview-public");
      expect(summary?.lastMessagePreview).toBe("Public answer");
    } finally {
      context.cleanup();
    }
  });

  it("rejects an oversized pending-approval index without truncation", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-pending-limit");
      const turnId = createRunningTurn(context.store, "session-pending-limit", "pending-limit");
      appendTurnState(
        context.store,
        "session-pending-limit",
        turnId,
        "running",
        "awaiting_approval",
        5,
      );
      const raw = new BetterSqlite3(context.databasePath);
      try {
        raw.pragma("foreign_keys = ON");
        const insert = raw.prepare(
          `INSERT INTO approval_requests(
             id, session_id, turn_id, request_id, status, title, description,
             options_json, decision_json, expires_at, resolved_at,
             created_seq, updated_seq
           ) VALUES (?, ?, ?, ?, 'pending', 'Permission', NULL, ?, NULL, ?, NULL, ?, ?)`,
        );
        raw.transaction(() => {
          for (let index = 0; index < CONTRACT_LIMITS.maxPendingApprovals + 1; index += 1) {
            insert.run(
              `approval-limit-${index}`,
              "session-pending-limit",
              turnId,
              `request-limit-${index}`,
              '[{"kind":"reject","label":"Reject","optionId":"reject"}]',
              time(100),
              10 + index,
              10 + index,
            );
          }
        })();
      } finally {
        raw.close();
      }
      expectCode(() => context.store.getGlobalSnapshot(), "SNAPSHOT_LIMIT_EXCEEDED");
    } finally {
      context.cleanup();
    }
  });
});

describe("journal retention and replay boundaries", () => {
  const maximumConfigurableAgeMs = 10 * 365 * 24 * 60 * 60 * 1_000;

  it.each([0, maximumConfigurableAgeMs])(
    "accepts the maxAgeMs operational boundary value %s",
    (maxAgeMs) => {
      const context = createTestContext();
      try {
        createInitializedSession(context.store, `session-retention-age-${maxAgeMs}`);
        const before = context.store.replay(0);
        expect(
          context.store.pruneJournal({
            maxAgeMs,
            maxEvents: 100,
            now: time(100),
          }),
        ).toEqual({
          deletedEvents: 0,
          latestSeq: before.latestSeq,
          minAvailableSeq: 0,
        });
      } finally {
        context.cleanup();
      }
    },
  );

  it.each([
    {
      maxAgeMs: Number.MAX_SAFE_INTEGER,
      name: "Number.MAX_SAFE_INTEGER maxAgeMs",
      now: time(100),
    },
    {
      maxAgeMs: maximumConfigurableAgeMs + 1,
      name: "maxAgeMs above the operational boundary",
      now: time(100),
    },
    {
      maxAgeMs: 1,
      name: "invalid now timestamp",
      now: "not-an-iso-timestamp",
    },
  ])("rejects $name without journal mutation", (testCase) => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, `session-invalid-retention-${testCase.maxAgeMs}`);
      const before = context.store.replay(0);
      expectCode(
        () =>
          context.store.pruneJournal({
            maxAgeMs: testCase.maxAgeMs,
            maxEvents: 100,
            now: testCase.now,
          }),
        "VALIDATION_FAILED",
      );
      expect(context.store.replay(0)).toEqual(before);
    } finally {
      context.cleanup();
    }
  });

  it("compares retention age by instant and persists clock timestamps in UTC", () => {
    const context = createTestContext({
      clock: () => "2026-07-24T08:00:00.000+08:00",
    });
    try {
      createInitializedSession(context.store, "session-offset-retention");
      const before = context.store.replay(0);
      const raw = new BetterSqlite3(context.databasePath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        expect(
          raw.prepare(`SELECT DISTINCT committed_at AS committedAt FROM session_events`).all(),
        ).toEqual([{ committedAt: "2026-07-24T00:00:00.000Z" }]);
      } finally {
        raw.close();
      }

      expect(
        context.store.pruneJournal({
          maxAgeMs: 60 * 60 * 1_000,
          maxEvents: 100,
          now: "2026-07-24T02:00:00.000Z",
        }),
      ).toEqual({
        deletedEvents: before.events.length,
        latestSeq: before.latestSeq,
        minAvailableSeq: before.latestSeq,
      });
    } finally {
      context.cleanup();
    }
  });

  it("preserves global sequence order and stable dedupe receipts after count pruning", () => {
    const context = createTestContext();
    try {
      const firstInitialized = createInitializedSession(context.store, "session-replay-a");
      createInitializedSession(context.store, "session-replay-b");
      createInitializedSession(context.store, "session-replay-c");
      const firstEvents = context.store.replay(0);
      expect(firstEvents.events.map((event) => event.seq)).toEqual(
        firstEvents.events.map((_, index) => index + 1),
      );
      expect(
        context.store
          .replay(0, "session-replay-b")
          .events.every((event) => event.sessionId === "session-replay-b"),
      ).toBe(true);
      expectCode(() => context.store.replay(firstEvents.latestSeq + 1), "REPLAY_CURSOR_AHEAD");

      const retention = context.store.pruneJournal({
        maxAgeMs: 1_000_000_000,
        maxEvents: 2,
        now: time(100),
      });
      expect(retention.latestSeq).toBe(firstEvents.latestSeq);
      expect(retention.minAvailableSeq).toBe(firstEvents.latestSeq - 2);
      expect(retention.deletedEvents).toBe(firstEvents.latestSeq - 2);
      expect(
        context.store.replay(retention.minAvailableSeq).events.map((event) => event.seq),
      ).toEqual([retention.minAvailableSeq + 1, retention.minAvailableSeq + 2]);
      expectCode(() => context.store.replay(retention.minAvailableSeq - 1), "REPLAY_GAP");

      const watermarkBeforeRetry = context.store.replay(retention.minAvailableSeq).latestSeq;
      const retry = context.store.createInitializedSession({
        eventId: "event-session-replay-a-idle",
        session: firstInitialized,
      });
      expect(retry.duplicate).toBe(true);
      expect(retry.envelope.eventId).toBe("event-session-replay-a-idle");
      expect(context.store.replay(retention.minAvailableSeq).latestSeq).toBe(watermarkBeforeRetry);
    } finally {
      context.cleanup();
    }
  });

  it("advances the floor exactly to latestSeq when every event expires", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-age-prune");
      const before = context.store.replay(0);
      const retention = context.store.pruneJournal({
        maxAgeMs: 1,
        maxEvents: 100,
        now: time(200),
      });
      expect(retention).toEqual({
        deletedEvents: before.events.length,
        latestSeq: before.latestSeq,
        minAvailableSeq: before.latestSeq,
      });
      expect(context.store.replay(before.latestSeq)).toEqual({
        events: [],
        latestSeq: before.latestSeq,
        minAvailableSeq: before.latestSeq,
      });
      expectCode(() => context.store.replay(before.latestSeq - 1), "REPLAY_GAP");
    } finally {
      context.cleanup();
    }
  });
});
