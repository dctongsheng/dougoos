import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { TokenUsageSchema } from "@dougoos/shared";

import { StorageError } from "./errors.js";
import { openStorage } from "./store.js";
import {
  createInitializedSession,
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

describe("Turn-grain usage_stats read model", () => {
  it("writes usage exactly once and keeps it readable after retention and reopen", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-usage");
      const turnId = createRunningTurn(context.store, "session-usage", "usage");
      expect(context.store.getTurnUsage(turnId)).toBeNull();
      const runtimeEvent = makeRuntimeEvent("session-usage", turnId, 10, {
        from: "running",
        status: "completed",
        stopReason: "end_turn",
        type: "turn_end",
        usage: {
          cachedInputTokens: 3,
          inputTokens: 11,
          outputTokens: 7,
          quality: "exact",
        },
      });
      const first = context.store.appendAndProject({
        eventId: "event-usage-end",
        runtimeEvent,
      });
      expect(
        context.store.appendAndProject({
          eventId: "event-usage-end",
          runtimeEvent,
        }),
      ).toEqual({ duplicate: true, envelope: first.envelope });
      const usage = TokenUsageSchema.parse({
        cachedInputTokens: 3,
        inputTokens: 11,
        outputTokens: 7,
        quality: "exact",
      });
      expect(context.store.getTurnUsage(turnId)).toEqual(usage);

      const beforePrune = context.store.replay(0);
      expect(
        context.store.pruneJournal({
          maxAgeMs: 1,
          maxEvents: 100,
          now: time(200),
        }),
      ).toEqual(
        expect.objectContaining({
          deletedEvents: beforePrune.events.length,
          minAvailableSeq: beforePrune.latestSeq,
        }),
      );
      expect(context.store.getTurnUsage(turnId)).toEqual(usage);
      context.store.close();

      const reopened = openStorage(context.databasePath);
      try {
        expect(reopened.getTurnUsage(turnId)).toEqual(usage);
        const raw = new BetterSqlite3(context.databasePath, {
          fileMustExist: true,
          readonly: true,
        });
        try {
          expect(
            raw
              .prepare(
                `SELECT turn_id AS turnId, session_id AS sessionId
                 FROM usage_stats`,
              )
              .all(),
          ).toEqual([{ sessionId: "session-usage", turnId }]);
        } finally {
          raw.close();
        }
      } finally {
        reopened.close();
      }
    } finally {
      context.cleanup();
    }
  });

  it("returns null when terminal usage was omitted", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-no-usage");
      const turnId = createRunningTurn(context.store, "session-no-usage", "no-usage");
      context.store.appendAndProject({
        eventId: "event-no-usage-end",
        runtimeEvent: makeRuntimeEvent("session-no-usage", turnId, 10, {
          from: "running",
          status: "completed",
          stopReason: "end_turn",
          type: "turn_end",
        }),
      });
      expect(context.store.getTurnUsage(turnId)).toBeNull();
    } finally {
      context.cleanup();
    }
  });

  it("fails closed when a stored usage value exceeds the shared safe-integer schema", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-corrupt-usage");
      const turnId = createRunningTurn(context.store, "session-corrupt-usage", "corrupt-usage");
      context.store.appendAndProject({
        eventId: "event-corrupt-usage-end",
        runtimeEvent: makeRuntimeEvent("session-corrupt-usage", turnId, 10, {
          from: "running",
          status: "completed",
          stopReason: "end_turn",
          type: "turn_end",
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            quality: "estimated",
          },
        }),
      });
      const raw = new BetterSqlite3(context.databasePath);
      try {
        raw
          .prepare(
            `UPDATE usage_stats
             SET input_tokens = 9007199254740992
             WHERE turn_id = ?`,
          )
          .run(turnId);
      } finally {
        raw.close();
      }
      expectCode(() => context.store.getTurnUsage(turnId), "CORRUPT_READ_MODEL");
    } finally {
      context.cleanup();
    }
  });
});
