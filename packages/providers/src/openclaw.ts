import type { AgentProvider } from "@dougoos/acp";
import type { PermissionProfileDescriptor } from "@dougoos/shared";

import { OPENCLAW_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export const OPENCLAW_PERMISSION_PROFILES = [
  {
    description:
      "Permissions are controlled by the configured OpenClaw Gateway. DougoOS does not modify shared Gateway policy.",
    id: "external",
    label: "Gateway policy",
    mechanism: "external",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "external",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

export class OpenClawProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly defaultPermissionProfileId = "external";
  readonly displayName = "OpenClaw";
  readonly id = "openclaw";
  readonly permissionProfiles = OPENCLAW_PERMISSION_PROFILES;
  readonly providerEnvironmentNames = OPENCLAW_PROCESS_ENV;

  chooseAuthMethod(): ReturnType<AgentProvider["chooseAuthMethod"]> {
    // The ACP bridge authenticates to the configured OpenClaw Gateway.
    return null;
  }
}
