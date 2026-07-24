import type { AgentProvider, SanitizedProcessEnv } from "@dougoos/acp";

import { GROK_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export class GrokProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["--no-auto-update", "agent", "stdio"] as const;
  readonly displayName = "Grok";
  readonly id = "grok";
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
}
