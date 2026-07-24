import type { AgentProvider } from "@dougoos/acp";

import { CURSOR_PROCESS_ENV } from "./environment.js";
import { NativeCliAcpProvider } from "./native-cli-provider.js";

export class CursorAgentProvider extends NativeCliAcpProvider {
  readonly commandArgs = ["acp"] as const;
  readonly displayName = "Cursor Agent";
  readonly id = "cursor-agent";
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
}
