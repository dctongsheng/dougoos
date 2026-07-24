import type { InitializeResponse, SessionUpdate } from "@agentclientprotocol/sdk";
import type {
  AgentRuntimeEvent,
  AgentUiEvent,
  ErrorPayload,
  PermissionEnforcement,
  ProviderCapabilitySnapshot,
  ProviderProcessPolicy,
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
}

/**
 * Provider-specific process discovery belongs in @dougoos/providers. This
 * protocol-owning port is the only surface the ACP runtime consumes.
 */
export interface AgentProvider {
  readonly displayName: string;
  readonly id: string;
  readonly permissionEnforcement: PermissionEnforcement;
  readonly processPolicy: ProviderProcessPolicy;
  available(): Promise<ProviderAvailability>;
  chooseAuthMethod(initialize: InitializeResponse, environment: SanitizedProcessEnv): string | null;
  normalizeMeta?(update: SessionUpdate): readonly AgentUiEvent[] | null;
  resolveCommand(context: { readonly env: SanitizedProcessEnv }): ResolvedAgentCommand;
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

export type PermissionVerdict = "ask" | "reject";
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
  readonly providers: readonly AgentProvider[];
  readonly stderrByteLimit?: number;
}

export interface NormalizationContext {
  readonly messageId: (kind: "message" | "note" | "thought") => string;
  readonly provider: AgentProvider;
}
