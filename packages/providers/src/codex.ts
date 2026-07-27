import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentProvider,
  ResolvedSessionPermissionConfiguration,
  SanitizedProcessEnv,
} from "@dougoos/acp";
import type { PermissionProfileDescriptor } from "@dougoos/shared";

import { BundledAcpProvider, type BundledProviderOptions } from "./bundled-provider.js";
import { CODEX_PROCESS_ENV } from "./environment.js";

export const CODEX_ACP_VERSION = "1.1.7";
const CODEX_ACP_ENTRY = fileURLToPath(import.meta.resolve("@agentclientprotocol/codex-acp"));

export const CODEX_PERMISSION_PROFILES = [
  {
    description: "Read files and analyze the workspace without modifying it.",
    id: "read-only",
    label: "Read only",
    mechanism: "launch",
    permissionEnforcement: "client_enforced",
    requiresNewSession: true,
    risk: "safe",
    semantic: "read_only",
  },
  {
    description: "Use Codex Agent mode and request approval for sensitive operations.",
    id: "agent",
    label: "Agent",
    mechanism: "launch",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "guarded",
    semantic: "ask",
  },
  {
    description: "Disable Codex approvals and sandbox restrictions for this Session.",
    id: "agent-full-access",
    label: "Agent full access",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "unrestricted",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

type LocalAuthProbe = (environment: SanitizedProcessEnv) => boolean;

export interface CodexProviderOptions extends BundledProviderOptions {
  readonly hasLocalAuth?: LocalAuthProbe;
}

function defaultLocalAuthProbe(environment: SanitizedProcessEnv): boolean {
  const codexHome =
    environment.CODEX_HOME ??
    (environment.HOME === undefined ? undefined : join(environment.HOME, ".codex"));
  return codexHome !== undefined && existsSync(join(codexHome, "auth.json"));
}

export class CodexProvider extends BundledAcpProvider {
  readonly defaultPermissionProfileId = "agent-full-access";
  readonly displayName = "Codex";
  readonly id = "codex";
  readonly permissionProfiles = CODEX_PERMISSION_PROFILES;
  readonly providerEnvironmentNames = CODEX_PROCESS_ENV;
  readonly supportedAdapterVersion = CODEX_ACP_VERSION;

  readonly #hasLocalAuth: LocalAuthProbe;

  constructor(options?: CodexProviderOptions) {
    super({
      adapterEntry: CODEX_ACP_ENTRY,
      adapterVersion: CODEX_ACP_VERSION,
      cliExecutableEnvironmentName: "CODEX_PATH",
      cliProviderId: "codex",
      ...(options === undefined ? {} : { options }),
    });
    this.#hasLocalAuth = options?.hasLocalAuth ?? defaultLocalAuthProbe;
  }

  chooseAuthMethod(
    initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0],
    environment: SanitizedProcessEnv,
  ): string | null {
    const advertised = new Set((initialize.authMethods ?? []).map((method) => method.id));
    if (
      advertised.has("api-key") &&
      (environment.CODEX_API_KEY !== undefined || environment.OPENAI_API_KEY !== undefined)
    ) {
      return "api-key";
    }
    if (advertised.has("chat-gpt") && this.#hasLocalAuth(environment)) {
      return "chat-gpt";
    }
    return null;
  }

  protected override environmentForPermissionProfile(
    profileId: string,
  ): Readonly<Record<string, string>> {
    return { INITIAL_AGENT_MODE: profileId };
  }

  protected override sessionConfigurationForPermissionProfile(
    profileId: string,
  ): ResolvedSessionPermissionConfiguration {
    return { autoApprovePermissions: profileId === "agent-full-access" };
  }
}
