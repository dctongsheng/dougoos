import {
  AcpRuntimeError,
  errorPayload,
  type AgentProvider,
  type ProviderAvailability,
  type ResolvedAgentCommand,
} from "@dougoos/acp";
import type {
  PermissionEnforcement,
  PermissionProfileDescriptor,
  ProviderProcessPolicy,
} from "@dougoos/shared";

export const CLAUDE_AGENT_DISABLED_REASON = "Claude Agent 在 DougoOS 0.2.0 中暂不可用。";
export const CLAUDE_AGENT_DISABLED_REMEDIATION =
  "当前版本不包含或启动 Claude Agent adapter；请先使用其他 Provider。consumer、OAuth、API key、云凭据和本机 Claude CLI 都不会启用此集成。";

export const CLAUDE_PERMISSION_PROFILES = [
  {
    description: "Claude Agent is disabled in this release and has no local permission control.",
    id: "external",
    label: "Unavailable",
    mechanism: "external",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "external",
  },
] as const satisfies readonly PermissionProfileDescriptor[];

export class ClaudeAgentIntegrationDisabledError extends AcpRuntimeError {
  constructor() {
    super(
      errorPayload("PROVIDER_UNAVAILABLE", false, {
        operation: "initialize",
        phase: "auth",
        providerId: "claude-code",
      }),
    );
    this.name = "ClaudeAgentIntegrationDisabledError";
    this.message = `${CLAUDE_AGENT_DISABLED_REASON} ${CLAUDE_AGENT_DISABLED_REMEDIATION}`;
  }
}

/**
 * Release-safe placeholder for the Claude Agent product slot.
 *
 * The reviewed adapter could apply local settings after a host preflight.
 * DougoOS 0.2.0 therefore does not distribute or spawn that adapter under any
 * credential configuration.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly defaultPermissionProfileId = "external";
  readonly displayName = "Claude Agent";
  readonly id = "claude-code";
  readonly permissionEnforcement: PermissionEnforcement = "not_guaranteed";
  readonly permissionProfiles = CLAUDE_PERMISSION_PROFILES;
  readonly processPolicy: ProviderProcessPolicy = {
    maxSessionsPerProcess: 1,
    multiSessionPerProcess: false,
  };

  available(): Promise<ProviderAvailability> {
    return Promise.resolve({
      kind: "unavailable",
      ok: false,
      reason: CLAUDE_AGENT_DISABLED_REASON,
      remediation: CLAUDE_AGENT_DISABLED_REMEDIATION,
    });
  }

  chooseAuthMethod(
    _initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0],
    _environment: Parameters<AgentProvider["chooseAuthMethod"]>[1],
  ): ReturnType<AgentProvider["chooseAuthMethod"]> {
    void _initialize;
    void _environment;
    return null;
  }

  resolveCommand(_context: Parameters<AgentProvider["resolveCommand"]>[0]): ResolvedAgentCommand {
    void _context;
    throw new ClaudeAgentIntegrationDisabledError();
  }
}
