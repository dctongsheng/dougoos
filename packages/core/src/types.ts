import type {
  AgentRuntimeEvent,
  CreateSessionRequest,
  CreateTurnRequest,
  ListAgentCliInstallationsResponse,
  Provider,
  ProviderCapabilitySnapshot,
  ProviderDoctorResult,
} from "@dougoos/shared";
import type { DougoStorage } from "@dougoos/storage";

export type MaybePromise<T> = Promise<T> | T;
export type RegistryEventListener = (event: AgentRuntimeEvent) => void;

export interface RegistrySession {
  readonly capabilities: ProviderCapabilitySnapshot;
  readonly providerSessionId: string;
  readonly title: string;
}

export interface CreateRegistrySessionInput extends CreateSessionRequest {
  readonly sessionId: string;
}

export interface StartRegistryTurnInput {
  readonly request: CreateTurnRequest;
  readonly sessionId: string;
  readonly turnId: string;
}

export interface CancelRegistryTurnInput {
  readonly sessionId: string;
  readonly turnId: string;
}

export interface ResolveRegistryApprovalInput extends CancelRegistryTurnInput {
  readonly optionId: string;
  readonly requestId: string;
}

/**
 * The Core depends on this narrow port while `acp-001` owns the concrete
 * registry. Accepting a command means it has been queued locally; it never
 * means the Provider Turn has completed.
 */
export interface CoreRegistry {
  cancelTurn(input: CancelRegistryTurnInput): MaybePromise<"cancelled" | "cancelling">;
  close?(): MaybePromise<void>;
  closeSession?(sessionId: string): MaybePromise<void>;
  createSession(input: CreateRegistrySessionInput): MaybePromise<RegistrySession>;
  doctor(providerId: string): MaybePromise<ProviderDoctorResult>;
  initialize(): MaybePromise<void>;
  listAgentCliInstallations?(options?: {
    readonly force?: boolean;
  }): MaybePromise<ListAgentCliInstallationsResponse>;
  listProviders(): MaybePromise<readonly Provider[]>;
  onEvent(listener: RegistryEventListener): () => void;
  resolveApproval(input: ResolveRegistryApprovalInput): MaybePromise<void>;
  startTurn(input: StartRegistryTurnInput): void;
}

export interface CoreDependencies {
  readonly appVersion: string;
  readonly clock?: () => string;
  readonly defaultConversationDirectory: string;
  /** Test seam; production always uses the 15-second default. */
  readonly eventStreamHeartbeatMs?: number;
  readonly eventIdFactory?: () => string;
  readonly instanceId?: string;
  readonly messageIdFactory?: () => string;
  readonly registry: CoreRegistry;
  readonly sessionIdFactory?: () => string;
  readonly storage: DougoStorage;
  readonly turnIdFactory?: () => string;
}

export interface CoreSecurityOptions {
  readonly allowedOrigins?: readonly string[];
  readonly bearerToken: string;
  /**
   * App-only tests set this up front. The real server installs its random
   * bound port before accepting authenticated business requests.
   */
  readonly boundPort?: number;
}
