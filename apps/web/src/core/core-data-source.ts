import type { AgentCliInstallation, Provider, SessionSummary } from "@dougoos/shared";

import { cloneSaasFixture } from "../saas/fixtures.js";
import type { AgentHistoryItem, AgentMessage } from "../saas/feature-fixtures.js";
import {
  AGENT_IDS,
  type AgentFixture,
  type AgentId,
  type ChatViewSnapshot,
  type RuntimePresentation,
  type SaasDataCommand,
  type SaasDataSnapshot,
  type SaasDataSource,
  type SaasFixture,
} from "../saas/types.js";
import {
  CoreApiClient,
  CoreClientError,
  type CoreConnection,
  type CoreFetch,
} from "./core-client.js";
import {
  applyEnvelope,
  beginLocalSessionLoad,
  completeLocalSessionLoad,
  stateFromGlobalSnapshot,
  type CoreViewState,
  type LiveMessage,
} from "./core-state.js";

export interface CoreConnectionProvider {
  chooseDirectory?(): Promise<string | null>;
  getCoreConnection(): Promise<CoreConnection>;
  onCoreRestart(listener: () => void): () => void;
  openDiagnostics?(source: "agent" | "migration"): Promise<void>;
  restartCore?(): Promise<void>;
}

export interface CoreDataSourceOptions {
  readonly fetch?: CoreFetch;
  readonly random?: () => number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

function defaultWait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Core retry aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function knownAgentId(providerId: string): AgentId | null {
  const normalized = providerId.toLowerCase();
  for (const agentId of AGENT_IDS) {
    if (normalized.includes(agentId)) return agentId;
  }
  return null;
}

export function assignProviders(providers: readonly Provider[]): ReadonlyMap<string, AgentId> {
  const assignments = new Map<string, AgentId>();
  const used = new Set<AgentId>();
  for (const provider of providers) {
    const known = knownAgentId(provider.id);
    if (known !== null && !used.has(known)) {
      assignments.set(provider.id, known);
      used.add(known);
    }
  }
  for (const provider of providers) {
    if (assignments.has(provider.id)) continue;
    const fallback = AGENT_IDS.find((agentId) => !used.has(agentId));
    if (fallback === undefined) break;
    assignments.set(provider.id, fallback);
    used.add(fallback);
  }
  return assignments;
}

function statusForSession(
  state: string | undefined,
): "executing" | "idle" | "thinking" | "waiting" {
  switch (state) {
    case "awaiting_approval":
      return "waiting";
    case "running":
    case "cancelling":
      return "executing";
    case "starting":
      return "thinking";
    default:
      return "idle";
  }
}

const realOnlyAgentPresentation: Readonly<
  Partial<Record<AgentId, Pick<AgentFixture, "glyph" | "model" | "tone">>>
> = {
  openclaw: { glyph: "⌁", model: "default", tone: "#ff6b6b" },
  opencode: { glyph: "◈", model: "auto", tone: "#d6e4ff" },
};

function realProviderAgent(
  agentId: AgentId,
  provider: Provider,
  summary: SessionSummary | undefined,
): AgentFixture {
  const presentation = realOnlyAgentPresentation[agentId];
  return {
    cost: 0,
    cwd: summary?.cwd ?? "~",
    enabled: provider.status === "available",
    glyph: presentation?.glyph ?? "◇",
    id: agentId,
    last: summary?.lastMessagePreview ?? "—",
    model: provider.version ?? presentation?.model ?? provider.id,
    name: provider.displayName,
    status: statusForSession(summary?.state),
    task: summary === undefined ? "待命" : sessionDisplayTitle(summary),
    tokenCount: 0,
    tone: presentation?.tone ?? "#8a968e",
  };
}

function messageForFixture(message: LiveMessage): AgentMessage | null {
  switch (message.kind) {
    case "user":
    case "text":
    case "note":
      return {
        body: message.body,
        id: message.id,
        ...(message.state === undefined ? {} : { state: message.state }),
        type: message.kind,
      };
    case "think":
      return null;
    case "tool":
      return {
        arg: message.displayInput,
        id: message.id,
        result: message.result || message.status,
        tool: message.title,
        type: "tool",
      };
    case "diff": {
      const oldLines = message.oldText?.split("\n") ?? [];
      const newLines = message.newText.split("\n");
      return {
        additions: newLines.length,
        deletions: oldLines.length,
        file: message.path,
        id: message.id,
        lines: [...oldLines.map((line) => `- ${line}`), ...newLines.map((line) => `+ ${line}`)],
        type: "diff",
      };
    }
    case "approval":
      return {
        approved:
          message.status === "allowed" ? true : message.status === "rejected" ? false : null,
        body: "⚠ 权限请求 — 需要你确认",
        command: message.title,
        id: message.id,
        note: message.description,
        options: message.options,
        requestId: message.requestId,
        status: message.status,
        ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
        type: "approval",
      };
  }
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.split("/").at(-1) || normalized || "workspace";
}

function sessionDisplayTitle(summary: SessionSummary): string {
  return summary.firstUserMessagePreview ?? summary.title;
}

export function fixtureFromCoreState(
  state: CoreViewState,
  providers: readonly Provider[],
  selectedSessionIds: ReadonlyMap<AgentId, string> = new Map(),
): SaasFixture {
  const base = cloneSaasFixture();
  const assignments = assignProviders(providers);
  const latestByAgent = new Map<AgentId, SessionSummary>();
  for (const summary of Object.values(state.summaries).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )) {
    const agentId = assignments.get(summary.providerId);
    if (agentId !== undefined && !latestByAgent.has(agentId)) {
      latestByAgent.set(agentId, summary);
    }
  }
  for (const [agentId, sessionId] of selectedSessionIds) {
    const selected = state.summaries[sessionId];
    if (selected !== undefined && assignments.get(selected.providerId) === agentId) {
      latestByAgent.set(agentId, selected);
    }
  }
  const providerByAgent = new Map<AgentId, Provider>();
  for (const provider of providers) {
    const agentId = assignments.get(provider.id);
    if (agentId !== undefined) providerByAgent.set(agentId, provider);
  }
  const fixtureAgents = base.agents.map((agent) => {
    const provider = providerByAgent.get(agent.id);
    const summary = latestByAgent.get(agent.id);
    return {
      ...agent,
      cost: 0,
      cwd: summary?.cwd ?? "~",
      enabled: provider?.status === "available",
      last: summary?.lastMessagePreview ?? "—",
      model: provider?.version ?? provider?.id ?? agent.model,
      name: provider?.displayName ?? agent.name,
      status: statusForSession(summary?.state),
      task: summary === undefined ? "待命" : sessionDisplayTitle(summary),
      tokenCount: 0,
    };
  });
  const prototypeAgentIds = new Set(fixtureAgents.map((agent) => agent.id));
  const realOnlyAgents = providers.flatMap((provider) => {
    const agentId = assignments.get(provider.id);
    if (agentId === undefined || prototypeAgentIds.has(agentId)) return [];
    return [realProviderAgent(agentId, provider, latestByAgent.get(agentId))];
  });
  const agents: readonly AgentFixture[] = [...fixtureAgents, ...realOnlyAgents];
  const initialMessages = Object.fromEntries(
    AGENT_IDS.map((agentId) => {
      const summary = latestByAgent.get(agentId);
      const session = summary === undefined ? undefined : state.sessions[summary.id];
      return [
        agentId,
        session?.messages.flatMap((message) => {
          const mapped = messageForFixture(message);
          return mapped === null ? [] : [mapped];
        }) ?? [],
      ];
    }),
  ) as unknown as Record<AgentId, readonly AgentMessage[]>;
  const summaries = Object.values(state.summaries).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const sessions = summaries.flatMap((summary) => {
    const agentId = assignments.get(summary.providerId);
    return agentId === undefined
      ? []
      : [{ agentId, sessionId: summary.id, title: sessionDisplayTitle(summary) }];
  });
  const paths = [...new Set(summaries.map((summary) => summary.cwd))];
  const projects = paths.map((path) => ({ name: basename(path), path }));
  const sidebarProjects = paths.map((path) => ({
    initiallyOpen: true,
    name: basename(path),
    sessions: summaries
      .filter((summary) => summary.cwd === path)
      .flatMap((summary) => {
        const agentId = assignments.get(summary.providerId);
        return agentId === undefined
          ? []
          : [{ agentId, sessionId: summary.id, title: sessionDisplayTitle(summary) }];
      }),
  }));
  const notifications = Object.values(state.pendingApprovals).map((approval) => {
    const summary = state.summaries[approval.sessionId];
    return {
      agentId: summary === undefined ? null : (assignments.get(summary.providerId) ?? null),
      id: approval.id,
      read: false,
      text: approval.description || approval.title,
      time: "刚刚",
      title: "Agent 等待确认",
    };
  });
  const histories = Object.fromEntries(
    AGENT_IDS.map((agentId) => [
      agentId,
      summaries.flatMap((summary): readonly AgentHistoryItem[] => {
        if (assignments.get(summary.providerId) !== agentId) return [];
        return [
          {
            date: summary.updatedAt.slice(5, 16).replace("T", " "),
            messageCount: summary.messageCount,
            project: basename(summary.cwd),
            sessionId: summary.id,
            summary: sessionDisplayTitle(summary),
            tokens: "—",
          },
        ];
      }),
    ]),
  ) as unknown as Readonly<Record<AgentId, readonly AgentHistoryItem[]>>;
  return {
    ...base,
    agents,
    conversations: sessions.length === 0 ? [] : [{ label: "最近", sessions }],
    features: {
      ...base.features,
      agent: {
        ...base.features.agent,
        histories,
        initialMessages,
      },
    },
    notifications,
    projects,
    sidebarProjects,
  };
}

function chatFromCoreState(
  state: CoreViewState,
  providers: readonly Provider[],
  selectedSessionIds: ReadonlyMap<AgentId, string>,
  cliInstallations: readonly AgentCliInstallation[] = [],
): ChatViewSnapshot {
  const assignments = assignProviders(providers);
  return {
    cliInstallations,
    providers: providers.flatMap((provider) => {
      const agentId = assignments.get(provider.id);
      if (agentId === undefined) return [];
      return [
        {
          agentId,
          capabilities: provider.capabilities,
          displayName: provider.displayName,
          id: provider.id,
          ...(provider.reason === undefined ? {} : { reason: provider.reason }),
          ...(provider.remediation === undefined ? {} : { remediation: provider.remediation }),
          status: provider.status,
          ...(provider.version === undefined ? {} : { version: provider.version }),
        },
      ];
    }),
    selectedSessionIds: Object.fromEntries(selectedSessionIds),
    sessions: Object.values(state.summaries)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .flatMap((summary) => {
        const agentId = assignments.get(summary.providerId);
        if (agentId === undefined) return [];
        return [
          {
            activeTurnId: summary.activeTurnId,
            agentId,
            cwd: summary.cwd,
            id: summary.id,
            messageCount: summary.messageCount,
            providerId: summary.providerId,
            state: summary.state,
            title: sessionDisplayTitle(summary),
            updatedAt: summary.updatedAt,
          },
        ];
      }),
  };
}

export class CoreDataSource implements SaasDataSource {
  readonly mode = "real" as const;
  readonly #connectionProvider: CoreConnectionProvider;
  readonly #fetch: CoreFetch;
  readonly #random: () => number;
  readonly #runtimeListeners = new Set<(presentation: RuntimePresentation) => void>();
  readonly #snapshotListeners = new Set<(snapshot: SaasDataSnapshot) => void>();
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  #client: CoreApiClient | null = null;
  #cliInstallations: readonly AgentCliInstallation[] = [];
  #closed = false;
  #generation = 0;
  #lifecycle: AbortController | null = null;
  #openedSessionIds = new Set<string>();
  #providers: readonly Provider[] = [];
  #revision = 0;
  #selectedSessionIds = new Map<AgentId, string>();
  #state: CoreViewState | null = null;
  #unsubscribeRestart: () => void;

  constructor(connectionProvider: CoreConnectionProvider, options: CoreDataSourceOptions = {}) {
    this.#connectionProvider = connectionProvider;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#random = options.random ?? Math.random;
    this.#wait = options.wait ?? defaultWait;
    this.#unsubscribeRestart = connectionProvider.onCoreRestart(() => {
      void this.#restartFromNewConnection();
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lifecycle?.abort();
    this.#unsubscribeRestart();
    this.#runtimeListeners.clear();
    this.#snapshotListeners.clear();
    this.#client = null;
  }

  chooseDirectory(): Promise<string | null> {
    return this.#connectionProvider.chooseDirectory?.() ?? Promise.resolve(null);
  }

  async execute(command: SaasDataCommand, signal: AbortSignal): Promise<void> {
    try {
      signal.throwIfAborted();
      if (command.name === "diagnostics.open") {
        await this.#connectionProvider.openDiagnostics?.(command.source);
        return;
      }
      if (command.name === "core.retry") {
        if (this.#connectionProvider.restartCore !== undefined) {
          await this.#connectionProvider.restartCore();
        } else {
          await this.#restartFromNewConnection();
        }
        return;
      }
      const client = this.#requireClient();
      switch (command.name) {
        case "clis.refresh":
          this.#cliInstallations = (await client.refreshAgentCliInstallations(signal)).clis;
          this.#publish();
          return;
        case "provider.doctor":
          await client.doctor(command.providerId, signal);
          this.#providers = (await client.listProviders(signal)).providers;
          await this.#replaceBaseline("normal", signal);
          return;
        case "session.create":
          await this.#createAndSelectSession(
            command.agentId,
            command.providerId,
            command.cwd,
            signal,
          );
          return;
        case "session.select":
          await this.#selectSession(command.agentId, command.sessionId, signal);
          return;
        case "chat.send": {
          const sessionId =
            command.sessionMode === "create"
              ? await this.#createAndSelectSession(
                  command.agentId,
                  command.providerId,
                  command.cwd,
                  signal,
                )
              : await this.#ensureChatSession(
                  command.agentId,
                  command.providerId,
                  command.cwd,
                  signal,
                );
          const turn = await client.createTurn(
            sessionId,
            {
              clientRequestId: command.requestId,
              content: [{ text: command.text, type: "text" }],
            },
            signal,
          );
          this.#emitRuntime({
            kind: "turn-running",
            sessionId,
            turnId: turn.turnId,
          });
          return;
        }
        case "approval.resolve":
          await client.resolveApproval(command.turnId, command.requestId, command.optionId, signal);
          return;
        case "turn.cancel": {
          const result = await client.cancelTurn(command.turnId, signal);
          const sessionId = this.#requireState().activeTurns[command.turnId]?.sessionId;
          if (result.status === "cancelling" && sessionId !== undefined) {
            this.#emitRuntime({
              kind: "turn-cancelling",
              sessionId,
              turnId: command.turnId,
            });
          }
          return;
        }
        case "request.retry":
          await this.#replaceBaseline("normal", signal);
          return;
      }
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      }
      if (
        error instanceof CoreClientError &&
        error.code === "SESSION_BUSY" &&
        error.response?.code === "SESSION_BUSY" &&
        "activeTurnId" in error.response
      ) {
        this.#emitRuntime({
          activeTurnId: error.response.activeTurnId,
          kind: "session-busy",
        });
      } else {
        this.#emitRuntime({
          code: error instanceof CoreClientError ? error.code : "CORE_REQUEST_FAILED",
          kind: "api-error",
          requestKey: command.name,
        });
      }
      throw error;
    }
  }

  async getSnapshot(signal: AbortSignal): Promise<SaasDataSnapshot> {
    if (this.#closed) throw new DOMException("Core data source is closed", "AbortError");
    this.#lifecycle?.abort();
    const lifecycle = new AbortController();
    this.#lifecycle = lifecycle;
    const generation = ++this.#generation;
    const connection = await this.#connectionProvider.getCoreConnection();
    signal.throwIfAborted();
    const client = new CoreApiClient(connection, this.#fetch);
    const [ready, providers, cliInstallations, snapshot] = await Promise.all([
      client.getReady(signal),
      client.listProviders(signal),
      client.listAgentCliInstallations(signal),
      client.getGlobalSnapshot([...this.#openedSessionIds], signal),
    ]);
    if (ready.status !== "ready" || ready.instanceId !== connection.instanceId) {
      throw new CoreClientError("CORE_INSTANCE_MISMATCH", {
        message: "Core readiness identity changed during connection",
        retryable: true,
        status: 503,
      });
    }
    signal.throwIfAborted();
    if (this.#closed || generation !== this.#generation) {
      throw new DOMException("Superseded Core load", "AbortError");
    }
    this.#client = client;
    this.#providers = providers.providers;
    this.#cliInstallations = cliInstallations.clis;
    this.#state = stateFromGlobalSnapshot(snapshot);
    this.#refreshSelections();
    if (this.#selectedSessionMissingFromState()) {
      this.#state = stateFromGlobalSnapshot(
        await client.getGlobalSnapshot([...this.#openedSessionIds], signal),
      );
      this.#refreshSelections();
    }
    const data = this.#snapshot();
    this.#emitRuntime({ kind: "normal" });
    void this.#streamLoop(generation, lifecycle.signal);
    return data;
  }

  async loadSession(sessionId: string, signal: AbortSignal): Promise<void> {
    const client = this.#requireClient();
    const state = this.#requireState();
    this.#openedSessionIds.add(sessionId);
    this.#state = beginLocalSessionLoad(state, sessionId);
    const snapshot = await client.getSession(sessionId, signal);
    signal.throwIfAborted();
    if (this.#state === null) return;
    this.#state = completeLocalSessionLoad(this.#state, snapshot);
    this.#publish();
  }

  subscribe(listener: (snapshot: SaasDataSnapshot) => void): () => void {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  }

  subscribeRuntime(listener: (presentation: RuntimePresentation) => void): () => void {
    this.#runtimeListeners.add(listener);
    return () => this.#runtimeListeners.delete(listener);
  }

  #emitRuntime(presentation: RuntimePresentation): void {
    for (const listener of this.#runtimeListeners) listener(presentation);
  }

  #publish(): void {
    const snapshot = this.#snapshot();
    for (const listener of this.#snapshotListeners) listener(snapshot);
  }

  #snapshot(): SaasDataSnapshot {
    const state = this.#requireState();
    return {
      chat: chatFromCoreState(
        state,
        this.#providers,
        this.#selectedSessionIds,
        this.#cliInstallations,
      ),
      fixture: fixtureFromCoreState(state, this.#providers, this.#selectedSessionIds),
      revision: ++this.#revision,
    };
  }

  #requireClient(): CoreApiClient {
    if (this.#client === null) {
      throw new CoreClientError("CORE_NOT_CONNECTED", {
        message: "Core is not connected",
        retryable: true,
        status: 503,
      });
    }
    return this.#client;
  }

  #requireState(): CoreViewState {
    if (this.#state === null) {
      throw new CoreClientError("CORE_NOT_CONNECTED", {
        message: "Core state is not loaded",
        retryable: true,
        status: 503,
      });
    }
    return this.#state;
  }

  async #createAndSelectSession(
    agentId: AgentId,
    providerId: string,
    cwd: string,
    signal: AbortSignal,
  ): Promise<string> {
    const assignedAgent = assignProviders(this.#providers).get(providerId);
    if (assignedAgent !== agentId) {
      throw new CoreClientError("INVALID_REQUEST", {
        message: "Provider is not assigned to the selected Agent slot",
        retryable: false,
        status: 400,
      });
    }
    const result = await this.#requireClient().createSession({ cwd, providerId }, signal);
    this.#selectedSessionIds.set(agentId, result.session.id);
    this.#openedSessionIds.add(result.session.id);
    await this.#replaceBaseline("normal", signal);
    return result.session.id;
  }

  async #ensureChatSession(
    agentId: AgentId,
    providerId: string,
    cwd: string,
    signal: AbortSignal,
  ): Promise<string> {
    const selectedId = this.#selectedSessionIds.get(agentId);
    const selected =
      selectedId === undefined ? undefined : this.#requireState().summaries[selectedId];
    if (
      selected !== undefined &&
      selected.providerId === providerId &&
      selected.cwd === cwd &&
      selected.state !== "closed" &&
      selected.state !== "crashed"
    ) {
      return selected.id;
    }
    return this.#createAndSelectSession(agentId, providerId, cwd, signal);
  }

  #refreshSelections(): void {
    const state = this.#requireState();
    const assignments = assignProviders(this.#providers);
    for (const [agentId, sessionId] of this.#selectedSessionIds) {
      const summary = state.summaries[sessionId];
      if (summary === undefined || assignments.get(summary.providerId) !== agentId) {
        this.#selectedSessionIds.delete(agentId);
      }
    }
    for (const summary of Object.values(state.summaries).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )) {
      const agentId = assignments.get(summary.providerId);
      if (agentId !== undefined && !this.#selectedSessionIds.has(agentId)) {
        this.#selectedSessionIds.set(agentId, summary.id);
      }
    }
    for (const sessionId of this.#selectedSessionIds.values()) {
      this.#openedSessionIds.add(sessionId);
    }
  }

  async #selectSession(agentId: AgentId, sessionId: string, signal: AbortSignal): Promise<void> {
    const summary = this.#requireState().summaries[sessionId];
    const assignedAgent =
      summary === undefined ? undefined : assignProviders(this.#providers).get(summary.providerId);
    if (summary === undefined || assignedAgent !== agentId) {
      throw new CoreClientError("NOT_FOUND", {
        message: "Session is not available for the selected Agent",
        retryable: false,
        status: 404,
      });
    }
    this.#selectedSessionIds.set(agentId, sessionId);
    this.#openedSessionIds.add(sessionId);
    await this.loadSession(sessionId, signal);
  }

  #selectedSessionMissingFromState(): boolean {
    const state = this.#requireState();
    return [...this.#selectedSessionIds.values()].some(
      (sessionId) =>
        state.summaries[sessionId] !== undefined && state.sessions[sessionId] === undefined,
    );
  }

  async #replaceBaseline(
    presentation: RuntimePresentation["kind"],
    signal: AbortSignal,
  ): Promise<void> {
    const client = this.#requireClient();
    if (presentation === "replay-gap") {
      this.#emitRuntime({ kind: "replay-gap", phase: "replacing" });
    }
    const snapshot = await client.getGlobalSnapshot([...this.#openedSessionIds], signal);
    this.#state = stateFromGlobalSnapshot(snapshot);
    this.#refreshSelections();
    this.#publish();
    this.#emitRuntime(
      presentation === "replay-gap"
        ? { kind: "replay-gap", phase: "resuming" }
        : { kind: "normal" },
    );
  }

  async #streamLoop(generation: number, signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted && generation === this.#generation && !this.#closed) {
      try {
        const client = this.#requireClient();
        let baselineReplaced = false;
        for await (const envelope of client.events(
          this.#requireState().lastAppliedSeq,
          signal,
          () => {
            attempt = 0;
            this.#emitRuntime({ kind: "normal" });
          },
        )) {
          if (signal.aborted || generation !== this.#generation) return;
          const result = applyEnvelope(this.#requireState(), envelope);
          if (result.kind === "gap" || result.kind === "snapshot-required") {
            this.#emitRuntime({ kind: "replay-gap", phase: "paused" });
            await this.#replaceBaseline("replay-gap", signal);
            baselineReplaced = true;
            break;
          }
          this.#state = result.state;
          if (result.kind === "applied") this.#publish();
          attempt = 0;
          if (
            result.kind === "applied" &&
            envelope.turnId !== null &&
            envelope.event.type === "turn_end" &&
            envelope.event.status === "failed" &&
            envelope.event.error !== undefined
          ) {
            this.#emitRuntime({
              code: envelope.event.error.code,
              kind: "turn-failed",
              message: envelope.event.error.message,
              turnId: envelope.turnId,
            });
          } else {
            this.#emitRuntime({ kind: "normal" });
          }
        }
        if (baselineReplaced) continue;
        if (!signal.aborted) throw new Error("Core event stream closed");
      } catch (error) {
        if (signal.aborted || generation !== this.#generation) return;
        if (error instanceof CoreClientError && error.code === "REPLAY_GAP") {
          this.#emitRuntime({ kind: "replay-gap", phase: "paused" });
          await this.#replaceBaseline("replay-gap", signal);
          continue;
        }
        attempt += 1;
        this.#emitRuntime({
          afterSeq: this.#requireState().lastAppliedSeq,
          attempt,
          kind: "sse-reconnecting",
        });
        const exponential = Math.min(10_000, 250 * 2 ** Math.min(attempt - 1, 5));
        const jittered = Math.round(exponential * (0.8 + this.#random() * 0.4));
        try {
          await this.#wait(jittered, signal);
        } catch (waitError) {
          if (signal.aborted) return;
          throw waitError;
        }
      }
    }
  }

  async #restartFromNewConnection(): Promise<void> {
    if (this.#closed) return;
    this.#emitRuntime({ generation: this.#generation + 1, kind: "core-restart" });
    this.#lifecycle?.abort();
    const lifecycle = new AbortController();
    this.#lifecycle = lifecycle;
    const generation = ++this.#generation;
    try {
      const connection = await this.#connectionProvider.getCoreConnection();
      if (lifecycle.signal.aborted || generation !== this.#generation) return;
      const client = new CoreApiClient(connection, this.#fetch);
      const [ready, providers, cliInstallations, snapshot] = await Promise.all([
        client.getReady(lifecycle.signal),
        client.listProviders(lifecycle.signal),
        client.listAgentCliInstallations(lifecycle.signal),
        client.getGlobalSnapshot([...this.#openedSessionIds], lifecycle.signal),
      ]);
      if (ready.status !== "ready" || ready.instanceId !== connection.instanceId) {
        throw new Error("Core restart identity mismatch");
      }
      this.#client = client;
      this.#providers = providers.providers;
      this.#cliInstallations = cliInstallations.clis;
      this.#state = stateFromGlobalSnapshot(snapshot);
      this.#refreshSelections();
      if (this.#selectedSessionMissingFromState()) {
        this.#state = stateFromGlobalSnapshot(
          await client.getGlobalSnapshot([...this.#openedSessionIds], lifecycle.signal),
        );
        this.#refreshSelections();
      }
      this.#publish();
      this.#emitRuntime({ kind: "normal" });
      void this.#streamLoop(generation, lifecycle.signal);
    } catch {
      if (lifecycle.signal.aborted) return;
      this.#emitRuntime({
        code: "CORE_RESTART_FAILED",
        kind: "api-error",
        requestKey: "core-restart",
      });
    }
  }
}
