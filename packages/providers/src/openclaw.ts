import type { AgentProvider } from "@dougoos/acp";

import { OPENCLAW_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export class OpenClawProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly displayName = "OpenClaw";
  readonly id = "openclaw";
  readonly providerEnvironmentNames = OPENCLAW_PROCESS_ENV;

  chooseAuthMethod(): ReturnType<AgentProvider["chooseAuthMethod"]> {
    // The ACP bridge authenticates to the configured OpenClaw Gateway.
    return null;
  }
}
