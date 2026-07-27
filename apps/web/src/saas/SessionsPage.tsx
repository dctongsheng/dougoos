import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

import type { Route, SaasAction, SaasFeatureState, SaasFixture, SessionsSection } from "./types.js";

interface SessionsPageProps {
  readonly dispatch: (action: SaasAction) => void;
  readonly featureState: SaasFeatureState;
  readonly fixture: SaasFixture;
  readonly navigate: (route: Route) => void;
  readonly section: SessionsSection;
  readonly writesDisabled: boolean;
}

const categoryColors: Readonly<Record<string, string>> = {
  "Bug 排查": "var(--diff-del)",
  功能构建: "var(--ac-fg)",
  文档: "var(--wait)",
  测试: "var(--think)",
  深度专注: "var(--ac-fg)",
  重构: "#b48cff",
};

const insightColors: Readonly<Record<string, string>> = {
  "Prompt 质量": "var(--diff-del)",
  决策: "var(--think)",
  技巧: "#b48cff",
  摘要: "var(--ac-fg)",
  经验: "var(--wait)",
};

export function SessionsPage({
  dispatch,
  featureState,
  fixture,
  navigate,
  section,
  writesDisabled,
}: SessionsPageProps) {
  const sessionsFixture = fixture.features.sessions;
  const agentsById = new Map(fixture.agents.map((agent) => [agent.id, agent]));
  const {
    sessionCategory: category,
    sessionDepth: depth,
    sessionExportState: exportState,
    sessionFormat: format,
    sessionQuery: query,
    sessionSyncEnabled: syncEnabled,
    sessionSyncState: syncState,
  } = featureState;
  const exportTimer = useRef<number | null>(null);
  const exportGeneration = useRef(0);
  const syncTimer = useRef<number | null>(null);
  const syncGeneration = useRef(0);

  const cancelExport = () => {
    exportGeneration.current += 1;
    if (exportTimer.current !== null) window.clearTimeout(exportTimer.current);
    exportTimer.current = null;
  };
  const cancelSync = () => {
    syncGeneration.current += 1;
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = null;
  };

  useEffect(
    () => () => {
      const exportWasPending = exportTimer.current !== null;
      const syncWasPending = syncTimer.current !== null;
      cancelExport();
      cancelSync();
      if (exportWasPending) dispatch({ state: "idle", type: "sessions.export-state" });
      if (syncWasPending) dispatch({ state: "idle", type: "sessions.sync-state" });
    },
    [dispatch],
  );

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const agentIds = new Set(fixture.agents.map((agent) => agent.id));
    return sessionsFixture.rows.filter(
      (session) =>
        agentIds.has(session.agentId) &&
        (normalized.length === 0 ||
          session.title.toLowerCase().includes(normalized) ||
          session.project.toLowerCase().includes(normalized)),
    );
  }, [fixture.agents, query, sessionsFixture.rows]);
  const visibleSources = sessionsFixture.dashboard.sources.flatMap(([agentId, count, width]) => {
    const agent = agentsById.get(agentId);
    return agent === undefined ? [] : [{ agent, count, width }];
  });
  const visibleInsights = sessionsFixture.insights.flatMap((item) => {
    const agent = agentsById.get(item.agentId);
    return agent === undefined || (category !== "全部" && category !== item.category)
      ? []
      : [{ agent, item }];
  });
  const visibleModelUsage = sessionsFixture.analytics.modelUsage.flatMap(
    ([agentId, model, tokens, width]) => {
      const agent = agentsById.get(agentId);
      return agent === undefined ? [] : [{ agent, model, tokens, width }];
    },
  );

  const generateExport = () => {
    if (writesDisabled || exportState === "pending") return;
    cancelExport();
    const generation = exportGeneration.current;
    dispatch({ state: "pending", type: "sessions.export-state" });
    exportTimer.current = window.setTimeout(() => {
      if (generation !== exportGeneration.current) return;
      exportTimer.current = null;
      dispatch({ state: "ready", type: "sessions.export-state" });
    }, 1_600);
  };

  const syncNow = () => {
    if (writesDisabled || !syncEnabled || syncState === "pending") return;
    cancelSync();
    const generation = syncGeneration.current;
    dispatch({ state: "pending", type: "sessions.sync-state" });
    syncTimer.current = window.setTimeout(() => {
      if (generation !== syncGeneration.current) return;
      syncTimer.current = null;
      dispatch({ state: "ready", type: "sessions.sync-state" });
    }, 1_400);
  };

  return (
    <main className="sessions-page sm-page" data-screen-label="Sessions Manager">
      {section === "dashboard" ? (
        <>
          <section className="sm-kpi-grid">
            {sessionsFixture.dashboard.kpis.map(([label, value, detail, accent]) => (
              <article className="sm-kpi" key={label}>
                <div>{label}</div>
                <div>
                  <strong className={accent ? "is-accent" : undefined}>{value}</strong>
                  <small>{detail}</small>
                </div>
              </article>
            ))}
          </section>
          <section className="sm-chart-grid sm-dashboard-charts">
            <article className="sm-chart-card">
              <h2>近 7 天会话活动</h2>
              <div className="sm-bars">
                {sessionsFixture.dashboard.activity.map(([day, count, height], index, rows) => (
                  <div className="sm-bar-column" key={day}>
                    <i
                      className={index === rows.length - 1 ? "is-today" : undefined}
                      style={{ height: `${height}%` }}
                      title={`${count} 场会话`}
                    />
                    <small className={index === rows.length - 1 ? "is-today" : undefined}>
                      {day}
                    </small>
                  </div>
                ))}
              </div>
            </article>
            <article className="sm-chart-card sm-sources">
              <h2>来源工具</h2>
              {visibleSources.map(({ agent, count, width }) => {
                return (
                  <div className="sm-source-row" key={agent.id}>
                    <span
                      className="sm-agent-glyph"
                      style={{ "--sm-tone": agent.tone } as CSSProperties}
                    >
                      {agent.glyph}
                    </span>
                    <span>{agent.name}</span>
                    <div>
                      <i
                        style={
                          {
                            "--sm-tone": agent.tone,
                            width: `${width}%`,
                          } as CSSProperties
                        }
                      />
                    </div>
                    <small>{count}</small>
                  </div>
                );
              })}
              {visibleSources.length === 0 ? (
                <div className="sm-session-empty">暂无可用 Agent 的来源数据</div>
              ) : null}
            </article>
          </section>
        </>
      ) : section === "sessions" ? (
        <>
          <input
            className="sm-search"
            onChange={(event) =>
              dispatch({ query: event.currentTarget.value, type: "sessions.query" })
            }
            placeholder="搜索会话标题、项目…"
            type="text"
            value={query}
          />
          <section className="sm-session-list">
            {filteredSessions.flatMap((session) => {
              const agent = agentsById.get(session.agentId);
              if (agent === undefined) return [];
              const categoryColor = categoryColors[session.category] ?? "var(--mut)";
              return [
                <button
                  className="sm-session-row"
                  key={`${session.agentId}-${session.title}`}
                  onClick={() =>
                    navigate({
                      agentId: session.agentId,
                      kind: "agent",
                      tab: "session",
                    })
                  }
                  type="button"
                >
                  <span
                    className="sm-agent-glyph is-large"
                    style={{ "--sm-tone": agent.tone } as CSSProperties}
                  >
                    {agent.glyph}
                  </span>
                  <span className="sm-session-copy">
                    <strong>{session.title}</strong>
                    <small>
                      {agent.name} · {session.date} · {session.duration} · {session.tokens} tok
                    </small>
                  </span>
                  <span
                    className="sm-category-pill"
                    style={{ "--sm-tone": categoryColor } as CSSProperties}
                  >
                    {session.category}
                  </span>
                  <span className="sm-project-pill">⌂ {session.project}</span>
                  {session.live ? <i className="sm-live-dot" /> : null}
                </button>,
              ];
            })}
            {filteredSessions.length === 0 ? (
              <div className="sm-session-empty">没有匹配的会话</div>
            ) : null}
          </section>
        </>
      ) : section === "insights" ? (
        <>
          <nav aria-label="洞察分类" className="sm-filter-chips">
            {sessionsFixture.insightCategories.map((item) => (
              <button
                aria-pressed={category === item}
                key={item}
                onClick={() => dispatch({ category: item, type: "sessions.category" })}
                type="button"
              >
                {item}
              </button>
            ))}
          </nav>
          <section className="sm-insight-grid">
            {visibleInsights.map(({ agent, item }) => {
              const categoryColor = insightColors[item.category] ?? "var(--mut)";
              return (
                <article className="sm-insight-card" key={item.text}>
                  <header>
                    <span
                      className="sm-insight-category"
                      style={{ "--sm-tone": categoryColor } as CSSProperties}
                    >
                      {item.category}
                    </span>
                    <i />
                    <time>{item.date}</time>
                  </header>
                  <p>{item.text}</p>
                  <footer>
                    <span style={{ color: agent.tone }}>{agent.glyph}</span>
                    <span>
                      {agent.name} {item.source}
                    </span>
                    <i />
                    <span>⌂ {item.project}</span>
                  </footer>
                </article>
              );
            })}
            {visibleInsights.length === 0 ? (
              <div className="sm-session-empty">暂无可用 Agent 的洞察</div>
            ) : null}
          </section>
        </>
      ) : section === "analytics" ? (
        <>
          <section className="sm-kpi-grid is-analytics">
            {sessionsFixture.analytics.kpis.map(([label, value]) => (
              <article className="sm-kpi" key={label}>
                <div>{label}</div>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          <section className="sm-chart-grid">
            <article className="sm-chart-card">
              <h2>费用趋势 · 7 天</h2>
              <div className="sm-bars">
                {sessionsFixture.analytics.trend.map(([day, height], index, rows) => (
                  <div className="sm-bar-column" key={day}>
                    <i
                      className={index === rows.length - 1 ? "is-today" : undefined}
                      style={{ height: `${height}%` }}
                    />
                    <small className={index === rows.length - 1 ? "is-today" : undefined}>
                      {day}
                    </small>
                  </div>
                ))}
              </div>
            </article>
            <article className="sm-chart-card sm-models">
              <h2>Token · 按模型</h2>
              {visibleModelUsage.map(({ agent, model, tokens, width }) => {
                return (
                  <div className="sm-model-row" key={model}>
                    <span>{model}</span>
                    <div>
                      <i
                        style={
                          {
                            "--sm-tone": agent.tone,
                            width: `${width}%`,
                          } as CSSProperties
                        }
                      />
                    </div>
                    <small>{tokens}</small>
                  </div>
                );
              })}
              {visibleModelUsage.length === 0 ? (
                <div className="sm-session-empty">暂无可用 Agent 的模型数据</div>
              ) : null}
            </article>
          </section>
        </>
      ) : section === "patterns" ? (
        <>
          <p className="sm-description">
            从多场会话中提炼的重复模式 · 出现次数越多越值得沉淀为规则
          </p>
          <section className="sm-pattern-grid">
            {sessionsFixture.patterns.map((pattern) => (
              <article className="sm-pattern-card" key={pattern.name}>
                <header>
                  <strong>✧ {pattern.name}</strong>
                  <i />
                  <small className={pattern.up ? "is-up" : undefined}>{pattern.trend}</small>
                  <span>×{pattern.count}</span>
                </header>
                <p>{pattern.description}</p>
                <footer>
                  {pattern.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </footer>
              </article>
            ))}
          </section>
        </>
      ) : section === "export" ? (
        <>
          <p className="sm-description">跨会话综合导出 · LLM 去重合并后生成可执行产物</p>
          <section className="sm-format-grid">
            {sessionsFixture.export.formats.map(([name, description]) => (
              <button
                aria-pressed={format === name}
                disabled={writesDisabled}
                key={name}
                onClick={() => {
                  if (writesDisabled) return;
                  cancelExport();
                  dispatch({ format: name, type: "sessions.format" });
                }}
                type="button"
              >
                <strong>{name}</strong>
                <span>{description}</span>
              </button>
            ))}
          </section>
          <section className="sm-export-actions">
            <span>深度</span>
            <div>
              {sessionsFixture.export.depths.map(([name, label]) => (
                <button
                  aria-pressed={depth === name}
                  disabled={writesDisabled}
                  key={name}
                  onClick={() => {
                    if (writesDisabled) return;
                    cancelExport();
                    dispatch({ depth: name, type: "sessions.depth" });
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <i />
            <button
              className="sm-primary-action"
              disabled={writesDisabled}
              onClick={generateExport}
              type="button"
            >
              <span>{exportState === "pending" ? "生成中…" : "生成导出"}</span>
            </button>
          </section>
          {exportState === "ready" ? (
            <div className="sm-success-note">
              ✓ 已生成 {format} · {depth}档 · 覆盖 96 场会话,去重合并 342 →{" "}
              {depth === "精要" ? "25" : depth === "完整" ? "200" : "80"} 条
            </div>
          ) : null}
        </>
      ) : (
        <section className="sm-sync-panel">
          <header>
            <div>
              <strong>本地优先 · 云端同步</strong>
              <small>~/.agentos/data.db · 全部数据在本机,同步仅传加密快照</small>
            </div>
            <button
              aria-label="本地优先 · 云端同步"
              aria-pressed={syncEnabled}
              className="sm-switch"
              disabled={writesDisabled}
              onClick={() => {
                if (writesDisabled) return;
                cancelSync();
                dispatch({ enabled: !syncEnabled, type: "sessions.sync-enabled" });
              }}
              type="button"
            >
              <span />
            </button>
          </header>
          {sessionsFixture.sync.devices.map(([glyph, name, meta], index) => (
            <div className="sm-device-row" key={name}>
              <span>{glyph}</span>
              <div>
                <strong>{name}</strong>
                <small>{meta}</small>
              </div>
              <span className={index === 0 || syncEnabled ? "is-synced" : undefined}>
                {index === 0 ? "✓ 最新" : syncEnabled ? "✓ 已同步" : "已暂停"}
              </span>
            </div>
          ))}
          <footer>
            <span>上次同步 {syncState === "ready" ? "刚刚" : "3 分钟前"}</span>
            <i />
            <button
              className="sm-sync-action"
              disabled={writesDisabled || !syncEnabled}
              onClick={syncNow}
              type="button"
            >
              <span>{syncState === "pending" ? "同步中…" : "立即同步"}</span>
            </button>
          </footer>
        </section>
      )}
    </main>
  );
}
