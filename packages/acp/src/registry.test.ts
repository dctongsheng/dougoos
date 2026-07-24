import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InitializeResponse } from "@agentclientprotocol/sdk";
import { AgentRuntimeEventSchema, type AgentRuntimeEvent } from "@dougoos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DefaultAgentSessionRegistry } from "./registry.js";
import type { AgentProvider, AgentSessionRegistryOptions } from "./types.js";

const fixtureAgent = join(import.meta.dirname, "../test/fixtures/fake-agent.mjs");
const temporaryDirectories: string[] = [];

class FixtureProvider implements AgentProvider {
  readonly displayName = "Fixture Agent";
  readonly id = "fixture";
  readonly permissionEnforcement: AgentProvider["permissionEnforcement"] = "requests_permission";
  readonly processPolicy = { maxSessionsPerProcess: 1, multiSessionPerProcess: false } as const;

  available(): Promise<{ readonly ok: true; readonly version: "1.0.0" }> {
    return Promise.resolve({ ok: true, version: "1.0.0" });
  }

  chooseAuthMethod(initialize: InitializeResponse): string | null {
    return initialize.authMethods?.find((method) => method.id === "fixture-auth")?.id ?? null;
  }

  resolveCommand() {
    return { args: [fixtureAgent], command: process.execPath };
  }
}

class UnauthenticatedFixtureProvider extends FixtureProvider {
  override chooseAuthMethod(): string | null {
    return null;
  }
}

class NotGuaranteedFixtureProvider extends FixtureProvider {
  override readonly permissionEnforcement = "not_guaranteed" as const;
}

async function createFixtureRegistry(
  overrides: Partial<Omit<AgentSessionRegistryOptions, "providers">> = {},
  provider: AgentProvider = new FixtureProvider(),
) {
  const directory = await mkdtemp(join(tmpdir(), "dougoos-acp-"));
  temporaryDirectories.push(directory);
  const tracePath = join(directory, "trace.log");
  const registry = new DefaultAgentSessionRegistry({
    approvalTimeoutMs: 250,
    deltaWindowMs: 10,
    environment: { DOUGOOS_FIXTURE_TRACE_PATH: tracePath },
    handshakeTimeoutMs: 2_000,
    providers: [provider],
    ...overrides,
  });
  return { directory, registry, tracePath };
}

async function waitForEvent(
  events: readonly AgentRuntimeEvent[],
  type: AgentRuntimeEvent["event"]["type"],
  count = 1,
): Promise<AgentRuntimeEvent> {
  await vi.waitFor(
    () => {
      expect(events.filter((entry) => entry.event.type === type).length).toBeGreaterThanOrEqual(
        count,
      );
    },
    { timeout: 2_000 },
  );
  const event = events.filter((entry) => entry.event.type === type)[count - 1];
  if (event === undefined) throw new Error(`Missing ${type} event`);
  return event;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("DefaultAgentSessionRegistry", () => {
  it("records the Provider-declared permission enforcement level", async () => {
    const { directory, registry } = await createFixtureRegistry(
      {},
      new NotGuaranteedFixtureProvider(),
    );
    try {
      const session = await registry.create({ cwd: directory, providerId: "fixture" });
      expect(session.capabilities.permissionEnforcement).toBe("not_guaranteed");
      await session.dispose();
    } finally {
      await registry.disposeAll();
    }
  });

  it("bounds and redacts Agent stderr without mixing it into protocol events", async () => {
    const entries: Array<{ readonly text: string; readonly truncated: boolean }> = [];
    const diagnostic =
      "credential sk-sensitive123 email operator@example.com path /Users/operator/private " +
      "x".repeat(256);
    const { directory, registry } = await createFixtureRegistry({
      environment: { DOUGOOS_FIXTURE_STDERR: diagnostic },
      onAgentStderr: (entry) => entries.push(entry),
      stderrByteLimit: 128,
    });
    try {
      const session = await registry.create({ cwd: directory, providerId: "fixture" });
      await vi.waitFor(() => {
        expect(entries.some((entry) => entry.truncated)).toBe(true);
      });
      const rendered = entries.map((entry) => entry.text).join("\n");
      expect(rendered).toContain("[REDACTED CREDENTIAL]");
      expect(rendered).toContain("[REDACTED EMAIL]");
      expect(rendered).not.toContain("sk-sensitive123");
      expect(rendered).not.toContain("operator@example.com");
      expect(rendered).not.toContain("/Users/operator");
      expect(rendered).toContain("128 byte local log limit");
      await session.dispose();
    } finally {
      await registry.disposeAll();
    }
  });

  it("runs official v1 handshake, auth, prompt, updates, approval, and completion", async () => {
    const { directory, registry, tracePath } = await createFixtureRegistry();
    try {
      const session = await registry.create({ cwd: directory, providerId: "fixture" });
      expect(session.capabilities).toMatchObject({
        protocolVersion: "1",
        session: { close: true },
        turn: { cancel: true, images: true, prompt: true },
      });
      const events: AgentRuntimeEvent[] = [];
      session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));

      const turn = await session.startTurn({
        text: "[approval] exercise the fixture",
        turnId: crypto.randomUUID(),
      });
      const approval = await waitForEvent(events, "approval_request");
      if (approval.event.type !== "approval_request") throw new Error("approval missing");
      const allow = approval.event.options.find((option) => option.kind === "allow");
      if (allow === undefined) throw new Error("allow option missing");
      await session.resolveApproval(approval.event.requestId, allow.optionId);
      await expect(
        session.resolveApproval(approval.event.requestId, allow.optionId),
      ).rejects.toMatchObject({
        payload: { code: "APPROVAL_ALREADY_RESOLVED" },
      });
      await expect(turn.completion).resolves.toMatchObject({
        status: "completed",
        stopReason: "end_turn",
      });

      const message = events.find((event) => event.event.type === "message_delta");
      expect(message?.event).toMatchObject({
        text: "Hello world",
        type: "message_delta",
      });
      expect(new Set(events.map((event) => event.event.type))).toEqual(
        new Set([
          "approval_request",
          "approval_resolved",
          "diff",
          "message_delta",
          "note",
          "session_state",
          "thought_delta",
          "tool_call",
          "tool_update",
          "turn_end",
          "turn_state",
        ]),
      );
      expect(await readFile(tracePath, "utf8")).toContain(
        "authenticated\nnew_session\nprompt:[approval] exercise the fixture\npermission:selected\n",
      );
    } finally {
      await registry.disposeAll();
    }
  });

  it("cancels through session/cancel and resolves only from the prompt response", async () => {
    const { directory, registry } = await createFixtureRegistry();
    try {
      const session = await registry.create({ cwd: directory, providerId: "fixture" });
      const events: AgentRuntimeEvent[] = [];
      session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
      const turn = await session.startTurn({
        text: "[cancel]",
        turnId: crypto.randomUUID(),
      });

      await turn.cancel();
      await expect(turn.completion).resolves.toEqual({
        status: "cancelled",
        stopReason: "cancelled",
      });
      expect(events.at(-2)?.event).toMatchObject({
        status: "cancelled",
        type: "turn_end",
      });
    } finally {
      await registry.disposeAll();
    }
  });

  it("interrupts an active Turn when the ACP process exits", async () => {
    const { directory, registry } = await createFixtureRegistry();
    const session = await registry.create({ cwd: directory, providerId: "fixture" });
    const events: AgentRuntimeEvent[] = [];
    session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
    const turn = await session.startTurn({
      text: "[exit]",
      turnId: crypto.randomUUID(),
    });

    await expect(turn.completion).resolves.toEqual({
      status: "interrupted",
      stopReason: "interrupted",
    });
    const error = await waitForEvent(events, "session_error");
    expect(error.event).toMatchObject({
      error: { code: "AGENT_PROCESS_CRASHED" },
      type: "session_error",
    });
    expect(session.state).toBe("crashed");
    await session.dispose();
  });

  it("rejects beforePrompt without sending session/prompt to the child", async () => {
    const observerErrors: unknown[] = [];
    const { directory, registry, tracePath } = await createFixtureRegistry({
      interceptors: [
        {
          afterEvent: () => Promise.reject(new Error("observer failure")),
          beforePrompt: () => Promise.resolve("reject"),
        },
      ],
      onObserverError: (error) => observerErrors.push(error),
    });
    try {
      const session = await registry.create({ cwd: directory, providerId: "fixture" });
      const turn = await session.startTurn({ text: "blocked", turnId: crypto.randomUUID() });
      await expect(turn.completion).resolves.toMatchObject({
        error: { code: "AGENT_FAILED" },
        status: "failed",
      });
      await vi.waitFor(() => expect(observerErrors.length).toBeGreaterThan(0));
      expect(await readFile(tracePath, "utf8")).toBe("authenticated\nnew_session\n");
    } finally {
      await registry.disposeAll();
    }
  });

  it.each(["exception", "timeout"] as const)(
    "fails a permission interceptor %s closed without hanging the Turn",
    async (mode) => {
      const { directory, registry } = await createFixtureRegistry({
        interceptorTimeoutMs: 10,
        interceptors: [
          {
            onPermissionRequest: () =>
              mode === "exception"
                ? Promise.reject(new Error("policy failed"))
                : new Promise(() => undefined),
          },
        ],
      });
      try {
        const session = await registry.create({ cwd: directory, providerId: "fixture" });
        const events: AgentRuntimeEvent[] = [];
        session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
        const turn = await session.startTurn({
          text: "[approval]",
          turnId: crypto.randomUUID(),
        });
        await expect(turn.completion).resolves.toMatchObject({ status: "completed" });
        const resolved = await waitForEvent(events, "approval_resolved");
        expect(resolved.event).toMatchObject({
          decision: { type: "reject" },
          status: "rejected",
        });
      } finally {
        await registry.disposeAll();
      }
    },
  );

  it("expires an unanswered permission and releases the Agent request", async () => {
    const { directory, registry } = await createFixtureRegistry({ approvalTimeoutMs: 20 });
    try {
      const session = await registry.create({ cwd: directory, providerId: "fixture" });
      const events: AgentRuntimeEvent[] = [];
      session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
      const turn = await session.startTurn({
        text: "[approval]",
        turnId: crypto.randomUUID(),
      });

      await expect(turn.completion).resolves.toMatchObject({ status: "completed" });
      const resolved = await waitForEvent(events, "approval_resolved");
      expect(resolved.event).toMatchObject({
        decision: null,
        status: "expired",
      });
    } finally {
      await registry.disposeAll();
    }
  });

  it("reports an unknown Provider as a structured error", async () => {
    const registry = new DefaultAgentSessionRegistry({ providers: [] });
    await expect(
      registry.create({ cwd: process.cwd(), providerId: "missing" }),
    ).rejects.toMatchObject({
      payload: { code: "PROVIDER_UNAVAILABLE" },
    });
  });

  it("classifies the official auth_required error without exposing Agent error data", async () => {
    const { directory, registry } = await createFixtureRegistry(
      {
        environment: { DOUGOOS_FIXTURE_REQUIRE_AUTH: "1" },
      },
      new UnauthenticatedFixtureProvider(),
    );
    try {
      await expect(
        registry.create({ cwd: directory, providerId: "fixture" }),
      ).rejects.toMatchObject({
        payload: {
          code: "PROVIDER_UNAVAILABLE",
          details: { phase: "auth", providerId: "fixture" },
        },
      });
    } finally {
      await registry.disposeAll();
    }
  });

  it("terminates the complete POSIX Agent process group on Session close", async () => {
    if (process.platform === "win32") return;
    const directory = await mkdtemp(join(tmpdir(), "dougoos-acp-tree-"));
    temporaryDirectories.push(directory);
    const childPidPath = join(directory, "child.pid");
    const registry = new DefaultAgentSessionRegistry({
      environment: { DOUGOOS_FIXTURE_CHILD_PID_PATH: childPidPath },
      providers: [new FixtureProvider()],
    });
    const session = await registry.create({ cwd: directory, providerId: "fixture" });
    await vi.waitFor(async () => {
      expect(await readFile(childPidPath, "utf8")).toMatch(/^[1-9][0-9]*$/u);
    });
    const childPid = Number(await readFile(childPidPath, "utf8"));
    expect(() => process.kill(childPid, 0)).not.toThrow();

    await session.dispose();
    await vi.waitFor(() => {
      expect(() => process.kill(childPid, 0)).toThrow();
    });
  });
});
