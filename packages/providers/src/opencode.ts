import type { AgentProvider, ResolvedSessionPermissionConfiguration } from "@dougoos/acp";
import type { PermissionProfileDescriptor } from "@dougoos/shared";

import { OPENCODE_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export const OPENCODE_PERMISSION_PROFILES = [
  {
    description:
      "Use OpenCode's advertised plan mode; Session creation fails if it is unavailable.",
    id: "plan",
    label: "Plan",
    mechanism: "acp_mode",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "safe",
    semantic: "read_only",
  },
  {
    description: "Use OpenCode's normal permission behavior.",
    id: "default",
    label: "Default",
    mechanism: "launch",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "guarded",
    semantic: "ask",
  },
  {
    description: "Auto-approve OpenCode permissions that are not explicitly denied.",
    id: "auto",
    label: "Auto",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "auto_limited",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

export class OpenCodeProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly defaultPermissionProfileId = "auto";
  readonly displayName = "OpenCode";
  readonly id = "opencode";
  readonly permissionProfiles = OPENCODE_PERMISSION_PROFILES;
  readonly providerEnvironmentNames = OPENCODE_PROCESS_ENV;

  chooseAuthMethod(
    initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0],
  ): ReturnType<AgentProvider["chooseAuthMethod"]> {
    return (initialize.authMethods ?? []).some((method) => method.id === "opencode-login")
      ? "opencode-login"
      : null;
  }

  protected override commandArgsForPermissionProfile(profileId: string): readonly string[] {
    return profileId === "auto" ? ["--auto", "acp"] : this.commandArgs;
  }

  protected override sessionConfigurationForPermissionProfile(
    profileId: string,
  ): ResolvedSessionPermissionConfiguration {
    if (profileId === "plan") return { modeId: "plan" };
    return { autoApprovePermissions: profileId === "auto" };
  }
}
