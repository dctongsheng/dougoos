import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  AgentCliInstallationSchema,
  AgentRuntimeEventSchema,
  CONTRACT_LIMITS,
  ProviderSchema,
  type Provider,
  type ProviderDoctorResult,
} from "@dougoos/shared";
import { openStorage, type DougoStorage } from "@dougoos/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCoreRuntime, generateBearerToken, type CoreRuntime } from "./app.js";
import type {
  CancelRegistryTurnInput,
  CoreRegistry,
  CreateRegistrySessionInput,
  ResolveRegistryApprovalInput,
  RegistryEventListener,
  StartRegistryTurnInput,
} from "./types.js";

const PORT = 41_337;
const NOW = "2026-07-24T08:00:00.000Z";
const TOKEN = generateBearerToken();

const CAPABILITIES = {
  clientProxy: {
    config: false,
    fileSystem: false,
    terminal: false,
  },
  negotiatedAt: NOW,
  permissionEnforcement: "requests_permission",
  protocolVersion: "1",
  session: {
    close: false,
    delete: false,
    list: false,
    load: false,
    resume: false,
  },
  turn: {
    cancel: true,
    images: false,
    prompt: true,
  },
} as const;

const PROVIDER = ProviderSchema.parse({
  capabilities: CAPABILITIES,
  checkedAt: NOW,
  displayName: "Fake ACP",
  id: "fake",
  processPolicy: {
    maxSessionsPerProcess: 1,
    multiSessionPerProcess: false,
  },
  status: "available",
  version: "1.0.0",
});
const CLI = AgentCliInstallationSchema.parse({
  command: "codex",
  detectedAt: NOW,
  displayName: "Codex",
  executablePath: "/safe/bin/codex",
  integratedProviderId: "codex",
  version: "codex-cli 0.145.0",
});

class FakeRegistry implements CoreRegistry {
  readonly cliScanOptions: Array<{ readonly force?: boolean } | undefined> = [];
  readonly cancelInputs: CancelRegistryTurnInput[] = [];
  readonly createInputs: CreateRegistrySessionInput[] = [];
  readonly resolveInputs: ResolveRegistryApprovalInput[] = [];
  readonly startInputs: StartRegistryTurnInput[] = [];
  initializeFailure = false;
  providers: readonly Provider[] = [PROVIDER];
  readonly #listeners = new Set<RegistryEventListener>();

  cancelTurn(input: CancelRegistryTurnInput) {
    this.cancelInputs.push(input);
    return "cancelling" as const;
  }

  createSession(input: CreateRegistrySessionInput) {
    this.createInputs.push(input);
    return {
      capabilities: CAPABILITIES,
      providerSessionId: `provider-${input.sessionId}`,
      title: "Fake session",
    };
  }

  doctor(providerId: string): ProviderDoctorResult {
    return {
      capabilities: CAPABILITIES,
      checkedAt: NOW,
      providerId,
      status: "available",
      version: "1.0.0",
    };
  }

  initialize() {
    if (this.initializeFailure) throw new Error("registry unavailable");
  }

  listProviders() {
    return this.providers;
  }

  listAgentCliInstallations(options?: { readonly force?: boolean }) {
    this.cliScanOptions.push(options);
    return { checkedAt: NOW, clis: [CLI] };
  }

  onEvent(listener: RegistryEventListener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: Parameters<RegistryEventListener>[0]) {
    for (const listener of this.#listeners) listener(event);
  }

  resolveApproval(input: ResolveRegistryApprovalInput) {
    this.resolveInputs.push(input);
  }

  startTurn(input: StartRegistryTurnInput) {
    this.startInputs.push(input);
  }
}

interface TestContext {
  readonly directory: string;
  readonly registry: FakeRegistry;
  readonly runtime: CoreRuntime;
  readonly storage: DougoStorage;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${TOKEN}`,
    host: `127.0.0.1:${PORT}`,
    origin: "app://dougoos",
    ...extra,
  };
}

async function api(runtime: CoreRuntime, path: string, init: RequestInit = {}): Promise<Response> {
  return await runtime.app.request(`http://127.0.0.1:${PORT}${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function jsonPost(runtime: CoreRuntime, path: string, body: unknown): Promise<Response> {
  return api(runtime, path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function appendState(
  storage: DougoStorage,
  sessionId: string,
  turnId: string,
  from: "awaiting_approval" | "cancelling" | "queued" | "running" | "starting",
  status: "awaiting_approval" | "cancelling" | "queued" | "running" | "starting",
): void {
  storage.appendAndProject({
    eventId: randomUUID(),
    runtimeEvent: AgentRuntimeEventSchema.parse({
      event: { from, status, type: "turn_state" },
      occurredAt: NOW,
      sessionId,
      turnId,
    }),
  });
}

describe("Core Hono REST baseline", () => {
  let context: TestContext;

  beforeEach(() => {
    const directory = mkdtempSync(join(tmpdir(), "dougoos-core-test-"));
    const storage = openStorage(join(directory, "data.db"), { clock: () => NOW });
    const registry = new FakeRegistry();
    const runtime = createCoreRuntime(
      {
        appVersion: "0.0.0-test",
        clock: () => NOW,
        instanceId: "instance-test",
        registry,
        storage,
      },
      {
        bearerToken: TOKEN,
        boundPort: PORT,
      },
    );
    context = { directory, registry, runtime, storage };
  });

  afterEach(async () => {
    await context.runtime.close();
    rmSync(context.directory, { force: true, recursive: true });
  });

  it("keeps live separate from ready and fails ready when registry initialization fails", async () => {
    const live = await api(context.runtime, "/api/health/live");
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ instanceId: "instance-test", status: "live" });

    const notReady = await api(context.runtime, "/api/health/ready");
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({ code: "CORE_NOT_READY", status: "not_ready" });

    context.registry.initializeFailure = true;
    await expect(context.runtime.initialize()).resolves.toBe(false);
    const failedReady = await api(context.runtime, "/api/health/ready");
    expect(failedReady.status).toBe(503);

    context.registry.initializeFailure = false;
    await expect(context.runtime.initialize()).resolves.toBe(true);
    const ready = await api(context.runtime, "/api/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ instanceId: "instance-test", status: "ready" });
  });

  it("cannot resurrect a closed Core while Registry initialization is pending", async () => {
    let release: (() => void) | undefined;
    context.registry.initialize = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const initializing = context.runtime.initialize();
    await context.runtime.close();
    release?.();
    await expect(initializing).resolves.toBe(false);
    expect(context.runtime.state).toBe("closed");
  });

  it("isolates event fan-out failures from committed writes and other listeners", async () => {
    await context.runtime.initialize();
    const survivingListener = vi.fn();
    context.runtime.events.subscribe(() => {
      throw new Error("consumer failed");
    });
    context.runtime.events.subscribe(survivingListener);
    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    expect(created.status).toBe(201);
    expect(survivingListener).toHaveBeenCalledTimes(1);
  });

  it("enforces exact loopback Host, explicit Origin, bearer, and readiness", async () => {
    const preflight = await context.runtime.app.request(
      `http://127.0.0.1:${PORT}/api/health/live`,
      {
        headers: {
          "access-control-request-headers": "authorization",
          "access-control-request-method": "GET",
          host: `127.0.0.1:${PORT}`,
          origin: "app://dougoos",
        },
        method: "OPTIONS",
      },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("app://dougoos");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

    const missingBearer = await context.runtime.app.request(
      `http://127.0.0.1:${PORT}/api/health/live`,
      { headers: { host: `127.0.0.1:${PORT}` } },
    );
    expect(missingBearer.status).toBe(401);

    const forbiddenOrigin = await api(context.runtime, "/api/health/live", {
      headers: { origin: "https://attacker.example" },
    });
    expect(forbiddenOrigin.status).toBe(403);
    expect(await forbiddenOrigin.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });

    const allowedOrigin = await api(context.runtime, "/api/health/live", {
      headers: { origin: "app://dougoos" },
    });
    expect(allowedOrigin.headers.get("access-control-allow-origin")).toBe("app://dougoos");

    const forbiddenHost = await context.runtime.app.request(
      `http://localhost:${PORT}/api/health/live`,
      {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          host: `localhost:${PORT}`,
        },
      },
    );
    expect(forbiddenHost.status).toBe(403);
    expect(await forbiddenHost.json()).toMatchObject({ code: "FORBIDDEN_HOST" });

    const malformedAuthority = await context.runtime.app.request(
      `http://127.0.0.1:${PORT}/api/health/live`,
      {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          host: `127.0.0.1:${PORT}#fragment`,
        },
      },
    );
    expect(malformedAuthority.status).toBe(403);
    expect(await malformedAuthority.json()).toMatchObject({ code: "FORBIDDEN_HOST" });

    const businessBeforeReady = await api(context.runtime, "/api/providers");
    expect(businessBeforeReady.status).toBe(503);
    expect(await businessBeforeReady.json()).toMatchObject({ code: "CORE_NOT_READY" });
  });

  it("creates and snapshots a Session through Registry then storage", async () => {
    await context.runtime.initialize();
    const eventListener = vi.fn();
    context.runtime.events.subscribe(eventListener);

    const providers = await api(context.runtime, "/api/providers");
    expect(providers.status).toBe(200);
    expect(await providers.json()).toEqual({ providers: [PROVIDER] });

    const clis = await api(context.runtime, "/api/clis");
    expect(await clis.json()).toEqual({ checkedAt: NOW, clis: [CLI] });
    const refreshedClis = await jsonPost(context.runtime, "/api/clis/refresh", {});
    expect(await refreshedClis.json()).toEqual({ checkedAt: NOW, clis: [CLI] });
    expect(context.registry.cliScanOptions).toEqual([undefined, { force: true }]);

    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { session: { id: string } };
    expect(context.registry.createInputs).toHaveLength(1);
    expect(eventListener).toHaveBeenCalledTimes(1);

    const snapshot = await api(
      context.runtime,
      `/api/sessions/${encodeURIComponent(createdBody.session.id)}`,
    );
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      session: { id: createdBody.session.id, state: "idle" },
      turns: [],
    });

    const global = await api(
      context.runtime,
      `/api/snapshot?includeSessionId=${encodeURIComponent(createdBody.session.id)}`,
    );
    expect(global.status).toBe(200);
    expect(await global.json()).toMatchObject({
      includedSessions: [{ session: { id: createdBody.session.id } }],
      sessions: [{ id: createdBody.session.id }],
    });
  });

  it("returns 202 without waiting for the Turn and preserves idempotency and SESSION_BUSY", async () => {
    await context.runtime.initialize();
    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const request = {
      clientRequestId: "request-1",
      content: [
        { text: "first", type: "text" },
        { text: "second", type: "text" },
      ],
    };

    const first = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, request);
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { turnId: string };
    expect(context.registry.startInputs).toHaveLength(1);

    const retry = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, request);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toEqual(firstBody);
    expect(context.registry.startInputs).toHaveLength(1);

    const busy = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
      clientRequestId: "request-2",
      content: [{ text: "different", type: "text" }],
    });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      activeTurnId: firstBody.turnId,
      code: "SESSION_BUSY",
      message: "Session already has an active Turn",
      retryable: true,
      sessionId,
    });
  });

  it("commits Registry runtime events before publishing them to replay and live consumers", async () => {
    await context.runtime.initialize();
    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const turnResponse = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
      clientRequestId: "registry-event-bridge",
      content: [{ text: "bridge", type: "text" }],
    });
    const turnId = ((await turnResponse.json()) as { turnId: string }).turnId;
    const liveListener = vi.fn();
    context.runtime.events.subscribe(liveListener);

    for (const event of [
      { from: "queued", status: "starting", type: "turn_state" },
      { from: "starting", status: "running", type: "turn_state" },
      { messageId: randomUUID(), text: "streamed", type: "message_delta" },
      {
        from: "running",
        status: "completed",
        stopReason: "end_turn",
        type: "turn_end",
      },
    ] as const) {
      context.registry.emit(
        AgentRuntimeEventSchema.parse({
          event,
          occurredAt: NOW,
          sessionId,
          turnId,
        }),
      );
    }

    const snapshot = await api(context.runtime, `/api/sessions/${sessionId}`);
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ body: "streamed", kind: "text", state: "complete" }),
      ]),
      session: { state: "idle" },
      turns: [expect.objectContaining({ id: turnId, status: "completed" })],
    });
    expect(liveListener).toHaveBeenCalledTimes(4);
    expect(context.storage.replay(0).events.at(-1)).toMatchObject({
      event: { status: "completed", type: "turn_end" },
      turnId,
    });
  });

  it("never publishes a Registry event when its journal transaction fails", async () => {
    await context.runtime.initialize();
    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const turnResponse = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
      clientRequestId: "journal-failure",
      content: [{ text: "fail journal", type: "text" }],
    });
    const turnId = ((await turnResponse.json()) as { turnId: string }).turnId;
    const before = context.storage.replay(0).latestSeq;
    const liveListener = vi.fn();
    context.runtime.events.subscribe(liveListener);
    vi.spyOn(context.storage, "appendAndProject").mockImplementationOnce(() => {
      throw new Error("simulated journal failure");
    });

    expect(() =>
      context.registry.emit(
        AgentRuntimeEventSchema.parse({
          event: { from: "queued", status: "starting", type: "turn_state" },
          occurredAt: NOW,
          sessionId,
          turnId,
        }),
      ),
    ).toThrow("simulated journal failure");
    expect(context.storage.replay(0).latestSeq).toBe(before);
    expect(liveListener).not.toHaveBeenCalled();
  });

  it("atomically allows only one of two concurrent Turn creates for one Session", async () => {
    await context.runtime.initialize();
    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const [left, right] = await Promise.all([
      jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
        clientRequestId: "race-left",
        content: [{ text: "left", type: "text" }],
      }),
      jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
        clientRequestId: "race-right",
        content: [{ text: "right", type: "text" }],
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual([202, 409]);
    expect(context.registry.startInputs).toHaveLength(1);
  });

  it("maps malformed, oversized, missing, and unknown requests to structured errors", async () => {
    await context.runtime.initialize();
    const malformed = await api(context.runtime, "/api/sessions", {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "INVALID_REQUEST" });

    const oversized = await api(context.runtime, "/api/sessions", {
      body: JSON.stringify({ value: "x".repeat(CONTRACT_LIMITS.requestBodyBytes) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });

    const missing = await api(context.runtime, `/api/sessions/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "NOT_FOUND", resourceType: "session" });

    const unknown = await api(context.runtime, "/api/no-such-route");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "NOT_FOUND", resourceType: "route" });
  });

  it("classifies a broken internal identity factory as 500, never as client input", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dougoos-core-invalid-factory-"));
    const storage = openStorage(join(directory, "data.db"), { clock: () => NOW });
    const registry = new FakeRegistry();
    const runtime = createCoreRuntime(
      {
        appVersion: "0.0.0-test",
        clock: () => NOW,
        registry,
        sessionIdFactory: () => "",
        storage,
      },
      { bearerToken: TOKEN, boundPort: PORT },
    );
    try {
      await runtime.initialize();
      const response = await jsonPost(runtime, "/api/sessions", {
        cwd: directory,
        providerId: "fake",
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(registry.createInputs).toHaveLength(0);
    } finally {
      await runtime.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("accepts cancel once and treats an already-cancelling Turn as idempotent", async () => {
    await context.runtime.initialize();
    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const turnResponse = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
      clientRequestId: "cancel-me",
      content: [{ text: "run", type: "text" }],
    });
    const turnId = ((await turnResponse.json()) as { turnId: string }).turnId;
    appendState(context.storage, sessionId, turnId, "queued", "starting");
    appendState(context.storage, sessionId, turnId, "starting", "running");

    const accepted = await jsonPost(context.runtime, `/api/turns/${turnId}/cancel`, {});
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ status: "cancelling", turnId });
    expect(context.registry.cancelInputs).toHaveLength(1);

    const unexpectedBody = await jsonPost(context.runtime, `/api/turns/${turnId}/cancel`, {
      unexpected: true,
    });
    expect(unexpectedBody.status).toBe(400);
    expect(await unexpectedBody.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(context.registry.cancelInputs).toHaveLength(1);

    appendState(context.storage, sessionId, turnId, "running", "cancelling");
    const duplicate = await jsonPost(context.runtime, `/api/turns/${turnId}/cancel`, {});
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toMatchObject({ status: "cancelling", turnId });
    expect(context.registry.cancelInputs).toHaveLength(1);

    context.storage.appendAndProject({
      eventId: randomUUID(),
      runtimeEvent: AgentRuntimeEventSchema.parse({
        event: {
          from: "cancelling",
          status: "cancelled",
          stopReason: "cancelled",
          type: "turn_end",
        },
        occurredAt: NOW,
        sessionId,
        turnId,
      }),
    });
    const cancelled = await jsonPost(context.runtime, `/api/turns/${turnId}/cancel`, {});
    expect(cancelled.status).toBe(202);
    expect(await cancelled.json()).toMatchObject({ status: "cancelled", turnId });
    expect(context.registry.cancelInputs).toHaveLength(1);

    const missing = await jsonPost(context.runtime, `/api/turns/${randomUUID()}/cancel`, {});
    expect(missing.status).toBe(404);
  });

  it("validates approval ownership, expiry, and option membership before Registry dispatch", async () => {
    await context.runtime.initialize();
    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const turnResponse = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
      clientRequestId: "approval-turn",
      content: [{ text: "approve", type: "text" }],
    });
    const turnId = ((await turnResponse.json()) as { turnId: string }).turnId;
    appendState(context.storage, sessionId, turnId, "queued", "starting");
    appendState(context.storage, sessionId, turnId, "starting", "running");
    appendState(context.storage, sessionId, turnId, "running", "awaiting_approval");
    context.storage.appendAndProject({
      eventId: randomUUID(),
      runtimeEvent: AgentRuntimeEventSchema.parse({
        event: {
          expiresAt: "2026-07-24T09:00:00.000Z",
          options: [
            { kind: "allow", label: "Allow", optionId: "allow-once" },
            { kind: "reject", label: "Reject", optionId: "reject" },
          ],
          requestId: "approval-1",
          title: "Run tool",
          type: "approval_request",
        },
        occurredAt: NOW,
        sessionId,
        turnId,
      }),
    });

    const invalid = await jsonPost(context.runtime, `/api/turns/${turnId}/approvals/approval-1`, {
      optionId: "unknown",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "APPROVAL_OPTION_INVALID" });

    const accepted = await jsonPost(context.runtime, `/api/turns/${turnId}/approvals/approval-1`, {
      optionId: "allow-once",
    });
    expect(accepted.status).toBe(202);
    expect(context.registry.resolveInputs).toEqual([
      {
        optionId: "allow-once",
        requestId: "approval-1",
        sessionId,
        turnId,
      },
    ]);

    context.storage.appendAndProject({
      eventId: randomUUID(),
      runtimeEvent: AgentRuntimeEventSchema.parse({
        event: {
          decision: { optionId: "allow-once", type: "option" },
          requestId: "approval-1",
          status: "allowed",
          type: "approval_resolved",
        },
        occurredAt: NOW,
        sessionId,
        turnId,
      }),
    });
    const duplicate = await jsonPost(context.runtime, `/api/turns/${turnId}/approvals/approval-1`, {
      optionId: "allow-once",
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "APPROVAL_ALREADY_RESOLVED" });
    expect(context.registry.resolveInputs).toHaveLength(1);

    context.storage.appendAndProject({
      eventId: randomUUID(),
      runtimeEvent: AgentRuntimeEventSchema.parse({
        event: {
          expiresAt: "2026-07-24T07:00:00.000Z",
          options: [
            { kind: "allow", label: "Allow", optionId: "allow-expired" },
            { kind: "reject", label: "Reject", optionId: "reject-expired" },
          ],
          requestId: "approval-expired",
          title: "Expired tool",
          type: "approval_request",
        },
        occurredAt: NOW,
        sessionId,
        turnId,
      }),
    });
    const expired = await jsonPost(
      context.runtime,
      `/api/turns/${turnId}/approvals/approval-expired`,
      { optionId: "allow-expired" },
    );
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ code: "APPROVAL_EXPIRED" });

    const missing = await jsonPost(context.runtime, `/api/turns/${turnId}/approvals/missing`, {
      optionId: "allow-once",
    });
    expect(missing.status).toBe(404);
  });

  it("serves authenticated replay SSE and returns structured cursor failures before streaming", async () => {
    await context.runtime.initialize();

    const invalid = await api(context.runtime, "/api/events?afterSeq=01");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_REQUEST" });

    const ahead = await api(context.runtime, "/api/events?afterSeq=1");
    expect(ahead.status).toBe(400);
    expect(await ahead.json()).toMatchObject({
      code: "INVALID_REQUEST",
      details: { field: "afterSeq", operation: "stream" },
    });

    const created = await jsonPost(context.runtime, "/api/sessions", {
      cwd: context.directory,
      providerId: "fake",
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const stream = await api(context.runtime, "/api/events?afterSeq=0", {
      headers: { accept: "text/event-stream" },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = stream.body?.getReader();
    if (reader === undefined) throw new Error("SSE response did not expose a body");
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toMatch(/^id: 1\ndata: /u);
    await reader.cancel();

    const turn = await jsonPost(context.runtime, `/api/sessions/${sessionId}/turns`, {
      clientRequestId: "stream-gap",
      content: [{ text: "run", type: "text" }],
    });
    expect(turn.status).toBe(202);
    const retention = context.storage.pruneJournal({
      maxAgeMs: 1_000_000_000,
      maxEvents: 1,
      now: NOW,
    });
    expect(retention.minAvailableSeq).toBeGreaterThan(0);

    const gap = await api(context.runtime, "/api/events?afterSeq=0");
    expect(gap.status).toBe(409);
    expect(await gap.json()).toEqual({
      code: "REPLAY_GAP",
      latestSeq: retention.latestSeq,
      message: "Replay cursor is outside retention",
      minAvailableSeq: retention.minAvailableSeq,
      retryable: true,
    });
  });
});
