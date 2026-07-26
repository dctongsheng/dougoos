import { constants } from "node:fs";
import { access } from "node:fs/promises";

import type {
  AgentProvider,
  ProviderAvailability,
  ResolvedAgentCommand,
  SanitizedProcessEnv,
} from "@dougoos/acp";
import type { PermissionEnforcement, ProviderProcessPolicy } from "@dougoos/shared";

import { AgentCliDiscovery, type AgentCliDiscoveryPort } from "./cli-discovery.js";
import { COMMON_PROCESS_ENV, pickEnvironment, prependExecutableDirectory } from "./environment.js";

export function unpackedAdapterEntry(value: string): string {
  return value.replace(/([/\\][^/\\]+\.asar)([/\\])/u, "$1.unpacked$2");
}

export interface BundledProviderOptions {
  readonly access?: (path: string, mode: number) => Promise<void>;
  readonly adapterEntry?: string;
  readonly adapterVersion?: string;
  readonly cliDiscovery?: AgentCliDiscoveryPort;
  readonly electronRunAsNode?: boolean;
  readonly nodeExecutable?: string;
  readonly runtimeNodeVersion?: string;
}

export abstract class BundledAcpProvider implements AgentProvider {
  abstract readonly displayName: string;
  abstract readonly id: string;
  readonly permissionEnforcement: PermissionEnforcement = "requests_permission";
  readonly processPolicy: ProviderProcessPolicy = {
    maxSessionsPerProcess: 1,
    multiSessionPerProcess: false,
  };

  abstract readonly providerEnvironmentNames: readonly string[];
  abstract readonly supportedAdapterVersion: string;
  abstract chooseAuthMethod(
    ...args: Parameters<AgentProvider["chooseAuthMethod"]>
  ): ReturnType<AgentProvider["chooseAuthMethod"]>;

  readonly #access: (path: string, mode: number) => Promise<void>;
  readonly #adapterEntry: string;
  readonly #adapterVersion: string;
  readonly #cliDiscovery: AgentCliDiscoveryPort;
  readonly #cliExecutableEnvironmentName: string | undefined;
  readonly #cliProviderId: string | undefined;
  #cliExecutablePath: string | null = null;
  readonly #electronRunAsNode: boolean;
  readonly #nodeExecutable: string;
  readonly #runtimeNodeVersion: string;

  protected constructor(defaults: {
    readonly adapterEntry: string;
    readonly adapterVersion: string;
    readonly cliExecutableEnvironmentName?: string;
    readonly cliProviderId?: string;
    readonly options?: BundledProviderOptions;
  }) {
    const options = defaults.options;
    this.#access = options?.access ?? access;
    this.#adapterEntry = unpackedAdapterEntry(options?.adapterEntry ?? defaults.adapterEntry);
    this.#adapterVersion = options?.adapterVersion ?? defaults.adapterVersion;
    this.#cliDiscovery = options?.cliDiscovery ?? new AgentCliDiscovery();
    this.#cliExecutableEnvironmentName = defaults.cliExecutableEnvironmentName;
    this.#cliProviderId = defaults.cliProviderId;
    this.#electronRunAsNode =
      options?.electronRunAsNode ?? Object.hasOwn(process.versions, "electron");
    this.#nodeExecutable = options?.nodeExecutable ?? process.execPath;
    this.#runtimeNodeVersion = options?.runtimeNodeVersion ?? process.versions.node;
  }

  async available(): Promise<ProviderAvailability> {
    const nodeMajor = Number.parseInt(this.#runtimeNodeVersion.split(".")[0] ?? "", 10);
    if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
      return {
        kind: "incompatible",
        ok: false,
        reason: "The Node runtime is incompatible with the bundled ACP adapter.",
        remediation: "Use Node 22 or newer, then retry Provider doctor.",
        version: this.#adapterVersion,
      };
    }
    if (this.#adapterVersion !== this.supportedAdapterVersion) {
      return {
        kind: "incompatible",
        ok: false,
        reason: "The bundled ACP adapter version is incompatible with this release.",
        remediation: "Restore the exact locked dependency versions, then retry Provider doctor.",
        version: this.#adapterVersion,
      };
    }
    try {
      await Promise.all([
        this.#access(this.#nodeExecutable, constants.X_OK),
        this.#access(this.#adapterEntry, constants.R_OK),
      ]);
    } catch {
      return {
        kind: "unavailable",
        ok: false,
        reason: "The bundled ACP adapter executable is unavailable.",
        remediation: "Reinstall project dependencies, then retry Provider doctor.",
        version: this.#adapterVersion,
      };
    }
    if (this.#cliExecutableEnvironmentName === undefined || this.#cliProviderId === undefined) {
      return { ok: true, version: this.#adapterVersion };
    }
    const installation = await this.#cliDiscovery.detectIntegrated(this.#cliProviderId);
    if (installation === null) {
      this.#cliExecutablePath = null;
      return {
        kind: "unavailable",
        ok: false,
        reason: `${this.displayName} CLI is not installed or is not executable.`,
        remediation: `Install ${this.displayName}, or expose its command through PATH, then retry Provider doctor.`,
        version: this.#adapterVersion,
      };
    }
    this.#cliExecutablePath = installation.executablePath;
    return { ok: true, version: this.#adapterVersion };
  }

  resolveCommand(context: { readonly env: SanitizedProcessEnv }): ResolvedAgentCommand {
    if (this.#cliProviderId !== undefined && this.#cliExecutablePath === null) {
      throw new Error(`${this.displayName} CLI availability must be checked before invocation`);
    }
    const pickedEnvironment = pickEnvironment(context.env, [
      ...COMMON_PROCESS_ENV,
      ...this.providerEnvironmentNames,
    ]);
    const env = {
      ...(this.#cliExecutablePath === null
        ? pickedEnvironment
        : prependExecutableDirectory(pickedEnvironment, this.#cliExecutablePath)),
      ...(this.#cliExecutableEnvironmentName === undefined || this.#cliExecutablePath === null
        ? {}
        : { [this.#cliExecutableEnvironmentName]: this.#cliExecutablePath }),
      ...(this.#electronRunAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    };
    return {
      args: [this.#adapterEntry],
      command: this.#nodeExecutable,
      env,
    };
  }
}
