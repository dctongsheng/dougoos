import { fileURLToPath } from "node:url";

import type { AgentProvider, ResolvedSessionPermissionConfiguration } from "@dougoos/acp";
import type { PermissionProfileDescriptor } from "@dougoos/shared";

import { BundledAcpProvider, type BundledProviderOptions } from "./bundled-provider.js";
import { PI_PROCESS_ENV } from "./environment.js";

export const PI_ACP_VERSION = "0.0.31";
const PI_ACP_ENTRY = fileURLToPath(import.meta.resolve("pi-acp"));

export const PI_PERMISSION_PROFILES = [
  {
    description: "Restrict Pi to the read, grep, find, and ls tools for this Session.",
    id: "read-only",
    label: "Read only (best effort)",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "safe",
    semantic: "read_only",
  },
  {
    description: "Allow all Pi tools and automatically accept ACP permission requests.",
    id: "unrestricted",
    label: "Unrestricted",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "unrestricted",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

export class PiProvider extends BundledAcpProvider {
  readonly defaultPermissionProfileId = "unrestricted";
  readonly displayName = "Pi";
  readonly id = "pi";
  readonly permissionProfiles = PI_PERMISSION_PROFILES;
  readonly providerEnvironmentNames = PI_PROCESS_ENV;
  readonly supportedAdapterVersion = PI_ACP_VERSION;

  constructor(options?: BundledProviderOptions) {
    super({
      adapterEntry: PI_ACP_ENTRY,
      adapterVersion: PI_ACP_VERSION,
      cliExecutableEnvironmentName: "PI_ACP_PI_COMMAND",
      cliProviderId: "pi",
      ...(options === undefined ? {} : { options }),
    });
  }

  chooseAuthMethod(): ReturnType<AgentProvider["chooseAuthMethod"]> {
    // pi-acp reuses Pi's configured provider credentials. Its advertised
    // terminal-login method needs a real terminal, which DougoOS does not claim.
    return null;
  }

  protected override sessionConfigurationForPermissionProfile(
    profileId: string,
  ): ResolvedSessionPermissionConfiguration {
    return { autoApprovePermissions: profileId === "unrestricted" };
  }

  protected override environmentForPermissionProfile(
    profileId: string,
  ): Readonly<Record<string, string>> {
    return {
      PI_ACP_PI_ARGS:
        profileId === "read-only"
          ? JSON.stringify(["--tools", "read,grep,find,ls"])
          : JSON.stringify([]),
    };
  }
}
