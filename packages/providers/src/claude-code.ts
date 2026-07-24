import { fileURLToPath } from "node:url";

import type { AgentProvider } from "@dougoos/acp";

import { BundledAcpProvider, type BundledProviderOptions } from "./bundled-provider.js";
import { CLAUDE_PROCESS_ENV } from "./environment.js";

export const CLAUDE_AGENT_ACP_VERSION = "0.61.0";
const CLAUDE_AGENT_ACP_ENTRY = fileURLToPath(
  import.meta.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js"),
);

export class ClaudeCodeProvider extends BundledAcpProvider {
  readonly displayName = "Claude Code";
  readonly id = "claude-code";
  readonly providerEnvironmentNames = CLAUDE_PROCESS_ENV;
  readonly supportedAdapterVersion = CLAUDE_AGENT_ACP_VERSION;

  constructor(options?: BundledProviderOptions) {
    super({
      adapterEntry: CLAUDE_AGENT_ACP_ENTRY,
      adapterVersion: CLAUDE_AGENT_ACP_VERSION,
      cliExecutableEnvironmentName: "CLAUDE_CODE_EXECUTABLE",
      cliProviderId: "claude-code",
      ...(options === undefined ? {} : { options }),
    });
  }

  chooseAuthMethod(): ReturnType<AgentProvider["chooseAuthMethod"]> {
    // Claude's adapter consumes an existing CLI login or explicitly allowlisted
    // non-interactive environment. Its interactive terminal/gateway methods
    // require client capabilities DougoOS does not advertise.
    return null;
  }
}
