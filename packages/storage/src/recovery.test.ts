import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { AgentEventEnvelopeSchema } from "@dougoos/shared";

import { StorageError } from "./errors.js";
import { openStorage } from "./store.js";
import {
  appendTurnState,
  createInitializedSession,
  createQueuedTurn,
  createRunningTurn,
  createTestContext,
  makeRuntimeEvent,
  time,
} from "./test-utils/helpers.js";

describe("single-transaction interrupted recovery", () => {
  it("recovers all five active states, closes dependent models, and is a second-run no-op", () => {
    let nextRecoveryId = 0;
    const context = createTestContext();
    let reopened: ReturnType<typeof openStorage> | undefined;
    try {
      for (const sessionId of [
        "session-recover-queued",
        "session-recover-starting",
        "session-recover-running",
        "session-recover-approval",
        "session-recover-cancelling",
      ]) {
        createInitializedSession(context.store, sessionId);
      }
      createQueuedTurn(context.store, "session-recover-queued", "recover-queued", 2);
      const startingTurn = createQueuedTurn(
        context.store,
        "session-recover-starting",
        "recover-starting",
        2,
      ).turnId;
      appendTurnState(
        context.store,
        "session-recover-starting",
        startingTurn,
        "queued",
        "starting",
        3,
      );
      createRunningTurn(context.store, "session-recover-running", "recover-running");
      const approvalTurn = createRunningTurn(
        context.store,
        "session-recover-approval",
        "recover-approval",
      );
      context.store.appendAndProject({
        eventId: "event-recover-stream",
        runtimeEvent: makeRuntimeEvent("session-recover-approval", approvalTurn, 5, {
          messageId: "message-recover-stream",
          text: "partial",
          type: "message_delta",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-recover-tool",
        runtimeEvent: makeRuntimeEvent("session-recover-approval", approvalTurn, 6, {
          kind: "shell",
          status: "running",
          title: "Running tool",
          toolCallId: "tool-recover",
          type: "tool_call",
        }),
      });
      appendTurnState(
        context.store,
        "session-recover-approval",
        approvalTurn,
        "running",
        "awaiting_approval",
        7,
      );
      context.store.appendAndProject({
        eventId: "event-recover-approval",
        runtimeEvent: makeRuntimeEvent("session-recover-approval", approvalTurn, 8, {
          expiresAt: time(100),
          options: [{ kind: "reject", label: "Reject", optionId: "reject" }],
          requestId: "request-recover",
          title: "Pending permission",
          type: "approval_request",
        }),
      });
      const cancellingTurn = createRunningTurn(
        context.store,
        "session-recover-cancelling",
        "recover-cancelling",
      );
      appendTurnState(
        context.store,
        "session-recover-cancelling",
        cancellingTurn,
        "running",
        "cancelling",
        9,
      );

      const before = context.store.replay(0).latestSeq;
      context.store.close();
      const crashChild = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
            const { openStorage } = await import(process.argv[1]);
            openStorage(process.argv[2]);
            process.exit(0);
          `,
          pathToFileURL(join(process.cwd(), "dist", "index.js")).href,
          context.databasePath,
        ],
        { encoding: "utf8" },
      );
      expect(crashChild.status, crashChild.stderr).toBe(0);
      reopened = openStorage(context.databasePath, {
        eventIdFactory: () => `recovery-event-${(nextRecoveryId += 1)}`,
      });
      const recovered = reopened.recoverInterruptedTurns(time(50));
      expect(recovered).toHaveLength(5);
      expect(recovered.map((envelope) => AgentEventEnvelopeSchema.parse(envelope))).toEqual(
        recovered,
      );
      expect(recovered.map((envelope) => envelope.seq)).toEqual([
        before + 1,
        before + 2,
        before + 3,
        before + 4,
        before + 5,
      ]);
      expect(
        recovered.every(
          (envelope) =>
            envelope.event.type === "turn_end" &&
            envelope.event.status === "interrupted" &&
            envelope.event.stopReason === "interrupted",
        ),
      ).toBe(true);

      for (const sessionId of [
        "session-recover-queued",
        "session-recover-starting",
        "session-recover-running",
        "session-recover-approval",
        "session-recover-cancelling",
      ]) {
        const snapshot = reopened.getSessionSnapshot(sessionId);
        expect(snapshot.session.state).toBe("crashed");
        expect(snapshot.turns[0]).toEqual(
          expect.objectContaining({
            endedAt: time(50),
            startedAt: expect.any(String),
            status: "interrupted",
            stopReason: "interrupted",
          }),
        );
      }
      const approvalSnapshot = reopened.getSessionSnapshot("session-recover-approval");
      expect(approvalSnapshot.approvals[0]).toEqual(
        expect.objectContaining({
          decision: null,
          resolvedAt: time(50),
          status: "cancelled",
        }),
      );
      expect(
        approvalSnapshot.messages.find((message) => message.id === "message-recover-stream"),
      ).toEqual(expect.objectContaining({ state: "complete" }));
      expect(
        approvalSnapshot.messages.find(
          (message) => message.kind === "tool" && message.toolCallId === "tool-recover",
        ),
      ).toEqual(expect.objectContaining({ status: "cancelled" }));

      const afterFirstRecovery = reopened.replay(0).latestSeq;
      expect(reopened.recoverInterruptedTurns(time(51))).toEqual([]);
      expect(reopened.replay(0).latestSeq).toBe(afterFirstRecovery);

      reopened.appendAndProject({
        eventId: "event-recover-queued-idle",
        runtimeEvent: makeRuntimeEvent("session-recover-queued", null, 52, {
          state: "idle",
          type: "session_state",
        }),
      });
      const replacement = reopened.createTurn({
        occurredAt: time(53),
        queuedEventId: "event-replacement-queued",
        request: {
          clientRequestId: "request-replacement",
          content: [{ text: "replacement", type: "text" }],
        },
        sessionId: "session-recover-queued",
        turnId: "turn-replacement",
        userMessages: [
          {
            eventId: "event-replacement-user",
            messageId: "message-replacement",
          },
        ],
      });
      expect(replacement.created).toBe(true);
    } finally {
      reopened?.close();
      context.cleanup();
    }
  });

  it("rolls back the entire recovery batch when any generated event conflicts", () => {
    const context = createTestContext({
      eventIdFactory: () => "same-recovery-event",
    });
    try {
      createInitializedSession(context.store, "session-recovery-rollback-a");
      createInitializedSession(context.store, "session-recovery-rollback-b");
      createQueuedTurn(context.store, "session-recovery-rollback-a", "recovery-rollback-a");
      createQueuedTurn(context.store, "session-recovery-rollback-b", "recovery-rollback-b");
      const before = context.store.replay(0).latestSeq;

      try {
        context.store.recoverInterruptedTurns(time(60));
        throw new Error("expected recovery rollback");
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe("EVENT_ID_CONFLICT");
      }
      expect(context.store.replay(0).latestSeq).toBe(before);
      expect(context.store.getSessionSnapshot("session-recovery-rollback-a").turns[0]?.status).toBe(
        "queued",
      );
      expect(context.store.getSessionSnapshot("session-recovery-rollback-b").turns[0]?.status).toBe(
        "queued",
      );
    } finally {
      context.cleanup();
    }
  });
});
