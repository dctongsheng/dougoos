import { useRef } from "react";
import type { CSSProperties } from "react";

import {
  hasValidPermissionProfile,
  isAbsoluteWorkspacePath,
  resolveHomeProjectCwd,
  resolveHomeTaskAgentId,
} from "./home-task.js";
import { routeTask } from "./home-routing.js";
import type { SaasAction, SaasState } from "./types.js";

interface HomePageProps {
  readonly chooseDirectory: (() => Promise<string | null>) | undefined;
  readonly dispatch: (action: SaasAction) => void;
  readonly onSend: () => void;
  readonly requiresAbsolutePath: boolean;
  readonly state: SaasState;
  readonly writesDisabled: boolean;
}

const agentStatusLabel = {
  executing: "执行中",
  idle: "空闲",
  thinking: "思考中",
  waiting: "等待确认",
} as const;

export function HomePage({
  chooseDirectory,
  dispatch,
  onSend,
  requiresAbsolutePath,
  state,
  writesDisabled,
}: HomePageProps) {
  const composing = useRef(false);
  const fixture = state.fixture;
  if (fixture === null) throw new Error("HomePage requires loaded fixture data");
  const selectableAgents =
    state.chat === null
      ? fixture.agents
      : state.chat.agentCatalog.flatMap((item) => {
          const agent = fixture.agents.find((candidate) => candidate.id === item.agentId);
          return agent === undefined ? [] : [agent];
        });
  const selectedAgent =
    selectableAgents.find((agent) => agent.id === state.homeAgentId) ?? selectableAgents[0];
  const launchAgentId = resolveHomeTaskAgentId({
    requestedAgentId:
      state.homeMode === "auto" ? routeTask(state.homeDraft.trim()) : state.homeAgentId,
    selectableAgentIds: selectableAgents.map((agent) => agent.id),
    selectedAgentId: state.homeAgentId,
  });
  const launchProvider = state.chat?.providers.find(
    (provider) => provider.agentId === launchAgentId,
  );
  const launchPreference = state.chat?.providerPreferences.find(
    (preference) => preference.providerId === launchProvider?.id,
  );
  const permissionProfileIsReady =
    state.chat === null ||
    hasValidPermissionProfile(launchProvider, launchPreference?.permissionProfileId);
  const selectedPath = resolveHomeProjectCwd(state.homeProject, state.conversationDirectory);
  const directoryPaths = [
    ...new Set([
      ...(state.homeProject.kind === "directory" ? [state.homeProject.path] : []),
      ...fixture.projects
        .filter((project) => project.kind === "directory")
        .map((project) => project.path),
    ]),
  ].filter((path) => !requiresAbsolutePath || isAbsoluteWorkspacePath(path));
  const pathIsReady = !requiresAbsolutePath || isAbsoluteWorkspacePath(selectedPath);
  const sendIsReady =
    state.homeDraft.trim().length > 0 &&
    pathIsReady &&
    selectedAgent !== undefined &&
    permissionProfileIsReady;

  const pickSuggestion = (suggestion: string) => {
    if (!writesDisabled) dispatch({ draft: suggestion, type: "home.draft" });
  };

  const chooseProjectDirectory = () => {
    if (writesDisabled || chooseDirectory === undefined) return;
    dispatch({ menu: "path", type: "home.menu" });
    void chooseDirectory().then((selected) => {
      if (selected !== null) {
        dispatch({
          project: { kind: "directory", path: selected },
          type: "home.project",
        });
      }
    });
  };

  return (
    <main className="home-page" data-screen-label="新建任务">
      <div className="home-glow" aria-hidden="true" />
      <div className="home-content">
        <header className="home-heading">
          <p>下午好 · RYO</p>
          <h1>有什么可以帮你的?</h1>
        </header>

        <section className="composer-card" aria-label="新任务">
          <textarea
            aria-label="任务内容"
            disabled={writesDisabled}
            onChange={(event) => dispatch({ draft: event.currentTarget.value, type: "home.draft" })}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !composing.current &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!writesDisabled && sendIsReady) onSend();
              }
            }}
            placeholder="交给我一个任务,或问我任何问题"
            rows={3}
            value={state.homeDraft}
          />

          <div className="composer-toolbar">
            <div className="segmented" aria-label="Agent 路由模式">
              <button
                aria-pressed={state.homeMode === "manual"}
                disabled={writesDisabled}
                onClick={() => dispatch({ mode: "manual", type: "home.mode" })}
                type="button"
              >
                指定 Agent
              </button>
              <button
                aria-pressed={state.homeMode === "auto"}
                disabled={writesDisabled}
                onClick={() => dispatch({ mode: "auto", type: "home.mode" })}
                type="button"
              >
                智能路由
              </button>
            </div>

            {state.homeMode === "auto" ? (
              <div className="auto-route-chip" title="AgentOS 根据任务内容自动选择最合适的 Agent">
                ◈ 由 AgentOS 判断
              </div>
            ) : (
              <div className="picker-wrap">
                <button
                  aria-expanded={state.homeMenu === "agent"}
                  className="picker-button"
                  disabled={writesDisabled || selectedAgent === undefined}
                  onClick={() => dispatch({ menu: "agent", type: "home.menu" })}
                  type="button"
                >
                  {selectedAgent === undefined ? (
                    <strong>未检测到可用 Agent</strong>
                  ) : (
                    <>
                      <span
                        className="agent-glyph"
                        style={{ "--agent-tone": selectedAgent.tone } as CSSProperties}
                      >
                        {selectedAgent.glyph}
                      </span>
                      <strong>{selectedAgent.name}</strong>
                    </>
                  )}
                  <span aria-hidden="true">▼</span>
                </button>
                {state.homeMenu === "agent" ? (
                  <div className="picker-menu agent-menu" role="menu">
                    {selectableAgents.map((agent) => (
                      <button
                        className={agent.id === state.homeAgentId ? "is-selected" : ""}
                        disabled={writesDisabled}
                        key={agent.id}
                        onClick={() => dispatch({ agentId: agent.id, type: "home.agent" })}
                        role="menuitem"
                        type="button"
                      >
                        <span
                          className="agent-glyph"
                          style={{ "--agent-tone": agent.tone } as CSSProperties}
                        >
                          {agent.glyph}
                        </span>
                        <strong>{agent.name}</strong>
                        <small>{agentStatusLabel[agent.status]}</small>
                        <span aria-hidden="true" className={`status-dot status-${agent.status}`} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            <div className="picker-wrap">
              <button
                aria-expanded={state.homeMenu === "path"}
                className="picker-button path-button"
                disabled={writesDisabled}
                onClick={() => dispatch({ menu: "path", type: "home.menu" })}
                type="button"
              >
                <span aria-hidden="true">⌂</span>
                <span className="path-value">
                  {state.homeProject.kind === "conversation" ? "对话" : state.homeProject.path}
                </span>
                <span aria-hidden="true">▼</span>
              </button>
              {state.homeMenu === "path" ? (
                <div className="picker-menu path-menu" role="menu">
                  <button
                    className={state.homeProject.kind === "conversation" ? "is-selected" : ""}
                    disabled={writesDisabled}
                    onClick={() =>
                      dispatch({ project: { kind: "conversation" }, type: "home.project" })
                    }
                    role="menuitem"
                    type="button"
                  >
                    <span aria-hidden="true">◫</span>
                    <strong>对话</strong>
                  </button>
                  {directoryPaths.map((path) => (
                    <button
                      className={
                        state.homeProject.kind === "directory" && path === state.homeProject.path
                          ? "is-selected"
                          : ""
                      }
                      disabled={writesDisabled}
                      key={path}
                      onClick={() =>
                        dispatch({
                          project: { kind: "directory", path },
                          type: "home.project",
                        })
                      }
                      role="menuitem"
                      type="button"
                    >
                      <span aria-hidden="true">⌂</span>
                      <strong>{path}</strong>
                      {path.startsWith("~/dev/") ? <small>{path.split("/").at(-1)}</small> : null}
                    </button>
                  ))}
                  {chooseDirectory === undefined ? null : (
                    <button
                      disabled={writesDisabled}
                      onClick={chooseProjectDirectory}
                      role="menuitem"
                      type="button"
                    >
                      <span aria-hidden="true">＋</span>
                      <strong>选择其他项目目录…</strong>
                    </button>
                  )}
                </div>
              ) : null}
            </div>

            <span className="model-note">
              {!pathIsReady
                ? "请先选择项目目录"
                : !permissionProfileIsReady
                  ? "请先在设置中重新选择权限档位"
                  : "模型由 Agent 管理"}
            </span>
            <button
              aria-disabled={writesDisabled || !sendIsReady}
              aria-label="发送任务"
              className="send-button"
              disabled={writesDisabled || !sendIsReady}
              onClick={onSend}
              title="发送 (⌘+Enter)"
              type="button"
            >
              ➤
            </button>
          </div>
        </section>

        <div className="suggestion-list" aria-label="任务建议">
          {fixture.suggestions.map((suggestion) => (
            <button
              disabled={writesDisabled}
              key={suggestion}
              onClick={() => pickSuggestion(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <p className="home-status">4 个 Agent 运行中 · 今日 $12.47 · ⌘+Enter 发送</p>
      </div>
    </main>
  );
}
