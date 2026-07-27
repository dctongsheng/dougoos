import type { AgentId, ChatProviderView, HomeProjectSelection, SaasDataCommand } from "./types.js";

export type ChatSendCommand = Extract<SaasDataCommand, { readonly name: "chat.send" }>;

export function isAbsoluteWorkspacePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

export function hasValidPermissionProfile(
  provider: ChatProviderView | undefined,
  savedProfileId: string | undefined,
): boolean {
  if (provider === undefined) return false;
  const profileId = savedProfileId ?? provider.defaultPermissionProfileId;
  return provider.permissionProfiles.some((profile) => profile.id === profileId);
}

export function resolveHomeTaskAgentId(input: {
  readonly requestedAgentId: AgentId;
  readonly selectedAgentId: AgentId;
  readonly selectableAgentIds: readonly AgentId[];
}): AgentId | undefined {
  return (
    input.selectableAgentIds.find((candidate) => candidate === input.requestedAgentId) ??
    input.selectableAgentIds.find((candidate) =>
      candidate.toLowerCase().includes(input.requestedAgentId.toLowerCase()),
    ) ??
    input.selectableAgentIds.find((candidate) => candidate === input.selectedAgentId) ??
    input.selectableAgentIds[0]
  );
}

export function resolveHomeProjectCwd(
  project: HomeProjectSelection,
  conversationDirectory: string,
): string {
  return project.kind === "conversation" ? conversationDirectory : project.path;
}

export function buildHomeChatCommand(input: {
  readonly agentId: AgentId;
  readonly cwd: string;
  readonly provider: ChatProviderView | undefined;
  readonly requestId: string;
  readonly text: string;
}): ChatSendCommand | null {
  if (input.provider?.status !== "available" || !isAbsoluteWorkspacePath(input.cwd)) {
    return null;
  }
  return {
    agentId: input.agentId,
    cwd: input.cwd,
    name: "chat.send",
    providerId: input.provider.id,
    requestId: input.requestId,
    sessionMode: "create",
    text: input.text,
  };
}

export function resolveInitialAgentCwd(input: {
  readonly agentCwd: string;
  readonly launchCwd: string | undefined;
  readonly selectedSessionCwd: string | undefined;
}): string {
  return (
    input.launchCwd ?? input.selectedSessionCwd ?? (input.agentCwd === "~" ? "" : input.agentCwd)
  );
}
