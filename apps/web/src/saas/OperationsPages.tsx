import { useEffect, useRef } from "react";

import type { QueueTaskFixture } from "./feature-fixtures.js";
import { agentById } from "./fixtures.js";
import type { AgentId, Route, SaasAction, SaasFeatureState, SaasFixture } from "./types.js";

interface OperationsPageProps {
  readonly featureState?: SaasFeatureState;
  readonly fixture: SaasFixture;
  readonly navigate: (route: Route) => void;
}

interface MutableOperationsPageProps extends OperationsPageProps {
  readonly dispatch: (action: SaasAction) => void;
  readonly featureState: SaasFeatureState;
  readonly writesDisabled: boolean;
}

const compactTokens = (tokens: number): string =>
  tokens === 0
    ? "0"
    : tokens >= 1_000_000
      ? `${(tokens / 1_000_000).toFixed(2)}M`
      : `${Math.round(tokens / 1_000)}k`;

const runtimeByAgent: Readonly<Record<AgentId, string>> = {
  claude: "11m00s",
  codex: "23m00s",
  cursor: "17m00s",
  grok: "4m00s",
  hermes: "0m00s",
  openclaw: "0m00s",
  opencode: "0m00s",
  pi: "0m00s",
};

export function DashboardPage({ featureState, fixture, navigate }: OperationsPageProps) {
  const active = fixture.agents.filter((agent) => agent.status !== "idle").length;
  const waiting = fixture.agents.filter((agent) => agent.status === "waiting").length;
  const cost = fixture.agents.reduce((sum, agent) => sum + agent.cost, 4.73);
  const tokens = fixture.agents.reduce((sum, agent) => sum + agent.tokenCount, 2_160_000);
  const kpis = [
    {
      className: "is-accent",
      label: "活跃 Agent",
      sub: "运行中",
      value: `${active}/${String(fixture.agents.length)}`,
    },
    {
      className: waiting > 0 ? "is-waiting" : "",
      label: "等待确认",
      sub: waiting > 0 ? "需要处理" : "无阻塞",
      value: String(waiting),
    },
    { className: "", label: "今日费用", sub: "预算 78%", value: `$${cost.toFixed(2)}` },
    { className: "", label: "今日 Tokens", sub: "全部 agent", value: compactTokens(tokens) },
  ];

  return (
    <main className="page-stack dashboard-page" data-screen-label="总览">
      <section className="kpi-grid">
        {kpis.map((kpi) => (
          <article className="panel kpi-card" key={kpi.label}>
            <span>{kpi.label}</span>
            <div>
              <strong className={kpi.className}>{kpi.value}</strong>
              <small>{kpi.sub}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="agent-card-grid">
        {fixture.agents.map((agent) => (
          <article
            className={`panel agent-card${agent.status === "waiting" ? " is-waiting" : ""}`}
            key={agent.id}
          >
            <header>
              <span
                className="agent-glyph"
                style={{ "--agent-tone": agent.tone } as React.CSSProperties}
              >
                {agent.glyph}
              </span>
              <div>
                <strong>{agent.name}</strong>
                <small>
                  {agent.model} · {agent.cwd}
                </small>
              </div>
              <span className={`status-pill status-${agent.status}`}>
                <i />
                {fixture.features.operations.statusLabels[agent.status]}
              </span>
            </header>
            <p>{agent.task}</p>
            <code className="agent-last">{agent.last}</code>
            <footer>
              <span>⏱ {runtimeByAgent[agent.id]}</span>
              <span>{compactTokens(agent.tokenCount)} tok</span>
              <strong>${agent.cost.toFixed(2)}</strong>
              <i />
              <button
                onClick={() => navigate({ agentId: agent.id, kind: "agent", tab: "session" })}
                type="button"
              >
                打开 →
              </button>
            </footer>
          </article>
        ))}
      </section>

      <section className="dashboard-lower">
        <article className="panel summary-panel">
          <header>
            <strong>任务队列</strong>
            <button onClick={() => navigate({ kind: "queue" })} type="button">
              全部 →
            </button>
          </header>
          <div className="dashboard-peek-list">
            {fixture.features.operations.queue.tasks.map((task) => {
              const status =
                featureState?.queueStatuses[task.id] ??
                fixture.features.operations.queue.statuses[task.id] ??
                "queued";
              return (
                <p key={task.id}>
                  <span className={`peek-status is-${status}`}>
                    {status === "done" ? "完成" : status === "running" ? "运行" : "排队"}
                  </span>
                  <span>{task.title}</span>
                  <code>{task.project}</code>
                </p>
              );
            })}
          </div>
        </article>
        <article className="panel summary-panel">
          <header>
            <strong>最近通知</strong>
            <button onClick={() => navigate({ kind: "usage" })} type="button">
              用量 →
            </button>
          </header>
          <div className="dashboard-notifications">
            {fixture.notifications.map((notification) => {
              const agent =
                notification.agentId === null ? null : agentById(fixture, notification.agentId);
              return (
                <p key={notification.id} style={{ opacity: notification.read ? 0.55 : 1 }}>
                  <span
                    className="agent-glyph"
                    style={{ "--agent-tone": agent?.tone ?? "#4fd8e0" } as React.CSSProperties}
                  >
                    {agent?.glyph ?? "◔"}
                  </span>
                  <span>{notification.title}</span>
                  <small>{notification.time}</small>
                </p>
              );
            })}
          </div>
        </article>
      </section>
    </main>
  );
}

export function CronPage({
  dispatch,
  featureState,
  fixture,
  writesDisabled,
}: MutableOperationsPageProps) {
  const cron = fixture.features.operations.cron;

  return (
    <main className="compact-page page-stack" data-screen-label="定时任务">
      <p className="page-description">按计划自动派发 · 与 Workflows 联动</p>
      <section className="list-stack">
        {cron.tasks.map((task) => {
          const agent = agentById(fixture, task.agentId);
          const on = featureState.cronEnabled[task.id] === true;
          return (
            <article className="panel schedule-row" key={task.id}>
              <span
                className="cron-glyph"
                style={{ "--agent-tone": agent.tone } as React.CSSProperties}
              >
                {agent.glyph}
              </span>
              <div>
                <strong>{task.title}</strong>
                <small>
                  {agent.name} · {task.schedule} · 下次 {task.next}
                </small>
              </div>
              <code className={on && task.last.startsWith("✓") ? "is-success" : ""}>
                {on ? task.last : "— 已暂停"}
              </code>
              <button
                aria-label={`${task.title}${on ? "已启用" : "已停用"}`}
                aria-pressed={on}
                className="switch"
                disabled={writesDisabled}
                onClick={() => {
                  if (!writesDisabled) dispatch({ id: task.id, type: "cron.toggle" });
                }}
                type="button"
              >
                <span />
              </button>
            </article>
          );
        })}
      </section>
    </main>
  );
}

export function QueuePage({
  dispatch,
  featureState,
  fixture,
  writesDisabled,
}: MutableOperationsPageProps) {
  const queue = fixture.features.operations.queue;
  const timers = useRef<Record<string, number>>({});

  useEffect(
    () => () => {
      Object.entries(timers.current).forEach(([taskId, timer]) => {
        window.clearTimeout(timer);
        dispatch({ status: "queued", taskId, type: "queue.status" });
      });
      timers.current = {};
    },
    [dispatch],
  );

  const dispatchTask = (task: QueueTaskFixture) => {
    const agentId = featureState.queueAssignees[task.id];
    if (writesDisabled || agentId === undefined || featureState.queueStatuses[task.id] !== "queued")
      return;
    dispatch({ status: "running", taskId: task.id, type: "queue.status" });
    const timer = window.setTimeout(() => {
      timers.current = Object.fromEntries(
        Object.entries(timers.current).filter(([taskId]) => taskId !== task.id),
      );
      dispatch({ status: "done", taskId: task.id, type: "queue.status" });
    }, 4_200);
    timers.current[task.id] = timer;
  };

  return (
    <main className="compact-page page-stack" data-screen-label="长程任务">
      <p className="page-description">点选 Agent 后派发任务;运行完成后自动回报</p>
      <section className="list-stack">
        {queue.tasks.map((task) => {
          const status = featureState.queueStatuses[task.id] ?? "queued";
          const assigned = featureState.queueAssignees[task.id];
          return (
            <article className={`panel queue-card is-${status}`} key={task.id}>
              <header>
                <strong>{task.title}</strong>
                <small>{task.project}</small>
                <span className="queue-state">
                  {status === "queued" ? "排队" : status === "running" ? "运行" : "完成"}
                </span>
              </header>
              {status === "queued" ? (
                <div className="queue-actions">
                  <div className="assignee-list">
                    {fixture.agents.map((agent) => (
                      <button
                        aria-pressed={assigned === agent.id}
                        disabled={writesDisabled}
                        key={agent.id}
                        onClick={() => {
                          if (writesDisabled) return;
                          dispatch({
                            agentId: assigned === agent.id ? undefined : agent.id,
                            taskId: task.id,
                            type: "queue.assignee",
                          });
                        }}
                        style={{ "--agent-tone": agent.tone } as React.CSSProperties}
                        title={agent.name}
                        type="button"
                      >
                        {agent.glyph}
                      </button>
                    ))}
                  </div>
                  <span />
                  <button
                    className="primary-action"
                    disabled={writesDisabled || assigned === undefined}
                    onClick={() => dispatchTask(task)}
                    type="button"
                  >
                    派发 →
                  </button>
                </div>
              ) : status === "running" && assigned !== undefined ? (
                <div className="running-line">▸ {agentById(fixture, assigned).name} 执行中 …</div>
              ) : (
                <div className="done-line">
                  {task.result ?? "✓ 已完成"} ·{" "}
                  {assigned === undefined ? "" : agentById(fixture, assigned).name}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

export function UsagePage({ fixture }: OperationsPageProps) {
  return (
    <main className="page-stack" data-screen-label="用量统计">
      <section className="panel section-panel">
        <h1>用量统计</h1>
        {fixture.agents.map((agent) => (
          <div className="usage-row" key={agent.id}>
            <span
              className="agent-glyph"
              style={{ "--agent-tone": agent.tone } as React.CSSProperties}
            >
              {agent.glyph}
            </span>
            <strong>{agent.name}</strong>
            <span>{agent.model}</span>
            <code>{compactTokens(agent.tokenCount)} tok</code>
            <code>${agent.cost.toFixed(2)}</code>
          </div>
        ))}
      </section>
    </main>
  );
}

export function ProjectsPage({ fixture }: OperationsPageProps) {
  return (
    <main className="page-stack" data-screen-label="项目">
      <section className="panel section-panel">
        <h1>项目</h1>
        {fixture.projects.map((project) => (
          <div className="project-row" key={project.id}>
            <span aria-hidden="true">{project.kind === "conversation" ? "◫" : "❒"}</span>
            <strong>{project.name}</strong>
            {project.kind === "directory" ? <code>{project.path}</code> : <span />}
            <small>
              {project.sessions.length} {project.kind === "conversation" ? "个对话" : "sessions"}
            </small>
          </div>
        ))}
      </section>
    </main>
  );
}
