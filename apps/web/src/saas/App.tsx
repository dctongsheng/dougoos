import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { AgentPage } from "./AgentPage.js";
import { FixtureDataSource } from "./fixtures.js";
import { HomePage } from "./HomePage.js";
import {
  buildHomeChatCommand,
  isAbsoluteWorkspacePath,
  resolveHomeProjectCwd,
} from "./home-task.js";
import { HarnessPage } from "./HarnessPage.js";
import { routeTask } from "./home-routing.js";
import { MemoryPage } from "./MemoryPage.js";
import { CronPage, DashboardPage, ProjectsPage, QueuePage, UsagePage } from "./OperationsPages.js";
import { Shell } from "./Shell.js";
import { SessionsPage } from "./SessionsPage.js";
import { ComparePage, SettingsPage } from "./SettingsPage.js";
import { initialSaasState, saasReducer } from "./state.js";
import type {
  AgentId,
  Route,
  RuntimePresentation,
  SaasDataCommand,
  SaasDataSource,
} from "./types.js";
import type { SaasState } from "./types.js";

interface AppProps {
  readonly dataSource?: SaasDataSource;
  readonly initialRoute?: Route;
  readonly runtimePresentation?: RuntimePresentation;
}

function LoadingSurface({ stage }: { readonly stage: string }) {
  return (
    <main className="system-surface" data-screen-label="Core 加载中">
      <span className="system-spinner" />
      <h1>正在启动 AgentOS</h1>
      <p>{stage}</p>
    </main>
  );
}

function deriveAgentRuntime(runtime: RuntimePresentation, state: SaasState): RuntimePresentation {
  if (runtime.kind !== "normal" || state.route.kind !== "agent" || state.chat === null) {
    return runtime;
  }
  const agentId = state.route.agentId;
  const provider = state.chat.providers.find((candidate) => candidate.agentId === agentId);
  const selectedSessionId = state.chat.selectedSessionIds[agentId];
  const session = state.chat.sessions.find((candidate) => candidate.id === selectedSessionId);
  if (session?.state === "running" && session.activeTurnId !== null) {
    return {
      kind: "turn-running",
      sessionId: session.id,
      turnId: session.activeTurnId,
    };
  }
  if (session?.state === "cancelling" && session.activeTurnId !== null) {
    return {
      kind: "turn-cancelling",
      sessionId: session.id,
      turnId: session.activeTurnId,
    };
  }
  if (session?.state === "crashed") return { exitCode: null, kind: "agent-crashed" };
  if (provider !== undefined && provider.status !== "available") {
    return {
      kind: "provider-probing-unavailable",
      unavailableProviderIds: [provider.id],
    };
  }
  if (
    provider?.capabilities !== undefined &&
    provider.capabilities !== null &&
    provider.capabilities.permissionEnforcement !== "client_enforced"
  ) {
    return { kind: "capability-warning", providerId: provider.id };
  }
  return runtime;
}

export function App({ dataSource, initialRoute, runtimePresentation }: AppProps) {
  const source = useMemo<SaasDataSource>(() => dataSource ?? new FixtureDataSource(), [dataSource]);
  const [state, dispatch] = useReducer(saasReducer, initialSaasState);
  const [sourceRuntime, setSourceRuntime] = useState<RuntimePresentation>({ kind: "normal" });
  const effectiveRuntime = deriveAgentRuntime(runtimePresentation ?? sourceRuntime, state);
  const writesDisabled =
    effectiveRuntime.kind === "provider-probing-unavailable" ||
    effectiveRuntime.kind === "turn-running" ||
    effectiveRuntime.kind === "core-restart" ||
    effectiveRuntime.kind === "replay-gap" ||
    effectiveRuntime.kind === "session-busy" ||
    effectiveRuntime.kind === "sse-reconnecting" ||
    effectiveRuntime.kind === "turn-cancelling";
  const configured = useRef(false);
  const loadGeneration = useRef(0);
  const commandControllers = useRef(new Set<AbortController>());
  const activeSource = useRef(source);
  activeSource.current = source;

  useEffect(() => {
    if (configured.current) return;
    configured.current = true;
    const parameters = new URLSearchParams(window.location.search);
    const requestedTheme = parameters.get("theme");
    if (requestedTheme === "dark" || requestedTheme === "light") {
      dispatch({ theme: requestedTheme, type: "theme.mode" });
    }
    const accentName = parameters.get("accent");
    const accents: Readonly<Record<string, string>> = {
      cyan: "#4fd8e0",
      green: "#3ddc84",
      orange: "#ffb454",
      purple: "#b48cff",
    };
    const requestedAccent = accentName === null ? undefined : accents[accentName];
    if (requestedAccent !== undefined) {
      dispatch({
        accent: requestedAccent,
        type: "theme.accent",
      });
    }
    if (window.innerWidth <= 1_024) dispatch({ collapsed: true, type: "sidebar.set" });
    if (initialRoute !== undefined) dispatch({ route: initialRoute, type: "navigate" });
  }, [initialRoute]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 1_024) dispatch({ collapsed: true, type: "sidebar.set" });
      else dispatch({ collapsed: false, type: "sidebar.set" });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    dispatch({ type: "data.source-changing" });
    setSourceRuntime({ kind: "normal" });
  }, [source]);

  useEffect(
    () => () => {
      commandControllers.current.forEach((controller) => controller.abort());
      commandControllers.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (state.connection.kind !== "loading") return;
    const controller = new AbortController();
    const generation = ++loadGeneration.current;
    void source.getSnapshot(controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted && generation === loadGeneration.current) {
          dispatch({
            mode: source.mode,
            snapshot,
            type: "data.loaded",
          });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || generation !== loadGeneration.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "无法加载本地工作区数据";
        dispatch({ message, type: "data.failed" });
      },
    );
    return () => controller.abort();
  }, [source, state.connection.kind]);

  useEffect(() => {
    if (source.subscribe === undefined) return;
    return source.subscribe((snapshot) => {
      if (activeSource.current !== source) return;
      dispatch({ snapshot, type: "data.snapshot" });
    });
  }, [source]);

  useEffect(() => {
    if (source.subscribeRuntime === undefined) return;
    return source.subscribeRuntime(setSourceRuntime);
  }, [source]);

  const execute = (command: SaasDataCommand): Promise<void> => {
    const controller = new AbortController();
    commandControllers.current.add(controller);
    return source
      .execute(command, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSourceRuntime({
          code: error instanceof Error ? error.name : "CORE_REQUEST_FAILED",
          kind: "api-error",
          requestKey: command.name,
        });
      })
      .finally(() => {
        commandControllers.current.delete(controller);
      });
  };

  if (effectiveRuntime.kind === "core-starting") {
    return (
      <main
        className="system-surface"
        data-production-ready="true"
        data-runtime-state={effectiveRuntime.kind}
        data-screen-label="Core 加载中"
      >
        <span className="system-spinner" />
        <h1>正在启动本地 Core…</h1>
        <p>数据库迁移 → HTTP 监听 → Provider Registry</p>
      </main>
    );
  }
  if (effectiveRuntime.kind === "migration-error") {
    return (
      <main
        className="system-surface is-error"
        data-production-ready="true"
        data-runtime-state={effectiveRuntime.kind}
        data-screen-label="Core 启动错误"
      >
        <span aria-hidden="true">!</span>
        <h1>数据库迁移失败</h1>
        <p>SQLITE_MIGRATION_FAILED · migration 004_turn_journal</p>
        <div className="system-actions">
          <button onClick={() => execute({ name: "core.retry" })} type="button">
            重试
          </button>
          <button
            onClick={() => execute({ name: "diagnostics.open", source: "migration" })}
            type="button"
          >
            诊断
          </button>
        </div>
      </main>
    );
  }
  if (state.connection.kind === "loading") {
    return <LoadingSurface stage={state.connection.stage} />;
  }
  if (state.connection.kind === "error") {
    return (
      <main className="system-surface is-error" data-screen-label="加载错误">
        <span aria-hidden="true">!</span>
        <h1>本地工作区加载失败</h1>
        <p>{state.connection.message}</p>
        <button onClick={() => dispatch({ type: "data.retry" })} type="button">
          重试
        </button>
      </main>
    );
  }
  if (state.fixture === null || state.features === null) {
    throw new Error("Ready connection state requires fixture and feature state");
  }
  const loadedFixture = state.fixture;

  const sendHomeTask = () => {
    if (writesDisabled) return;
    const text = state.homeDraft.trim();
    if (text.length === 0) return;
    const requestedAgentId = state.homeMode === "auto" ? routeTask(text) : state.homeAgentId;
    const agentId = loadedFixture.agents.some((agent) => agent.id === requestedAgentId)
      ? requestedAgentId
      : state.homeAgentId;
    const provider = state.chat?.providers.find((candidate) => candidate.agentId === agentId);
    const homeCwd = resolveHomeProjectCwd(state.homeProject, state.conversationDirectory);
    const command =
      source.mode === "real"
        ? buildHomeChatCommand({
            agentId,
            cwd: homeCwd,
            provider,
            requestId: crypto.randomUUID(),
            text,
          })
        : null;
    if (source.mode === "real" && command === null) return;
    const launchCwd =
      source.mode === "real" && isAbsoluteWorkspacePath(homeCwd) ? homeCwd : undefined;
    dispatch({ draft: "", type: "home.draft" });
    dispatch({ agentId, draft: command === null ? text : "", type: "agent.draft" });
    dispatch({
      route: {
        agentId,
        ...(launchCwd === undefined ? {} : { cwd: launchCwd }),
        kind: "agent",
        tab: "session",
      },
      type: "navigate",
    });
    if (command !== null) void execute(command);
  };
  const navigate = (route: Route) => dispatch({ route, type: "navigate" });
  const selectSidebarSession = (agentId: AgentId, sessionId: string) => {
    if (writesDisabled) return;
    navigate({ agentId, kind: "agent", tab: "session" });
    void execute({ agentId, name: "session.select", sessionId });
  };
  const executeRuntimeAction = () => {
    switch (effectiveRuntime.kind) {
      case "agent-crashed":
        execute({ name: "diagnostics.open", source: "agent" });
        break;
      case "api-error":
        execute({ name: "request.retry", requestKey: effectiveRuntime.requestKey });
        break;
      case "provider-probing-unavailable":
        execute({
          name: "provider.doctor",
          providerId: effectiveRuntime.unavailableProviderIds[0] ?? "unknown",
        });
        break;
      case "turn-running":
        execute({ name: "turn.cancel", turnId: effectiveRuntime.turnId });
        break;
      default:
        break;
    }
  };

  return (
    <div data-runtime-state={effectiveRuntime.kind} id="dc-root">
      <div className="sc-host">
        <Shell
          dispatch={dispatch}
          onSessionSelect={selectSidebarSession}
          state={state}
          writesDisabled={writesDisabled}
        >
          {state.route.kind === "home" ? (
            <HomePage
              chooseDirectory={
                source.chooseDirectory === undefined
                  ? undefined
                  : () => source.chooseDirectory?.() ?? Promise.resolve(null)
              }
              dispatch={dispatch}
              onSend={sendHomeTask}
              requiresAbsolutePath={source.mode === "real"}
              state={state}
              writesDisabled={writesDisabled}
            />
          ) : state.route.kind === "dashboard" ? (
            <DashboardPage
              featureState={state.features}
              fixture={state.fixture}
              navigate={navigate}
            />
          ) : state.route.kind === "cron" ? (
            <CronPage
              dispatch={dispatch}
              featureState={state.features}
              fixture={state.fixture}
              navigate={navigate}
              writesDisabled={writesDisabled}
            />
          ) : state.route.kind === "queue" ? (
            <QueuePage
              dispatch={dispatch}
              featureState={state.features}
              fixture={state.fixture}
              navigate={navigate}
              writesDisabled={writesDisabled}
            />
          ) : state.route.kind === "usage" ? (
            <UsagePage fixture={state.fixture} navigate={navigate} />
          ) : state.route.kind === "projects" ? (
            <ProjectsPage fixture={state.fixture} navigate={navigate} />
          ) : state.route.kind === "agent" ? (
            <AgentPage
              agentId={state.route.agentId}
              chat={state.chat}
              chooseDirectory={() => source.chooseDirectory?.() ?? Promise.resolve(null)}
              dataMode={source.mode}
              dispatch={dispatch}
              execute={execute}
              featureState={state.features}
              fixture={state.fixture}
              initialCwd={state.route.cwd}
              navigate={navigate}
              onApprovalDecision={(agentId) =>
                dispatch({ agentId, type: "notifications.read-agent" })
              }
              onRuntimeChange={(agentId, status, task, last) =>
                dispatch({ agentId, last, status, task, type: "agent.runtime" })
              }
              onRuntimeAction={executeRuntimeAction}
              runtimePresentation={effectiveRuntime}
              tab={state.route.tab}
            />
          ) : state.route.kind === "memory" ? (
            <MemoryPage fixture={state.fixture} initialTab={state.route.tab} />
          ) : state.route.kind === "sessions" ? (
            <SessionsPage
              fixture={state.fixture}
              dispatch={dispatch}
              featureState={state.features}
              navigate={navigate}
              section={state.route.section}
              writesDisabled={writesDisabled}
            />
          ) : state.route.kind === "harness" ? (
            <HarnessPage
              dispatch={dispatch}
              featureState={state.features}
              fixture={state.fixture}
              section={state.route.section}
              writesDisabled={writesDisabled}
            />
          ) : state.route.kind === "settings" ? (
            <SettingsPage
              chat={state.chat}
              chooseDirectory={() => source.chooseDirectory?.() ?? Promise.resolve(null)}
              dataMode={source.mode}
              dispatch={dispatch}
              execute={execute}
              fixture={state.fixture}
              initialAgentId={state.route.agentId}
              state={state}
              writesDisabled={writesDisabled}
            />
          ) : state.route.kind === "compare" ? (
            <ComparePage fixture={state.fixture} writesDisabled={writesDisabled} />
          ) : (
            <main className="placeholder-page" data-screen-label={"AgentOS"}>
              <p>该工作区模块正在加载。</p>
            </main>
          )}
        </Shell>
      </div>
    </div>
  );
}
