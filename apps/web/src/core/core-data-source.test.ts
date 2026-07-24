import {
  AgentCliInstallationSchema,
  AgentEventEnvelopeSchema,
  GlobalSnapshotSchema,
  ProviderSchema,
} from "@dougoos/shared";
import { describe, expect, it } from "vitest";

import type { CoreConnection, CoreFetch } from "./core-client.js";
import {
  assignProviders,
  CoreDataSource,
  type CoreConnectionProvider,
} from "./core-data-source.js";

const NOW = "2026-07-24T08:00:00.000Z";
const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);
const CAPABILITIES = {
  clientProxy: { config: false, fileSystem: false, terminal: false },
  negotiatedAt: NOW,
  permissionEnforcement: "requests_permission",
  protocolVersion: "1",
  session: { close: false, delete: false, list: false, load: false, resume: false },
  turn: { cancel: true, images: false, prompt: true },
} as const;
const PROVIDER = ProviderSchema.parse({
  capabilities: CAPABILITIES,
  checkedAt: NOW,
  displayName: "Fake Agent",
  id: "fake",
  processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
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
const SESSION = {
  capabilities: CAPABILITIES,
  createdAt: NOW,
  cwd: "/workspace",
  id: "session:chat",
  providerId: PROVIDER.id,
  providerSessionId: "provider:chat",
  source: "dougoos",
  state: "idle",
  title: "Real chat",
  updatedAt: NOW,
} as const;

function sessionSnapshot(messageBody = "loaded message") {
  return {
    approvals: [],
    messages: [
      {
        body: messageBody,
        createdAt: NOW,
        id: `message:${messageBody.replaceAll(" ", "-")}`,
        kind: "text",
        sessionId: SESSION.id,
        state: "complete",
        turnId: "turn:prior",
      },
    ],
    session: SESSION,
    sessionSnapshotSeq: 0,
    turns: [
      {
        clientRequestId: "client:prior",
        createdAt: NOW,
        endedAt: NOW,
        error: null,
        id: "turn:prior",
        sessionId: SESSION.id,
        startedAt: NOW,
        status: "completed",
        stopReason: "end_turn",
      },
    ],
  } as const;
}

function populatedSnapshot(
  messageBody = "loaded message",
  firstUserMessagePreview = "first user task",
) {
  return GlobalSnapshotSchema.parse({
    activeTurns: [],
    includedSessions: [sessionSnapshot(messageBody)],
    pendingApprovals: [],
    sessions: [
      {
        activeTurnId: null,
        cwd: SESSION.cwd,
        firstUserMessagePreview,
        id: SESSION.id,
        lastMessagePreview: messageBody,
        messageCount: 1,
        providerId: SESSION.providerId,
        state: SESSION.state,
        title: SESSION.title,
        updatedAt: SESSION.updatedAt,
      },
    ],
    snapshotSeq: 0,
  });
}

function emptySnapshot(seq = 0) {
  return GlobalSnapshotSchema.parse({
    activeTurns: [],
    includedSessions: [],
    pendingApprovals: [],
    sessions: [],
    snapshotSeq: seq,
  });
}

class FakeConnectionProvider implements CoreConnectionProvider {
  connection: CoreConnection = {
    instanceId: "instance:a",
    port: 41_337,
    token: TOKEN_A,
  };
  readonly listeners = new Set<() => void>();

  async getCoreConnection(): Promise<CoreConnection> {
    return this.connection;
  }

  onCoreRestart(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  restart(connection: CoreConnection): void {
    this.connection = connection;
    for (const listener of this.listeners) listener();
  }
}

function openEventStream(signal: AbortSignal | null | undefined): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => {
          try {
            controller.close();
          } catch {
            // Fetch already cancelled the test stream.
          }
        },
        { once: true },
      );
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function eventStream(
  event: ReturnType<typeof AgentEventEnvelopeSchema.parse>,
  signal: AbortSignal | null | undefined,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`id: ${String(event.seq)}\ndata: ${JSON.stringify(event)}\n\n`),
      );
      signal?.addEventListener(
        "abort",
        () => {
          try {
            controller.close();
          } catch {
            // Fetch already cancelled the test stream.
          }
        },
        { once: true },
      );
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function routeResponse(
  input: Parameters<CoreFetch>[0],
  init: RequestInit | undefined,
  instanceId: string,
  snapshot = emptySnapshot(),
): Response {
  const path = new URL(String(input)).pathname;
  if (path === "/api/health/ready") {
    return Response.json({ checkedAt: NOW, instanceId, status: "ready" });
  }
  if (path === "/api/providers") return Response.json({ providers: [PROVIDER] });
  if (path === "/api/clis") return Response.json({ checkedAt: NOW, clis: [CLI] });
  if (path === "/api/snapshot") return Response.json(snapshot);
  if (path === "/api/events") return openEventStream(init?.signal);
  throw new Error(`Unexpected test Core route: ${path}`);
}

describe("CoreDataSource", () => {
  it("assigns every built-in Provider to a stable Agent slot without dropping the eighth", () => {
    const providers = [
      "claude-code",
      "codex",
      "cursor-agent",
      "grok",
      "hermes",
      "openclaw",
      "opencode",
      "pi",
    ].map((id) =>
      ProviderSchema.parse({
        ...PROVIDER,
        displayName: id,
        id,
      }),
    );

    expect(Object.fromEntries(assignProviders(providers))).toEqual({
      "claude-code": "claude",
      codex: "codex",
      "cursor-agent": "cursor",
      grok: "grok",
      hermes: "hermes",
      openclaw: "openclaw",
      opencode: "opencode",
      pi: "pi",
    });
  });

  it("loads real provider state while keeping credentials header-only and memory-only", async () => {
    const provider = new FakeConnectionProvider();
    const requests: Array<{ readonly headers: Headers; readonly url: string }> = [];
    const fakeFetch: CoreFetch = async (input, init) => {
      requests.push({ headers: new Headers(init?.headers), url: String(input) });
      return routeResponse(input, init, "instance:a");
    };
    const source = new CoreDataSource(provider, { fetch: fakeFetch });
    try {
      const snapshot = await source.getSnapshot(new AbortController().signal);
      expect(snapshot.fixture.agents.find((agent) => agent.name === "Fake Agent")).toMatchObject({
        enabled: true,
        status: "idle",
      });
      expect(snapshot.chat?.providers).toEqual([
        expect.objectContaining({
          displayName: "Fake Agent",
          id: "fake",
          status: "available",
        }),
      ]);
      expect(snapshot.chat?.cliInstallations).toEqual([CLI]);
      expect(requests.every((request) => !request.url.includes(TOKEN_A))).toBe(true);
      expect(
        requests.every((request) => request.headers.get("authorization") === `Bearer ${TOKEN_A}`),
      ).toBe(true);
    } finally {
      source.close();
    }
  });

  it("uses the stable first user message for every real Session navigation surface", async () => {
    const provider = new FakeConnectionProvider();
    const source = new CoreDataSource(provider, {
      fetch: (input, init) =>
        Promise.resolve(
          routeResponse(
            input,
            init,
            "instance:a",
            populatedSnapshot("latest assistant answer", "fix flaky login"),
          ),
        ),
    });
    try {
      const snapshot = await source.getSnapshot(new AbortController().signal);
      expect(snapshot.fixture.features.agent.histories.claude[0]).toMatchObject({
        sessionId: SESSION.id,
        summary: "fix flaky login",
      });
      expect(snapshot.fixture.sidebarProjects[0]?.sessions[0]).toEqual({
        agentId: "claude",
        sessionId: SESSION.id,
        title: "fix flaky login",
      });
      expect(snapshot.fixture.conversations[0]?.sessions[0]).toEqual({
        agentId: "claude",
        sessionId: SESSION.id,
        title: "fix flaky login",
      });
      expect(snapshot.chat?.sessions[0]?.title).toBe("fix flaky login");
    } finally {
      source.close();
    }
  });

  it("replaces the global baseline after REPLAY_GAP before reopening live", async () => {
    const provider = new FakeConnectionProvider();
    let snapshotCalls = 0;
    let eventCalls = 0;
    let resolveReopened: (() => void) | undefined;
    const reopened = new Promise<void>((resolve) => {
      resolveReopened = resolve;
    });
    const fakeFetch: CoreFetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/snapshot") {
        snapshotCalls += 1;
        return Response.json(emptySnapshot(snapshotCalls - 1));
      }
      if (path === "/api/events") {
        eventCalls += 1;
        if (eventCalls === 1) {
          return Response.json(
            {
              code: "REPLAY_GAP",
              latestSeq: 1,
              message: "Replay cursor is outside retention",
              minAvailableSeq: 1,
              retryable: true,
            },
            { status: 409 },
          );
        }
        resolveReopened?.();
        return openEventStream(init?.signal);
      }
      return routeResponse(input, init, "instance:a");
    };
    const source = new CoreDataSource(provider, { fetch: fakeFetch });
    const runtimeKinds: string[] = [];
    source.subscribeRuntime((runtime) => {
      runtimeKinds.push(
        runtime.kind === "replay-gap" ? `${runtime.kind}:${runtime.phase}` : runtime.kind,
      );
    });
    const replaced = new Promise<void>((resolve) => {
      source.subscribe(() => resolve());
    });
    try {
      await source.getSnapshot(new AbortController().signal);
      await replaced;
      await reopened;
      expect(snapshotCalls).toBe(2);
      expect(eventCalls).toBeGreaterThanOrEqual(2);
      expect(runtimeKinds).toEqual(
        expect.arrayContaining([
          "replay-gap:paused",
          "replay-gap:replacing",
          "replay-gap:resuming",
          "normal",
        ]),
      );
    } finally {
      source.close();
    }
  });

  it("drops the old client and uses the rotated instance, port, and token after restart", async () => {
    const provider = new FakeConnectionProvider();
    const observedTokens: string[] = [];
    const observedPorts: number[] = [];
    const fakeFetch: CoreFetch = async (input, init) => {
      const authorization = new Headers(init?.headers).get("authorization") ?? "";
      observedTokens.push(authorization);
      const url = new URL(String(input));
      observedPorts.push(Number(url.port));
      const instanceId = authorization.endsWith(TOKEN_B) ? "instance:b" : "instance:a";
      return routeResponse(input, init, instanceId);
    };
    const source = new CoreDataSource(provider, { fetch: fakeFetch });
    const restarted = new Promise<void>((resolve) => {
      source.subscribe(() => resolve());
    });
    try {
      await source.getSnapshot(new AbortController().signal);
      provider.restart({
        instanceId: "instance:b",
        port: 41_338,
        token: TOKEN_B,
      });
      await restarted;
      expect(observedTokens).toContain(`Bearer ${TOKEN_A}`);
      expect(observedTokens).toContain(`Bearer ${TOKEN_B}`);
      expect(observedPorts).toContain(41_337);
      expect(observedPorts).toContain(41_338);
    } finally {
      source.close();
    }
  });

  it("surfaces a failed terminal Turn instead of silently returning to normal", async () => {
    const provider = new FakeConnectionProvider();
    const failed = AgentEventEnvelopeSchema.parse({
      event: {
        error: {
          code: "AGENT_FAILED",
          message: "Agent failed",
          retryable: true,
        },
        from: "running",
        status: "failed",
        stopReason: "error",
        type: "turn_end",
      },
      eventId: "event:failed",
      occurredAt: NOW,
      seq: 1,
      sessionId: SESSION.id,
      turnId: "turn:failed",
      v: 1,
    });
    const fakeFetch: CoreFetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/events") return eventStream(failed, init?.signal);
      return routeResponse(input, init, "instance:a", populatedSnapshot());
    };
    const source = new CoreDataSource(provider, { fetch: fakeFetch });
    const surfaced = new Promise<void>((resolve) => {
      source.subscribeRuntime((runtime) => {
        if (runtime.kind !== "turn-failed") return;
        expect(runtime).toEqual({
          code: "AGENT_FAILED",
          kind: "turn-failed",
          message: "Agent failed",
          turnId: "turn:failed",
        });
        resolve();
      });
    });
    try {
      await source.getSnapshot(new AbortController().signal);
      await surfaced;
    } finally {
      source.close();
    }
  });

  it("creates and selects a Session before sending, then forwards approval and cancel commands", async () => {
    const provider = new FakeConnectionProvider();
    const observed: Array<{
      readonly body: unknown;
      readonly method: string;
      readonly path: string;
    }> = [];
    const fakeFetch: CoreFetch = async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const method = init?.method ?? "GET";
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      observed.push({ body, method, path });
      if (path === "/api/health/ready") {
        return Response.json({ checkedAt: NOW, instanceId: "instance:a", status: "ready" });
      }
      if (path === "/api/providers") return Response.json({ providers: [PROVIDER] });
      if (path === "/api/clis") return Response.json({ checkedAt: NOW, clis: [CLI] });
      if (path === "/api/snapshot") return Response.json(populatedSnapshot());
      if (path === "/api/events") return openEventStream(init?.signal);
      if (path === "/api/sessions" && method === "POST") {
        return Response.json({ session: SESSION }, { status: 201 });
      }
      if (path === "/api/sessions/session%3Achat/turns" && method === "POST") {
        return Response.json({ turnId: "turn:chat" }, { status: 202 });
      }
      if (path === "/api/turns/turn%3Achat/approvals/approval%3Achat" && method === "POST") {
        return Response.json({ accepted: true, requestId: "approval:chat" }, { status: 202 });
      }
      if (path === "/api/turns/turn%3Achat/cancel" && method === "POST") {
        return Response.json(
          { accepted: true, status: "cancelled", turnId: "turn:chat" },
          { status: 202 },
        );
      }
      throw new Error(`Unexpected test Core route: ${method} ${path}`);
    };
    const source = new CoreDataSource(provider, { fetch: fakeFetch });
    const signal = new AbortController().signal;
    try {
      await source.getSnapshot(signal);
      await source.execute(
        {
          agentId: "claude",
          cwd: SESSION.cwd,
          name: "chat.send",
          providerId: PROVIDER.id,
          requestId: "client:chat",
          sessionMode: "create",
          text: "hello from the real UI",
        },
        signal,
      );
      await source.execute(
        {
          name: "approval.resolve",
          optionId: "allow-once",
          requestId: "approval:chat",
          turnId: "turn:chat",
        },
        signal,
      );
      await source.execute({ name: "turn.cancel", turnId: "turn:chat" }, signal);

      expect(
        observed.filter((request) => request.path === "/api/sessions" && request.method === "POST"),
      ).toEqual([
        {
          body: { cwd: SESSION.cwd, providerId: PROVIDER.id },
          method: "POST",
          path: "/api/sessions",
        },
      ]);
      expect(
        observed.find((request) => request.path === "/api/sessions/session%3Achat/turns"),
      ).toMatchObject({
        body: {
          clientRequestId: "client:chat",
          content: [{ text: "hello from the real UI", type: "text" }],
        },
        method: "POST",
      });
      expect(observed.find((request) => request.path.includes("/approvals/"))).toMatchObject({
        body: { optionId: "allow-once" },
        method: "POST",
      });
    } finally {
      source.close();
    }
  });
});
