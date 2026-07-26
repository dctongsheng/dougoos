import { randomUUID } from "node:crypto";

import type {
  RegistryEventListener,
  ResolveRegistryApprovalInput,
  StartRegistryTurnInput,
} from "@dougoos/core";
import { AgentRuntimeEventSchema } from "@dougoos/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeRegistry } from "./fake-registry.js";

const NOW = "2026-07-24T09:00:00.000Z";

function turnInput(sessionId: string, turnId: string, prompt: string): StartRegistryTurnInput {
  return {
    request: {
      clientRequestId: randomUUID(),
      content: [{ text: prompt, type: "text" }],
    },
    sessionId,
    turnId,
  } as StartRegistryTurnInput;
}

describe("test-only Fake Registry", () => {
  let registry: FakeRegistry;
  let events: Parameters<RegistryEventListener>[0][];
  let sessionId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    registry = new FakeRegistry();
    events = [];
    sessionId = randomUUID();
    registry.onEvent((event) => events.push(AgentRuntimeEventSchema.parse(event)));
    registry.createSession({
      cwd: "/tmp/fake-workspace",
      providerId: "test-fake",
      sessionId,
    } as Parameters<FakeRegistry["createSession"]>[0]);
  });

  it("exposes deterministic local CLI discovery data for desktop acceptance", () => {
    expect(registry.listAgentCliInstallations().clis).toMatchObject([
      { command: "codex", executablePath: "/fixture/bin/codex" },
    ]);
  });

  afterEach(() => {
    registry.close();
    vi.useRealTimers();
  });

  it("scripts all seven message kinds, approval, and completion", async () => {
    const turnId = randomUUID();
    registry.startTurn(turnInput(sessionId, turnId, "[fake:approval]"));
    await vi.advanceTimersByTimeAsync(100);

    expect(events.map((entry) => entry.event.type)).toEqual([
      "turn_state",
      "turn_state",
      "thought_delta",
      "message_delta",
      "message_delta",
      "note",
      "tool_call",
      "diff",
      "turn_state",
      "approval_request",
    ]);
    const approval = events.find((entry) => entry.event.type === "approval_request");
    if (approval?.event.type !== "approval_request") throw new Error("approval not emitted");

    registry.resolveApproval({
      optionId: "allow-once",
      requestId: approval.event.requestId,
      sessionId,
      turnId,
    } as ResolveRegistryApprovalInput);
    await vi.advanceTimersByTimeAsync(20);

    expect(events.slice(-5).map((entry) => entry.event.type)).toEqual([
      "approval_resolved",
      "turn_state",
      "tool_update",
      "message_delta",
      "turn_end",
    ]);
    expect(events.at(-1)?.event).toMatchObject({
      status: "completed",
      stopReason: "end_turn",
      type: "turn_end",
    });
  });

  it("keeps a scripted Turn running until cancellation and cancels it deterministically", async () => {
    const turnId = randomUUID();
    registry.startTurn(turnInput(sessionId, turnId, "[fake:cancel]"));
    await vi.advanceTimersByTimeAsync(30);

    expect(registry.cancelTurn({ sessionId, turnId })).toBe("cancelling");
    await vi.advanceTimersByTimeAsync(20);

    expect(events.slice(-2).map((entry) => entry.event.type)).toEqual(["turn_state", "turn_end"]);
    expect(events.at(-1)?.event).toMatchObject({
      status: "cancelled",
      stopReason: "cancelled",
    });
  });

  it("emits an interrupted Turn before a scripted process crash", async () => {
    const turnId = randomUUID();
    registry.startTurn(turnInput(sessionId, turnId, "[fake:crash]"));
    await vi.advanceTimersByTimeAsync(40);

    expect(events.slice(-2).map((entry) => entry.event.type)).toEqual([
      "turn_end",
      "session_error",
    ]);
    expect(events.at(-1)?.event).toMatchObject({
      error: { code: "AGENT_PROCESS_CRASHED" },
      type: "session_error",
    });
  });
});
