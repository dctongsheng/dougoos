import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InitializeResponse } from "@agentclientprotocol/sdk";
import { AgentRuntimeEventSchema, type AgentRuntimeEvent } from "@dougoos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DefaultAgentSessionRegistry } from "./registry.js";
import type { AgentProvider, AgentSessionRegistryOptions, ResolvedAgentCommand } from "./types.js";

const fixtureAgent = join(import.meta.dirname, "../test/fixtures/fake-agent.mjs");
const temporaryDirectories: string[] = [];

class FixtureProvider implements AgentProvider {
  readonly defaultPermissionProfileId: string = "ask";
  readonly displayName = "Fixture Agent";
  readonly id = "fixture";
  readonly permissionEnforcement: AgentProvider["permissionEnforcement"] = "requests_permission";
  readonly permissionProfiles: AgentProvider["permissionProfiles"] = [
    {
      description: "Ask before fixture operations.",
      id: "ask",
      label: "Ask",
      mechanism: "launch",
      permissionEnforcement: "requests_permission",
      requiresNewSession: true,
      risk: "guarded",
      semantic: "ask",
    },
  ];
  readonly processPolicy = { maxSessionsPerProcess: 1, multiSessionPerProcess: false } as const;

  available(): Promise<{ readonly ok: true; readonly version: "1.0.0" }> {
    return Promise.resolve({ ok: true, version: "1.0.0" });
  }

  chooseAuthMethod(initialize: InitializeResponse): string | null {
    return initialize.authMethods?.find((method) => method.id === "fixture-auth")?.id ?? null;
  }

  resolveCommand(): ResolvedAgentCommand {
    return { args: [fixtureAgent], command: process.execPath };
  }
}

class UnauthenticatedFixtureProvider extends FixtureProvider {
  override chooseAuthMethod(): string | null {
    return null;
  }
}

class NotGuaranteedFixtureProvider extends FixtureProvider {
  override readonly defaultPermissionProfileId = "external";
  override readonly permissionEnforcement = "not_guaranteed" as const;
  override readonly permissionProfiles: AgentProvider["permissionProfiles"] = [
    {
      description: "Fixture enforcement is not guaranteed.",
      id: "external",
      label: "External",
      mechanism: "external",
      permissionEnforcement: "not_guaranteed",
      requiresNewSession: true,
      risk: "dangerous",
      semantic: "external",
    },
  ];
}

class ConfiguredFixtureProvider extends FixtureProvider {
  override readonly defaultPermissionProfileId = "auto";
  override readonly permissionEnforcement = "client_enforced" as const;
  override readonly permissionProfiles: AgentProvider["permissionProfiles"] = [
    {
      description: "Apply the fixture ACP mode and config, then automatically approve.",
      id: "auto",
      label: "Auto",
      mechanism: "acp_mode",
      permissionEnforcement: "client_enforced",
      requiresNewSession: true,
      risk: "dangerous",
      semantic: "auto_limited",
    },
  ];

  override resolveCommand(): ResolvedAgentCommand {
    return {
      args: [fixtureAgent],
      command: process.execPath,
      sessionConfiguration: {
        autoApprovePermissions: true,
        configOptions: [{ configId: "safe_toggle", value: true }],
        modeId: "auto",
      },
    };
  }
}

class UnsupportedModeFixtureProvider extends ConfiguredFixtureProvider {
  override resolveCommand(): ResolvedAgentCommand {
    return {
      args: [fixtureAgent],
      command: process.execPath,
      sessionConfiguration: { modeId: "missing-mode" },
    };
  }
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

  it("applies ACP permission configuration before the first prompt and auto-approves visibly", async () => {
    const audit: Array<{
      readonly effectiveProfileId: string;
      readonly optionId: string;
      readonly providerId: string;
      readonly requestId: string;
      readonly result: "allowed";
      readonly sessionId: string;
    }> = [];
    const { directory, registry, tracePath } = await createFixtureRegistry(
      {
        onPermissionAudit: (entry) => {
          audit.push(entry);
        },
      },
      new ConfiguredFixtureProvider(),
    );
    try {
      const session = await registry.create({
        cwd: directory,
        permissionProfileId: "auto",
        providerId: "fixture",
      });
      expect(session.permission).toEqual({
        effectiveProfileId: "auto",
        mechanism: "acp_mode",
        permissionEnforcement: "client_enforced",
        requestedProfileId: "auto",
      });
      expect(session.capabilities.permissionEnforcement).toBe("client_enforced");

      const events: AgentRuntimeEvent[] = [];
      session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
      const turn = await session.startTurn({
        text: "[approval] automatic fixture",
        turnId: crypto.randomUUID(),
      });
      await expect(turn.completion).resolves.toMatchObject({ status: "completed" });
      const approval = await waitForEvent(events, "approval_request");
      const resolved = await waitForEvent(events, "approval_resolved");
      expect(approval.event).toMatchObject({
        description: "The Agent asks before running this tool.",
        type: "approval_request",
      });
      expect(resolved.event).toMatchObject({
        decision: { type: "option" },
        status: "allowed",
        type: "approval_resolved",
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        effectiveProfileId: "auto",
        providerId: "fixture",
        result: "allowed",
        sessionId: session.sessionId,
      });

      const trace = await readFile(tracePath, "utf8");
      expect(trace.indexOf("set_mode:auto")).toBeGreaterThan(trace.indexOf("new_session"));
      expect(trace.indexOf("set_config:safe_toggle:true")).toBeGreaterThan(
        trace.indexOf("set_mode:auto"),
      );
      expect(trace.indexOf("prompt:[approval] automatic fixture")).toBeGreaterThan(
        trace.indexOf("set_config:safe_toggle:true"),
      );
      expect(trace).toContain("permission:selected");
      await session.dispose();
    } finally {
      await registry.disposeAll();
    }
  });

  it("fails closed for unknown profiles and unavailable ACP modes", async () => {
    const first = await createFixtureRegistry({}, new ConfiguredFixtureProvider());
    try {
      await expect(
        first.registry.create({
          cwd: first.directory,
          permissionProfileId: "renderer-injected",
          providerId: "fixture",
        }),
      ).rejects.toMatchObject({
        payload: { code: "PROVIDER_CAPABILITY_UNSUPPORTED" },
      });
    } finally {
      await first.registry.disposeAll();
    }

    const second = await createFixtureRegistry({}, new UnsupportedModeFixtureProvider());
    try {
      await expect(
        second.registry.create({
          cwd: second.directory,
          permissionProfileId: "auto",
          providerId: "fixture",
        }),
      ).rejects.toMatchObject({
        payload: { code: "PROVIDER_CAPABILITY_UNSUPPORTED" },
      });
    } finally {
      await second.registry.disposeAll();
    }
  });

  it("never fabricates an allow option for automatic permission profiles", async () => {
    const audit = vi.fn();
    const { directory, registry } = await createFixtureRegistry(
      { onPermissionAudit: audit },
      new ConfiguredFixtureProvider(),
    );
    try {
      const session = await registry.create({
        cwd: directory,
        permissionProfileId: "auto",
        providerId: "fixture",
      });
      const events: AgentRuntimeEvent[] = [];
      session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
      const turn = await session.startTurn({
        text: "[approval] [approval-no-allow]",
        turnId: crypto.randomUUID(),
      });

      await expect(turn.completion).resolves.toMatchObject({ status: "completed" });
      const resolved = await waitForEvent(events, "approval_resolved");
      expect(resolved.event).toMatchObject({
        decision: { type: "reject" },
        status: "rejected",
        type: "approval_resolved",
      });
      expect(audit).not.toHaveBeenCalled();
      await session.dispose();
    } finally {
      await registry.disposeAll();
    }
  });

  it("fails closed when the automatic-permission audit cannot be persisted", async () => {
    const auditFailure = new Error("audit storage unavailable");
    const { directory, registry } = await createFixtureRegistry(
      { onPermissionAudit: () => Promise.reject(auditFailure) },
      new ConfiguredFixtureProvider(),
    );
    try {
      const session = await registry.create({
        cwd: directory,
        permissionProfileId: "auto",
        providerId: "fixture",
      });
      const events: AgentRuntimeEvent[] = [];
      session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
      const turn = await session.startTurn({
        text: "[approval] audit must precede allow",
        turnId: crypto.randomUUID(),
      });

      await expect(turn.completion).resolves.toMatchObject({ status: "completed" });
      const resolved = await waitForEvent(events, "approval_resolved");
      expect(resolved.event).toMatchObject({
        decision: { type: "reject" },
        status: "rejected",
        type: "approval_resolved",
      });
      expect(
        events.some(
          (event) =>
            event.event.type === "note" &&
            event.event.text.includes("audit record could not be persisted"),
        ),
      ).toBe(true);
      await session.dispose();
    } finally {
      await registry.disposeAll();
    }
  });

  it("keeps automatic audit and allow atomic against concurrent cancellation", async () => {
    let releaseAudit: (() => void) | undefined;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    const audit = vi.fn(async () => {
      await auditGate;
    });
    const { directory, registry } = await createFixtureRegistry(
      { onPermissionAudit: audit },
      new ConfiguredFixtureProvider(),
    );
    try {
      const session = await registry.create({
        cwd: directory,
        permissionProfileId: "auto",
        providerId: "fixture",
      });
      const events: AgentRuntimeEvent[] = [];
      session.subscribe((event) => events.push(AgentRuntimeEventSchema.parse(event)));
      const turn = await session.startTurn({
        text: "[approval] cancellation races durable audit",
        turnId: crypto.randomUUID(),
      });
      await waitForEvent(events, "approval_request");
      await vi.waitFor(() => expect(audit).toHaveBeenCalledOnce());

      let cancellationFinished = false;
      const cancellation = turn.cancel().then(() => {
        cancellationFinished = true;
      });
      await Promise.resolve();
      expect(cancellationFinished).toBe(false);

      releaseAudit?.();
      await cancellation;
      const resolved = await waitForEvent(events, "approval_resolved");
      expect(resolved.event).toMatchObject({
        decision: { type: "option" },
        status: "allowed",
        type: "approval_resolved",
      });
      await expect(turn.completion).resolves.toMatchObject({
        status: "cancelled",
        stopReason: "cancelled",
      });
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
