import type {
  AgentCliInstallation,
  PermissionProfileDescriptor,
  ProviderPreference,
  ProviderCapabilitySnapshot,
  ProviderStatus,
  SessionState,
} from "@dougoos/shared";

import type { FeatureFixtures } from "./feature-fixtures.js";
import type { AgentMessage, QueueStatus } from "./feature-fixtures.js";

/**
 * Fixture mode uses this finite prototype set. Real mode keys Agents by
 * Provider ID so newly integrated CLIs never need a hard-coded UI slot.
 */
export const PROTOTYPE_AGENT_IDS = ["codex", "claude", "grok", "cursor", "pi", "hermes"] as const;

export type PrototypeAgentId = (typeof PROTOTYPE_AGENT_IDS)[number];
export type AgentId = string;

export type AgentStatus = "executing" | "idle" | "thinking" | "waiting";

export type AgentTab = "history" | "kanban" | "mcps" | "session" | "skills";

export type SessionsSection =
  "analytics" | "dashboard" | "export" | "insights" | "patterns" | "sessions" | "sync";

export type HarnessSection =
  "goal" | "hooks" | "mcp" | "prompt" | "rules" | "skills" | "subagents" | "workflows";

export type MemoryTab = "graph" | "notes" | "omi" | "recent";

export type Route =
  | {
      readonly kind: "agent";
      readonly agentId: AgentId;
      readonly tab: AgentTab;
      /**
       * One-shot launch intent from Home. It keeps the selected project visible
       * while the matching Session is being created asynchronously.
       */
      readonly cwd?: string;
    }
  | { readonly kind: "compare" }
  | { readonly kind: "cron" }
  | { readonly kind: "dashboard" }
  | { readonly kind: "harness"; readonly section: HarnessSection }
  | { readonly kind: "home" }
  | { readonly kind: "memory"; readonly tab: MemoryTab }
  | { readonly kind: "projects" }
  | { readonly kind: "queue" }
  | { readonly kind: "sessions"; readonly section: SessionsSection }
  | { readonly kind: "settings"; readonly agentId: AgentId }
  | { readonly kind: "usage" };

export interface AgentFixture {
  readonly cost: number;
  readonly cwd: string;
  readonly enabled: boolean;
  readonly glyph: string;
  readonly id: AgentId;
  readonly last: string;
  readonly model: string;
  readonly name: string;
  readonly status: AgentStatus;
  readonly task: string;
  readonly tokenCount: number;
  readonly tone: string;
}

export interface NotificationFixture {
  readonly agentId: AgentId | null;
  readonly id: string;
  readonly read: boolean;
  readonly text: string;
  readonly time: string;
  readonly title: string;
}

export interface ProjectFixture {
  readonly id: string;
  readonly initiallyOpen: boolean;
  readonly kind: "conversation" | "directory";
  readonly name: string;
  readonly path: string;
  readonly sessions: readonly SidebarSessionFixture[];
}

export interface SidebarSessionFixture {
  readonly agentId: AgentId;
  readonly sessionId?: string;
  readonly title: string;
}

export interface SaasFixture {
  readonly agents: readonly AgentFixture[];
  readonly features: FeatureFixtures;
  readonly notifications: readonly NotificationFixture[];
  readonly projects: readonly ProjectFixture[];
  readonly suggestions: readonly string[];
}

export type DataMode = "fixture" | "real";

export interface ChatProviderView {
  readonly agentId: AgentId;
  readonly capabilities: ProviderCapabilitySnapshot | null;
  readonly defaultPermissionProfileId: string;
  readonly displayName: string;
  readonly id: string;
  readonly installed: boolean;
  readonly permissionProfiles: readonly PermissionProfileDescriptor[];
  readonly reason?: string;
  readonly remediation?: string;
  readonly status: ProviderStatus;
  readonly version?: string;
}

export interface AgentCatalogItem {
  readonly agentId: AgentId;
  readonly cli: AgentCliInstallation;
  readonly displayName: string;
  readonly providerId: string;
  readonly status: ProviderStatus;
}

export interface ChatSessionView {
  readonly activeTurnId: string | null;
  readonly agentId: AgentId;
  readonly cwd: string;
  readonly id: string;
  readonly messageCount: number;
  readonly providerId: string;
  readonly state: SessionState;
  readonly title: string;
  readonly updatedAt: string;
}

export interface ChatViewSnapshot {
  readonly agentCatalog: readonly AgentCatalogItem[];
  readonly cliInstallations: readonly AgentCliInstallation[];
  readonly providerPreferences: readonly ProviderPreference[];
  readonly providers: readonly ChatProviderView[];
  readonly selectedSessionIds: Readonly<Partial<Record<AgentId, string>>>;
  readonly sessions: readonly ChatSessionView[];
}

export interface SaasDataSnapshot {
  readonly chat?: ChatViewSnapshot;
  readonly conversationDirectory: string;
  readonly fixture: SaasFixture;
  /**
   * Monotonically increases within one SaasDataSource instance. A replacement
   * source owns a new revision sequence because App also isolates source identity.
   */
  readonly revision: number;
}

export type SaasDataCommand =
  | {
      readonly agentId: AgentId;
      readonly cwd: string;
      readonly name: "chat.send";
      readonly providerId: string;
      readonly requestId: string;
      readonly sessionMode: "create" | "reuse";
      readonly text: string;
    }
  | { readonly name: "clis.refresh" }
  | {
      readonly name: "provider.preference.update";
      readonly permissionProfileId: string;
      readonly providerId: string;
      readonly visibleInSidebar: boolean;
    }
  | {
      readonly conversationDirectory: string;
      readonly name: "preferences.conversation-directory.update";
    }
  | {
      readonly name: "approval.resolve";
      readonly optionId: string;
      readonly requestId: string;
      readonly turnId: string;
    }
  | { readonly name: "core.retry" }
  | { readonly name: "diagnostics.open"; readonly source: "agent" | "migration" }
  | { readonly name: "provider.doctor"; readonly providerId: string }
  | { readonly name: "request.retry"; readonly requestKey: string }
  | {
      readonly agentId: AgentId;
      readonly cwd: string;
      readonly name: "session.create";
      readonly providerId: string;
    }
  | {
      readonly agentId: AgentId;
      readonly name: "session.select";
      readonly sessionId: string;
    }
  | { readonly name: "turn.cancel"; readonly turnId: string };

export interface SaasDataSource {
  readonly mode: DataMode;
  chooseDirectory?(): Promise<string | null>;
  close?(): void;
  execute(command: SaasDataCommand, signal: AbortSignal): Promise<void>;
  getSnapshot(signal: AbortSignal): Promise<SaasDataSnapshot>;
  subscribe?(listener: (snapshot: SaasDataSnapshot) => void): () => void;
  subscribeRuntime?(listener: (presentation: RuntimePresentation) => void): () => void;
}

export type ConnectionState =
  | { readonly kind: "loading"; readonly stage: string }
  | { readonly kind: "ready"; readonly mode: DataMode }
  | { readonly attempt: number; readonly kind: "reconnecting" }
  | { readonly kind: "error"; readonly message: string };

export type MenuKind = "agent" | "path" | null;

export type HomeProjectSelection =
  { readonly kind: "conversation" } | { readonly kind: "directory"; readonly path: string };

export type SidebarVisibilityKey =
  | AgentId
  | "harness"
  | "harness-goal"
  | "harness-hooks"
  | "harness-mcp"
  | "harness-prompt"
  | "harness-rules"
  | "harness-skills"
  | "harness-subagents"
  | "harness-workflows"
  | "home"
  | "memory"
  | "orchestration"
  | "project-conversations"
  | "project-list"
  | "project-pinned"
  | "projects"
  | "sessions"
  | "sessions-analytics"
  | "sessions-dashboard"
  | "sessions-export"
  | "sessions-insights"
  | "sessions-patterns"
  | "sessions-sessions"
  | "sessions-sync";

export type RuntimePresentation =
  | { readonly kind: "agent-crashed"; readonly exitCode: number | null }
  | {
      readonly code: string;
      readonly kind: "api-error";
      readonly requestKey: string;
    }
  | { readonly kind: "capability-warning"; readonly providerId: string }
  | { readonly generation: number; readonly kind: "core-restart" }
  | {
      readonly kind: "core-starting";
      readonly stage: "http" | "migration" | "providers";
    }
  | {
      readonly code: string;
      readonly kind: "migration-error";
      readonly migrationId: string;
    }
  | { readonly kind: "normal" }
  | {
      readonly kind: "provider-probing-unavailable";
      readonly unavailableProviderIds: readonly string[];
    }
  | {
      readonly kind: "replay-gap";
      readonly phase: "paused" | "replacing" | "resuming";
    }
  | { readonly activeTurnId: string; readonly kind: "session-busy" }
  | {
      readonly afterSeq: number;
      readonly attempt: number;
      readonly kind: "sse-reconnecting";
    }
  | { readonly kind: "turn-cancelling"; readonly sessionId: string; readonly turnId: string }
  | {
      readonly code: string;
      readonly kind: "turn-failed";
      readonly message: string;
      readonly turnId: string;
    }
  | { readonly kind: "turn-interrupted"; readonly turnId: string }
  | { readonly kind: "turn-running"; readonly sessionId: string; readonly turnId: string };

export type RuntimePresentationKind = RuntimePresentation["kind"];

export interface SaasFeatureState {
  readonly agentDrafts: Readonly<Record<AgentId, string>>;
  readonly agentMessages: Readonly<Record<AgentId, readonly AgentMessage[]>>;
  readonly cronEnabled: Readonly<Record<string, boolean>>;
  readonly harnessHookOn: Readonly<Record<string, boolean>>;
  readonly harnessMcpOn: Readonly<Record<string, boolean>>;
  readonly harnessRunningWorkflow: string | null;
  readonly queueAssignees: Readonly<Record<string, AgentId | undefined>>;
  readonly queueStatuses: Readonly<Record<string, QueueStatus>>;
  readonly sessionCategory: string;
  readonly sessionDepth: string;
  readonly sessionExportState: "idle" | "pending" | "ready";
  readonly sessionFormat: string;
  readonly sessionQuery: string;
  readonly sessionSyncEnabled: boolean;
  readonly sessionSyncState: "idle" | "pending" | "ready";
  readonly settingsAgentEnabled: Readonly<Record<AgentId, boolean>>;
  readonly settingsModels: Readonly<Record<AgentId, string>>;
  readonly settingsNotifyDone: boolean;
  readonly settingsNotifyWait: boolean;
}

export interface SaasState {
  readonly accent: string;
  readonly chat: ChatViewSnapshot | null;
  readonly collapsedSidebar: boolean;
  readonly connection: ConnectionState;
  readonly conversationDirectory: string;
  readonly dataRevision: number | null;
  readonly dashboardVisible: boolean;
  readonly features: SaasFeatureState | null;
  readonly fixture: SaasFixture | null;
  readonly homeAgentId: AgentId;
  readonly homeDraft: string;
  readonly homeMenu: MenuKind;
  readonly homeMode: "auto" | "manual";
  readonly homeProject: HomeProjectSelection;
  readonly notificationOpen: boolean;
  readonly route: Route;
  readonly sidebarVisibility: Readonly<Record<SidebarVisibilityKey, boolean>>;
  readonly theme: "dark" | "light";
}

export type SaasAction =
  | {
      readonly agentId: AgentId;
      readonly last: string;
      readonly status: AgentStatus;
      readonly task: string;
      readonly type: "agent.runtime";
    }
  | {
      readonly mode: DataMode;
      readonly snapshot: SaasDataSnapshot;
      readonly type: "data.loaded";
    }
  | { readonly message: string; readonly type: "data.failed" }
  | { readonly type: "data.retry" }
  | { readonly type: "data.source-changing" }
  | { readonly snapshot: SaasDataSnapshot; readonly type: "data.snapshot" }
  | { readonly agentId: AgentId; readonly draft: string; readonly type: "agent.draft" }
  | { readonly agentId: AgentId; readonly message: AgentMessage; readonly type: "agent.message" }
  | {
      readonly agentId: AgentId;
      readonly approved: boolean;
      readonly messageId: string;
      readonly type: "agent.approval";
    }
  | { readonly id: string; readonly type: "cron.toggle" }
  | { readonly id: string; readonly type: "harness.hook-toggle" }
  | { readonly id: string; readonly type: "harness.mcp-toggle" }
  | { readonly id: string | null; readonly type: "harness.workflow" }
  | {
      readonly agentId: AgentId | undefined;
      readonly taskId: string;
      readonly type: "queue.assignee";
    }
  | { readonly status: QueueStatus; readonly taskId: string; readonly type: "queue.status" }
  | { readonly category: string; readonly type: "sessions.category" }
  | { readonly depth: string; readonly type: "sessions.depth" }
  | {
      readonly state: "idle" | "pending" | "ready";
      readonly type: "sessions.export-state";
    }
  | { readonly format: string; readonly type: "sessions.format" }
  | { readonly query: string; readonly type: "sessions.query" }
  | { readonly enabled: boolean; readonly type: "sessions.sync-enabled" }
  | {
      readonly state: "idle" | "pending" | "ready";
      readonly type: "sessions.sync-state";
    }
  | { readonly agentId: AgentId; readonly type: "settings.agent-enabled" }
  | { readonly agentId: AgentId; readonly model: string; readonly type: "settings.model" }
  | { readonly type: "settings.notify-done" }
  | { readonly type: "settings.notify-wait" }
  | { readonly agentId: AgentId; readonly type: "home.agent" }
  | { readonly draft: string; readonly type: "home.draft" }
  | { readonly menu: MenuKind; readonly type: "home.menu" }
  | { readonly mode: "auto" | "manual"; readonly type: "home.mode" }
  | { readonly project: HomeProjectSelection; readonly type: "home.project" }
  | { readonly route: Route; readonly type: "navigate" }
  | { readonly agentId: AgentId; readonly type: "notifications.read-agent" }
  | { readonly id: string; readonly type: "notifications.read" }
  | { readonly type: "notifications.mark-all" }
  | { readonly type: "notifications.toggle" }
  | { readonly type: "sidebar.toggle" }
  | { readonly collapsed: boolean; readonly type: "sidebar.set" }
  | { readonly type: "settings.dashboard-visible" }
  | { readonly key: SidebarVisibilityKey; readonly type: "settings.sidebar-visible" }
  | { readonly accent: string; readonly type: "theme.accent" }
  | { readonly theme: "dark" | "light"; readonly type: "theme.mode" };

export interface RouteMeta {
  readonly label: string;
  readonly subtitle: string;
}
