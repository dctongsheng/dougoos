import {
  AgentCliInstallationSchema,
  AgentEventEnvelopeSchema,
  GlobalSnapshotSchema,
  ProviderSchema,
} from "@dougoos/shared";
import { describe, expect, it } from "vitest";

import type { CoreConnection, CoreFetch } from "./core-client.js";
import {
  agentCatalogFrom,
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
  defaultPermissionProfileId: "full-access",
  displayName: "Fake Agent",
  id: "fake",
  permissionProfiles: [
    {
      description: "Run without approval prompts",
      id: "full-access",
      label: "Full access",
      mechanism: "launch",
      permissionEnforcement: "requests_permission",
      requiresNewSession: true,
      risk: "dangerous",
      semantic: "unrestricted",
    },
  ],
  processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
  status: "available",
  version: "1.0.0",
});
const CLI = AgentCliInstallationSchema.parse({
  command: "fake",
  detectedAt: NOW,
  displayName: "Fake CLI",
  executablePath: "/safe/bin/fake",
  integratedProviderId: "fake",
  version: "fake-cli 1.0.0",
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
  providers = [PROVIDER],
  clis = [CLI],
): Response {
  const path = new URL(String(input)).pathname;
  if (path === "/api/health/ready") {
    return Response.json({ checkedAt: NOW, instanceId, status: "ready" });
  }
  if (path === "/api/preferences") {
    return Response.json({ conversationDirectory: SESSION.cwd });
  }
  if (path === "/api/provider-preferences") {
    return Response.json({
      preferences: providers.map((provider) => ({
        permissionProfileId: provider.defaultPermissionProfileId,
        providerId: provider.id,
        visibleInSidebar: true,
      })),
    });
  }
  if (path === "/api/providers") return Response.json({ providers });
  if (path === "/api/clis") return Response.json({ checkedAt: NOW, clis });
  if (path === "/api/snapshot") return Response.json(snapshot);
  if (path === "/api/events") return openEventStream(init?.signal);
  throw new Error(`Unexpected test Core route: ${path}`);
}

describe("CoreDataSource", () => {
  it("keys every Provider by its stable Provider ID without fixed UI slots", () => {
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
      "claude-code": "claude-code",
      codex: "codex",
      "cursor-agent": "cursor-agent",
      grok: "grok",
      hermes: "hermes",
      openclaw: "openclaw",
      opencode: "opencode",
      pi: "pi",
    });
  });

  it("catalogs every detected integrated Provider, deduplicates, and ignores inventory-only CLIs", () => {
    const providers = Array.from({ length: 10 }, (_, index) =>
      ProviderSchema.parse({
        ...PROVIDER,
        displayName: `Agent ${String(index)}`,
        id: `agent-${String(index)}`,
      }),
    );
    const integrated = providers.map((provider) =>
      AgentCliInstallationSchema.parse({
        command: provider.id,
        detectedAt: NOW,
        displayName: provider.displayName,
        executablePath: `/safe/bin/${provider.id}`,
        integratedProviderId: provider.id,
        version: "1.0.0",
      }),
    );
    const duplicate = AgentCliInstallationSchema.parse({
      ...integrated[0],
      command: "agent-0-alt",
      executablePath: "/safe/bin/agent-0-alt",
    });
    const inventoryOnly = AgentCliInstallationSchema.parse({
      command: "aider",
      detectedAt: NOW,
      displayName: "Aider",
      executablePath: "/safe/bin/aider",
      version: "1.0.0",
    });

    expect(
      agentCatalogFrom(providers, [...integrated, duplicate, inventoryOnly]).map(
        (item) => item.providerId,
      ),
    ).toEqual(providers.map((provider) => provider.id));
  });

  it("projects the seven locally integrated CLIs without the unavailable Claude placeholder", () => {
    const detectedIds = ["codex", "cursor-agent", "grok", "hermes", "openclaw", "opencode", "pi"];
    const providers = ["claude-code", ...detectedIds].map((id) =>
      ProviderSchema.parse({ ...PROVIDER, displayName: id, id }),
    );
    const clis = detectedIds.map((id) =>
      AgentCliInstallationSchema.parse({
        command: id,
        detectedAt: NOW,
        displayName: id,
        executablePath: `/safe/bin/${id}`,
        integratedProviderId: id,
        version: "1.0.0",
      }),
    );

    expect(agentCatalogFrom(providers, clis).map((item) => item.providerId)).toEqual(detectedIds);
  });

  it("builds real Agents only from detected and integrated CLIs", async () => {
    const provider = new FakeConnectionProvider();
    const providers = ["openclaw", "opencode"].map((id) =>
      ProviderSchema.parse({
        ...PROVIDER,
        displayName: id === "openclaw" ? "OpenClaw" : "OpenCode",
        id,
      }),
    );
    const source = new CoreDataSource(provider, {
      fetch: (input, init) =>
        Promise.resolve(
          routeResponse(
            input,
            init,
            "instance:a",
            emptySnapshot(),
            providers,
            providers.map((candidate) =>
              AgentCliInstallationSchema.parse({
                command: candidate.id,
                detectedAt: NOW,
                displayName: candidate.displayName,
                executablePath: `/safe/bin/${candidate.id}`,
                integratedProviderId: candidate.id,
                version: "1.0.0",
              }),
            ),
          ),
        ),
    });
    try {
      const snapshot = await source.getSnapshot(new AbortController().signal);
      expect(snapshot.fixture.agents.map((agent) => agent.id)).toEqual(["openclaw", "opencode"]);
      expect(snapshot.fixture.agents).toEqual([
        expect.objectContaining({ enabled: true, id: "openclaw", name: "OpenClaw" }),
        expect.objectContaining({ enabled: true, id: "opencode", name: "OpenCode" }),
      ]);
      expect(snapshot.chat?.agentCatalog.map((agent) => agent.providerId)).toEqual([
        "openclaw",
        "opencode",
      ]);
      expect(snapshot.chat?.providers.map((candidate) => candidate.id)).toEqual([
        "openclaw",
        "opencode",
      ]);
    } finally {
      source.close();
    }
  });

  it("rebuilds the Agent catalog immediately after CLI refresh", async () => {
    const provider = new FakeConnectionProvider();
    const refreshedClis: readonly ReturnType<typeof AgentCliInstallationSchema.parse>[] = [];
    const source = new CoreDataSource(provider, {
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/clis/refresh") {
          return Promise.resolve(Response.json({ checkedAt: NOW, clis: refreshedClis }));
        }
        return Promise.resolve(
          routeResponse(input, init, "instance:a", emptySnapshot(), [PROVIDER], [CLI]),
        );
      },
    });
    const signal = new AbortController().signal;
    try {
      expect((await source.getSnapshot(signal)).chat?.agentCatalog).toHaveLength(1);
      const snapshots: Array<
        ReturnType<CoreDataSource["getSnapshot"]> extends Promise<infer T> ? T : never
      > = [];
      source.subscribe((snapshot) => snapshots.push(snapshot));

      await source.execute({ name: "clis.refresh" }, signal);

      expect(snapshots.at(-1)?.chat?.agentCatalog).toEqual([]);
      expect(snapshots.at(-1)?.fixture.agents).toEqual([]);
    } finally {
      source.close();
    }
  });

  it("keeps uninstalled Agent history visible but excludes it from new Session catalog", async () => {
    const provider = new FakeConnectionProvider();
    const source = new CoreDataSource(provider, {
      fetch: (input, init) =>
        Promise.resolve(
          routeResponse(input, init, "instance:a", populatedSnapshot(), [PROVIDER], []),
        ),
    });
    try {
      const snapshot = await source.getSnapshot(new AbortController().signal);

      expect(snapshot.chat?.agentCatalog).toEqual([]);
      expect(snapshot.fixture.agents).toEqual([
        expect.objectContaining({ enabled: false, id: "fake", task: "first user task" }),
      ]);
      expect(snapshot.fixture.features.agent.histories.fake).toHaveLength(1);
    } finally {
      source.close();
    }
  });

  it("does not expose raw provider reasoning in the persisted UI snapshot", async () => {
    const sensitiveReasoning = "PRIVATE_REASONING_SENTINEL";
    const provider = new FakeConnectionProvider();
    const baseline = populatedSnapshot("Public answer");
    const snapshotWithReasoning = GlobalSnapshotSchema.parse({
      ...baseline,
      includedSessions: baseline.includedSessions.map((session) => ({
        ...session,
        messages: [
          {
            body: sensitiveReasoning,
            createdAt: NOW,
            id: "message:private-reasoning",
            kind: "think",
            sessionId: SESSION.id,
            state: "complete",
            turnId: "turn:prior",
          },
        ],
      })),
    });
    const source = new CoreDataSource(provider, {
      fetch: (input, init) =>
        Promise.resolve(routeResponse(input, init, "instance:a", snapshotWithReasoning)),
    });
    try {
      const snapshot = await source.getSnapshot(new AbortController().signal);
      expect(snapshot.fixture.features.agent.initialMessages.fake).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toContain(sensitiveReasoning);
    } finally {
      source.close();
    }
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
      expect(snapshot.fixture.features.agent.histories.fake?.[0]).toMatchObject({
        sessionId: SESSION.id,
        summary: "fix flaky login",
      });
      expect(snapshot.fixture.projects[0]).toMatchObject({
        id: "conversation",
        kind: "conversation",
        name: "对话",
      });
      expect(
        snapshot.fixture.projects.flatMap((project) =>
          project.sessions.filter((session) => session.sessionId === SESSION.id),
        ),
      ).toEqual([
        {
          agentId: "fake",
          sessionId: SESSION.id,
          title: "fix flaky login",
        },
      ]);
      expect(snapshot.chat?.sessions[0]?.title).toBe("fix flaky login");
    } finally {
      source.close();
    }
  });

  it("loads and updates the conversation project preference through the Core", async () => {
    const provider = new FakeConnectionProvider();
    let conversationDirectory: string = SESSION.cwd;
    let updateBody: unknown;
    const source = new CoreDataSource(provider, {
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/preferences") {
          if ((init?.method ?? "GET") === "POST") {
            updateBody = JSON.parse(String(init?.body));
            conversationDirectory = (updateBody as { readonly conversationDirectory: string })
              .conversationDirectory;
          }
          return Promise.resolve(Response.json({ conversationDirectory }));
        }
        return Promise.resolve(routeResponse(input, init, "instance:a", populatedSnapshot()));
      },
    });
    try {
      const initial = await source.getSnapshot(new AbortController().signal);
      expect(initial.conversationDirectory).toBe(SESSION.cwd);
      expect(initial.fixture.projects[0]).toMatchObject({
        id: "conversation",
        path: SESSION.cwd,
        sessions: [expect.objectContaining({ sessionId: SESSION.id })],
      });

      let published: typeof initial | undefined;
      const unsubscribe = source.subscribe((snapshot) => {
        published = snapshot;
      });
      const nextDirectory = "/workspace/next-conversations";
      await source.execute(
        {
          conversationDirectory: nextDirectory,
          name: "preferences.conversation-directory.update",
        },
        new AbortController().signal,
      );
      unsubscribe();

      expect(updateBody).toEqual({ conversationDirectory: nextDirectory });
      expect(published?.conversationDirectory).toBe(nextDirectory);
      expect(published?.fixture.projects[0]).toMatchObject({
        id: "conversation",
        path: nextDirectory,
        sessions: [],
      });
      expect(
        published?.fixture.projects.flatMap((project) =>
          project.sessions.filter((session) => session.sessionId === SESSION.id),
        ),
      ).toHaveLength(1);
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
      if (path === "/api/preferences") {
        return Response.json({ conversationDirectory: SESSION.cwd });
      }
      if (path === "/api/provider-preferences") {
        return Response.json({
          preferences: [
            {
              permissionProfileId: PROVIDER.defaultPermissionProfileId,
              providerId: PROVIDER.id,
              visibleInSidebar: true,
            },
          ],
        });
      }
      if (path === "/api/provider-preferences/fake" && method === "PUT") {
        return Response.json({
          preference: {
            ...(body as {
              readonly permissionProfileId: string;
              readonly visibleInSidebar: boolean;
            }),
            providerId: "fake",
          },
        });
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
          name: "provider.preference.update",
          permissionProfileId: "full-access",
          providerId: "fake",
          visibleInSidebar: false,
        },
        signal,
      );
      await source.execute(
        {
          agentId: "fake",
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
        observed.find(
          (request) =>
            request.path === "/api/provider-preferences/fake" && request.method === "PUT",
        ),
      ).toMatchObject({
        body: { permissionProfileId: "full-access", visibleInSidebar: false },
      });
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
