import type { AgentProvider, ResolvedSessionPermissionConfiguration } from "@dougoos/acp";
import type { PermissionProfileDescriptor } from "@dougoos/shared";

import { HERMES_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export const HERMES_PERMISSION_PROFILES = [
  {
    description: "Ask before file edits and dangerous commands.",
    id: "default",
    label: "Default",
    mechanism: "acp_mode",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "guarded",
    semantic: "ask",
  },
  {
    description: "Auto-allow workspace and temporary-directory edits; keep sensitive prompts.",
    id: "accept-edits",
    label: "Accept edits",
    mechanism: "acp_mode",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "guarded",
    semantic: "auto_limited",
  },
  {
    description: "Auto-allow file edits except Hermes sensitive-path protections.",
    id: "dont-ask",
    label: "Don't ask",
    mechanism: "acp_mode",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "auto_limited",
  },
  {
    description: "Bypass Hermes dangerous-command approval prompts for this process.",
    id: "yolo",
    label: "YOLO",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "unrestricted",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

export class HermesProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly defaultPermissionProfileId = "yolo";
  readonly displayName = "Hermes";
  readonly id = "hermes";
  readonly permissionProfiles = HERMES_PERMISSION_PROFILES;
  readonly providerEnvironmentNames = HERMES_PROCESS_ENV;

  chooseAuthMethod(): ReturnType<AgentProvider["chooseAuthMethod"]> {
    // Hermes ACP reuses the provider/model and credentials configured by the CLI.
    return null;
  }

  protected override commandArgsForPermissionProfile(profileId: string): readonly string[] {
    return profileId === "yolo" ? ["--yolo", "acp"] : this.commandArgs;
  }

  protected override sessionConfigurationForPermissionProfile(
    profileId: string,
  ): ResolvedSessionPermissionConfiguration {
    if (profileId === "yolo") return { autoApprovePermissions: true };
    const modeId =
      profileId === "accept-edits"
        ? "accept_edits"
        : profileId === "dont-ask"
          ? "dont_ask"
          : "default";
    return { modeId };
  }
}
