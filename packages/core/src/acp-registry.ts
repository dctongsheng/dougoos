import { basename } from "node:path";

import {
  AcpRuntimeError,
  DefaultAgentSessionRegistry,
  errorPayload,
  type AgentProvider,
  type AgentSessionHandle,
  type AgentSessionRegistry,
  type AgentTurnHandle,
  type SanitizedProcessEnv,
} from "@dougoos/acp";
import {
  AgentProviderRegistry,
  AgentCliDiscovery,
  type AgentCliDiscoveryPort,
  createBuiltinProviders,
  providerProcessEnvironment,
} from "@dougoos/providers";
import {
  AgentRuntimeEventSchema,
  ProviderDoctorResultSchema,
  ProviderSchema,
  TitleSchema,
  type ActiveTurnStatus,
  type AgentRuntimeEvent,
  type ErrorPayload,
  type ListAgentCliInstallationsResponse,
  type Provider,
  type ProviderDoctorResult,
} from "@dougoos/shared";

import type {
  CancelRegistryTurnInput,
  CoreRegistry,
  CreateRegistrySessionInput,
  RegistryEventListener,
  ResolveRegistryApprovalInput,
  StartRegistryTurnInput,
} from "./types.js";
import { RotatingAgentLog } from "./local-agent-log.js";

const DEFAULT_MAX_AGENT_PROCESSES = 4;
const DEFAULT_IDLE_PROCESS_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_CRASH_BACKOFF_BASE_MS = 250;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

interface ManagedTurn {
  readonly input: StartRegistryTurnInput;
  readonly rejectStart: (error: unknown) => void;
  readonly resolveStart: (handle: AgentTurnHandle) => void;
  dispatched: boolean;
  handle: AgentTurnHandle | null;
  readonly start: Promise<AgentTurnHandle>;
  status: ActiveTurnStatus | "terminal";
}

interface ManagedSession {
  readonly cwd: string;
  handle: AgentSessionHandle | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  readonly providerId: string;
  readonly turns: Map<string, ManagedTurn>;
  unsubscribe: (() => void) | null;
}

interface ProviderBreaker {
  failures: number;
  nextRetryAt: number;
  open: boolean;
}

export interface AcpCoreRegistryOptions {
  readonly cliDiscovery?: AgentCliDiscoveryPort;
  readonly circuitBreakerThreshold?: number;
  readonly clock?: () => string;
  readonly crashBackoffBaseMs?: number;
  readonly doctorCwd?: string;
  readonly environment?: SanitizedProcessEnv;
  readonly idleProcessTimeoutMs?: number;
  readonly localLogDirectory?: string;
  readonly maxAgentProcesses?: number;
  readonly providers?: readonly AgentProvider[];
  readonly sessionRegistry?: AgentSessionRegistry;
}

function providerSummary(provider: AgentProvider, result: ProviderDoctorResult): Provider {
  if (result.status === "available") {
    return ProviderSchema.parse({
      capabilities: result.capabilities,
      checkedAt: result.checkedAt,
      displayName: provider.displayName,
      id: provider.id,
      processPolicy: provider.processPolicy,
      status: "available",
      version: result.version,
    });
  }
  if (result.status === "handshake_failed") {
    return ProviderSchema.parse({
      capabilities: null,
      checkedAt: result.checkedAt,
      displayName: provider.displayName,
      id: provider.id,
      processPolicy: provider.processPolicy,
      reason: "The ACP handshake failed.",
      remediation: "Retry Provider doctor, then repair or reinstall the locked adapter.",
      status: "handshake_failed",
      ...(result.version === undefined ? {} : { version: result.version }),
    });
  }
  return ProviderSchema.parse({
    capabilities: null,
    checkedAt: result.checkedAt,
    displayName: provider.displayName,
    id: provider.id,
    processPolicy: provider.processPolicy,
    reason: result.reason,
    remediation: result.remediation,
    status: result.status,
    ...(result.version === undefined ? {} : { version: result.version }),
  });
}

function safeFailure(error: unknown): ErrorPayload {
  return error instanceof AcpRuntimeError
    ? error.payload
    : errorPayload("AGENT_FAILED", true, {
        operation: "create_turn",
        phase: "turn",
      });
}

export class AcpCoreRegistry implements CoreRegistry {
  readonly #agentLog: RotatingAgentLog | null;
  readonly #circuitBreakerThreshold: number;
  readonly #clock: () => string;
  readonly #cliDiscovery: AgentCliDiscoveryPort;
  readonly #crashBackoffBaseMs: number;
  readonly #doctorCwd: string;
  readonly #environment: SanitizedProcessEnv;
  readonly #idleProcessTimeoutMs: number;
  readonly #listeners = new Set<RegistryEventListener>();
  readonly #maxAgentProcesses: number;
  readonly #pendingTurns: ManagedTurn[] = [];
  readonly #providerBreakers = new Map<string, ProviderBreaker>();
  readonly #providerRegistry: AgentProviderRegistry;
  readonly #providers: readonly AgentProvider[];
  readonly #sessionRegistry: AgentSessionRegistry;
  readonly #sessions = new Map<string, ManagedSession>();
  readonly #summaries = new Map<string, Provider>();

  #closed = false;
  #dispatchPromise: Promise<void> | null = null;
  #initializePromise: Promise<void> | null = null;

  constructor(options: AcpCoreRegistryOptions = {}) {
    this.#agentLog =
      options.localLogDirectory === undefined
        ? null
        : new RotatingAgentLog({ directory: options.localLogDirectory });
    this.#circuitBreakerThreshold =
      options.circuitBreakerThreshold ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#crashBackoffBaseMs = options.crashBackoffBaseMs ?? DEFAULT_CRASH_BACKOFF_BASE_MS;
    this.#doctorCwd = options.doctorCwd ?? process.cwd();
    this.#environment = options.environment ?? providerProcessEnvironment();
    this.#cliDiscovery =
      options.cliDiscovery ?? new AgentCliDiscovery({ environment: this.#environment });
    this.#idleProcessTimeoutMs = options.idleProcessTimeoutMs ?? DEFAULT_IDLE_PROCESS_TIMEOUT_MS;
    this.#maxAgentProcesses = options.maxAgentProcesses ?? DEFAULT_MAX_AGENT_PROCESSES;
    if (this.#idleProcessTimeoutMs < 1) {
      throw new TypeError("idleProcessTimeoutMs must be positive");
    }
    if (this.#maxAgentProcesses < 1) {
      throw new TypeError("maxAgentProcesses must be positive");
    }
    if (this.#crashBackoffBaseMs < 1) {
      throw new TypeError("crashBackoffBaseMs must be positive");
    }
    if (this.#circuitBreakerThreshold < 2) {
      throw new TypeError("circuitBreakerThreshold must be at least 2");
    }
    this.#providers = options.providers ?? createBuiltinProviders(this.#cliDiscovery);
    this.#providerRegistry = new AgentProviderRegistry(this.#providers);
    this.#sessionRegistry =
      options.sessionRegistry ??
      new DefaultAgentSessionRegistry({
        clock: this.#clock,
        environment: this.#environment,
        maxActiveSessions: this.#maxAgentProcesses,
        ...(this.#agentLog === null
          ? {}
          : { onAgentStderr: (entry) => this.#agentLog?.write(entry) }),
        providers: this.#providers,
      });
    for (const provider of this.#providers) {
      this.#providerBreakers.set(provider.id, {
        failures: 0,
        nextRetryAt: 0,
        open: false,
      });
      this.#summaries.set(
        provider.id,
        ProviderSchema.parse({
          capabilities: null,
          checkedAt: this.#now(),
          displayName: provider.displayName,
          id: provider.id,
          processPolicy: provider.processPolicy,
          status: "probing",
        }),
      );
    }
  }

  async cancelTurn(input: CancelRegistryTurnInput): Promise<"cancelled" | "cancelling"> {
    const managed = this.#sessions.get(input.sessionId);
    const turn = managed?.turns.get(input.turnId);
    if (managed === undefined || turn === undefined || turn.status === "terminal") {
      return "cancelled";
    }
    if (!turn.dispatched) {
      const pendingIndex = this.#pendingTurns.indexOf(turn);
      if (pendingIndex >= 0) this.#pendingTurns.splice(pendingIndex, 1);
      turn.dispatched = true;
      this.#emitEvent(input.sessionId, input.turnId, {
        from: "queued",
        status: "starting",
        type: "turn_state",
      });
      this.#emitEvent(input.sessionId, input.turnId, {
        from: "starting",
        status: "running",
        type: "turn_state",
      });
      this.#emitEvent(input.sessionId, input.turnId, {
        from: "running",
        status: "cancelling",
        type: "turn_state",
      });
      this.#emitEvent(input.sessionId, input.turnId, {
        from: "cancelling",
        status: "cancelled",
        stopReason: "cancelled",
        type: "turn_end",
      });
      turn.rejectStart(
        new AcpRuntimeError(
          errorPayload("TURN_NOT_CANCELLABLE", false, {
            operation: "cancel",
            phase: "turn",
          }),
        ),
      );
      managed.turns.delete(input.turnId);
      return "cancelled";
    }
    try {
      const handle = await turn.start;
      if (managed.turns.get(input.turnId)?.status === "terminal") return "cancelled";
      await handle.cancel();
      return managed.turns.get(input.turnId)?.status === "terminal" ? "cancelled" : "cancelling";
    } catch {
      return "cancelled";
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const turn of this.#pendingTurns.splice(0)) {
      turn.rejectStart(
        new AcpRuntimeError(errorPayload("AGENT_PROCESS_CRASHED", false, { phase: "turn" })),
      );
    }
    for (const session of this.#sessions.values()) {
      if (session.idleTimer !== null) clearTimeout(session.idleTimer);
      session.unsubscribe?.();
    }
    this.#sessions.clear();
    this.#listeners.clear();
    try {
      await this.#sessionRegistry.disposeAll();
    } finally {
      await this.#agentLog?.close();
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const managed = this.#sessions.get(sessionId);
    if (managed === undefined) return;
    if (managed.idleTimer !== null) clearTimeout(managed.idleTimer);
    managed.unsubscribe?.();
    this.#sessions.delete(sessionId);
    if (managed.handle !== null) await managed.handle.dispose();
  }

  async createSession(input: CreateRegistrySessionInput) {
    if (this.#closed) {
      throw new AcpRuntimeError(
        errorPayload("PROVIDER_UNAVAILABLE", false, {
          operation: "create_session",
          phase: "session",
          providerId: input.providerId,
        }),
      );
    }
    const provider = this.#providerRegistry.get(input.providerId);
    if (provider === undefined) {
      throw new AcpRuntimeError(
        errorPayload("PROVIDER_UNAVAILABLE", false, {
          operation: "create_session",
          phase: "session",
          providerId: input.providerId,
        }),
      );
    }
    this.#assertProviderReady(input.providerId);
    if (!(await this.#makeProcessSlot(input.sessionId))) {
      throw new AcpRuntimeError(
        errorPayload("ACTIVE_SESSION_LIMIT_REACHED", true, {
          limit: this.#maxAgentProcesses,
          phase: "session",
        }),
      );
    }
    const handle = await this.#sessionRegistry.create({
      cwd: input.cwd,
      providerId: input.providerId,
      sessionId: input.sessionId,
    });
    const managed: ManagedSession = {
      cwd: input.cwd,
      handle,
      idleTimer: null,
      providerId: input.providerId,
      turns: new Map(),
      unsubscribe: handle.subscribe((event) => this.#forwardEvent(event)),
    };
    this.#sessions.set(input.sessionId, managed);
    this.#scheduleIdleClose(input.sessionId, managed);
    const workspaceName = basename(input.cwd).slice(0, 96);
    return {
      capabilities: handle.capabilities,
      providerSessionId: handle.providerSessionId,
      title: TitleSchema.parse(
        `${provider.displayName}${workspaceName.length === 0 ? "" : ` · ${workspaceName}`}`,
      ),
    };
  }

  async doctor(providerId: string): Promise<ProviderDoctorResult> {
    const provider = this.#providerRegistry.get(providerId);
    if (provider === undefined) {
      return ProviderDoctorResultSchema.parse({
        checkedAt: this.#now(),
        providerId,
        reason: "The Provider is not registered.",
        remediation: "Select a supported Provider, then retry doctor.",
        status: "unavailable",
      });
    }
    const result = await this.#providerRegistry.doctor(providerId, {
      clock: this.#clock,
      cwd: this.#doctorCwd,
      environment: this.#environment,
      ...(this.#agentLog === null
        ? {}
        : { onAgentStderr: (entry) => this.#agentLog?.write(entry) }),
    });
    this.#summaries.set(providerId, providerSummary(provider, result));
    if (result.status === "available") this.#resetProviderBreaker(providerId);
    return result;
  }

  initialize(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Provider Registry is closed"));
    this.#initializePromise ??= (async () => {
      const results = await this.#providerRegistry.doctorAll({
        clock: this.#clock,
        cwd: this.#doctorCwd,
        environment: this.#environment,
        ...(this.#agentLog === null
          ? {}
          : { onAgentStderr: (entry) => this.#agentLog?.write(entry) }),
      });
      for (const result of results) {
        const provider = this.#providerRegistry.get(result.providerId);
        if (provider !== undefined) {
          this.#summaries.set(provider.id, providerSummary(provider, result));
        }
      }
    })();
    return this.#initializePromise;
  }

  listProviders(): readonly Provider[] {
    return this.#providers.flatMap((provider) => {
      const summary = this.#summaries.get(provider.id);
      return summary === undefined ? [] : [summary];
    });
  }

  listAgentCliInstallations(
    options: { readonly force?: boolean } = {},
  ): Promise<ListAgentCliInstallationsResponse> {
    return this.#cliDiscovery.scan(options);
  }

  onEvent(listener: RegistryEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async resolveApproval(input: ResolveRegistryApprovalInput): Promise<void> {
    const managed = this.#sessions.get(input.sessionId);
    const turn = managed?.turns.get(input.turnId);
    if (
      managed === undefined ||
      managed.handle === null ||
      turn === undefined ||
      turn.status === "terminal"
    ) {
      throw new AcpRuntimeError(
        errorPayload("APPROVAL_NOT_FOUND", false, {
          operation: "resolve_approval",
          phase: "turn",
        }),
      );
    }
    await turn.start;
    await managed.handle.resolveApproval(input.requestId, input.optionId);
  }

  startTurn(input: StartRegistryTurnInput): void {
    const managed = this.#sessions.get(input.sessionId);
    if (managed === undefined) {
      this.#emitTurnFailure(input, "queued", safeFailure(new Error("missing session")));
      return;
    }
    if (managed.idleTimer !== null) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
    const started = deferred<AgentTurnHandle>();
    const record: ManagedTurn = {
      dispatched: false,
      handle: null,
      input,
      rejectStart: started.reject,
      resolveStart: started.resolve,
      start: started.promise,
      status: "queued",
    };
    void record.start.catch(() => undefined);
    managed.turns.set(input.turnId, record);
    this.#pendingTurns.push(record);
    void this.#dispatchTurns();
  }

  #dispatchTurns(): Promise<void> {
    if (this.#dispatchPromise !== null) return this.#dispatchPromise;
    const dispatch = (async () => {
      while (!this.#closed) {
        const turn = this.#pendingTurns[0];
        if (turn === undefined) return;
        const managed = this.#sessions.get(turn.input.sessionId);
        if (managed === undefined) {
          this.#pendingTurns.shift();
          turn.dispatched = true;
          turn.rejectStart(
            new AcpRuntimeError(
              errorPayload("PROVIDER_UNAVAILABLE", false, {
                operation: "create_turn",
                phase: "session",
              }),
            ),
          );
          if (turn.status !== "terminal") {
            this.#emitTurnFailure(
              turn.input,
              turn.status,
              safeFailure(new Error("missing session")),
            );
          }
          continue;
        }
        if (managed.handle === null) {
          if (!(await this.#makeProcessSlot(turn.input.sessionId))) return;
          try {
            await this.#openSession(turn.input.sessionId, managed);
          } catch (error) {
            this.#pendingTurns.shift();
            turn.dispatched = true;
            turn.rejectStart(error);
            if (turn.status !== "terminal") {
              this.#emitTurnFailure(turn.input, turn.status, safeFailure(error));
            }
            managed.turns.delete(turn.input.turnId);
            continue;
          }
        }
        this.#pendingTurns.shift();
        turn.dispatched = true;
        void this.#beginTurn(managed, turn);
      }
    })();
    this.#dispatchPromise = dispatch;
    void dispatch.finally(() => {
      if (this.#dispatchPromise === dispatch) this.#dispatchPromise = null;
    });
    return dispatch;
  }

  async #beginTurn(managed: ManagedSession, turn: ManagedTurn): Promise<void> {
    const handle = managed.handle;
    if (handle === null) return;
    const prompt = turn.input.request.content.map((part) => part.text).join("\n");
    try {
      const turnHandle = await handle.startTurn({
        text: prompt,
        turnId: turn.input.turnId,
      });
      turn.handle = turnHandle;
      turn.resolveStart(turnHandle);
      await turnHandle.completion;
    } catch (error) {
      turn.rejectStart(error);
      if (turn.status !== "terminal") {
        this.#emitTurnFailure(turn.input, turn.status, safeFailure(error));
      }
    } finally {
      if (turn.status === "terminal") {
        managed.turns.delete(turn.input.turnId);
      }
      if (managed.turns.size === 0) {
        this.#scheduleIdleClose(turn.input.sessionId, managed);
      }
      queueMicrotask(() => void this.#dispatchTurns());
    }
  }

  async #openSession(sessionId: string, managed: ManagedSession): Promise<void> {
    this.#assertProviderReady(managed.providerId);
    const handle = await this.#sessionRegistry.create({
      cwd: managed.cwd,
      providerId: managed.providerId,
      sessionId,
    });
    managed.handle = handle;
    managed.unsubscribe = handle.subscribe((event) => this.#forwardEvent(event));
  }

  async #makeProcessSlot(targetSessionId: string): Promise<boolean> {
    if (this.#sessionRegistry.list().length < this.#maxAgentProcesses) return true;
    const idle = [...this.#sessions.entries()].find(
      ([sessionId, managed]) =>
        sessionId !== targetSessionId &&
        managed.handle !== null &&
        managed.handle.state === "idle" &&
        managed.turns.size === 0,
    );
    if (idle === undefined) return false;
    await this.#suspendSession(idle[0], idle[1]);
    return true;
  }

  async #suspendSession(sessionId: string, managed: ManagedSession): Promise<void> {
    if (this.#sessions.get(sessionId) !== managed) return;
    if (managed.handle === null || managed.turns.size > 0) return;
    if (managed.idleTimer !== null) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
    const handle = managed.handle;
    managed.unsubscribe?.();
    managed.unsubscribe = null;
    managed.handle = null;
    await handle.dispose();
    if (!this.#closed) void this.#dispatchTurns();
  }

  #scheduleIdleClose(sessionId: string, managed: ManagedSession): void {
    if (managed.handle === null || managed.handle.state !== "idle" || managed.turns.size > 0) {
      return;
    }
    if (managed.idleTimer !== null) clearTimeout(managed.idleTimer);
    managed.idleTimer = setTimeout(() => {
      managed.idleTimer = null;
      void this.#suspendSession(sessionId, managed);
    }, this.#idleProcessTimeoutMs);
  }

  #emit(runtimeEvent: AgentRuntimeEvent): void {
    for (const listener of this.#listeners) listener(runtimeEvent);
  }

  #emitTurnFailure(
    input: StartRegistryTurnInput,
    status: ActiveTurnStatus,
    error: ErrorPayload,
  ): void {
    let current = status;
    if (current === "awaiting_approval" || current === "cancelling") {
      this.#emitEvent(input.sessionId, input.turnId, {
        from: current,
        status: "interrupted",
        stopReason: "interrupted",
        type: "turn_end",
      });
      return;
    }
    if (current === "queued") {
      this.#emitEvent(input.sessionId, input.turnId, {
        from: "queued",
        status: "starting",
        type: "turn_state",
      });
      current = "starting";
    }
    if (current === "starting") {
      this.#emitEvent(input.sessionId, input.turnId, {
        from: "starting",
        status: "running",
        type: "turn_state",
      });
      current = "running";
    }
    this.#emitEvent(input.sessionId, input.turnId, {
      error,
      from: current,
      status: "failed",
      stopReason: "error",
      type: "turn_end",
    });
  }

  #emitEvent(sessionId: string, turnId: string | null, event: unknown): void {
    this.#forwardEvent(
      AgentRuntimeEventSchema.parse({
        event,
        occurredAt: this.#now(),
        sessionId,
        turnId,
      }),
    );
  }

  #forwardEvent(runtimeEvent: AgentRuntimeEvent): void {
    const managed = this.#sessions.get(runtimeEvent.sessionId);
    if (runtimeEvent.turnId !== null) {
      const turn = managed?.turns.get(runtimeEvent.turnId);
      if (turn !== undefined) {
        if (runtimeEvent.event.type === "turn_state") {
          turn.status = runtimeEvent.event.status;
        } else if (runtimeEvent.event.type === "turn_end") {
          turn.status = "terminal";
        }
      }
    }
    this.#emit(AgentRuntimeEventSchema.parse(runtimeEvent));
    if (
      managed !== undefined &&
      runtimeEvent.event.type === "session_error" &&
      runtimeEvent.event.error.code === "AGENT_PROCESS_CRASHED"
    ) {
      this.#recordProviderCrash(managed.providerId);
      managed.unsubscribe?.();
      managed.unsubscribe = null;
      managed.handle = null;
    }
    if (
      managed !== undefined &&
      runtimeEvent.event.type === "turn_end" &&
      runtimeEvent.event.status === "completed"
    ) {
      this.#resetProviderBreaker(managed.providerId);
    }
    if (
      managed !== undefined &&
      runtimeEvent.event.type === "session_state" &&
      runtimeEvent.event.state === "idle"
    ) {
      this.#scheduleIdleClose(runtimeEvent.sessionId, managed);
      queueMicrotask(() => void this.#dispatchTurns());
    }
  }

  #now(): string {
    return new Date(this.#clock()).toISOString();
  }

  #assertProviderReady(providerId: string): void {
    const breaker = this.#providerBreakers.get(providerId);
    if (breaker === undefined || (!breaker.open && Date.now() >= breaker.nextRetryAt)) return;
    throw new AcpRuntimeError(
      errorPayload("PROVIDER_UNAVAILABLE", true, {
        operation: "create_session",
        phase: "spawn",
        providerId,
        ...(breaker.open
          ? { status: "unavailable" }
          : { retryAfterMs: Math.max(1, breaker.nextRetryAt - Date.now()) }),
      }),
    );
  }

  #recordProviderCrash(providerId: string): void {
    const breaker = this.#providerBreakers.get(providerId);
    const provider = this.#providerRegistry.get(providerId);
    if (breaker === undefined || provider === undefined) return;
    breaker.failures += 1;
    breaker.nextRetryAt =
      Date.now() +
      Math.min(30_000, this.#crashBackoffBaseMs * 2 ** Math.max(0, breaker.failures - 1));
    breaker.open = breaker.failures >= this.#circuitBreakerThreshold;
    if (breaker.open) {
      this.#summaries.set(
        providerId,
        ProviderSchema.parse({
          capabilities: null,
          checkedAt: this.#now(),
          displayName: provider.displayName,
          id: provider.id,
          processPolicy: provider.processPolicy,
          reason: "The Provider circuit breaker is open after repeated process crashes.",
          remediation: "Run Provider doctor to verify the adapter and reset the circuit breaker.",
          status: "unavailable",
        }),
      );
    }
  }

  #resetProviderBreaker(providerId: string): void {
    const breaker = this.#providerBreakers.get(providerId);
    if (breaker === undefined) return;
    breaker.failures = 0;
    breaker.nextRetryAt = 0;
    breaker.open = false;
  }
}

export function createAcpCoreRegistry(options?: AcpCoreRegistryOptions): AcpCoreRegistry {
  return new AcpCoreRegistry(options);
}
