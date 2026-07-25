import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentProvider } from "@dougoos/acp";
import { AgentRuntimeEventSchema, type AgentRuntimeEvent } from "@dougoos/shared";
import { openStorage } from "@dougoos/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AcpCoreRegistry } from "./acp-registry.js";
import { createCoreRuntime, generateBearerToken } from "./app.js";

const fixtureAgent = join(import.meta.dirname, "../../acp/test/fixtures/fake-agent.mjs");
const directories: string[] = [];

class FixtureProvider implements AgentProvider {
  readonly displayName = "Fixture ACP";
  readonly id = "fixture";
  readonly permissionEnforcement = "requests_permission" as const;
  readonly processPolicy = { maxSessionsPerProcess: 1, multiSessionPerProcess: false } as const;

  available() {
    return Promise.resolve({ ok: true, version: "1.0.0" } as const);
  }

  chooseAuthMethod(initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0]): string | null {
    return initialize.authMethods?.find((method) => method.id === "fixture-auth")?.id ?? null;
  }

  resolveCommand(context: Parameters<AgentProvider["resolveCommand"]>[0]) {
    return {
      args: [fixtureAgent],
      command: process.execPath,
      env: context.env,
    };
  }
}

async function waitForEvent(
  events: readonly AgentRuntimeEvent[],
  type: AgentRuntimeEvent["event"]["type"],
): Promise<AgentRuntimeEvent> {
  await vi.waitFor(() => {
    expect(events.some((event) => event.event.type === type)).toBe(true);
  });
  const event = events.find((candidate) => candidate.event.type === type);
  if (event === undefined) throw new Error(`Missing ${type}`);
  return event;
}

describe("AcpCoreRegistry", () => {
  let directory: string;
  let registry: AcpCoreRegistry;
  let events: AgentRuntimeEvent[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "dougoos-core-acp-"));
    directories.push(directory);
    registry = new AcpCoreRegistry({
      doctorCwd: directory,
      environment: { DOUGOOS_FIXTURE_TRACE_PATH: join(directory, "trace.log") },
      providers: [new FixtureProvider()],
    });
    events = [];
    registry.onEvent((event) => events.push(AgentRuntimeEventSchema.parse(event)));
    await registry.initialize();
  });

  afterEach(async () => {
    await registry.close();
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function createSession() {
    const sessionId = crypto.randomUUID();
    const session = await registry.createSession({
      cwd: directory,
      providerId: "fixture",
      sessionId,
    });
    return { session, sessionId };
  }

  it("probes, creates, streams, approves, and completes through the official ACP runtime", async () => {
    expect(registry.listProviders()).toMatchObject([
      {
        capabilities: { protocolVersion: "1", turn: { prompt: true } },
        id: "fixture",
        status: "available",
        version: "1.0.0",
      },
    ]);
    const { session, sessionId } = await createSession();
    expect(session).toMatchObject({
      capabilities: { protocolVersion: "1" },
      title: expect.stringContaining("Fixture ACP"),
    });

    const turnId = crypto.randomUUID();
    registry.startTurn({
      request: {
        clientRequestId: "core-acp-approval",
        content: [{ text: "[approval]", type: "text" }],
      },
      sessionId,
      turnId,
    });
    const approval = await waitForEvent(events, "approval_request");
    if (approval.event.type !== "approval_request") throw new Error("approval missing");
    const allow = approval.event.options.find((option) => option.kind === "allow");
    if (allow === undefined) throw new Error("allow option missing");
    await registry.resolveApproval({
      optionId: allow.optionId,
      requestId: approval.event.requestId,
      sessionId,
      turnId,
    });
    const ended = await waitForEvent(events, "turn_end");
    expect(ended.event).toMatchObject({
      status: "completed",
      stopReason: "end_turn",
      type: "turn_end",
    });
    expect(new Set(events.map((event) => event.event.type))).toEqual(
      expect.objectContaining(
        new Set([
          "approval_request",
          "approval_resolved",
          "diff",
          "message_delta",
          "note",
          "thought_delta",
          "tool_call",
          "tool_update",
          "turn_end",
          "turn_state",
        ]),
      ),
    );
  });

  it("cancels idempotently and does not accept a late completion state", async () => {
    const { sessionId } = await createSession();
    const turnId = crypto.randomUUID();
    registry.startTurn({
      request: {
        clientRequestId: "core-acp-cancel",
        content: [{ text: "[cancel]", type: "text" }],
      },
      sessionId,
      turnId,
    });
    await waitForEvent(events, "turn_state");
    await expect(registry.cancelTurn({ sessionId, turnId })).resolves.toBe("cancelling");
    const ended = await waitForEvent(events, "turn_end");
    expect(ended.event).toMatchObject({ status: "cancelled", type: "turn_end" });
    await expect(registry.cancelTurn({ sessionId, turnId })).resolves.toBe("cancelled");
    expect(
      events.filter((event) => event.event.type === "turn_end" && event.turnId === turnId),
    ).toHaveLength(1);
  });

  it("turns a crashed Agent process into an interrupted Turn and session_error", async () => {
    const { sessionId } = await createSession();
    const turnId = crypto.randomUUID();
    registry.startTurn({
      request: {
        clientRequestId: "core-acp-crash",
        content: [{ text: "[exit]", type: "text" }],
      },
      sessionId,
      turnId,
    });
    const ended = await waitForEvent(events, "turn_end");
    const sessionError = await waitForEvent(events, "session_error");
    expect(ended.event).toMatchObject({ status: "interrupted", type: "turn_end" });
    expect(sessionError.event).toMatchObject({
      error: { code: "AGENT_PROCESS_CRASHED" },
      type: "session_error",
    });
  });

  it("keeps excess logical Sessions explicitly queued until one process slot is free", async () => {
    const queuedRegistry = new AcpCoreRegistry({
      doctorCwd: directory,
      environment: { DOUGOOS_FIXTURE_TRACE_PATH: join(directory, "queue-trace.log") },
      maxAgentProcesses: 1,
      providers: [new FixtureProvider()],
    });
    const queuedEvents: AgentRuntimeEvent[] = [];
    queuedRegistry.onEvent((event) => queuedEvents.push(event));
    try {
      await queuedRegistry.initialize();
      const firstSessionId = crypto.randomUUID();
      const secondSessionId = crypto.randomUUID();
      await queuedRegistry.createSession({
        cwd: directory,
        providerId: "fixture",
        sessionId: firstSessionId,
      });
      await queuedRegistry.createSession({
        cwd: directory,
        providerId: "fixture",
        sessionId: secondSessionId,
      });

      const firstTurnId = crypto.randomUUID();
      queuedRegistry.startTurn({
        request: {
          clientRequestId: "slot-first",
          content: [{ text: "[cancel]", type: "text" }],
        },
        sessionId: firstSessionId,
        turnId: firstTurnId,
      });
      await vi.waitFor(() => {
        expect(
          queuedEvents.some(
            (event) =>
              event.turnId === firstTurnId &&
              event.event.type === "turn_state" &&
              event.event.status === "running",
          ),
        ).toBe(true);
      });

      const secondTurnId = crypto.randomUUID();
      queuedRegistry.startTurn({
        request: {
          clientRequestId: "slot-second",
          content: [{ text: "second runs later", type: "text" }],
        },
        sessionId: secondSessionId,
        turnId: secondTurnId,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(queuedEvents.some((event) => event.turnId === secondTurnId)).toBe(false);

      await expect(
        queuedRegistry.cancelTurn({ sessionId: firstSessionId, turnId: firstTurnId }),
      ).resolves.toBe("cancelling");
      await vi.waitFor(() => {
        expect(
          queuedEvents.some(
            (event) =>
              event.turnId === secondTurnId &&
              event.event.type === "turn_end" &&
              event.event.status === "completed",
          ),
        ).toBe(true);
      });
      const firstSecondEvent = queuedEvents.find((event) => event.turnId === secondTurnId);
      expect(firstSecondEvent?.event).toMatchObject({
        from: "queued",
        status: "starting",
        type: "turn_state",
      });
    } finally {
      await queuedRegistry.close();
    }
  });

  it("backs off repeated process crashes and opens a doctor-reset circuit breaker", async () => {
    const guardedRegistry = new AcpCoreRegistry({
      circuitBreakerThreshold: 3,
      crashBackoffBaseMs: 1,
      doctorCwd: directory,
      environment: { DOUGOOS_FIXTURE_TRACE_PATH: join(directory, "breaker-trace.log") },
      providers: [new FixtureProvider()],
    });
    const guardedEvents: AgentRuntimeEvent[] = [];
    guardedRegistry.onEvent((event) => guardedEvents.push(event));
    try {
      await guardedRegistry.initialize();
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const sessionId = crypto.randomUUID();
        await guardedRegistry.createSession({
          cwd: directory,
          providerId: "fixture",
          sessionId,
        });
        guardedRegistry.startTurn({
          request: {
            clientRequestId: `breaker-${String(attempt)}`,
            content: [{ text: "[exit]", type: "text" }],
          },
          sessionId,
          turnId: crypto.randomUUID(),
        });
        await vi.waitFor(() => {
          expect(
            guardedEvents.filter((event) => event.event.type === "session_error"),
          ).toHaveLength(attempt);
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(guardedRegistry.listProviders()).toMatchObject([
        {
          capabilities: null,
          id: "fixture",
          reason: expect.stringContaining("circuit breaker"),
          status: "unavailable",
        },
      ]);
      await expect(
        guardedRegistry.createSession({
          cwd: directory,
          providerId: "fixture",
          sessionId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({
        payload: { code: "PROVIDER_UNAVAILABLE", details: { phase: "spawn" } },
      });

      await expect(guardedRegistry.doctor("fixture")).resolves.toMatchObject({
        status: "available",
      });
      expect(guardedRegistry.listProviders()).toMatchObject([
        { id: "fixture", status: "available" },
      ]);
    } finally {
      await guardedRegistry.close();
    }
  });

  it("runs REST to ACP to journal to live publication as one committed chain", async () => {
    const storage = openStorage(join(directory, "core.db"));
    const token = generateBearerToken();
    const runtime = createCoreRuntime(
      {
        appVersion: "integration-test",
        defaultConversationDirectory: join(directory, "Dogoos"),
        registry,
        storage,
      },
      { bearerToken: token, boundPort: 41_338 },
    );
    const live: unknown[] = [];
    runtime.events.subscribe((event) => live.push(event));
    const request = (path: string, body?: unknown) =>
      runtime.app.request(`http://127.0.0.1:41338${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          host: "127.0.0.1:41338",
        },
        method: body === undefined ? "GET" : "POST",
      });

    try {
      await expect(runtime.initialize()).resolves.toBe(true);
      const created = await request("/api/sessions", {
        cwd: directory,
        providerId: "fixture",
      });
      expect(created.status).toBe(201);
      const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
      const queued = await request(`/api/sessions/${sessionId}/turns`, {
        clientRequestId: "rest-acp-journal",
        content: [{ text: "[approval]", type: "text" }],
      });
      expect(queued.status).toBe(202);
      const turnId = ((await queued.json()) as { turnId: string }).turnId;

      await vi.waitFor(() => {
        expect(storage.getSessionSnapshot(sessionId).approvals).toHaveLength(1);
      });
      const approval = storage.getSessionSnapshot(sessionId).approvals[0];
      if (approval === undefined) throw new Error("approval missing");
      const allow = approval.options.find((option) => option.kind === "allow");
      if (allow === undefined) throw new Error("allow option missing");
      const resolved = await request(`/api/turns/${turnId}/approvals/${approval.requestId}`, {
        optionId: allow.optionId,
      });
      expect(resolved.status).toBe(202);

      await vi.waitFor(() => {
        expect(storage.getTurn(turnId)).toMatchObject({ status: "completed" });
      });
      const replay = storage.replay(0).events;
      expect(replay.map((event) => event.event.type)).toEqual(
        expect.arrayContaining([
          "approval_request",
          "approval_resolved",
          "message_delta",
          "turn_end",
          "turn_state",
          "user_message",
        ]),
      );
      expect(live).toHaveLength(replay.length);
      expect(storage.getSessionSnapshot(sessionId)).toMatchObject({
        session: { state: "idle" },
        turns: [expect.objectContaining({ id: turnId, status: "completed" })],
      });
      expect(storage.getGlobalSnapshot([])).toMatchObject({
        activeTurns: [],
        sessions: [expect.objectContaining({ id: sessionId, state: "idle" })],
      });
    } finally {
      await runtime.close();
    }
  });
});
