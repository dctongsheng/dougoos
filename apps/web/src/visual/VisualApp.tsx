import { useEffect, useMemo, useRef, useState } from "react";

import { App } from "../saas/App.js";
import type {
  AgentId,
  ChatViewSnapshot,
  RuntimePresentation,
  SaasDataCommand,
  SaasDataSource,
  SaasDataSnapshot,
  SaasFixture,
} from "../saas/types.js";
import { FIXTURE_CONVERSATION_DIRECTORY, FixtureDataSource } from "../saas/fixtures.js";
import type { AgentMessage } from "../saas/feature-fixtures.js";

export const visualScenarioIds = [
  "saas-production-agent-crashed",
  "saas-production-api-error",
  "saas-production-capability-warning",
  "saas-production-constrained-sidebar",
  "saas-production-core-restart",
  "saas-production-core-starting",
  "saas-production-migration-error",
  "saas-production-permission-selector",
  "saas-production-provider-probing-unavailable",
  "saas-production-replay-gap",
  "saas-production-session-busy",
  "saas-production-seven-message-types",
  "saas-production-sse-reconnecting",
  "saas-production-turn-cancelling",
  "saas-production-turn-interrupted",
  "saas-production-turn-running",
] as const;

export type VisualScenarioId = (typeof visualScenarioIds)[number];

const visualScenarioSet = new Set<string>(visualScenarioIds);

const requestedVisualScenario = (): VisualScenarioId | null => {
  const value = new URLSearchParams(window.location.search).get("visualCase");
  return value !== null && visualScenarioSet.has(value) ? (value as VisualScenarioId) : null;
};

const runtimeByScenario: Readonly<Record<VisualScenarioId, RuntimePresentation>> = {
  "saas-production-agent-crashed": { exitCode: 1, kind: "agent-crashed" },
  "saas-production-api-error": {
    code: "CORE_REQUEST_FAILED",
    kind: "api-error",
    requestKey: "agent-conversation",
  },
  "saas-production-capability-warning": {
    kind: "capability-warning",
    providerId: "claude-code",
  },
  "saas-production-constrained-sidebar": { kind: "normal" },
  "saas-production-core-restart": { generation: 2, kind: "core-restart" },
  "saas-production-core-starting": { kind: "core-starting", stage: "providers" },
  "saas-production-migration-error": {
    code: "SQLITE_MIGRATION_FAILED",
    kind: "migration-error",
    migrationId: "004_turn_journal",
  },
  "saas-production-permission-selector": { kind: "normal" },
  "saas-production-provider-probing-unavailable": {
    kind: "provider-probing-unavailable",
    unavailableProviderIds: ["claude-code"],
  },
  "saas-production-replay-gap": { kind: "replay-gap", phase: "replacing" },
  "saas-production-session-busy": {
    activeTurnId: "turn-visual-running",
    kind: "session-busy",
  },
  "saas-production-seven-message-types": { kind: "normal" },
  "saas-production-sse-reconnecting": {
    afterSeq: 41,
    attempt: 2,
    kind: "sse-reconnecting",
  },
  "saas-production-turn-cancelling": {
    kind: "turn-cancelling",
    sessionId: "session-visual-claude",
    turnId: "turn-visual-running",
  },
  "saas-production-turn-interrupted": {
    kind: "turn-interrupted",
    turnId: "turn-visual-interrupted",
  },
  "saas-production-turn-running": {
    kind: "turn-running",
    sessionId: "session-visual-claude",
    turnId: "turn-visual-running",
  },
};

// This scenario uses only safe canned fixture content. Its historical case ID
// is retained because production-only IDs are part of the committed manifest.
const safeFixtureSevenTypeMessages: readonly AgentMessage[] = [
  { body: "✓ 已记录工作区检查点", id: "visual-note", type: "note" },
  {
    body: "正在核验依赖方向与回归证据 …",
    id: "visual-think",
    type: "think",
  },
];

const visualPermissionProfiles = [
  {
    description: "Read files and analyze the workspace without modifying it.",
    id: "read-only",
    label: "Read only",
    mechanism: "launch",
    permissionEnforcement: "client_enforced",
    requiresNewSession: true,
    risk: "safe",
    semantic: "read_only",
  },
  {
    description: "Request approval for sensitive operations.",
    id: "agent",
    label: "Agent",
    mechanism: "launch",
    permissionEnforcement: "requests_permission",
    requiresNewSession: true,
    risk: "guarded",
    semantic: "ask",
  },
  {
    description: "Disable approval and sandbox restrictions for this Session.",
    id: "agent-full-access",
    label: "Agent full access",
    mechanism: "launch",
    permissionEnforcement: "not_guaranteed",
    requiresNewSession: true,
    risk: "dangerous",
    semantic: "unrestricted",
  },
] as const;

const realChatForFixture = (
  fixture: SaasFixture,
  agentIds: readonly AgentId[],
  permissionProfileId = "agent-full-access",
): ChatViewSnapshot => {
  const agents = agentIds.flatMap((agentId) => {
    const agent = fixture.agents.find((candidate) => candidate.id === agentId);
    return agent === undefined ? [] : [agent];
  });
  return {
    agentCatalog: agents.map((agent) => ({
      agentId: agent.id,
      cli: {
        command: agent.id,
        detectedAt: "2026-07-23T04:05:06.000Z",
        displayName: agent.name,
        executablePath: `/fixture/bin/${agent.id}`,
        integratedProviderId: agent.id,
        version: `${agent.id} visual-fixture`,
      },
      displayName: agent.name,
      providerId: agent.id,
      status: "available",
    })),
    cliInstallations: agents.map((agent) => ({
      command: agent.id,
      detectedAt: "2026-07-23T04:05:06.000Z",
      displayName: agent.name,
      executablePath: `/fixture/bin/${agent.id}`,
      integratedProviderId: agent.id,
      version: `${agent.id} visual-fixture`,
    })),
    providerPreferences: agents.map((agent) => ({
      permissionProfileId,
      providerId: agent.id,
      visibleInSidebar: true,
    })),
    providers: agents.map((agent) => ({
      agentId: agent.id,
      capabilities: null,
      defaultPermissionProfileId: "agent-full-access",
      displayName: agent.name,
      id: agent.id,
      installed: true,
      permissionProfiles: visualPermissionProfiles,
      status: "available",
      version: `${agent.id} visual-fixture`,
    })),
    selectedSessionIds: {},
    sessions: [],
  };
};

class VisualDataSource extends FixtureDataSource {
  constructor(private readonly scenario: VisualScenarioId) {
    super();
  }

  override async getSnapshot(signal: AbortSignal): Promise<SaasDataSnapshot> {
    const snapshot = await super.getSnapshot(signal);
    if (this.scenario === "saas-production-seven-message-types") {
      const mutable = snapshot.fixture as unknown as {
        features: {
          agent: {
            initialMessages: Record<AgentId, AgentMessage[]>;
          };
        };
      };
      mutable.features.agent.initialMessages.claude?.push(...safeFixtureSevenTypeMessages);
    }
    return snapshot;
  }

  override async execute(command: SaasDataCommand, signal: AbortSignal): Promise<void> {
    await Promise.resolve();
    if (signal.aborted) throw new DOMException("Visual command aborted", "AbortError");
    const runtime = globalThis as typeof globalThis & {
      __dougoosRuntimeEffects?: SaasDataCommand[];
    };
    (runtime.__dougoosRuntimeEffects ??= []).push(command);
  }
}

class RealVisualDataSource implements SaasDataSource {
  readonly mode = "real" as const;
  private readonly fixtureSource: VisualDataSource;

  constructor(scenario: VisualScenarioId) {
    this.fixtureSource = new VisualDataSource(scenario);
  }

  async execute(command: SaasDataCommand, signal: AbortSignal): Promise<void> {
    await this.fixtureSource.execute(command, signal);
  }

  async getSnapshot(signal: AbortSignal): Promise<SaasDataSnapshot> {
    const snapshot = await this.fixtureSource.getSnapshot(signal);
    return {
      ...snapshot,
      chat: realChatForFixture(
        snapshot.fixture,
        snapshot.fixture.agents.map((agent) => agent.id),
      ),
    };
  }
}

class SourceSwapDataSource implements SaasDataSource {
  readonly mode = "real" as const;
  private readonly fixtureSource = new FixtureDataSource();
  private listener: ((snapshot: SaasDataSnapshot) => void) | null = null;
  private subscribed = false;

  constructor(private readonly label: "SOURCE_A" | "SOURCE_B") {}

  async execute(command: SaasDataCommand, signal: AbortSignal): Promise<void> {
    await this.fixtureSource.execute(command, signal);
  }

  async getSnapshot(signal: AbortSignal): Promise<SaasDataSnapshot> {
    return this.snapshot(1, signal);
  }

  private async snapshot(revision: number, signal: AbortSignal): Promise<SaasDataSnapshot> {
    const base = await this.fixtureSource.getSnapshot(signal);
    const agentId = this.label === "SOURCE_A" ? "codex" : "hermes";
    const fixture: SaasFixture = {
      ...base.fixture,
      ...(revision === 1
        ? {}
        : {
            agents: base.fixture.agents.map((agent) =>
              agent.id === agentId
                ? { ...agent, model: `${this.label.toLowerCase()}-r${revision}` }
                : agent,
            ),
            features: {
              ...base.fixture.features,
              agent: {
                ...base.fixture.features.agent,
                initialMessages: {
                  ...base.fixture.features.agent.initialMessages,
                  [agentId]: [
                    {
                      body: `${this.label}_R${revision}_MESSAGE`,
                      id: `${this.label.toLowerCase()}-r${revision}`,
                      type: "text",
                    },
                  ],
                },
              },
              operations: {
                ...base.fixture.features.operations,
                queue: {
                  ...base.fixture.features.operations.queue,
                  statuses: {
                    ...base.fixture.features.operations.queue.statuses,
                    t1: "done",
                  },
                },
              },
              settings: {
                ...base.fixture.features.settings,
                initialNotifyDone: false,
              },
            },
          }),
      suggestions: [revision === 1 ? this.label : `${this.label}_R${revision}`],
    };
    return {
      chat: realChatForFixture(fixture, [agentId], revision === 1 ? "agent" : "agent-full-access"),
      conversationDirectory: FIXTURE_CONVERSATION_DIRECTORY,
      fixture,
      revision,
    };
  }

  async emit(revision: number, includeAfterUnsubscribe = false): Promise<void> {
    const snapshot = await this.snapshot(revision, new AbortController().signal);
    if ((this.subscribed || includeAfterUnsubscribe) && this.listener !== null) {
      this.listener(snapshot);
    }
  }

  subscribe(listener: (snapshot: SaasDataSnapshot) => void): () => void {
    this.listener = listener;
    this.subscribed = true;
    return () => {
      this.subscribed = false;
      document.documentElement.dataset.sourceUnsubscribed = this.label;
    };
  }
}

export function VisualApp() {
  const scenario = useMemo(requestedVisualScenario, []);
  const sourceSwap = useMemo(
    () => new URLSearchParams(window.location.search).get("sourceSwap") === "1",
    [],
  );
  const [secondSource, setSecondSource] = useState(false);
  const sourceHistory = useRef<SourceSwapDataSource[]>([]);
  const replacementSource = useMemo(
    () => new SourceSwapDataSource(secondSource ? "SOURCE_B" : "SOURCE_A"),
    [secondSource],
  );
  const source = useMemo(
    () =>
      scenario === null
        ? null
        : scenario === "saas-production-core-restart" ||
            scenario === "saas-production-permission-selector"
          ? new RealVisualDataSource(scenario)
          : new VisualDataSource(scenario),
    [scenario],
  );
  useEffect(() => {
    if (sourceSwap && !sourceHistory.current.includes(replacementSource)) {
      sourceHistory.current.push(replacementSource);
    }
  }, [replacementSource, sourceSwap]);

  if (sourceSwap) {
    return (
      <>
        <div
          style={{
            display: "flex",
            gap: 4,
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 10_000,
          }}
        >
          <button
            data-source-emit-current="true"
            onClick={() => void replacementSource.emit(2)}
            type="button"
          >
            emit current r2
          </button>
          <button
            data-source-swap="true"
            onClick={() => setSecondSource((current) => !current)}
            type="button"
          >
            swap source
          </button>
          <button
            data-source-emit-old="true"
            onClick={() => void sourceHistory.current[0]?.emit(3, true)}
            type="button"
          >
            emit old source r3
          </button>
        </div>
        <App dataSource={replacementSource} />
      </>
    );
  }
  if (scenario === null) return <App />;
  if (source === null) throw new Error("Visual scenario requires a visual data source");
  document.documentElement.dataset.visualCase = scenario;
  const standalone =
    scenario === "saas-production-core-starting" || scenario === "saas-production-migration-error";
  const initialRoute =
    scenario === "saas-production-permission-selector"
      ? ({ agentId: "codex", kind: "settings" } as const)
      : ({ agentId: "claude", kind: "agent", tab: "session" } as const);
  return (
    <App
      dataSource={source}
      {...(standalone ? {} : { initialRoute })}
      runtimePresentation={runtimeByScenario[scenario]}
    />
  );
}
