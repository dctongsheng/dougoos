import { useState } from "react";
import type { ReactNode } from "react";
import type { CSSProperties } from "react";

import { agentById } from "./fixtures.js";
import { routeMeta } from "./state.js";
import {
  type AgentId,
  type HarnessSection,
  type Route,
  type SaasAction,
  type SaasState,
  type SessionsSection,
} from "./types.js";

interface ShellProps {
  readonly children: ReactNode;
  readonly dispatch: (action: SaasAction) => void;
  readonly onSessionSelect: (agentId: AgentId, sessionId: string) => void;
  readonly state: SaasState;
  readonly writesDisabled: boolean;
}

interface NavigationItem {
  readonly glyph: string;
  readonly label: string;
  readonly route: Route;
}

const queueItems: readonly NavigationItem[] = [
  { glyph: "◷", label: "定时任务", route: { kind: "cron" } },
  { glyph: "⇶", label: "长程任务", route: { kind: "queue" } },
];

const harnessItems: readonly {
  readonly glyph: string;
  readonly label: string;
  readonly section: HarnessSection;
}[] = [
  { glyph: "¶", label: "System Prompt", section: "prompt" },
  { glyph: "✦", label: "Skills", section: "skills" },
  { glyph: "⚙", label: "MCP", section: "mcp" },
  { glyph: "⛬", label: "SubAgents", section: "subagents" },
  { glyph: "◎", label: "Goals", section: "goal" },
  { glyph: "⧉", label: "Workflows", section: "workflows" },
  { glyph: "⚓", label: "Hooks", section: "hooks" },
  { glyph: "§", label: "Rules", section: "rules" },
];

const sessionsItems: readonly {
  readonly glyph: string;
  readonly label: string;
  readonly section: SessionsSection;
}[] = [
  { glyph: "⊞", label: "Dashboard", section: "dashboard" },
  { glyph: "❐", label: "Sessions", section: "sessions" },
  { glyph: "☉", label: "Insights", section: "insights" },
  { glyph: "▥", label: "Analytics", section: "analytics" },
  { glyph: "✧", label: "Patterns", section: "patterns" },
  { glyph: "⇩", label: "Export", section: "export" },
  { glyph: "☁", label: "Cloud Sync", section: "sync" },
];

const sameRoute = (left: Route, right: Route): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "agent" && right.kind === "agent") return left.agentId === right.agentId;
  if (left.kind === "harness" && right.kind === "harness") return left.section === right.section;
  if (left.kind === "sessions" && right.kind === "sessions") return left.section === right.section;
  return true;
};

function NavButton({
  active,
  badge,
  glyph,
  indent,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly badge?: string;
  readonly glyph: string;
  readonly indent?: "queue" | "section";
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`nav-button${
        indent === "queue" ? " nav-sub" : indent === "section" ? " nav-section" : ""
      }`}
      data-nav-label={label}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">{glyph}</span>
      <strong>{label}</strong>
      {badge === undefined ? null : <small>{badge}</small>}
    </button>
  );
}

export function Shell({ children, dispatch, onSessionSelect, state, writesDisabled }: ShellProps) {
  const [sections, setSections] = useState({
    agents: true,
    harness: true,
    projects: true,
    queue: true,
    sessions: true,
  });
  const toggleSection = (section: keyof typeof sections) =>
    setSections((current) => ({ ...current, [section]: !current[section] }));
  const [openAgents, setOpenAgents] = useState<Record<AgentId, boolean>>(() => {
    const fixture = state.fixture;
    return Object.fromEntries(
      (fixture?.agents ?? []).map((agent) => [
        agent.id,
        agent.enabled && (fixture?.features.agent.initialMessages[agent.id]?.length ?? 0) > 0,
      ]),
    ) as Record<AgentId, boolean>;
  });
  const fixture = state.fixture;
  if (fixture === null) throw new Error("Shell requires loaded fixture data");
  const stats = fixture.agents.reduce(
    (total, agent) => ({
      active: total.active + (agent.status === "idle" ? 0 : 1),
      cost: total.cost + agent.cost,
      tokens: total.tokens + agent.tokenCount,
    }),
    { active: 0, cost: 4.73, tokens: 2_160_000 },
  );
  const routeMetadata = routeMeta(state.route, (agentId) => agentById(fixture, agentId).name);
  const meta =
    state.route.kind === "agent"
      ? { ...routeMetadata, subtitle: agentById(fixture, state.route.agentId).cwd }
      : routeMetadata;
  const unread = fixture.notifications.filter((notification) => !notification.read);
  const navigate = (route: Route) => dispatch({ route, type: "navigate" });
  const isRealMode = state.chat !== null;
  const visibleAgents = fixture.agents.filter((agent) => state.sidebarVisibility[agent.id] ?? true);
  const linkedAgentCount = state.chat?.agentCatalog.length ?? fixture.agents.length;
  const visibleHarnessItems = harnessItems.filter(
    (item) => state.sidebarVisibility[`harness-${item.section}`],
  );
  const visibleSessionsItems = sessionsItems.filter(
    (item) => state.sidebarVisibility[`sessions-${item.section}`],
  );
  const projectsVisible =
    state.sidebarVisibility.projects &&
    (state.sidebarVisibility["project-pinned"] ||
      state.sidebarVisibility["project-list"] ||
      state.sidebarVisibility["project-conversations"]);

  return (
    <div
      className={`app-shell theme-${state.theme}${
        state.collapsedSidebar ? " sidebar-collapsed" : ""
      }`}
      data-production-ready="true"
      style={{ "--accent": state.accent } as CSSProperties}
    >
      <aside className="sidebar" aria-label="主导航">
        <header className="brand">
          <div aria-hidden="true" className="brand-mark">
            ◈
          </div>
          <div className="brand-copy">
            <strong>AgentOS</strong>
            <small>workspace / local</small>
          </div>
          <button
            aria-label={state.collapsedSidebar ? "展开侧栏" : "收起侧栏"}
            className="sidebar-toggle"
            onClick={() => dispatch({ type: "sidebar.toggle" })}
            type="button"
          >
            {state.collapsedSidebar ? "›" : "‹"}
          </button>
        </header>

        <nav className="sidebar-scroll">
          {state.sidebarVisibility.home ? (
            <NavButton
              active={state.route.kind === "home"}
              glyph="＋"
              label="新建任务"
              onClick={() => navigate({ kind: "home" })}
            />
          ) : null}
          {state.dashboardVisible ? (
            <NavButton
              active={state.route.kind === "dashboard"}
              glyph="▦"
              label="总览"
              onClick={() => navigate({ kind: "dashboard" })}
            />
          ) : null}
          {state.sidebarVisibility.orchestration ? (
            <>
              <button
                aria-current={
                  state.route.kind === "cron" || state.route.kind === "queue" ? "page" : undefined
                }
                aria-expanded={sections.queue}
                className="nav-button nav-parent"
                onClick={() => toggleSection("queue")}
                type="button"
              >
                <span aria-hidden="true">▤</span>
                <strong>任务编排</strong>
                <small>2</small>
                <span aria-hidden="true" className={`nav-caret${sections.queue ? " is-open" : ""}`}>
                  ▶
                </span>
              </button>
              {sections.queue
                ? queueItems.map((item) => (
                    <NavButton
                      active={sameRoute(state.route, item.route)}
                      glyph={item.glyph}
                      key={item.label}
                      label={item.label}
                      onClick={() => navigate(item.route)}
                      indent="queue"
                    />
                  ))
                : null}
            </>
          ) : null}
          {state.sidebarVisibility.memory ? (
            <NavButton
              active={state.route.kind === "memory"}
              glyph="✦"
              label="Memory"
              onClick={() => navigate({ kind: "memory", tab: "graph" })}
            />
          ) : null}

          {projectsVisible ? (
            <>
              <button
                aria-expanded={sections.projects}
                className="section-heading"
                onClick={() => toggleSection("projects")}
                type="button"
              >
                <span className="section-title">PROJECTS</span>
                <span className={sections.projects ? "is-open" : ""}>▶</span>
              </button>
              {sections.projects ? (
                <>
                  {state.sidebarVisibility["project-pinned"] && !isRealMode ? (
                    <details className="pinned-tree">
                      <summary>置顶</summary>
                      <button onClick={() => navigate({ kind: "compare" })} type="button">
                        <span aria-hidden="true" className="pinned-icon">
                          ⚑
                        </span>
                        <span>限流方案对比 · 3 agents</span>
                      </button>
                      <button
                        onClick={() =>
                          navigate({ agentId: "claude", kind: "agent", tab: "session" })
                        }
                        type="button"
                      >
                        <span aria-hidden="true" className="pinned-icon">
                          ⚑
                        </span>
                        <span>users 表 schema 迁移</span>
                      </button>
                    </details>
                  ) : null}
                  {fixture.projects
                    .filter((project) =>
                      project.kind === "conversation"
                        ? state.sidebarVisibility["project-conversations"]
                        : state.sidebarVisibility["project-list"],
                    )
                    .map((project) => (
                      <details
                        className={
                          project.kind === "conversation"
                            ? "project-tree conversation-project"
                            : "project-tree"
                        }
                        key={project.id}
                        open={project.initiallyOpen}
                      >
                        <summary>
                          <span aria-hidden="true" className="project-icon">
                            {project.kind === "conversation" ? "◫" : "❒"}
                          </span>
                          <span className="project-name">{project.name}</span>
                        </summary>
                        {project.sessions.flatMap((session) => {
                          const sessionAgent = fixture.agents.find(
                            (agent) => agent.id === session.agentId,
                          );
                          return sessionAgent === undefined
                            ? []
                            : [
                                <button
                                  data-session-id={session.sessionId}
                                  key={`${project.id}-${session.sessionId ?? session.title}`}
                                  onClick={() => {
                                    if (state.chat !== null && session.sessionId !== undefined) {
                                      onSessionSelect(session.agentId, session.sessionId);
                                      return;
                                    }
                                    navigate({
                                      agentId: session.agentId,
                                      kind: "agent",
                                      tab: "session",
                                    });
                                  }}
                                  type="button"
                                >
                                  <span>{session.title}</span>
                                  <span
                                    className="agent-glyph tree-agent"
                                    style={{ "--agent-tone": sessionAgent.tone } as CSSProperties}
                                  >
                                    {sessionAgent.glyph}
                                  </span>
                                </button>,
                              ];
                        })}
                      </details>
                    ))}
                </>
              ) : null}
            </>
          ) : null}

          {visibleAgents.length > 0 ? (
            <button
              aria-expanded={sections.agents}
              className="section-heading"
              onClick={() => toggleSection("agents")}
              type="button"
            >
              <span className="section-title">AGENTS</span>
              <span className={sections.agents ? "is-open" : ""}>▶</span>
            </button>
          ) : null}
          {sections.agents
            ? visibleAgents.map((agent) => {
                const selected = state.route.kind === "agent" && state.route.agentId === agent.id;
                const open = openAgents[agent.id] === true;
                const histories = fixture.features.agent.histories[agent.id] ?? [];
                const installed =
                  state.chat === null ||
                  state.chat.agentCatalog.some((item) => item.agentId === agent.id);
                const hasFixtureLive =
                  state.chat === null &&
                  agent.enabled &&
                  (fixture.features.agent.initialMessages[agent.id]?.length ?? 0) > 0;
                const selectedSessionId = state.chat?.selectedSessionIds[agent.id];
                return (
                  <div className="agent-tree" data-agent-id={agent.id} key={agent.id}>
                    <div
                      aria-current={selected ? "page" : undefined}
                      className="agent-nav"
                      style={{ opacity: agent.enabled ? 1 : 0.45 }}
                    >
                      <button
                        aria-expanded={open}
                        aria-label={`${open ? "收起" : "展开"} ${agent.name} 会话`}
                        className="agent-nav-toggle"
                        onClick={() =>
                          setOpenAgents((current) => ({
                            ...current,
                            [agent.id]: !current[agent.id],
                          }))
                        }
                        type="button"
                      >
                        <span className={open ? "is-open" : ""}>▶</span>
                      </button>
                      <button
                        className="agent-nav-primary"
                        onClick={() =>
                          navigate({ agentId: agent.id, kind: "agent", tab: "session" })
                        }
                        type="button"
                      >
                        <span
                          className="agent-glyph"
                          style={{ "--agent-tone": agent.tone } as CSSProperties}
                        >
                          {agent.glyph}
                        </span>
                        <strong>{agent.name}</strong>
                        {!installed ? <small>CLI 未安装</small> : null}
                        {agent.status === "waiting" && agent.enabled ? <small>!</small> : null}
                        <span
                          aria-hidden="true"
                          className={`status-dot ${agent.enabled ? `status-${agent.status}` : ""}`}
                        />
                      </button>
                    </div>
                    {open ? (
                      <div className="agent-session-tree">
                        {hasFixtureLive ? (
                          <button
                            aria-current={
                              selected && state.route.tab === "session" ? "page" : undefined
                            }
                            className="agent-session-row"
                            onClick={() =>
                              navigate({ agentId: agent.id, kind: "agent", tab: "session" })
                            }
                            title={agent.task}
                            type="button"
                          >
                            <span>{agent.task}</span>
                            <small>{agent.cwd.split("/").at(-1) ?? "其他"}</small>
                            <i aria-hidden="true" className={`status-dot status-${agent.status}`} />
                          </button>
                        ) : null}
                        {histories.map((history) => (
                          <button
                            aria-current={
                              selected &&
                              state.route.tab === "session" &&
                              selectedSessionId === history.sessionId
                                ? "page"
                                : undefined
                            }
                            className="agent-session-row"
                            data-session-id={history.sessionId}
                            disabled={state.chat === null ? false : writesDisabled}
                            key={history.sessionId}
                            onClick={() => {
                              if (state.chat !== null) {
                                onSessionSelect(agent.id, history.sessionId);
                                return;
                              }
                              navigate({ agentId: agent.id, kind: "agent", tab: "history" });
                            }}
                            title={`${history.summary} · ${history.date} · ${history.sessionId}`}
                            type="button"
                          >
                            <span>{history.summary}</span>
                            <small>{history.project}</small>
                            <time>{history.date.slice(-5)}</time>
                          </button>
                        ))}
                        {!hasFixtureLive && histories.length === 0 ? (
                          <div className="agent-no-session">暂无会话</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}

          {state.sidebarVisibility.harness && visibleHarnessItems.length > 0 ? (
            <>
              <button
                aria-expanded={sections.harness}
                className="section-heading"
                onClick={() => toggleSection("harness")}
                type="button"
              >
                <span className="section-title">HARNESS</span>
                <span className={sections.harness ? "is-open" : ""}>▶</span>
              </button>
              {sections.harness
                ? visibleHarnessItems.map((item) => (
                    <NavButton
                      active={
                        state.route.kind === "harness" && state.route.section === item.section
                      }
                      glyph={item.glyph}
                      key={item.section}
                      label={item.label}
                      onClick={() => navigate({ kind: "harness", section: item.section })}
                      indent="section"
                    />
                  ))
                : null}
            </>
          ) : null}

          {state.sidebarVisibility.sessions && visibleSessionsItems.length > 0 ? (
            <>
              <button
                aria-expanded={sections.sessions}
                className="section-heading"
                onClick={() => toggleSection("sessions")}
                type="button"
              >
                <span className="section-title">SESSIONS MANAGER</span>
                <span className={sections.sessions ? "is-open" : ""}>▶</span>
              </button>
              {sections.sessions
                ? visibleSessionsItems.map((item) => (
                    <NavButton
                      active={
                        state.route.kind === "sessions" && state.route.section === item.section
                      }
                      glyph={item.glyph}
                      key={item.section}
                      label={item.label}
                      onClick={() => navigate({ kind: "sessions", section: item.section })}
                      indent="section"
                    />
                  ))
                : null}
            </>
          ) : null}
        </nav>

        <footer className="sidebar-footer">
          <div className="budget-label">
            <span>今日预算</span>
            <strong>78%</strong>
          </div>
          <div className="budget-track">
            <span />
          </div>
          <div className="profile">
            <span className="avatar">R</span>
            <div>
              <strong>Ryo</strong>
              <small>Pro · {linkedAgentCount} agents linked</small>
            </div>
            <button
              aria-label="设置"
              onClick={() =>
                navigate({
                  agentId:
                    state.route.kind === "agent"
                      ? state.route.agentId
                      : (state.chat?.agentCatalog[0]?.agentId ?? fixture.agents[0]?.id ?? "codex"),
                  kind: "settings",
                })
              }
              type="button"
            >
              ⚙
            </button>
          </div>
        </footer>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            aria-label="切换侧栏"
            className="mobile-sidebar-toggle"
            onClick={() => dispatch({ type: "sidebar.toggle" })}
            type="button"
          >
            ☰
          </button>
          <strong>{meta.label}</strong>
          <small>{meta.subtitle}</small>
          <div className="topbar-spacer" />
          <div className="runtime-stats">
            <span>
              活跃{" "}
              <strong>
                {stats.active}/{linkedAgentCount}
              </strong>
            </span>
            <span>
              今日 <strong>${stats.cost.toFixed(2)}</strong>
            </span>
            <span>{(stats.tokens / 1_000_000).toFixed(2)}M tok</span>
          </div>
          <div
            aria-expanded={state.notificationOpen}
            aria-label="通知"
            className="notification-button"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                dispatch({ type: "notifications.toggle" });
              }
            }}
            onClick={() => dispatch({ type: "notifications.toggle" })}
            role="button"
            tabIndex={0}
          >
            ◍{unread.length === 0 ? null : <small>{unread.length}</small>}
          </div>
          <time dateTime="12:05:06">12:05:06</time>
        </header>

        {state.notificationOpen ? (
          <section className="notification-panel" aria-label="通知面板" style={{ zIndex: 900 }}>
            <header>
              <strong>通知</strong>
              <button
                disabled={writesDisabled}
                onClick={() => dispatch({ type: "notifications.mark-all" })}
                type="button"
              >
                全部已读
              </button>
            </header>
            {fixture.notifications.map((notification) => {
              const agent =
                notification.agentId === null
                  ? undefined
                  : fixture.agents.find((candidate) => candidate.id === notification.agentId);
              return (
                <button
                  className={notification.read ? "is-read" : ""}
                  disabled={writesDisabled}
                  key={notification.id}
                  onClick={() => {
                    dispatch({ id: notification.id, type: "notifications.read" });
                    if (notification.agentId !== null && agent !== undefined) {
                      navigate({
                        agentId: notification.agentId,
                        kind: "agent",
                        tab: "session",
                      });
                    }
                  }}
                  type="button"
                >
                  <span
                    className="agent-glyph"
                    style={
                      {
                        "--agent-tone": agent?.tone ?? "#4fd8e0",
                      } as CSSProperties
                    }
                  >
                    {agent?.glyph ?? "◔"}
                  </span>
                  <span>
                    <strong>{notification.title}</strong>
                    <small>{notification.text}</small>
                  </span>
                  <time>{notification.time}</time>
                  {notification.read ? null : <i aria-label="未读" />}
                </button>
              );
            })}
          </section>
        ) : null}

        <div className="screen-scroll">{children}</div>
      </div>
    </div>
  );
}

export const defaultAgentId = (route: Route): AgentId =>
  route.kind === "agent" || route.kind === "settings" ? route.agentId : "codex";
