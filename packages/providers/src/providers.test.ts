import { delimiter } from "node:path";

import type { AgentProvider } from "@dougoos/acp";
import { describe, expect, it, vi } from "vitest";

import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { CursorAgentProvider } from "./cursor-agent.js";
import { unpackedAdapterEntry } from "./bundled-provider.js";
import { GrokProvider } from "./grok.js";
import { HermesProvider } from "./hermes.js";
import { OpenClawProvider } from "./openclaw.js";
import { OpenCodeProvider } from "./opencode.js";
import { PiProvider } from "./pi.js";
import { AgentProviderRegistry } from "./registry.js";

const readable = vi.fn(() => Promise.resolve());
const commandsByProvider = {
  "claude-code": "claude",
  codex: "codex",
  "cursor-agent": "cursor-agent",
  grok: "grok",
  hermes: "hermes",
  openclaw: "openclaw",
  opencode: "opencode",
  pi: "pi",
} as const;
const installedClis = {
  detectIntegrated: (providerId: string) => {
    const command = commandsByProvider[providerId as keyof typeof commandsByProvider];
    return Promise.resolve(
      command === undefined
        ? null
        : {
            command,
            detectedAt: "2026-07-24T08:00:00.000Z",
            displayName: providerId,
            executablePath: `/safe/bin/${command}`,
            integratedProviderId: providerId,
            version: "1.0.0-test",
          },
    );
  },
  scan: () =>
    Promise.resolve({
      checkedAt: "2026-07-24T08:00:00.000Z",
      clis: [],
    }),
} as const;

const unversionedCli = {
  detectIntegrated: (providerId: string) => {
    const command = commandsByProvider[providerId as keyof typeof commandsByProvider];
    return Promise.resolve(
      command === undefined
        ? null
        : {
            command,
            detectedAt: "2026-07-24T08:00:00.000Z",
            displayName: providerId,
            executablePath: `/safe/bin/${command}`,
            integratedProviderId: providerId,
          },
    );
  },
  scan: () =>
    Promise.resolve({
      checkedAt: "2026-07-24T08:00:00.000Z",
      clis: [],
    }),
} as const;

function initialize(authMethodIds: readonly string[]) {
  return {
    agentCapabilities: {},
    agentInfo: { name: "fixture", version: "1" },
    authMethods: authMethodIds.map((id) => ({ id, name: id })),
    protocolVersion: 1,
  } as Parameters<AgentProvider["chooseAuthMethod"]>[0];
}

describe("Agent providers", () => {
  it("maps packaged adapter entries onto real app.asar.unpacked files", () => {
    expect(
      unpackedAdapterEntry(
        "/Applications/DougoOS.app/Contents/Resources/app.asar/node_modules/adapter/index.js",
      ),
    ).toBe(
      "/Applications/DougoOS.app/Contents/Resources/app.asar.unpacked/node_modules/adapter/index.js",
    );
    expect(unpackedAdapterEntry("/safe/source/adapter.js")).toBe("/safe/source/adapter.js");
  });

  it("reports exact availability and resolves a shell-free allowlisted Claude command", async () => {
    readable.mockClear();
    const provider = new ClaudeCodeProvider({
      access: readable,
      adapterEntry: "/safe/claude-adapter.js",
      cliDiscovery: installedClis,
      electronRunAsNode: true,
      nodeExecutable: "/safe/node",
    });

    await expect(provider.available()).resolves.toEqual({
      ok: true,
      version: "0.61.0",
    });
    expect(
      provider.resolveCommand({
        env: {
          ANTHROPIC_API_KEY: "secret",
          HOME: "/safe/home",
          MALICIOUS_UNDECLARED_VALUE: "must-not-pass",
          OPENAI_API_KEY: "other-provider-secret",
        },
      }),
    ).toEqual({
      args: ["/safe/claude-adapter.js"],
      command: "/safe/node",
      env: {
        ANTHROPIC_API_KEY: "secret",
        CLAUDE_CODE_EXECUTABLE: "/safe/bin/claude",
        ELECTRON_RUN_AS_NODE: "1",
        HOME: "/safe/home",
        PATH: "/safe/bin",
      },
    });
    expect(readable).toHaveBeenCalledTimes(2);
  });

  it("distinguishes an incompatible adapter version from an unavailable executable", async () => {
    const incompatible = new CodexProvider({
      access: readable,
      adapterVersion: "9.9.9",
      nodeExecutable: "/safe/node",
    });
    await expect(incompatible.available()).resolves.toMatchObject({
      kind: "incompatible",
      ok: false,
      version: "9.9.9",
    });

    const unavailable = new CodexProvider({
      access: () => Promise.reject(new Error("private path must not surface")),
      nodeExecutable: "/safe/node",
    });
    const result = await unavailable.available();
    expect(result).toMatchObject({ kind: "unavailable", ok: false });
    expect(JSON.stringify(result)).not.toContain("private path");
  });

  it("does not mark a bundled adapter available when its local Agent CLI is missing", async () => {
    const provider = new ClaudeCodeProvider({
      access: readable,
      adapterEntry: "/safe/claude-adapter.js",
      cliDiscovery: {
        detectIntegrated: () => Promise.resolve(null),
        scan: installedClis.scan,
      },
      nodeExecutable: "/safe/node",
    });

    await expect(provider.available()).resolves.toMatchObject({
      kind: "unavailable",
      ok: false,
      reason: expect.stringContaining("not installed"),
    });
    expect(() => provider.resolveCommand({ env: {} })).toThrow(
      "availability must be checked before invocation",
    );
  });

  it("selects only an auth method the Codex initialize response advertised", () => {
    const withLogin = new CodexProvider({ hasLocalAuth: () => true });
    expect(
      withLogin.chooseAuthMethod(initialize(["api-key", "chat-gpt"]), {
        HOME: "/safe/home",
      }),
    ).toBe("chat-gpt");
    expect(
      withLogin.chooseAuthMethod(initialize(["api-key"]), {
        HOME: "/safe/home",
      }),
    ).toBeNull();
    expect(
      withLogin.chooseAuthMethod(initialize(["api-key", "chat-gpt"]), {
        CODEX_API_KEY: "secret",
      }),
    ).toBe("api-key");

    const withoutLogin = new CodexProvider({ hasLocalAuth: () => false });
    expect(
      withoutLogin.chooseAuthMethod(initialize(["chat-gpt"]), {
        HOME: "/safe/home",
      }),
    ).toBeNull();
  });

  it("launches native ACP CLIs by exact path, fixed argv, and an env allowlist", async () => {
    const providers = [
      [new CursorAgentProvider({ cliDiscovery: installedClis }), ["acp"]],
      [new GrokProvider({ cliDiscovery: installedClis }), ["--no-auto-update", "agent", "stdio"]],
      [new HermesProvider({ cliDiscovery: installedClis }), ["acp"]],
      [new OpenClawProvider({ cliDiscovery: installedClis }), ["acp"]],
      [new OpenCodeProvider({ cliDiscovery: installedClis }), ["acp"]],
    ] as const;

    for (const [provider, args] of providers) {
      await expect(provider.available()).resolves.toEqual({
        ok: true,
        version: "1.0.0-test",
      });
      const command = provider.resolveCommand({
        env: {
          CURSOR_API_KEY: "cursor-secret",
          HOME: "/safe/home",
          MALICIOUS_UNDECLARED_VALUE: "must-not-pass",
          PATH: "/usr/bin",
          XAI_API_KEY: "xai-secret",
        },
      });
      expect(command.command).toBe(
        `/safe/bin/${commandsByProvider[provider.id as keyof typeof commandsByProvider]}`,
      );
      expect(command.args).toEqual(args);
      expect(command.env?.PATH).toBe(["/safe/bin", "/usr/bin"].join(delimiter));
      expect(command.env?.NO_PROXY).toBe("127.0.0.1,localhost,::1");
      expect(command.env?.no_proxy).toBe("127.0.0.1,localhost,::1");
      expect(command.env).not.toHaveProperty("MALICIOUS_UNDECLARED_VALUE");
    }
  });

  it("keeps an installed native CLI probeable when its version command times out", async () => {
    const provider = new HermesProvider({ cliDiscovery: unversionedCli });
    await expect(provider.available()).resolves.toEqual({ ok: true, version: "installed" });
  });

  it("chooses only advertised Cursor, Grok, and OpenCode authentication methods", () => {
    const cursor = new CursorAgentProvider();
    expect(cursor.chooseAuthMethod(initialize(["cursor_login"]))).toBe("cursor_login");
    expect(cursor.chooseAuthMethod(initialize(["api-key"]))).toBeNull();

    const grok = new GrokProvider();
    expect(grok.chooseAuthMethod(initialize(["xai.api_key", "cached_token"]), {})).toBe(
      "cached_token",
    );
    expect(
      grok.chooseAuthMethod(initialize(["xai.api_key", "cached_token"]), {
        XAI_API_KEY: "secret",
      }),
    ).toBe("xai.api_key");
    expect(grok.chooseAuthMethod(initialize(["xai.api_key"]), {})).toBeNull();

    const opencode = new OpenCodeProvider();
    expect(opencode.chooseAuthMethod(initialize(["opencode-login"]))).toBe("opencode-login");
    expect(opencode.chooseAuthMethod(initialize(["api-key"]))).toBeNull();
  });

  it("preserves custom proxy bypasses while always keeping ACP loopback traffic local", async () => {
    const provider = new OpenCodeProvider({ cliDiscovery: installedClis });
    await provider.available();
    const command = provider.resolveCommand({
      env: {
        NO_PROXY: "internal.example",
        no_proxy: "metadata.internal",
        PATH: "/usr/bin",
      },
    });
    expect(command.env?.NO_PROXY).toBe(
      "internal.example,metadata.internal,127.0.0.1,localhost,::1",
    );
    expect(command.env?.no_proxy).toBe(command.env?.NO_PROXY);
  });

  it("launches the locked Pi ACP adapter with the exact detected Pi executable", async () => {
    const provider = new PiProvider({
      access: readable,
      adapterEntry: "/safe/pi-acp.js",
      cliDiscovery: installedClis,
      electronRunAsNode: true,
      nodeExecutable: "/safe/node",
    });
    await expect(provider.available()).resolves.toEqual({ ok: true, version: "0.0.31" });
    expect(provider.resolveCommand({ env: { HOME: "/safe/home", PATH: "/usr/bin" } })).toEqual({
      args: ["/safe/pi-acp.js"],
      command: "/safe/node",
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        HOME: "/safe/home",
        PATH: ["/safe/bin", "/usr/bin"].join(delimiter),
        PI_ACP_PI_COMMAND: "/safe/bin/pi",
      },
    });
  });

  it("keeps static process policy independent from negotiated capabilities", () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.processPolicy).toEqual({
      maxSessionsPerProcess: 1,
      multiSessionPerProcess: false,
    });
    expect(provider).not.toHaveProperty("capabilities");
    expect(provider.permissionEnforcement).toBe("requests_permission");
    expect(new PiProvider().permissionEnforcement).toBe("not_guaranteed");
  });

  it("registers all eight built-in Providers without duplicating protocol code", () => {
    const registry = new AgentProviderRegistry();
    expect(registry.list().map((provider) => provider.id)).toEqual([
      "claude-code",
      "codex",
      "cursor-agent",
      "grok",
      "hermes",
      "openclaw",
      "opencode",
      "pi",
    ]);
    expect(registry.get("codex")).toBeInstanceOf(CodexProvider);
    expect(registry.get("cursor-agent")).toBeInstanceOf(CursorAgentProvider);
    expect(registry.get("pi")).toBeInstanceOf(PiProvider);
    expect(() => new AgentProviderRegistry([new CodexProvider(), new CodexProvider()])).toThrow(
      "Provider IDs must be unique",
    );
  });
});
