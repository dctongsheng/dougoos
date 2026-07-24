import type { AgentProvider } from "@dougoos/acp";

import { OPENCODE_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export class OpenCodeProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly displayName = "OpenCode";
  readonly id = "opencode";
  readonly providerEnvironmentNames = OPENCODE_PROCESS_ENV;

  chooseAuthMethod(
    initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0],
  ): ReturnType<AgentProvider["chooseAuthMethod"]> {
    return (initialize.authMethods ?? []).some((method) => method.id === "opencode-login")
      ? "opencode-login"
      : null;
  }
}
