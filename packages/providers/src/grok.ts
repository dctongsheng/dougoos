import type {
  AgentProvider,
  ResolvedSessionPermissionConfiguration,
  SanitizedProcessEnv,
} from "@dougoos/acp";
import type { PermissionProfileDescriptor } from "@dougoos/shared";

import { GROK_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export const GROK_PERMISSION_PROFILES = [
  {
    description: "Use Grok plan mode without executing changes.",
    id: "plan",
    label: "Plan",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "safe",
    semantic: "read_only",
  },
  {
    description: "Use Grok's default permission prompts.",
    id: "default",
    label: "Default",
    mechanism: "launch",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "guarded",
    semantic: "ask",
  },
  {
    description: "Let Grok automatically approve operations covered by its auto policy.",
    id: "auto",
    label: "Auto",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "auto_limited",
  },
  {
    description: "Bypass Grok permission prompts for this Session.",
    id: "bypass-permissions",
    label: "Bypass permissions",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "unrestricted",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

export class GrokProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["--no-auto-update", "agent", "stdio"] as const;
  readonly defaultPermissionProfileId = "bypass-permissions";
  readonly displayName = "Grok";
  readonly id = "grok";
  readonly permissionProfiles = GROK_PERMISSION_PROFILES;
  readonly providerEnvironmentNames = GROK_PROCESS_ENV;

  chooseAuthMethod(
    initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0],
    environment: SanitizedProcessEnv,
  ): string | null {
    const advertised = new Set((initialize.authMethods ?? []).map((method) => method.id));
    if (advertised.has("xai.api_key") && environment.XAI_API_KEY !== undefined) {
      return "xai.api_key";
    }
    if (advertised.has("cached_token")) return "cached_token";
    return null;
  }

  protected override commandArgsForPermissionProfile(profileId: string): readonly string[] {
    const mode = profileId === "bypass-permissions" ? "bypassPermissions" : profileId;
    return ["--no-auto-update", "--permission-mode", mode, "agent", "stdio"];
  }

  protected override sessionConfigurationForPermissionProfile(
    profileId: string,
  ): ResolvedSessionPermissionConfiguration {
    return {
      autoApprovePermissions: profileId === "auto" || profileId === "bypass-permissions",
    };
  }
}
