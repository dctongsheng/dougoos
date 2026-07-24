import type {
  AgentProvider,
  ProviderAvailability,
  ResolvedAgentCommand,
  SanitizedProcessEnv,
} from "@dougoos/acp";
import type { PermissionEnforcement, ProviderProcessPolicy } from "@dougoos/shared";

import { AgentCliDiscovery, type AgentCliDiscoveryPort } from "./cli-discovery.js";
import {
  COMMON_PROCESS_ENV,
  pickEnvironment,
  prependExecutableDirectory,
  withLoopbackProxyBypass,
} from "./environment.js";

export interface NativeCliProviderOptions {
  readonly cliDiscovery?: AgentCliDiscoveryPort;
}

/**
 * Shared shell-free launcher for Agent CLIs that already expose ACP over
 * stdin/stdout. Provider-specific authentication remains in each subclass.
 */
export abstract class NativeCliAcpProvider implements AgentProvider {
  abstract readonly commandArgs: readonly string[];
  abstract readonly displayName: string;
  abstract readonly id: string;
  abstract readonly providerEnvironmentNames: readonly string[];
  readonly permissionEnforcement: PermissionEnforcement = "requests_permission";
  readonly processPolicy: ProviderProcessPolicy = {
    maxSessionsPerProcess: 1,
    multiSessionPerProcess: false,
  };

  abstract chooseAuthMethod(
    ...args: Parameters<AgentProvider["chooseAuthMethod"]>
  ): ReturnType<AgentProvider["chooseAuthMethod"]>;

  readonly #cliDiscovery: AgentCliDiscoveryPort;
  #executablePath: string | null = null;

  constructor(options: NativeCliProviderOptions = {}) {
    this.#cliDiscovery = options.cliDiscovery ?? new AgentCliDiscovery();
  }

  async available(): Promise<ProviderAvailability> {
    const installation = await this.#cliDiscovery.detectIntegrated(this.id);
    if (installation === null) {
      this.#executablePath = null;
      return {
        kind: "unavailable",
        ok: false,
        reason: `${this.displayName} CLI is not installed or is not executable.`,
        remediation: `Install ${this.displayName}, or expose its command through PATH, then retry Provider doctor.`,
      };
    }
    this.#executablePath = installation.executablePath;
    return {
      ok: true,
      // Some CLIs perform update checks in `--version` and can exceed the
      // bounded discovery timeout. The ACP handshake remains the authoritative
      // compatibility check, so keep installed-but-unversioned CLIs probeable.
      version: installation.version ?? "installed",
    };
  }

  resolveCommand(context: { readonly env: SanitizedProcessEnv }): ResolvedAgentCommand {
    if (this.#executablePath === null) {
      throw new Error(`${this.displayName} CLI availability must be checked before invocation`);
    }
    const env = withLoopbackProxyBypass(
      prependExecutableDirectory(
        pickEnvironment(context.env, [...COMMON_PROCESS_ENV, ...this.providerEnvironmentNames]),
        this.#executablePath,
      ),
    );
    return {
      args: this.commandArgs,
      command: this.#executablePath,
      env,
    };
  }
}
