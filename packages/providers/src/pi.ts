import { fileURLToPath } from "node:url";

import type { AgentProvider } from "@dougoos/acp";
import type { PermissionEnforcement } from "@dougoos/shared";

import { BundledAcpProvider, type BundledProviderOptions } from "./bundled-provider.js";
import { PI_PROCESS_ENV } from "./environment.js";

export const PI_ACP_VERSION = "0.0.31";
const PI_ACP_ENTRY = fileURLToPath(import.meta.resolve("pi-acp"));

export class PiProvider extends BundledAcpProvider {
  readonly displayName = "Pi";
  readonly id = "pi";
  override readonly permissionEnforcement: PermissionEnforcement = "not_guaranteed";
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
}
