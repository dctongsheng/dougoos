import type { AgentProvider, ResolvedSessionPermissionConfiguration } from "@dougoos/acp";
import type { PermissionProfileDescriptor } from "@dougoos/shared";

import { CURSOR_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export const CURSOR_PERMISSION_PROFILES = [
  {
    description: "Plan changes without editing files or running mutating tools.",
    id: "plan",
    label: "Plan",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "safe",
    semantic: "read_only",
  },
  {
    description: "Answer questions in Cursor's read-only ask mode.",
    id: "ask",
    label: "Ask",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "safe",
    semantic: "read_only",
  },
  {
    description: "Run the normal Cursor Agent and ask before protected operations.",
    id: "agent",
    label: "Agent",
    mechanism: "launch",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "guarded",
    semantic: "ask",
  },
  {
    description: "Force-allow commands and disable Cursor's sandbox for this Session.",
    id: "yolo",
    label: "YOLO",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "unrestricted",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

export class CursorAgentProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly defaultPermissionProfileId = "yolo";
  readonly displayName = "Cursor Agent";
  readonly id = "cursor-agent";
  readonly permissionProfiles = CURSOR_PERMISSION_PROFILES;
  readonly providerEnvironmentNames = CURSOR_PROCESS_ENV;

  chooseAuthMethod(
    initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0],
  ): ReturnType<AgentProvider["chooseAuthMethod"]> {
    // The current hidden ACP entrypoint advertises cursor_login even when it
    // can reuse an existing CLI session. Never request it unless advertised.
    return (initialize.authMethods ?? []).some((method) => method.id === "cursor_login")
      ? "cursor_login"
      : null;
  }

  protected override commandArgsForPermissionProfile(profileId: string): readonly string[] {
    switch (profileId) {
      case "plan":
      case "ask":
        return ["--mode", profileId, "acp"];
      case "yolo":
        return ["--force", "--sandbox", "disabled", "acp"];
      default:
        return this.commandArgs;
    }
  }

  protected override sessionConfigurationForPermissionProfile(
    profileId: string,
  ): ResolvedSessionPermissionConfiguration {
    return { autoApprovePermissions: profileId === "yolo" };
  }
}
