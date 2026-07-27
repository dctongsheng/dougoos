import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
  PROTOCOL_VERSION,
  RequestError,
  client,
  methods,
  ndJsonStream,
  type ClientConnection,
  type ClientRequestContext,
  type InitializeResponse,
  type JsonRpcId,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  AgentRuntimeEventSchema,
  CwdSchema,
  MessageIdSchema,
  OpaqueIdSchema,
  PromptSchema,
  ProviderCapabilitySnapshotSchema,
  ProviderIdSchema,
  SessionPermissionSnapshotSchema,
  SessionIdSchema,
  TurnIdSchema,
  type ActiveTurnStatus,
  type AgentRuntimeEvent,
  type AgentUiEvent,
  type PermissionProfileDescriptor,
  type ProviderCapabilitySnapshot,
  type SessionPermissionSnapshot,
  type SessionState,
  type StopReason,
} from "@dougoos/shared";

import { DeltaCoalescer } from "./delta-coalescer.js";
import { AcpRuntimeError, errorPayload, runtimeError, toRuntimeError } from "./errors.js";
import { InterceptorChain } from "./interceptors.js";
import { normalizeSessionUpdate } from "./normalizer.js";
import { DEFAULT_AGENT_STDERR_BYTE_LIMIT, observeAgentStderr } from "./stderr.js";
import type {
  AgentProvider,
  AgentPermissionAuditEntry,
  AgentSessionHandle,
  AgentSessionRegistry,
  AgentSessionRegistryOptions,
  AgentTurnHandle,
  AgentTurnResult,
  ResolvedAgentCommand,
  ResolvedSessionConfigOption,
  SanitizedProcessEnv,
  StartAgentTurnInput,
} from "./types.js";

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ACTIVE_SESSIONS = 32;
const PROCESS_STOP_GRACE_MS = 1_000;

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

function defaultEnvironment(): SanitizedProcessEnv {
  const allowed = [
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SHELL",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "USERPROFILE",
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(runtimeError("ACP_HANDSHAKE_FAILED", true, { phase: "handshake" }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizedRequestId(requestId: JsonRpcId): string {
  const raw = String(requestId ?? randomUUID());
  return raw.length <= 240 ? `acp-${raw}` : `acp-${randomUUID()}`;
}

function normalizedOpaqueId(value: string, prefix: string): string {
  if (OpaqueIdSchema.safeParse(value).success) return value;
  return `${prefix}-${createHash("sha256").update(value).digest("hex")}`;
}

function capabilitiesFromInitialize(
  initialize: InitializeResponse,
  negotiatedAt: string,
  permissionEnforcement: ProviderCapabilitySnapshot["permissionEnforcement"],
): ProviderCapabilitySnapshot {
  const session = initialize.agentCapabilities?.sessionCapabilities;
  return ProviderCapabilitySnapshotSchema.parse({
    clientProxy: { config: false, fileSystem: false, terminal: false },
    negotiatedAt,
    permissionEnforcement,
    protocolVersion: "1",
    session: {
      close: session?.close != null,
      delete: session?.delete != null,
      list: session?.list != null,
      load: initialize.agentCapabilities?.loadSession === true,
      resume: session?.resume != null,
    },
    turn: {
      cancel: true,
      images: initialize.agentCapabilities?.promptCapabilities?.image === true,
      prompt: true,
    },
  });
}

function permissionProfile(
  provider: AgentProvider,
  profileId: string,
): PermissionProfileDescriptor {
  const profile = provider.permissionProfiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) {
    throw runtimeError("PROVIDER_CAPABILITY_UNSUPPORTED", false, {
      operation: "create_session",
      phase: "session",
      providerId: provider.id,
    });
  }
  return profile;
}

function supportsAutomaticApproval(profile: PermissionProfileDescriptor): boolean {
  return profile.semantic === "auto_limited" || profile.semantic === "unrestricted";
}

function selectOptions(option: SessionConfigOption): readonly string[] {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) =>
    "options" in entry ? entry.options.map((nested) => nested.value) : [entry.value],
  );
}

function validatesConfigOption(
  available: readonly SessionConfigOption[],
  requested: ResolvedSessionConfigOption,
): boolean {
  const option = available.find((candidate) => candidate.id === requested.configId);
  if (option === undefined) return false;
  if (option.type === "boolean") {
    return typeof requested.value === "boolean";
  }
  return typeof requested.value === "string" && selectOptions(option).includes(requested.value);
}

function unsupportedPermissionConfiguration(providerId: string): AcpRuntimeError {
  return runtimeError("PROVIDER_CAPABILITY_UNSUPPORTED", false, {
    operation: "create_session",
    phase: "session",
    providerId,
  });
}

async function applyPermissionConfiguration(options: {
  readonly command: ResolvedAgentCommand;
  readonly connection: ClientConnection;
  readonly created: NewSessionResponse;
  readonly profile: PermissionProfileDescriptor;
  readonly providerId: string;
}): Promise<void> {
  const configuration = options.command.sessionConfiguration;
  if (configuration === undefined) return;
  if (
    configuration.autoApprovePermissions === true &&
    !supportsAutomaticApproval(options.profile)
  ) {
    throw unsupportedPermissionConfiguration(options.providerId);
  }

  if (configuration.modeId !== undefined) {
    const modes = options.created.modes;
    if (modes == null || !modes.availableModes.some((mode) => mode.id === configuration.modeId)) {
      throw unsupportedPermissionConfiguration(options.providerId);
    }
    if (modes.currentModeId !== configuration.modeId) {
      await options.connection.agent.request(methods.agent.session.setMode, {
        modeId: configuration.modeId,
        sessionId: options.created.sessionId,
      });
    }
  }

  const requestedOptions = configuration.configOptions ?? [];
  const availableOptions = options.created.configOptions ?? [];
  for (const requested of requestedOptions) {
    if (!validatesConfigOption(availableOptions, requested)) {
      throw unsupportedPermissionConfiguration(options.providerId);
    }
    await options.connection.agent.request(methods.agent.session.setConfigOption, {
      configId: requested.configId,
      sessionId: options.created.sessionId,
      value: requested.value,
      ...(typeof requested.value === "boolean" ? { type: "boolean" as const } : {}),
    });
  }
}

function stopReason(reason: PromptResponse["stopReason"]): StopReason {
  return reason;
}

const SAFE_PROCESS_SIGNALS = new Set([
  "SIGABRT",
  "SIGBUS",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGKILL",
  "SIGPIPE",
  "SIGQUIT",
  "SIGSEGV",
  "SIGTERM",
] as const);

function safeProcessSignal(
  signal: NodeJS.Signals | null,
):
  | "SIGABRT"
  | "SIGBUS"
  | "SIGFPE"
  | "SIGHUP"
  | "SIGILL"
  | "SIGINT"
  | "SIGKILL"
  | "SIGPIPE"
  | "SIGQUIT"
  | "SIGSEGV"
  | "SIGTERM"
  | null {
  return signal !== null && SAFE_PROCESS_SIGNALS.has(signal as never)
    ? (signal as Exclude<ReturnType<typeof safeProcessSignal>, null>)
    : null;
}

function signalProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall back to the direct child when the process group is already gone.
    }
  }
  if (process.platform === "win32" && signal === "SIGKILL" && pid !== undefined) {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
    });
    killer.once("error", () => undefined);
    return;
  }
  child.kill(signal);
}

async function stopProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const processIsActive = child.exitCode === null && child.signalCode === null;
  const exited = processIsActive
    ? new Promise<void>((resolve) => child.once("exit", () => resolve()))
    : Promise.resolve();
  signalProcessTree(child, "SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PROCESS_STOP_GRACE_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    signalProcessTree(child, "SIGKILL");
    await exited;
  } else if (process.platform !== "win32") {
    // The adapter leader may exit before descendants. A final group signal
    // ensures those descendants cannot outlive the owning Session.
    signalProcessTree(child, "SIGKILL");
  }
}

interface PendingApproval {
  readonly options: ReadonlyMap<
    string,
    {
      readonly kind: "allow" | "reject";
      readonly rawOptionId: string | null;
    }
  >;
  readonly requestId: string;
  readonly response: Deferred<RequestPermissionResponse>;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ActiveTurn {
  readonly abort: AbortController;
  readonly completion: Deferred<AgentTurnResult>;
  readonly messageIds: Map<"message" | "note" | "thought", string>;
  readonly turnId: string;
  status: ActiveTurnStatus;
}

class SessionTurnHandle implements AgentTurnHandle {
  readonly completion: Promise<AgentTurnResult>;
  readonly turnId: string;
  readonly #cancelTurn: () => Promise<void>;

  constructor(turn: ActiveTurn, cancelTurn: () => Promise<void>) {
    this.completion = turn.completion.promise;
    this.turnId = turn.turnId;
    this.#cancelTurn = cancelTurn;
  }

  cancel(): Promise<void> {
    return this.#cancelTurn();
  }
}

class AcpSession implements AgentSessionHandle {
  readonly capabilities: ProviderCapabilitySnapshot;
  readonly cwd: string;
  readonly permission: SessionPermissionSnapshot;
  readonly providerId: string;
  readonly providerSessionId: string;
  readonly sessionId: string;

  readonly #approvalTimeoutMs: number;
  readonly #acpSessionId: string;
  readonly #allowsAutomaticApproval: boolean;
  readonly #autoApprovePermissions: boolean;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #clock: () => string;
  readonly #connection: ClientConnection;
  readonly #delta: DeltaCoalescer;
  readonly #interceptors: InterceptorChain;
  readonly #listeners = new Set<(event: AgentRuntimeEvent) => void>();
  readonly #onClosed: () => void;
  readonly #onPermissionAudit:
    ((entry: AgentPermissionAuditEntry) => Promise<void> | void) | undefined;
  readonly #provider: AgentProvider;
  readonly #resolvedApprovalIds = new Set<string>();

  #approvalResolutionLock: Promise<void> | undefined;
  #currentTurn: ActiveTurn | undefined;
  #disposed = false;
  #pendingApproval: PendingApproval | undefined;
  #state: SessionState = "idle";

  constructor(options: {
    readonly approvalTimeoutMs: number;
    readonly allowsAutomaticApproval: boolean;
    readonly autoApprovePermissions: boolean;
    readonly capabilities: ProviderCapabilitySnapshot;
    readonly child: ChildProcessWithoutNullStreams;
    readonly clock: () => string;
    readonly connection: ClientConnection;
    readonly cwd: string;
    readonly deltaWindowMs: number;
    readonly interceptors: InterceptorChain;
    readonly onClosed: () => void;
    readonly onPermissionAudit?: (entry: AgentPermissionAuditEntry) => Promise<void> | void;
    readonly permission: SessionPermissionSnapshot;
    readonly provider: AgentProvider;
    readonly providerSessionId: string;
    readonly sessionId: string;
  }) {
    this.#approvalTimeoutMs = options.approvalTimeoutMs;
    this.#allowsAutomaticApproval = options.allowsAutomaticApproval;
    this.#autoApprovePermissions = options.autoApprovePermissions;
    this.capabilities = options.capabilities;
    this.#child = options.child;
    this.#clock = options.clock;
    this.#connection = options.connection;
    this.cwd = options.cwd;
    this.#interceptors = options.interceptors;
    this.#onClosed = options.onClosed;
    this.#onPermissionAudit = options.onPermissionAudit;
    this.permission = options.permission;
    this.#provider = options.provider;
    this.providerId = options.provider.id;
    this.#acpSessionId = options.providerSessionId;
    this.providerSessionId = normalizedOpaqueId(options.providerSessionId, "acp-session");
    this.sessionId = options.sessionId;
    this.#delta = new DeltaCoalescer(
      (event) => this.#emit(this.#currentTurn?.turnId ?? null, event),
      options.deltaWindowMs,
    );

    this.#child.once("exit", (code, signal) => this.#handleProcessExit(code, signal));
    this.#child.once("error", () => this.#handleProcessExit(null, null));
    void this.#connection.closed.then(() => this.#handleTransportClosed());
  }

  get state(): SessionState {
    return this.#state;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const turn = this.#currentTurn;
    if (turn !== undefined) {
      turn.abort.abort();
      await this.#cancelPendingApproval("cancelled");
      this.#delta.flushAll();
      this.#finishTurn({
        status: "interrupted",
        stopReason: "interrupted",
      });
    }

    if (this.capabilities.session.close) {
      await settleWithin(
        this.#connection.agent.request(methods.agent.session.close, {
          sessionId: this.#acpSessionId,
        }),
        PROCESS_STOP_GRACE_MS,
      );
    }
    this.#connection.close();
    await this.#stopProcess();
    this.#setState("closed");
    this.#listeners.clear();
    this.#onClosed();
  }

  async resolveApproval(requestId: string, optionId: string | null): Promise<void> {
    const pending = this.#pendingApproval;
    if (pending === undefined) {
      throw runtimeError(
        this.#resolvedApprovalIds.has(requestId)
          ? "APPROVAL_ALREADY_RESOLVED"
          : "APPROVAL_NOT_FOUND",
        false,
        {
          operation: "resolve_approval",
          phase: "turn",
        },
      );
    }
    if (pending.requestId !== requestId) {
      throw runtimeError("APPROVAL_NOT_FOUND", false, {
        operation: "resolve_approval",
        phase: "turn",
      });
    }
    const turn = this.#currentTurn;
    if (turn === undefined || turn.status !== "awaiting_approval") {
      throw runtimeError("APPROVAL_ALREADY_RESOLVED", false, {
        operation: "resolve_approval",
        phase: "turn",
      });
    }

    if (optionId === null) {
      await this.#resolvePendingApproval("cancelled", null, null);
      return;
    }
    const option = pending.options.get(optionId);
    if (option === undefined) {
      throw runtimeError("APPROVAL_OPTION_INVALID", false, {
        field: "optionId",
        operation: "resolve_approval",
        phase: "turn",
      });
    }
    if (option.rawOptionId === null) {
      await this.#resolvePendingApproval("rejected", { type: "reject" }, null);
      return;
    }
    await this.#resolvePendingApproval(
      option.kind === "allow" ? "allowed" : "rejected",
      option.kind === "allow" ? { optionId, type: "option" } : { type: "reject" },
      option.rawOptionId,
    );
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurnHandle> {
    if (this.#disposed || this.#state === "closed" || this.#state === "crashed") {
      throw runtimeError("AGENT_PROCESS_CRASHED", true, { phase: "turn" });
    }
    if (this.#currentTurn !== undefined) {
      throw runtimeError("ACTIVE_SESSION_LIMIT_REACHED", true, {
        limit: 1,
        phase: "turn",
      });
    }
    const turnId = TurnIdSchema.parse(input.turnId);
    const text = PromptSchema.parse(input.text);
    const turn: ActiveTurn = {
      abort: new AbortController(),
      completion: deferred<AgentTurnResult>(),
      messageIds: new Map(),
      status: "queued",
      turnId,
    };
    this.#currentTurn = turn;
    this.#transitionTurn("starting");

    const verdict = await this.#interceptors.beforePrompt({
      cwd: this.cwd,
      providerId: this.providerId,
      sessionId: this.sessionId,
      signal: turn.abort.signal,
      text,
      turnId,
    });
    this.#transitionTurn("running");
    if (verdict === "reject") {
      this.#finishTurn({
        error: errorPayload("AGENT_FAILED", false, {
          operation: "create_turn",
          phase: "turn",
        }),
        status: "failed",
        stopReason: "error",
      });
      return new SessionTurnHandle(turn, () => Promise.resolve());
    }

    const prompt = this.#connection.agent.request(
      methods.agent.session.prompt,
      {
        prompt: [{ text, type: "text" }],
        sessionId: this.#acpSessionId,
      },
      { cancellationSignal: turn.abort.signal },
    );
    void this.#completePrompt(turn, prompt);
    return new SessionTurnHandle(turn, () => this.#cancelTurn(turnId));
  }

  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async handlePermission(
    context: ClientRequestContext<RequestPermissionRequest>,
  ): Promise<RequestPermissionResponse> {
    const turn = this.#currentTurn;
    if (
      turn === undefined ||
      turn.status !== "running" ||
      context.params.sessionId !== this.#acpSessionId
    ) {
      return { outcome: { outcome: "cancelled" } };
    }
    if (this.#pendingApproval !== undefined) {
      return { outcome: { outcome: "cancelled" } };
    }

    const requestId = normalizedRequestId(context.requestId);
    if (this.#resolvedApprovalIds.has(requestId)) {
      return { outcome: { outcome: "cancelled" } };
    }
    const options = new Map<
      string,
      { readonly kind: "allow" | "reject"; readonly rawOptionId: string | null }
    >();
    const normalizedOptions = context.params.options.slice(0, 31).map((option) => {
      const optionId =
        option.optionId.length <= 240 ? `acp-${option.optionId}` : `acp-${randomUUID()}`;
      const kind: "allow" | "reject" = option.kind.startsWith("allow") ? "allow" : "reject";
      options.set(optionId, { kind, rawOptionId: option.optionId });
      return {
        kind,
        label: option.name.slice(0, 128) || (kind === "allow" ? "Allow" : "Reject"),
        optionId,
      };
    });
    if (!normalizedOptions.some((option) => option.kind === "reject")) {
      const optionId = `local-reject-${randomUUID()}`;
      options.set(optionId, { kind: "reject", rawOptionId: null });
      normalizedOptions.push({ kind: "reject", label: "Reject", optionId });
    }

    const verdict = await this.#interceptors.onPermissionRequest({
      providerId: this.providerId,
      request: {
        options: context.params.options.map((option) => ({
          kind: option.kind,
          name: option.name,
          optionId: option.optionId,
        })),
        toolCall: {
          ...(context.params.toolCall.kind === undefined
            ? {}
            : { kind: context.params.toolCall.kind }),
          ...(context.params.toolCall.status === undefined
            ? {}
            : { status: context.params.toolCall.status }),
          ...(context.params.toolCall.title === undefined
            ? {}
            : { title: context.params.toolCall.title }),
          toolCallId: context.params.toolCall.toolCallId,
        },
      },
      requestId,
      sessionId: this.sessionId,
      signal: turn.abort.signal,
      turnId: turn.turnId,
    });

    this.#transitionTurn("awaiting_approval");
    this.#emit(turn.turnId, {
      description: "The Agent asks before running this tool.",
      expiresAt: new Date(Date.parse(this.#now()) + this.#approvalTimeoutMs).toISOString(),
      options: normalizedOptions,
      requestId,
      title:
        (context.params.toolCall.title ?? "Agent permission request").slice(0, 256) ||
        "Agent permission request",
      type: "approval_request",
    });

    const response = deferred<RequestPermissionResponse>();
    const timer = setTimeout(() => {
      void this.#resolvePendingApproval("expired", null, null);
    }, this.#approvalTimeoutMs);
    this.#pendingApproval = { options, requestId, response, timer };

    if (verdict === "reject") {
      this.#emit(turn.turnId, {
        level: "warn",
        messageId: MessageIdSchema.parse(randomUUID()),
        text: "A local policy rejected this permission request.",
        type: "note",
      });
      const rejectOption = [...options.values()].find(
        (option) => option.kind === "reject" && option.rawOptionId !== null,
      );
      await this.#resolvePendingApproval(
        "rejected",
        { type: "reject" },
        rejectOption?.rawOptionId ?? null,
      );
    } else if (
      this.#allowsAutomaticApproval &&
      (this.#autoApprovePermissions || verdict === "allow")
    ) {
      const allowOption = normalizedOptions.find((option) => option.kind === "allow");
      const rawAllow =
        allowOption === undefined ? undefined : options.get(allowOption.optionId)?.rawOptionId;
      if (allowOption !== undefined && rawAllow != null) {
        const pending = this.#pendingApproval;
        if (pending !== undefined) {
          // Treat durable audit + automatic resolution as one critical section.
          // Timeout, cancellation, and prompt cleanup wait for it, so an
          // "allowed" audit record can never outlive an expired/cancelled
          // permission outcome.
          clearTimeout(pending.timer);
          const auditAndResolve = (async () => {
            try {
              if (this.#onPermissionAudit === undefined) {
                throw new Error("Automatic approval requires a durable permission audit sink");
              }
              await this.#onPermissionAudit({
                cwd: this.cwd,
                effectiveProfileId: this.permission.effectiveProfileId,
                occurredAt: this.#now(),
                optionId: allowOption.optionId,
                providerId: this.providerId,
                requestId,
                result: "allowed",
                sessionId: this.sessionId,
                source: "permission_profile",
                ...(typeof context.params.toolCall.kind !== "string"
                  ? {}
                  : { toolKind: context.params.toolCall.kind.slice(0, 64) }),
                turnId: turn.turnId,
              });
              await this.#resolvePendingApproval(
                "allowed",
                { optionId: allowOption.optionId, type: "option" },
                rawAllow,
                true,
              );
            } catch {
              this.#emit(turn.turnId, {
                level: "warn",
                messageId: MessageIdSchema.parse(randomUUID()),
                text: "Automatic approval was blocked because its audit record could not be persisted.",
                type: "note",
              });
              const rejectOption = [...options.values()].find(
                (option) => option.kind === "reject" && option.rawOptionId !== null,
              );
              await this.#resolvePendingApproval(
                "rejected",
                { type: "reject" },
                rejectOption?.rawOptionId ?? null,
                true,
              );
            }
          })();
          this.#approvalResolutionLock = auditAndResolve;
          try {
            await auditAndResolve;
          } finally {
            if (this.#approvalResolutionLock === auditAndResolve) {
              this.#approvalResolutionLock = undefined;
            }
          }
        }
      } else {
        const rejectOption = [...options.values()].find(
          (option) => option.kind === "reject" && option.rawOptionId !== null,
        );
        await this.#resolvePendingApproval(
          "rejected",
          { type: "reject" },
          rejectOption?.rawOptionId ?? null,
        );
      }
    }
    return response.promise;
  }

  handleSessionUpdate(notification: SessionNotification): void {
    const turn = this.#currentTurn;
    if (turn === undefined || notification.sessionId !== this.#acpSessionId || this.#disposed) {
      return;
    }
    const events = normalizeSessionUpdate(notification.update, {
      messageId: (kind) => {
        const existing = turn.messageIds.get(kind);
        if (existing !== undefined) return existing;
        const created = randomUUID();
        turn.messageIds.set(kind, created);
        return created;
      },
      provider: this.#provider,
    });
    for (const event of events) {
      if (event.type === "message_delta" || event.type === "thought_delta") {
        this.#delta.add(event);
      } else {
        this.#delta.flushAll();
        this.#emit(turn.turnId, event);
      }
    }
  }

  async #cancelPendingApproval(status: "cancelled" | "expired"): Promise<void> {
    if (this.#pendingApproval !== undefined) {
      await this.#resolvePendingApproval(status, null, null);
    }
  }

  async #cancelTurn(turnId: string): Promise<void> {
    const turn = this.#currentTurn;
    if (turn === undefined || turn.turnId !== turnId) return;
    if (turn.status === "cancelling") return;
    if (turn.status !== "running" && turn.status !== "awaiting_approval") {
      throw runtimeError("TURN_NOT_CANCELLABLE", false, {
        operation: "cancel",
        phase: "turn",
      });
    }
    this.#transitionTurn("cancelling");
    await this.#cancelPendingApproval("cancelled");
    await this.#connection.agent.notify(methods.agent.session.cancel, {
      sessionId: this.#acpSessionId,
    });
  }

  async #completePrompt(turn: ActiveTurn, prompt: Promise<PromptResponse>): Promise<void> {
    try {
      const response = await prompt;
      if (this.#currentTurn !== turn) return;
      await this.#cancelPendingApproval("cancelled");
      this.#delta.flushAll();
      if (turn.status === "awaiting_approval") this.#transitionTurn("running");
      if (response.stopReason === "cancelled" && turn.status !== "cancelling") {
        this.#transitionTurn("cancelling");
      }
      if (turn.status === "cancelling") {
        this.#finishTurn({ status: "cancelled", stopReason: "cancelled" });
      } else {
        this.#finishTurn({
          status: "completed",
          stopReason: stopReason(response.stopReason),
        });
      }
    } catch (error) {
      if (this.#currentTurn !== turn) return;
      await this.#cancelPendingApproval("cancelled");
      this.#delta.flushAll();
      if (turn.status === "cancelling") {
        this.#finishTurn({ status: "interrupted", stopReason: "interrupted" });
      } else {
        const failure = toRuntimeError(error);
        this.#finishTurn({
          error: failure.payload,
          status: "failed",
          stopReason: "error",
        });
      }
    }
  }

  #emit(turnId: string | null, event: AgentUiEvent): void {
    const runtimeEvent = AgentRuntimeEventSchema.parse({
      event,
      occurredAt: this.#now(),
      sessionId: this.sessionId,
      turnId,
    });
    for (const listener of this.#listeners) listener(runtimeEvent);
    this.#interceptors.observe(runtimeEvent);
  }

  #finishTurn(result: AgentTurnResult, setIdle = true): void {
    const turn = this.#currentTurn;
    if (turn === undefined) return;
    const from = turn.status;
    this.#delta.flushAll();
    this.#emit(turn.turnId, {
      ...(result.error === undefined ? {} : { error: result.error }),
      from,
      status: result.status,
      stopReason: result.stopReason,
      type: "turn_end",
      ...(result.usage === undefined ? {} : { usage: result.usage }),
    });
    turn.completion.resolve(result);
    this.#currentTurn = undefined;
    if (setIdle && !this.#disposed && this.#state !== "crashed") this.#setState("idle");
  }

  #handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#disposed || this.#state === "closed" || this.#state === "crashed") return;
    signalProcessTree(this.#child, "SIGTERM");
    this.#delta.flushAll();
    if (this.#currentTurn !== undefined) {
      this.#finishTurn({ status: "interrupted", stopReason: "interrupted" }, false);
    }
    this.#setState("crashed");
    this.#emit(null, {
      error: errorPayload("AGENT_PROCESS_CRASHED", true, {
        exitCode: code,
        phase: "spawn",
        signal: safeProcessSignal(signal),
      }),
      type: "session_error",
    });
    this.#onClosed();
  }

  #handleTransportClosed(): void {
    if (!this.#disposed && this.#child.exitCode === null) {
      this.#handleProcessExit(null, null);
    }
  }

  #now(): string {
    return new Date(this.#clock()).toISOString();
  }

  async #resolvePendingApproval(
    status: "allowed" | "cancelled" | "expired" | "rejected",
    decision:
      { readonly optionId: string; readonly type: "option" } | { readonly type: "reject" } | null,
    rawOptionId: string | null,
    bypassResolutionLock = false,
  ): Promise<void> {
    if (!bypassResolutionLock && this.#approvalResolutionLock !== undefined) {
      await this.#approvalResolutionLock;
    }
    const pending = this.#pendingApproval;
    const turn = this.#currentTurn;
    if (pending === undefined || turn === undefined) return;
    clearTimeout(pending.timer);
    this.#pendingApproval = undefined;
    this.#resolvedApprovalIds.add(pending.requestId);
    this.#emit(turn.turnId, {
      decision,
      requestId: pending.requestId,
      status,
      type: "approval_resolved",
    });
    if (turn.status === "awaiting_approval") this.#transitionTurn("running");
    pending.response.resolve(
      rawOptionId === null
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { optionId: rawOptionId, outcome: "selected" } },
    );
  }

  #setState(state: SessionState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#emit(null, { state, type: "session_state" });
  }

  async #stopProcess(): Promise<void> {
    await stopProcessTree(this.#child);
  }

  #transitionTurn(status: ActiveTurnStatus): void {
    const turn = this.#currentTurn;
    if (turn === undefined || turn.status === status) return;
    const from = turn.status;
    turn.status = status;
    this.#emit(turn.turnId, { from, status, type: "turn_state" });
    if (status === "running" || status === "awaiting_approval" || status === "cancelling") {
      this.#setState(status === "running" ? "running" : status);
    }
  }
}

export class DefaultAgentSessionRegistry implements AgentSessionRegistry {
  readonly #approvalTimeoutMs: number;
  readonly #clock: () => string;
  readonly #deltaWindowMs: number;
  readonly #environment: SanitizedProcessEnv;
  readonly #handshakeTimeoutMs: number;
  readonly #interceptors: InterceptorChain;
  readonly #maxActiveSessions: number;
  readonly #onAgentStderr: AgentSessionRegistryOptions["onAgentStderr"];
  readonly #onPermissionAudit: AgentSessionRegistryOptions["onPermissionAudit"];
  readonly #providers: ReadonlyMap<string, AgentProvider>;
  readonly #sessions = new Map<string, AcpSession>();
  readonly #stderrByteLimit: number;

  constructor(options: AgentSessionRegistryOptions) {
    this.#approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#deltaWindowMs = options.deltaWindowMs ?? 50;
    this.#environment = options.environment ?? defaultEnvironment();
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.#maxActiveSessions = options.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;
    this.#onAgentStderr = options.onAgentStderr;
    this.#onPermissionAudit = options.onPermissionAudit;
    this.#stderrByteLimit = options.stderrByteLimit ?? DEFAULT_AGENT_STDERR_BYTE_LIMIT;
    this.#providers = new Map(options.providers.map((provider) => [provider.id, provider]));
    this.#interceptors = new InterceptorChain(options.interceptors, {
      ...(options.interceptorTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.interceptorTimeoutMs }),
      ...(options.observerQueueLimit === undefined
        ? {}
        : { observerQueueLimit: options.observerQueueLimit }),
      ...(options.onObserverError === undefined
        ? {}
        : { onObserverError: options.onObserverError }),
    });
    if (this.#providers.size !== options.providers.length) {
      throw new Error("Provider IDs must be unique");
    }
    for (const provider of options.providers) {
      const profileIds = new Set(provider.permissionProfiles.map((profile) => profile.id));
      if (
        profileIds.size !== provider.permissionProfiles.length ||
        !profileIds.has(provider.defaultPermissionProfileId)
      ) {
        throw new Error(`Provider ${provider.id} has invalid permission profiles`);
      }
      const defaultProfile = permissionProfile(provider, provider.defaultPermissionProfileId);
      if (defaultProfile.permissionEnforcement !== provider.permissionEnforcement) {
        throw new Error(`Provider ${provider.id} default permission enforcement is inconsistent`);
      }
    }
    if (!Number.isSafeInteger(this.#stderrByteLimit) || this.#stderrByteLimit < 1) {
      throw new TypeError("stderrByteLimit must be a positive safe integer");
    }
  }

  async create(options: {
    readonly cwd: string;
    readonly permissionProfileId?: string;
    readonly providerId: string;
    readonly sessionId?: string;
  }): Promise<AgentSessionHandle> {
    if (this.#sessions.size >= this.#maxActiveSessions) {
      throw runtimeError("ACTIVE_SESSION_LIMIT_REACHED", true, {
        limit: this.#maxActiveSessions,
        phase: "session",
      });
    }
    const cwd = CwdSchema.parse(options.cwd);
    const providerId = ProviderIdSchema.parse(options.providerId);
    const sessionId = SessionIdSchema.parse(options.sessionId ?? randomUUID());
    if (this.#sessions.has(sessionId)) {
      throw runtimeError("ACTIVE_SESSION_LIMIT_REACHED", false, {
        limit: 1,
        phase: "session",
      });
    }
    const provider = this.#providers.get(providerId);
    if (provider === undefined) {
      throw runtimeError("PROVIDER_UNAVAILABLE", false, {
        operation: "create_session",
        phase: "session",
        providerId,
      });
    }
    const requestedProfileId = options.permissionProfileId ?? provider.defaultPermissionProfileId;
    const profile = permissionProfile(provider, requestedProfileId);
    const availability = await provider.available();
    if (!availability.ok) {
      throw runtimeError("PROVIDER_UNAVAILABLE", true, {
        operation: "create_session",
        phase: "session",
        providerId,
      });
    }

    const command = provider.resolveCommand({
      env: this.#environment,
      permissionProfileId: profile.id,
    });
    const child = spawn(command.command, [...command.args], {
      cwd,
      detached: process.platform !== "win32",
      env: command.env ?? this.#environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // stderr is always drained separately from ACP stdout. Only bounded,
    // redacted entries may cross the local diagnostics callback.
    observeAgentStderr(child.stderr, {
      byteLimit: this.#stderrByteLimit,
      clock: this.#clock,
      ...(this.#onAgentStderr === undefined ? {} : { onEntry: this.#onAgentStderr }),
      providerId,
      sessionId,
    });
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    let session: AcpSession | undefined;
    const application = client({ name: "dougoos" })
      .onRequest(methods.client.session.requestPermission, (context) =>
        session === undefined
          ? Promise.resolve({ outcome: { outcome: "cancelled" } })
          : session.handlePermission(context),
      )
      .onNotification(methods.client.session.update, (context) => {
        session?.handleSessionUpdate(context.params);
      });
    const connection = application.connect(stream);

    try {
      const initialize = await withDeadline(
        connection.agent.request(methods.agent.initialize, {
          clientCapabilities: {},
          clientInfo: {
            name: "dougoos",
            title: "DougoOS",
            version: "0.0.0",
          },
          protocolVersion: PROTOCOL_VERSION,
        }),
        this.#handshakeTimeoutMs,
        () => {
          connection.close();
          signalProcessTree(child, "SIGTERM");
        },
      );
      if (initialize.protocolVersion !== PROTOCOL_VERSION) {
        throw runtimeError("PROTOCOL_VERSION_UNSUPPORTED", false, {
          actual: initialize.protocolVersion,
          expected: PROTOCOL_VERSION,
          phase: "initialize",
          providerId,
        });
      }

      const authMethod = provider.chooseAuthMethod(initialize, this.#environment);
      if (
        authMethod !== null &&
        !(initialize.authMethods ?? []).some((method) => method.id === authMethod)
      ) {
        throw runtimeError("PROVIDER_UNAVAILABLE", false, {
          operation: "initialize",
          phase: "auth",
          providerId,
        });
      }
      if (authMethod !== null) {
        await withDeadline(
          connection.agent.request(methods.agent.authenticate, { methodId: authMethod }),
          this.#handshakeTimeoutMs,
          () => {
            connection.close();
            signalProcessTree(child, "SIGTERM");
          },
        );
      }

      const created = await withDeadline(
        connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] }),
        this.#handshakeTimeoutMs,
        () => {
          connection.close();
          signalProcessTree(child, "SIGTERM");
        },
      );
      await withDeadline(
        applyPermissionConfiguration({
          command,
          connection,
          created,
          profile,
          providerId,
        }),
        this.#handshakeTimeoutMs,
        () => {
          connection.close();
          signalProcessTree(child, "SIGTERM");
        },
      );
      const permission = SessionPermissionSnapshotSchema.parse({
        effectiveProfileId: profile.id,
        mechanism: profile.mechanism,
        permissionEnforcement: profile.permissionEnforcement,
        requestedProfileId: profile.id,
      });
      const capabilities = capabilitiesFromInitialize(
        initialize,
        this.#now(),
        permission.permissionEnforcement,
      );
      session = new AcpSession({
        approvalTimeoutMs: this.#approvalTimeoutMs,
        allowsAutomaticApproval: supportsAutomaticApproval(profile),
        autoApprovePermissions: command.sessionConfiguration?.autoApprovePermissions === true,
        capabilities,
        child,
        clock: this.#clock,
        connection,
        cwd,
        deltaWindowMs: this.#deltaWindowMs,
        interceptors: this.#interceptors,
        onClosed: () => this.#sessions.delete(sessionId),
        ...(this.#onPermissionAudit === undefined
          ? {}
          : { onPermissionAudit: this.#onPermissionAudit }),
        permission,
        provider,
        providerSessionId: created.sessionId,
        sessionId,
      });
      this.#sessions.set(sessionId, session);
      return session;
    } catch (error) {
      connection.close();
      await stopProcessTree(child);
      if (error instanceof RequestError && error.code === -32_000) {
        throw runtimeError(
          "PROVIDER_UNAVAILABLE",
          false,
          { operation: "initialize", phase: "auth", providerId },
          error,
        );
      }
      throw error instanceof AcpRuntimeError
        ? error
        : runtimeError(
            "ACP_HANDSHAKE_FAILED",
            true,
            { operation: "initialize", phase: "handshake", providerId },
            error,
          );
    }
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map((session) => session.dispose()));
    this.#sessions.clear();
  }

  get(sessionId: string): AgentSessionHandle | undefined {
    return this.#sessions.get(sessionId);
  }

  list(): readonly AgentSessionHandle[] {
    return [...this.#sessions.values()];
  }

  #now(): string {
    return new Date(this.#clock()).toISOString();
  }
}
