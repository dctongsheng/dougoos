import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@dougoos/shared";

import { StorageError } from "./errors.js";
import {
  appendTurnState,
  createInitializedSession,
  createQueuedTurn,
  createRunningTurn,
  createTestContext,
  makeRuntimeEvent,
  startingSession,
  TEST_CAPABILITIES,
  time,
} from "./test-utils/helpers.js";

function expectStorageCode(action: () => unknown, code: StorageError["code"]): void {
  try {
    action();
    throw new Error("expected StorageError");
  } catch (error) {
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe(code);
  }
}

describe("journal identity and atomicity", () => {
  it("creates an initialized Session atomically and keeps exact retries receipt-first", () => {
    const context = createTestContext();
    try {
      const starting = startingSession("session-initialized-retry");
      const initialized = SessionSchema.parse({
        ...starting,
        capabilities: TEST_CAPABILITIES,
        providerSessionId: "provider-initialized-retry",
        state: "idle",
        updatedAt: time(1),
      });
      const created = context.store.createInitializedSession({
        eventId: "event-session-initialized-idle",
        session: initialized,
      });
      createRunningTurn(context.store, "session-initialized-retry", "initialized-retry");
      const watermark = context.store.replay(0).latestSeq;

      expect(
        context.store.createInitializedSession({
          eventId: "event-session-initialized-idle",
          session: initialized,
        }),
      ).toEqual({ duplicate: true, envelope: created.envelope });
      expect(context.store.replay(0).latestSeq).toBe(watermark);
      expect(context.store.getSessionSnapshot("session-initialized-retry").session.state).toBe(
        "running",
      );

      expectStorageCode(
        () =>
          context.store.createInitializedSession({
            eventId: "event-session-initialized-idle",
            session: SessionSchema.parse({
              ...initialized,
              title: "Different",
            }),
          }),
        "EVENT_ID_CONFLICT",
      );
      expect(context.store.replay(0).latestSeq).toBe(watermark);
    } finally {
      context.cleanup();
    }
  });

  it("leaves no Session when validation or the atomic journal projection fails", () => {
    const context = createTestContext();
    try {
      const starting = startingSession("session-atomic-failure");
      const before = context.store.replay(0);
      expectStorageCode(
        () =>
          context.store.createInitializedSession({
            eventId: "event-session-atomic-failure",
            session: starting,
          }),
        "VALIDATION_FAILED",
      );
      expectStorageCode(
        () => context.store.getSessionSnapshot("session-atomic-failure"),
        "NOT_FOUND",
      );
      expect(context.store.replay(0)).toEqual(before);

      const initialized = SessionSchema.parse({
        ...starting,
        capabilities: TEST_CAPABILITIES,
        providerSessionId: "provider-atomic-failure",
        state: "idle",
        updatedAt: time(1),
      });
      const raw = new BetterSqlite3(context.databasePath);
      try {
        raw.exec(`
          CREATE TRIGGER fail_initialized_session_event
          BEFORE INSERT ON session_events
          BEGIN
            SELECT RAISE(ABORT, 'injected initialized-session event failure');
          END;
        `);
      } finally {
        raw.close();
      }
      expectStorageCode(
        () =>
          context.store.createInitializedSession({
            eventId: "event-session-atomic-failure",
            session: initialized,
          }),
        "PROJECTION_CONFLICT",
      );
      expectStorageCode(
        () => context.store.getSessionSnapshot("session-atomic-failure"),
        "NOT_FOUND",
      );
      expect(context.store.replay(0)).toEqual(before);

      const repair = new BetterSqlite3(context.databasePath);
      try {
        repair.exec(`DROP TRIGGER fail_initialized_session_event`);
      } finally {
        repair.close();
      }
      const created = context.store.createInitializedSession({
        eventId: "event-session-atomic-failure",
        session: initialized,
      });
      expect(created.duplicate).toBe(false);
      expect(
        context.store.createInitializedSession({
          eventId: "event-session-atomic-failure",
          session: initialized,
        }),
      ).toEqual({ duplicate: true, envelope: created.envelope });
      expect(context.store.getSessionSnapshot("session-atomic-failure").session).toEqual(
        initialized,
      );
    } finally {
      context.cleanup();
    }
  });

  it("returns the original sequence for an exact event retry without projecting twice", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-duplicate");
      const turnId = createRunningTurn(context.store, "session-duplicate", "duplicate");
      const runtimeEvent = makeRuntimeEvent("session-duplicate", turnId, 5, {
        messageId: "message-duplicate",
        text: "once",
        type: "message_delta",
      });
      const first = context.store.appendAndProject({
        eventId: "event-duplicate",
        runtimeEvent,
      });
      const retry = context.store.appendAndProject({
        eventId: "event-duplicate",
        runtimeEvent,
      });

      expect(retry).toEqual({ duplicate: true, envelope: first.envelope });
      expect(context.store.getSessionSnapshot("session-duplicate").messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ body: "once", id: "message-duplicate" }),
        ]),
      );
      expect(
        context.store.replay(0).events.filter((event) => event.eventId === "event-duplicate"),
      ).toHaveLength(1);
    } finally {
      context.cleanup();
    }
  });

  it("rejects the same eventId with a different canonical payload and rolls back", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-conflict");
      const turnId = createRunningTurn(context.store, "session-conflict", "conflict");
      const firstRuntime = makeRuntimeEvent("session-conflict", turnId, 5, {
        messageId: "message-conflict",
        text: "first",
        type: "message_delta",
      });
      const first = context.store.appendAndProject({
        eventId: "event-conflict",
        runtimeEvent: firstRuntime,
      });
      const watermark = context.store.replay(0).latestSeq;

      expectStorageCode(
        () =>
          context.store.appendAndProject({
            eventId: "event-conflict",
            runtimeEvent: makeRuntimeEvent("session-conflict", turnId, 5, {
              messageId: "message-conflict",
              text: "second",
              type: "message_delta",
            }),
          }),
        "EVENT_ID_CONFLICT",
      );
      expect(context.store.replay(0).latestSeq).toBe(watermark);
      expect(
        context.store
          .getSessionSnapshot("session-conflict")
          .messages.find((message) => message.id === "message-conflict"),
      ).toEqual(expect.objectContaining({ body: "first" }));
      expect(first.duplicate).toBe(false);
    } finally {
      context.cleanup();
    }
  });

  it("keeps clientRequestId idempotent when a retry regenerates internal IDs", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-request-retry");
      const first = createQueuedTurn(context.store, "session-request-retry", "stable-request");
      const retry = context.store.createTurn({
        occurredAt: time(9),
        queuedEventId: "different-queued-event",
        request: {
          clientRequestId: "request-stable-request",
          content: [{ text: "prompt-stable-request", type: "text" }],
        },
        sessionId: "session-request-retry",
        turnId: "different-turn-id",
        userMessages: [
          {
            eventId: "different-user-event",
            messageId: "different-message-id",
          },
        ],
      });

      expect(retry).toEqual({
        created: false,
        envelopes: [],
        turnId: first.turnId,
      });
      expect(context.store.getSessionSnapshot("session-request-retry").turns).toHaveLength(1);
    } finally {
      context.cleanup();
    }
  });

  it("preserves content boundaries as one atomic user-message event per part", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-multipart");
      const first = context.store.createTurn({
        occurredAt: time(2),
        queuedEventId: "event-multipart-queued",
        request: {
          clientRequestId: "request-multipart",
          content: [
            { text: "alpha", type: "text" },
            { text: "beta", type: "text" },
          ],
        },
        sessionId: "session-multipart",
        turnId: "turn-multipart",
        userMessages: [
          { eventId: "event-multipart-user-a", messageId: "message-multipart-a" },
          { eventId: "event-multipart-user-b", messageId: "message-multipart-b" },
        ],
      });
      expect(first.envelopes.map((envelope) => envelope.event.type)).toEqual([
        "turn_state",
        "user_message",
        "user_message",
      ]);
      expect(
        context.store.getSessionSnapshot("session-multipart").messages.map((message) => ({
          body: "body" in message ? message.body : null,
          id: message.id,
        })),
      ).toEqual([
        { body: "alpha", id: "message-multipart-a" },
        { body: "beta", id: "message-multipart-b" },
      ]);

      expect(
        context.store.createTurn({
          occurredAt: time(9),
          queuedEventId: "event-multipart-retry-queued",
          request: {
            clientRequestId: "request-multipart",
            content: [
              { text: "alpha", type: "text" },
              { text: "beta", type: "text" },
            ],
          },
          sessionId: "session-multipart",
          turnId: "turn-multipart-retry",
          userMessages: [
            { eventId: "event-multipart-retry-a", messageId: "message-multipart-retry-a" },
            { eventId: "event-multipart-retry-b", messageId: "message-multipart-retry-b" },
          ],
        }),
      ).toEqual({
        created: false,
        envelopes: [],
        turnId: "turn-multipart",
      });
      expectStorageCode(
        () =>
          context.store.createTurn({
            occurredAt: time(10),
            queuedEventId: "event-multipart-conflict-queued",
            request: {
              clientRequestId: "request-multipart",
              content: [{ text: "alphabeta", type: "text" }],
            },
            sessionId: "session-multipart",
            turnId: "turn-multipart-conflict",
            userMessages: [
              {
                eventId: "event-multipart-conflict-user",
                messageId: "message-multipart-conflict",
              },
            ],
          }),
        "IDEMPOTENCY_CONFLICT",
      );
      expect(context.store.getSessionSnapshot("session-multipart").turns).toHaveLength(1);
    } finally {
      context.cleanup();
    }
  });

  it("rejects mismatched or duplicate multipart identities before mutating storage", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-multipart-invalid");
      const before = context.store.replay(0);
      expectStorageCode(
        () =>
          context.store.createTurn({
            occurredAt: time(2),
            queuedEventId: "event-multipart-count-queued",
            request: {
              clientRequestId: "request-multipart-count",
              content: [
                { text: "one", type: "text" },
                { text: "two", type: "text" },
              ],
            },
            sessionId: "session-multipart-invalid",
            turnId: "turn-multipart-count",
            userMessages: [
              { eventId: "event-multipart-count-user", messageId: "message-multipart-count" },
            ],
          }),
        "VALIDATION_FAILED",
      );
      expectStorageCode(
        () =>
          context.store.createTurn({
            occurredAt: time(2),
            queuedEventId: "event-multipart-duplicate-event",
            request: {
              clientRequestId: "request-multipart-duplicate-event",
              content: [{ text: "one", type: "text" }],
            },
            sessionId: "session-multipart-invalid",
            turnId: "turn-multipart-duplicate-event",
            userMessages: [
              {
                eventId: "event-multipart-duplicate-event",
                messageId: "message-multipart-duplicate-event",
              },
            ],
          }),
        "VALIDATION_FAILED",
      );
      expectStorageCode(
        () =>
          context.store.createTurn({
            occurredAt: time(2),
            queuedEventId: "event-multipart-duplicate-message-queued",
            request: {
              clientRequestId: "request-multipart-duplicate-message",
              content: [
                { text: "one", type: "text" },
                { text: "two", type: "text" },
              ],
            },
            sessionId: "session-multipart-invalid",
            turnId: "turn-multipart-duplicate-message",
            userMessages: [
              {
                eventId: "event-multipart-duplicate-message-a",
                messageId: "message-multipart-duplicate",
              },
              {
                eventId: "event-multipart-duplicate-message-b",
                messageId: "message-multipart-duplicate",
              },
            ],
          }),
        "VALIDATION_FAILED",
      );
      expect(context.store.replay(0)).toEqual(before);
      expect(context.store.getSessionSnapshot("session-multipart-invalid").turns).toEqual([]);
    } finally {
      context.cleanup();
    }
  });

  it("rejects an idempotency key reused with different prompt content", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-request-conflict");
      createQueuedTurn(context.store, "session-request-conflict", "request-conflict");
      expectStorageCode(
        () =>
          context.store.createTurn({
            occurredAt: time(9),
            queuedEventId: "event-retry-queued",
            request: {
              clientRequestId: "request-request-conflict",
              content: [{ text: "different prompt", type: "text" }],
            },
            sessionId: "session-request-conflict",
            turnId: "turn-retry",
            userMessages: [
              {
                eventId: "event-retry-user",
                messageId: "message-retry",
              },
            ],
          }),
        "IDEMPOTENCY_CONFLICT",
      );
    } finally {
      context.cleanup();
    }
  });

  it("rejects an approval decision after expiry before committing any event", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-expiry");
      const turnId = createRunningTurn(context.store, "session-expiry", "expiry");
      appendTurnState(context.store, "session-expiry", turnId, "running", "awaiting_approval", 5);
      context.store.appendAndProject({
        eventId: "event-approval-expiry-request",
        runtimeEvent: makeRuntimeEvent("session-expiry", turnId, 6, {
          expiresAt: time(7),
          options: [
            { kind: "allow", label: "Allow", optionId: "allow" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "request-expiry",
          title: "Permission",
          type: "approval_request",
        }),
      });
      const watermark = context.store.replay(0).latestSeq;

      expectStorageCode(
        () =>
          context.store.appendAndProject({
            eventId: "event-approval-expired-resolution",
            runtimeEvent: makeRuntimeEvent("session-expiry", turnId, 8, {
              decision: { optionId: "allow", type: "option" },
              requestId: "request-expiry",
              status: "allowed",
              type: "approval_resolved",
            }),
          }),
        "PROJECTION_CONFLICT",
      );
      expect(context.store.replay(0).latestSeq).toBe(watermark);
      expect(context.store.getSessionSnapshot("session-expiry").approvals[0]?.status).toBe(
        "pending",
      );
    } finally {
      context.cleanup();
    }
  });

  it("allows opaque toolCallId and approval requestId reuse in a later Turn", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-scoped-ids");
      const firstTurn = createRunningTurn(context.store, "session-scoped-ids", "scoped-first");
      context.store.appendAndProject({
        eventId: "event-tool-first",
        runtimeEvent: makeRuntimeEvent("session-scoped-ids", firstTurn, 5, {
          kind: "shell",
          status: "pending",
          title: "Run",
          toolCallId: "opaque-shared",
          type: "tool_call",
        }),
      });
      appendTurnState(
        context.store,
        "session-scoped-ids",
        firstTurn,
        "running",
        "awaiting_approval",
        6,
      );
      context.store.appendAndProject({
        eventId: "event-approval-first",
        runtimeEvent: makeRuntimeEvent("session-scoped-ids", firstTurn, 7, {
          expiresAt: time(20),
          options: [
            { kind: "allow", label: "Allow", optionId: "allow" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "opaque-shared",
          title: "Permission",
          type: "approval_request",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-resolve-first",
        runtimeEvent: makeRuntimeEvent("session-scoped-ids", firstTurn, 8, {
          decision: { optionId: "allow", type: "option" },
          requestId: "opaque-shared",
          status: "allowed",
          type: "approval_resolved",
        }),
      });
      appendTurnState(
        context.store,
        "session-scoped-ids",
        firstTurn,
        "awaiting_approval",
        "running",
        9,
      );
      context.store.appendAndProject({
        eventId: "event-end-first",
        runtimeEvent: makeRuntimeEvent("session-scoped-ids", firstTurn, 10, {
          from: "running",
          status: "completed",
          stopReason: "end_turn",
          type: "turn_end",
        }),
      });

      const secondTurn = context.store.createTurn({
        occurredAt: time(11),
        queuedEventId: "event-queued-scoped-second",
        request: {
          clientRequestId: "request-scoped-second",
          content: [{ text: "second", type: "text" }],
        },
        sessionId: "session-scoped-ids",
        turnId: "turn-scoped-second",
        userMessages: [
          {
            eventId: "event-user-scoped-second",
            messageId: "message-scoped-second",
          },
        ],
      }).turnId;
      appendTurnState(context.store, "session-scoped-ids", secondTurn, "queued", "starting", 12);
      appendTurnState(context.store, "session-scoped-ids", secondTurn, "starting", "running", 13);
      context.store.appendAndProject({
        eventId: "event-tool-second",
        runtimeEvent: makeRuntimeEvent("session-scoped-ids", secondTurn, 14, {
          kind: "shell",
          status: "pending",
          title: "Run",
          toolCallId: "opaque-shared",
          type: "tool_call",
        }),
      });
      appendTurnState(
        context.store,
        "session-scoped-ids",
        secondTurn,
        "running",
        "awaiting_approval",
        15,
      );
      context.store.appendAndProject({
        eventId: "event-approval-second",
        runtimeEvent: makeRuntimeEvent("session-scoped-ids", secondTurn, 16, {
          expiresAt: time(30),
          options: [
            { kind: "allow", label: "Allow", optionId: "allow" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "opaque-shared",
          title: "Permission",
          type: "approval_request",
        }),
      });

      const snapshot = context.store.getSessionSnapshot("session-scoped-ids");
      expect(snapshot.messages.filter((message) => message.kind === "tool")).toHaveLength(2);
      expect(snapshot.approvals).toHaveLength(2);
      expect(new Set(snapshot.approvals.map((approval) => approval.id)).size).toBe(2);
      expect(context.store.getApproval(firstTurn, "opaque-shared")).toEqual(
        snapshot.approvals.find((approval) => approval.turnId === firstTurn),
      );
      expect(context.store.getApproval(secondTurn, "opaque-shared")).toEqual(
        snapshot.approvals.find((approval) => approval.turnId === secondTurn),
      );
    } finally {
      context.cleanup();
    }
  });

  it("returns typed Turn and Approval lookups without crossing Turn ownership", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-lookup-a");
      createInitializedSession(context.store, "session-lookup-b");
      const turnA = createRunningTurn(context.store, "session-lookup-a", "lookup-a");
      const turnB = createRunningTurn(context.store, "session-lookup-b", "lookup-b");
      appendTurnState(context.store, "session-lookup-b", turnB, "running", "awaiting_approval", 5);
      context.store.appendAndProject({
        eventId: "event-approval-lookup-b",
        runtimeEvent: makeRuntimeEvent("session-lookup-b", turnB, 6, {
          expiresAt: time(30),
          options: [
            { kind: "allow", label: "Allow", optionId: "allow" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "request-lookup-b",
          title: "Permission",
          type: "approval_request",
        }),
      });

      expect(context.store.getTurn(turnA)).toEqual(
        context.store.getSessionSnapshot("session-lookup-a").turns[0],
      );
      expect(context.store.getTurn("turn-unknown")).toBeNull();
      expect(context.store.getApproval(turnB, "request-lookup-b")).toEqual(
        context.store.getSessionSnapshot("session-lookup-b").approvals[0],
      );
      expect(context.store.getApproval(turnA, "request-lookup-b")).toBeNull();
      expect(context.store.getApproval(turnB, "request-unknown")).toBeNull();
      expect(context.store.getApproval("turn-unknown", "request-lookup-b")).toBeNull();
    } finally {
      context.cleanup();
    }
  });

  it("fails closed when a Turn lookup row does not satisfy the shared schema", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-corrupt-turn-lookup");
      const turnId = createQueuedTurn(
        context.store,
        "session-corrupt-turn-lookup",
        "corrupt-turn-lookup",
      ).turnId;
      const raw = new BetterSqlite3(context.databasePath);
      try {
        raw.pragma("ignore_check_constraints = ON");
        raw.prepare(`UPDATE turns SET status = 'bogus' WHERE id = ?`).run(turnId);
      } finally {
        raw.close();
      }
      expectStorageCode(() => context.store.getTurn(turnId), "CORRUPT_READ_MODEL");
    } finally {
      context.cleanup();
    }
  });

  it("fails closed when an Approval lookup row does not satisfy the shared schema", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-corrupt-approval-lookup");
      const turnId = createRunningTurn(
        context.store,
        "session-corrupt-approval-lookup",
        "corrupt-approval-lookup",
      );
      appendTurnState(
        context.store,
        "session-corrupt-approval-lookup",
        turnId,
        "running",
        "awaiting_approval",
        5,
      );
      context.store.appendAndProject({
        eventId: "event-corrupt-approval-lookup",
        runtimeEvent: makeRuntimeEvent("session-corrupt-approval-lookup", turnId, 6, {
          expiresAt: time(30),
          options: [
            { kind: "allow", label: "Allow", optionId: "allow" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "request-corrupt-approval-lookup",
          title: "Permission",
          type: "approval_request",
        }),
      });
      const raw = new BetterSqlite3(context.databasePath);
      try {
        raw
          .prepare(`UPDATE approval_requests SET options_json = '{}' WHERE turn_id = ?`)
          .run(turnId);
      } finally {
        raw.close();
      }
      expectStorageCode(
        () => context.store.getApproval(turnId, "request-corrupt-approval-lookup"),
        "CORRUPT_READ_MODEL",
      );
    } finally {
      context.cleanup();
    }
  });
});
