import {
  AcpRuntimeError,
  errorPayload,
  type AgentProvider,
  type AgentSessionHandle,
  type AgentSessionRegistry,
  type AgentSessionRegistryOptions,
} from "@dougoos/acp";
import { ProviderDoctorResultSchema, type ProviderCapabilitySnapshot } from "@dougoos/shared";
import { describe, expect, it } from "vitest";

import {
  CLAUDE_AGENT_DISABLED_REASON,
  CLAUDE_AGENT_DISABLED_REMEDIATION,
  ClaudeCodeProvider,
} from "./claude-code.js";
import { doctorProvider } from "./doctor.js";

const capabilities: ProviderCapabilitySnapshot = {
  clientProxy: { config: false, fileSystem: false, terminal: false },
  negotiatedAt: "2026-07-24T00:00:00.000Z",
  permissionEnforcement: "requests_permission",
  protocolVersion: "1",
  session: { close: true, delete: false, list: false, load: false, resume: false },
  turn: { cancel: true, images: false, prompt: true },
};

function provider(
  availability: Awaited<ReturnType<AgentProvider["available"]>> = {
    ok: true,
    version: "1.2.3",
  },
): AgentProvider {
  return {
    available: () => Promise.resolve(availability),
    chooseAuthMethod: () => null,
    defaultPermissionProfileId: "ask",
    displayName: "Fixture Provider",
    id: "fixture",
    permissionEnforcement: "requests_permission",
    permissionProfiles: [
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
    ],
    processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
    resolveCommand: () => ({ args: [], command: process.execPath }),
  };
}

function registryFactory(
  outcome: "available" | "auth" | "handshake" | "protocol",
): (options: AgentSessionRegistryOptions) => AgentSessionRegistry {
  return () => {
    const session = {
      capabilities,
      dispose: () => Promise.resolve(),
    } as AgentSessionHandle;
    return {
      create: () => {
        if (outcome === "available") return Promise.resolve(session);
        if (outcome === "auth") {
          return Promise.reject(
            new AcpRuntimeError(
              errorPayload("PROVIDER_UNAVAILABLE", false, {
                operation: "initialize",
                phase: "auth",
                providerId: "fixture",
              }),
            ),
          );
        }
        if (outcome === "protocol") {
          return Promise.reject(
            new AcpRuntimeError(
              errorPayload("PROTOCOL_VERSION_UNSUPPORTED", false, {
                actual: 2,
                expected: 1,
                phase: "initialize",
                providerId: "fixture",
              }),
            ),
          );
        }
        return Promise.reject(
          new AcpRuntimeError(
            errorPayload("ACP_HANDSHAKE_FAILED", true, {
              operation: "initialize",
              phase: "handshake",
              providerId: "fixture",
            }),
          ),
        );
      },
      disposeAll: () => Promise.resolve(),
      get: () => undefined,
      list: () => [],
    };
  };
}

const doctorOptions = {
  clock: () => "2026-07-24T00:00:00.000Z",
  cwd: "/safe/fixture",
  environment: { OPENAI_API_KEY: "must-never-surface" },
} as const;

describe("Provider doctor", () => {
  it("returns a real capability snapshot for an available Provider", async () => {
    const result = await doctorProvider(provider(), {
      ...doctorOptions,
      registryFactory: registryFactory("available"),
    });
    expect(ProviderDoctorResultSchema.parse(result)).toEqual({
      capabilities,
      checkedAt: "2026-07-24T00:00:00.000Z",
      providerId: "fixture",
      status: "available",
      version: "1.2.3",
    });
  });

  it.each([
    [
      "unavailable",
      {
        kind: "unavailable",
        ok: false,
        reason: "Adapter is missing.",
        remediation: "Install the adapter.",
      },
    ],
    [
      "incompatible",
      {
        kind: "incompatible",
        ok: false,
        reason: "Adapter version is unsupported.",
        remediation: "Restore the locked version.",
        version: "9.0.0",
      },
    ],
  ] as const)("reports %s without attempting a handshake", async (status, availability) => {
    const result = await doctorProvider(provider(availability), {
      ...doctorOptions,
      registryFactory: () => {
        throw new Error("must not run");
      },
    });
    expect(result.status).toBe(status);
  });

  it.each([
    ["auth", "unauthenticated"],
    ["handshake", "handshake_failed"],
    ["protocol", "incompatible"],
  ] as const)("classifies %s separately as %s", async (outcome, status) => {
    const result = await doctorProvider(provider(), {
      ...doctorOptions,
      registryFactory: registryFactory(outcome),
    });
    expect(result.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain("must-never-surface");
  });

  it("reports Claude Agent as temporarily unavailable without attempting a handshake", async () => {
    const result = await doctorProvider(new ClaudeCodeProvider(), {
      ...doctorOptions,
      registryFactory: () => {
        throw new Error("disabled Claude Agent must not create a registry");
      },
    });

    expect(result).toEqual({
      checkedAt: "2026-07-24T00:00:00.000Z",
      providerId: "claude-code",
      reason: CLAUDE_AGENT_DISABLED_REASON,
      remediation: CLAUDE_AGENT_DISABLED_REMEDIATION,
      status: "unavailable",
    });
    expect(JSON.stringify(result)).not.toMatch(/sign in|subscription login is supported/iu);
  });
});
