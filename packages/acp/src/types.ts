import type { InitializeResponse, SessionUpdate } from "@agentclientprotocol/sdk";
import type {
  AgentRuntimeEvent,
  AgentUiEvent,
  ErrorPayload,
  PermissionEnforcement,
  PermissionProfileDescriptor,
  ProviderCapabilitySnapshot,
  ProviderProcessPolicy,
  SessionPermissionSnapshot,
  SessionState,
  StopReason,
  TokenUsage,
} from "@dougoos/shared";

export type MaybePromise<T> = Promise<T> | T;
export type SanitizedProcessEnv = Readonly<Record<string, string>>;

export interface ProviderAvailability {
  readonly kind?: "incompatible" | "unavailable";
  readonly ok: boolean;
  readonly reason?: string;
  readonly remediation?: string;
  readonly version?: string;
}

export interface ResolvedAgentCommand {
  readonly args: readonly string[];
  readonly command: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Fixed, Provider-owned ACP configuration to apply after `session/new` and
   * before the first prompt. Renderer input can only select a declared profile;
   * it can never inject an arbitrary mode, config option, argv, or env value.
   */
  readonly sessionConfiguration?: ResolvedSessionPermissionConfiguration;
}

export interface ResolvedSessionConfigOption {
  readonly configId: string;
  readonly value: boolean | string;
}

export interface ResolvedSessionPermissionConfiguration {
  /**
   * Whether this profile intends DougoOS to immediately select an Agent
   * supplied allow option for ACP permission requests. The Registry still
   * verifies the selected profile semantic and lets interceptors reject.
   */
  readonly autoApprovePermissions?: boolean;
  readonly configOptions?: readonly ResolvedSessionConfigOption[];
  readonly modeId?: string;
}

/**
 * Provider-specific process discovery belongs in @dougoos/providers. This
 * protocol-owning port is the only surface the ACP runtime consumes.
 */
export interface AgentProvider {
  readonly defaultPermissionProfileId: string;
  readonly displayName: string;
  readonly id: string;
  /**
   * Compatibility summary for code that has not selected a Session profile
   * yet. It must equal the default profile's enforcement.
   */
  readonly permissionEnforcement: PermissionEnforcement;
  readonly permissionProfiles: readonly PermissionProfileDescriptor[];
  readonly processPolicy: ProviderProcessPolicy;
  available(): Promise<ProviderAvailability>;
  chooseAuthMethod(initialize: InitializeResponse, environment: SanitizedProcessEnv): string | null;
  normalizeMeta?(update: SessionUpdate): readonly AgentUiEvent[] | null;
  resolveCommand(context: {
    readonly env: SanitizedProcessEnv;
    readonly permissionProfileId: string;
  }): ResolvedAgentCommand;
}

export interface PromptContext {
  readonly cwd: string;
  readonly providerId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly text: string;
  readonly turnId: string;
}

export interface PermissionContext {
  readonly providerId: string;
  readonly request: {
    readonly options: readonly {
      readonly kind: string;
      readonly name: string;
      readonly optionId: string;
    }[];
    readonly toolCall: {
      readonly kind?: string | null;
      readonly status?: string | null;
      readonly title?: string | null;
      readonly toolCallId: string;
    };
  };
  readonly requestId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly turnId: string;
}

export type PermissionVerdict = "allow" | "ask" | "reject";
export type BeforePromptVerdict = "allow" | "reject";

export interface SessionInterceptor {
  afterEvent?(event: AgentRuntimeEvent): Promise<void>;
  beforePrompt?(context: PromptContext): Promise<BeforePromptVerdict>;
  onPermissionRequest?(context: PermissionContext): Promise<PermissionVerdict>;
}

export interface AgentTurnResult {
  readonly error?: ErrorPayload;
  readonly status: "cancelled" | "completed" | "failed" | "interrupted";
  readonly stopReason: StopReason;
  readonly usage?: TokenUsage;
}

export interface AgentTurnHandle {
  readonly completion: Promise<AgentTurnResult>;
  readonly turnId: string;
  cancel(): Promise<void>;
}

export interface StartAgentTurnInput {
  readonly text: string;
  readonly turnId: string;
}

export interface AgentSessionHandle {
  readonly capabilities: ProviderCapabilitySnapshot;
  readonly cwd: string;
  readonly permission: SessionPermissionSnapshot;
  readonly providerId: string;
  readonly providerSessionId: string;
  readonly sessionId: string;
  readonly state: SessionState;
  dispose(): Promise<void>;
  resolveApproval(requestId: string, optionId: string | null): Promise<void>;
  startTurn(input: StartAgentTurnInput): Promise<AgentTurnHandle>;
  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void;
}

export interface CreateAgentSessionOptions {
  readonly cwd: string;
  readonly permissionProfileId?: string;
  readonly providerId: string;
  readonly sessionId?: string;
}

export interface AgentSessionRegistry {
  create(options: CreateAgentSessionOptions): Promise<AgentSessionHandle>;
  disposeAll(): Promise<void>;
  get(sessionId: string): AgentSessionHandle | undefined;
  list(): readonly AgentSessionHandle[];
}

export interface AgentStderrLogEntry {
  readonly occurredAt: string;
  readonly providerId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Security-safe observability emitted for automatic ACP permission decisions.
 * It intentionally excludes command text, tool arguments, file content,
 * environment values, and free-form Agent titles.
 */
export interface AgentPermissionAuditEntry {
  readonly cwd: string;
  readonly effectiveProfileId: string;
  readonly occurredAt: string;
  readonly optionId: string;
  readonly providerId: string;
  readonly requestId: string;
  readonly result: "allowed";
  readonly sessionId: string;
  readonly source: "permission_profile";
  readonly toolKind?: string;
  readonly turnId: string;
}

export interface AgentSessionRegistryOptions {
  readonly approvalTimeoutMs?: number;
  readonly clock?: () => string;
  readonly deltaWindowMs?: number;
  readonly environment?: SanitizedProcessEnv;
  readonly handshakeTimeoutMs?: number;
  readonly interceptorTimeoutMs?: number;
  readonly interceptors?: readonly SessionInterceptor[];
  readonly maxActiveSessions?: number;
  readonly observerQueueLimit?: number;
  readonly onAgentStderr?: (entry: AgentStderrLogEntry) => void;
  readonly onObserverError?: (error: unknown) => void;
  /**
   * Automatic approval is fail-closed until this callback completes. Durable
   * consumers should only resolve after the audit record has been persisted.
   */
  readonly onPermissionAudit?: (entry: AgentPermissionAuditEntry) => MaybePromise<void>;
  readonly providers: readonly AgentProvider[];
  readonly stderrByteLimit?: number;
}

export interface NormalizationContext {
  readonly messageId: (kind: "message" | "note" | "thought") => string;
  readonly provider: AgentProvider;
}
