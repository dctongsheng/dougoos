import { readFile } from "node:fs/promises";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentProvider } from "@dougoos/acp";
import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_AGENT_DISABLED_REASON,
  CLAUDE_AGENT_DISABLED_REMEDIATION,
  ClaudeCodeProvider,
} from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { CursorAgentProvider } from "./cursor-agent.js";
import { unpackedAdapterEntry } from "./bundled-provider.js";
import { providerProcessEnvironment } from "./environment.js";
import { GrokProvider } from "./grok.js";
import { HermesProvider } from "./hermes.js";
import { OpenClawProvider } from "./openclaw.js";
import { OpenCodeProvider } from "./opencode.js";
import { PiProvider } from "./pi.js";
import { AgentProviderRegistry } from "./registry.js";

const readable = vi.fn(() => Promise.resolve());
const commandsByProvider = {
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

  it("keeps Claude Agent unavailable in 0.2.0 without resolving any runtime command", async () => {
    const provider = new ClaudeCodeProvider();

    await expect(provider.available()).resolves.toEqual({
      kind: "unavailable",
      ok: false,
      reason: CLAUDE_AGENT_DISABLED_REASON,
      remediation: CLAUDE_AGENT_DISABLED_REMEDIATION,
    });
    expect(
      provider.chooseAuthMethod(initialize(["claude-ai-login", "console-login"]), {}),
    ).toBeNull();

    for (const env of [
      {},
      { ANTHROPIC_API_KEY: "secret" },
      { CLAUDE_CODE_USE_BEDROCK: "1" },
      { CLAUDE_CODE_USE_VERTEX: "1" },
      { CLAUDE_CODE_OAUTH_TOKEN: "consumer-token" },
      { ANTHROPIC_AUTH_TOKEN: "gateway-token" },
      { CLAUDE_CODE_EXECUTABLE: "/unsafe/local/claude" },
    ]) {
      expect(() => provider.resolveCommand({ env, permissionProfileId: "external" })).toThrow(
        CLAUDE_AGENT_DISABLED_REASON,
      );
    }
    expect(
      providerProcessEnvironment({
        CLAUDE_CODE_EXECUTABLE: "/unsafe/local/claude",
        CLAUDE_CODE_OAUTH_TOKEN: "consumer-token",
      }),
    ).toEqual({});
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
    const provider = new CodexProvider({
      access: readable,
      adapterEntry: "/safe/codex-adapter.js",
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
    expect(() =>
      provider.resolveCommand({
        env: {},
        permissionProfileId: provider.defaultPermissionProfileId,
      }),
    ).toThrow("availability must be checked before invocation");
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
      [new CursorAgentProvider({ cliDiscovery: installedClis }), "agent", ["acp"]],
      [
        new GrokProvider({ cliDiscovery: installedClis }),
        "default",
        ["--no-auto-update", "--permission-mode", "default", "agent", "stdio"],
      ],
      [new HermesProvider({ cliDiscovery: installedClis }), "default", ["acp"]],
      [new OpenClawProvider({ cliDiscovery: installedClis }), "external", ["acp"]],
      [new OpenCodeProvider({ cliDiscovery: installedClis }), "default", ["acp"]],
    ] as const;

    for (const [provider, permissionProfileId, args] of providers) {
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
        permissionProfileId,
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
      permissionProfileId: "default",
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
    expect(
      provider.resolveCommand({
        env: { HOME: "/safe/home", PATH: "/usr/bin" },
        permissionProfileId: "unrestricted",
      }),
    ).toEqual({
      args: ["/safe/pi-acp.js"],
      command: "/safe/node",
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        HOME: "/safe/home",
        PATH: ["/safe/bin", "/usr/bin"].join(delimiter),
        PI_ACP_PI_ARGS: "[]",
        PI_ACP_PI_COMMAND: "/safe/bin/pi",
      },
      sessionConfiguration: { autoApprovePermissions: true },
    });
  });

  it("keeps the locked Pi ACP adapter patched to consume Provider-owned Pi argv", async () => {
    const entry = fileURLToPath(import.meta.resolve("pi-acp"));
    await expect(readFile(entry, "utf8")).resolves.toContain("PI_ACP_PI_ARGS");
  });

  it("keeps static process policy independent from negotiated capabilities", () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.processPolicy).toEqual({
      maxSessionsPerProcess: 1,
      multiSessionPerProcess: false,
    });
    expect(provider).not.toHaveProperty("capabilities");
    expect(provider.permissionEnforcement).toBe(
      provider.permissionProfiles.find(
        (profile) => profile.id === provider.defaultPermissionProfileId,
      )?.permissionEnforcement,
    );
    expect(new PiProvider().permissionEnforcement).toBe("not_guaranteed");
  });

  it("maps declared native permission profiles to fixed launch and ACP configuration", async () => {
    const codex = new CodexProvider({
      access: readable,
      adapterEntry: "/safe/codex-adapter.js",
      cliDiscovery: installedClis,
      nodeExecutable: "/safe/node",
    });
    const cursor = new CursorAgentProvider({ cliDiscovery: installedClis });
    const grok = new GrokProvider({ cliDiscovery: installedClis });
    const hermes = new HermesProvider({ cliDiscovery: installedClis });
    const opencode = new OpenCodeProvider({ cliDiscovery: installedClis });
    const pi = new PiProvider({
      access: readable,
      adapterEntry: "/safe/pi-acp.js",
      cliDiscovery: installedClis,
      nodeExecutable: "/safe/node",
    });
    const openclaw = new OpenClawProvider({ cliDiscovery: installedClis });
    await Promise.all(
      [codex, cursor, grok, hermes, opencode, pi, openclaw].map((provider) => provider.available()),
    );

    expect(
      codex.resolveCommand({ env: {}, permissionProfileId: "agent-full-access" }),
    ).toMatchObject({
      env: { INITIAL_AGENT_MODE: "agent-full-access" },
      sessionConfiguration: { autoApprovePermissions: true },
    });
    expect(cursor.resolveCommand({ env: {}, permissionProfileId: "yolo" }).args).toEqual([
      "--force",
      "--sandbox",
      "disabled",
      "acp",
    ]);
    expect(
      grok.resolveCommand({ env: {}, permissionProfileId: "bypass-permissions" }),
    ).toMatchObject({
      args: ["--no-auto-update", "--permission-mode", "bypassPermissions", "agent", "stdio"],
      sessionConfiguration: { autoApprovePermissions: true },
    });
    expect(hermes.resolveCommand({ env: {}, permissionProfileId: "accept-edits" })).toMatchObject({
      args: ["acp"],
      sessionConfiguration: { modeId: "accept_edits" },
    });
    expect(hermes.resolveCommand({ env: {}, permissionProfileId: "yolo" })).toMatchObject({
      args: ["--yolo", "acp"],
      sessionConfiguration: { autoApprovePermissions: true },
    });
    expect(opencode.resolveCommand({ env: {}, permissionProfileId: "plan" })).toMatchObject({
      args: ["acp"],
      sessionConfiguration: { modeId: "plan" },
    });
    expect(opencode.resolveCommand({ env: {}, permissionProfileId: "auto" })).toMatchObject({
      args: ["--auto", "acp"],
      sessionConfiguration: { autoApprovePermissions: true },
    });
    expect(pi.resolveCommand({ env: {}, permissionProfileId: "read-only" })).toMatchObject({
      env: { PI_ACP_PI_ARGS: '["--tools","read,grep,find,ls"]' },
      sessionConfiguration: { autoApprovePermissions: false },
    });
    expect(openclaw.resolveCommand({ env: {}, permissionProfileId: "external" })).toMatchObject({
      args: ["acp"],
    });
    expect(() =>
      cursor.resolveCommand({ env: {}, permissionProfileId: "renderer-injected-yolo" }),
    ).toThrow("Permission profile is not declared");
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
