import { describe, expect, it } from "vitest";

import { AgentRuntimeEventSchema } from "@dougoos/shared";

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

describe("exhaustive AgentUiEvent projector", () => {
  it.each(["message", "tool", "approval"] as const)(
    "uses an unambiguous canonical source identity for %s events",
    (kind) => {
      const context = createTestContext();
      try {
        const sessionId = `session-source-key-${kind}`;
        createInitializedSession(context.store, sessionId);
        const emit = (turnId: string, sourceId: string, second: number): void => {
          if (kind === "message") {
            context.store.appendAndProject({
              eventId: `event-source-key-${kind}-${second}`,
              runtimeEvent: makeRuntimeEvent(sessionId, turnId, second, {
                messageId: sourceId,
                text: `delta-${second}`,
                type: "message_delta",
              }),
            });
            return;
          }
          if (kind === "tool") {
            context.store.appendAndProject({
              eventId: `event-source-key-${kind}-${second}`,
              runtimeEvent: makeRuntimeEvent(sessionId, turnId, second, {
                kind: "read",
                status: "pending",
                title: `Tool ${second}`,
                toolCallId: sourceId,
                type: "tool_call",
              }),
            });
            return;
          }
          context.store.appendAndProject({
            eventId: `event-source-key-${kind}-${second}`,
            runtimeEvent: makeRuntimeEvent(sessionId, turnId, second, {
              expiresAt: time(100),
              options: [{ kind: "reject", label: "Reject", optionId: "reject" }],
              requestId: sourceId,
              title: `Approval ${second}`,
              type: "approval_request",
            }),
          });
        };

        const firstTurn = createRunningTurn(context.store, sessionId, "a");
        if (kind === "approval") {
          appendTurnState(context.store, sessionId, firstTurn, "running", "awaiting_approval", 5);
        }
        emit(firstTurn, `id:${kind}:z`, 6);
        if (kind === "approval") {
          context.store.appendAndProject({
            eventId: `event-source-key-${kind}-resolved`,
            runtimeEvent: makeRuntimeEvent(sessionId, firstTurn, 7, {
              decision: { type: "reject" },
              requestId: `id:${kind}:z`,
              status: "rejected",
              type: "approval_resolved",
            }),
          });
          appendTurnState(context.store, sessionId, firstTurn, "awaiting_approval", "running", 8);
        }
        context.store.appendAndProject({
          eventId: `event-source-key-${kind}-end`,
          runtimeEvent: makeRuntimeEvent(sessionId, firstTurn, kind === "approval" ? 9 : 7, {
            from: "running",
            status: "completed",
            stopReason: "end_turn",
            type: "turn_end",
          }),
        });

        const secondBase = kind === "approval" ? 10 : 8;
        const secondTurn = createQueuedTurn(
          context.store,
          sessionId,
          `a:${kind}:id`,
          secondBase,
        ).turnId;
        appendTurnState(context.store, sessionId, secondTurn, "queued", "starting", secondBase + 1);
        appendTurnState(
          context.store,
          sessionId,
          secondTurn,
          "starting",
          "running",
          secondBase + 2,
        );
        if (kind === "approval") {
          appendTurnState(
            context.store,
            sessionId,
            secondTurn,
            "running",
            "awaiting_approval",
            secondBase + 3,
          );
        }
        emit(secondTurn, "z", secondBase + 4);

        const snapshot = context.store.getSessionSnapshot(sessionId);
        if (kind === "approval") {
          expect(snapshot.approvals).toHaveLength(2);
          expect(snapshot.messages.filter((message) => message.kind === "approval")).toHaveLength(
            2,
          );
        } else {
          expect(
            snapshot.messages.filter(
              (message) => message.kind === (kind === "message" ? "text" : kind),
            ),
          ).toHaveLength(2);
        }
      } finally {
        context.cleanup();
      }
    },
  );

  it("projects every current event variant and all seven Message read models", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-projector");
      const turnId = createRunningTurn(context.store, "session-projector", "projector");
      const firstTextEvent = makeRuntimeEvent("session-projector", turnId, 5, {
        messageId: "message-projector-text",
        text: "hello ",
        type: "message_delta",
      });
      expect(AgentRuntimeEventSchema.parse(firstTextEvent)).toEqual(firstTextEvent);
      context.store.appendAndProject({
        eventId: "event-projector-text-a",
        runtimeEvent: firstTextEvent,
      });
      context.store.appendAndProject({
        eventId: "event-projector-text-b",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 6, {
          messageId: "message-projector-text",
          text: "world",
          type: "message_delta",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-thought",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 7, {
          messageId: "message-projector-thought",
          text: "considering",
          type: "thought_delta",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-note",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 8, {
          level: "success",
          messageId: "message-projector-note",
          text: "ready",
          type: "note",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-tool-call",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 9, {
          displayInput: "safe display",
          kind: "read",
          status: "pending",
          title: "Read",
          toolCallId: "tool-projector",
          type: "tool_call",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-tool-running",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 10, {
          status: "running",
          toolCallId: "tool-projector",
          type: "tool_update",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-tool-done",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 11, {
          result: { output: "done", type: "inline" },
          status: "done",
          toolCallId: "tool-projector",
          type: "tool_update",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-diff",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 12, {
          diff: {
            newText: "new",
            oldText: "old",
            path: "relative.txt",
            type: "inline",
          },
          messageId: "message-projector-diff",
          type: "diff",
        }),
      });
      appendTurnState(
        context.store,
        "session-projector",
        turnId,
        "running",
        "awaiting_approval",
        13,
      );
      context.store.appendAndProject({
        eventId: "event-projector-approval-request",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 14, {
          description: "Allow operation",
          expiresAt: time(30),
          options: [
            { kind: "allow", label: "Allow", optionId: "allow" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "approval-projector",
          title: "Permission",
          type: "approval_request",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-approval-resolved",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 15, {
          decision: { optionId: "allow", type: "option" },
          requestId: "approval-projector",
          status: "allowed",
          type: "approval_resolved",
        }),
      });
      appendTurnState(
        context.store,
        "session-projector",
        turnId,
        "awaiting_approval",
        "running",
        16,
      );
      context.store.appendAndProject({
        eventId: "event-projector-end",
        runtimeEvent: makeRuntimeEvent("session-projector", turnId, 17, {
          from: "running",
          status: "completed",
          stopReason: "end_turn",
          type: "turn_end",
          usage: {
            cachedInputTokens: 1,
            inputTokens: 2,
            outputTokens: 3,
            quality: "exact",
          },
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-session-error",
        runtimeEvent: makeRuntimeEvent("session-projector", null, 18, {
          error: {
            code: "AGENT_PROCESS_CRASHED",
            message: "Agent process exited",
            retryable: false,
          },
          type: "session_error",
        }),
      });
      context.store.appendAndProject({
        eventId: "event-projector-session-idle",
        runtimeEvent: makeRuntimeEvent("session-projector", null, 19, {
          state: "idle",
          type: "session_state",
        }),
      });

      const snapshot = context.store.getSessionSnapshot("session-projector");
      expect(snapshot.messages.map((message) => message.kind)).toEqual([
        "user",
        "text",
        "think",
        "note",
        "tool",
        "diff",
        "approval",
      ]);
      expect(snapshot.messages.find((message) => message.kind === "text")).toEqual(
        expect.objectContaining({ body: "hello world", state: "complete" }),
      );
      expect(snapshot.messages.find((message) => message.kind === "think")).toEqual(
        expect.objectContaining({ state: "complete" }),
      );
      expect(snapshot.messages.find((message) => message.kind === "tool")).toEqual(
        expect.objectContaining({
          result: { output: "done", type: "inline" },
          status: "done",
        }),
      );
      expect(snapshot.approvals[0]).toEqual(expect.objectContaining({ status: "allowed" }));
      expect(snapshot.turns[0]).toEqual(
        expect.objectContaining({
          status: "completed",
          stopReason: "end_turn",
        }),
      );
      expect(snapshot.session.state).toBe("idle");
      expect(
        new Set(context.store.replay(0).events.map((envelope) => envelope.event.type)),
      ).toEqual(
        new Set([
          "approval_request",
          "approval_resolved",
          "diff",
          "message_delta",
          "note",
          "session_error",
          "session_state",
          "thought_delta",
          "tool_call",
          "tool_update",
          "turn_end",
          "turn_state",
          "user_message",
        ]),
      );
    } finally {
      context.cleanup();
    }
  });

  it.each([
    {
      decision: { type: "reject" } as const,
      resolutionSecond: 10,
      status: "rejected" as const,
    },
    {
      decision: null,
      resolutionSecond: 20,
      status: "expired" as const,
    },
  ])(
    "projects a successful $status approval resolution and releases the pending gate",
    (testCase) => {
      const context = createTestContext();
      try {
        const sessionId = `session-approval-${testCase.status}`;
        createInitializedSession(context.store, sessionId);
        const turnId = createRunningTurn(context.store, sessionId, `approval-${testCase.status}`);
        appendTurnState(context.store, sessionId, turnId, "running", "awaiting_approval", 5);
        context.store.appendAndProject({
          eventId: `event-approval-${testCase.status}-request`,
          runtimeEvent: makeRuntimeEvent(sessionId, turnId, 6, {
            expiresAt: time(15),
            options: [
              { kind: "allow", label: "Allow", optionId: "allow" },
              { kind: "reject", label: "Reject", optionId: "reject" },
            ],
            requestId: `request-${testCase.status}`,
            title: "Permission",
            type: "approval_request",
          }),
        });
        context.store.appendAndProject({
          eventId: `event-approval-${testCase.status}-resolved`,
          runtimeEvent: makeRuntimeEvent(sessionId, turnId, testCase.resolutionSecond, {
            decision: testCase.decision,
            requestId: `request-${testCase.status}`,
            status: testCase.status,
            type: "approval_resolved",
          }),
        });
        const resolved = context.store.getSessionSnapshot(sessionId).approvals[0];
        expect(resolved).toEqual(
          expect.objectContaining({
            decision: testCase.decision,
            resolvedAt: time(testCase.resolutionSecond),
            status: testCase.status,
          }),
        );
        appendTurnState(context.store, sessionId, turnId, "awaiting_approval", "running", 21);
        expect(context.store.getSessionSnapshot(sessionId).session.state).toBe("running");
      } finally {
        context.cleanup();
      }
    },
  );

  it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "atomically rejects every late content event after a %s Turn",
    (terminalStatus) => {
      const context = createTestContext();
      try {
        const sessionId = `session-late-${terminalStatus}`;
        createInitializedSession(context.store, sessionId);
        const turnId = createRunningTurn(context.store, sessionId, `late-${terminalStatus}`);
        if (terminalStatus === "cancelled") {
          appendTurnState(context.store, sessionId, turnId, "running", "cancelling", 5);
          context.store.appendAndProject({
            eventId: `event-terminal-${terminalStatus}`,
            runtimeEvent: makeRuntimeEvent(sessionId, turnId, 6, {
              from: "cancelling",
              status: "cancelled",
              stopReason: "cancelled",
              type: "turn_end",
            }),
          });
        } else {
          context.store.appendAndProject({
            eventId: `event-terminal-${terminalStatus}`,
            runtimeEvent: makeRuntimeEvent(sessionId, turnId, 6, {
              ...(terminalStatus === "failed"
                ? {
                    error: {
                      code: "AGENT_FAILED",
                      message: "Agent failed",
                      retryable: false,
                    },
                  }
                : {}),
              from: "running",
              status: terminalStatus,
              stopReason:
                terminalStatus === "completed"
                  ? "end_turn"
                  : terminalStatus === "failed"
                    ? "error"
                    : "interrupted",
              type: "turn_end",
            }),
          });
        }
        const watermark = context.store.replay(0).latestSeq;
        const lateEvents = [
          {
            messageId: `late-text-${terminalStatus}`,
            text: "late",
            type: "message_delta",
          },
          {
            messageId: `late-thought-${terminalStatus}`,
            text: "late",
            type: "thought_delta",
          },
          {
            level: "warn",
            messageId: `late-note-${terminalStatus}`,
            text: "late",
            type: "note",
          },
          {
            diff: {
              newText: "late",
              oldText: null,
              path: "late.txt",
              type: "inline",
            },
            messageId: `late-diff-${terminalStatus}`,
            type: "diff",
          },
          {
            kind: "read",
            status: "pending",
            title: "Late tool",
            toolCallId: `late-tool-${terminalStatus}`,
            type: "tool_call",
          },
          {
            status: "done",
            toolCallId: `late-tool-${terminalStatus}`,
            type: "tool_update",
          },
          {
            expiresAt: time(40),
            options: [{ kind: "reject", label: "Reject", optionId: "reject" }],
            requestId: `late-approval-${terminalStatus}`,
            title: "Late approval",
            type: "approval_request",
          },
          {
            decision: null,
            requestId: `late-approval-${terminalStatus}`,
            status: "cancelled",
            type: "approval_resolved",
          },
        ] as const;

        for (const [index, event] of lateEvents.entries()) {
          try {
            context.store.appendAndProject({
              eventId: `event-late-${terminalStatus}-${index}`,
              runtimeEvent: makeRuntimeEvent(sessionId, turnId, 20 + index, event),
            });
            throw new Error("expected late event rejection");
          } catch (error) {
            expect(error).toBeInstanceOf(StorageError);
            expect((error as StorageError).code).toBe("PROJECTION_CONFLICT");
          }
          expect(context.store.replay(0).latestSeq).toBe(watermark);
        }
        const snapshot = context.store.getSessionSnapshot(sessionId);
        expect(snapshot.turns[0]?.status).toBe(terminalStatus);
        expect(snapshot.messages.some((message) => message.id.startsWith("late-"))).toBe(false);
      } finally {
        context.cleanup();
      }
    },
  );

  it("rolls back missing tool updates and illegal Turn compare-and-swap transitions", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-invalid-projector");
      const turnId = createRunningTurn(
        context.store,
        "session-invalid-projector",
        "invalid-projector",
      );
      const before = context.store.replay(0).latestSeq;
      for (const input of [
        {
          eventId: "event-missing-tool",
          runtimeEvent: makeRuntimeEvent("session-invalid-projector", turnId, 5, {
            status: "done",
            toolCallId: "missing",
            type: "tool_update",
          }),
        },
        {
          eventId: "event-wrong-cas",
          runtimeEvent: makeRuntimeEvent("session-invalid-projector", turnId, 6, {
            from: "starting",
            status: "running",
            type: "turn_state",
          }),
        },
      ]) {
        expect(() => context.store.appendAndProject(input)).toThrowError(StorageError);
        expect(context.store.replay(0).latestSeq).toBe(before);
      }
    } finally {
      context.cleanup();
    }
  });
});
