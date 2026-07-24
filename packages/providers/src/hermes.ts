import type { AgentProvider } from "@dougoos/acp";

import { HERMES_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export class HermesProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly displayName = "Hermes";
  readonly id = "hermes";
  readonly providerEnvironmentNames = HERMES_PROCESS_ENV;

  chooseAuthMethod(): ReturnType<AgentProvider["chooseAuthMethod"]> {
    // Hermes ACP reuses the provider/model and credentials configured by the CLI.
    return null;
  }
}
