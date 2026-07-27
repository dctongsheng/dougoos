import { useState } from "react";
import type { CSSProperties } from "react";

import { agentById } from "./fixtures.js";
import type {
  AgentId,
  ChatViewSnapshot,
  DataMode,
  SaasAction,
  SaasDataCommand,
  SaasFixture,
  SaasState,
  SidebarVisibilityKey,
} from "./types.js";

interface SettingsPageProps {
  readonly chat: ChatViewSnapshot | null;
  readonly chooseDirectory: () => Promise<string | null>;
  readonly dataMode: DataMode;
  readonly dispatch: (action: SaasAction) => void;
  readonly execute: (command: SaasDataCommand) => Promise<void>;
  readonly fixture: SaasFixture;
  readonly initialAgentId: AgentId;
  readonly state: SaasState;
  readonly writesDisabled: boolean;
}

interface ConversationDirectoryUpdateInput {
  readonly chooseDirectory: () => Promise<string | null>;
  readonly execute: (command: SaasDataCommand) => Promise<void>;
  readonly onDirectorySelected?: () => void;
}

export async function chooseAndUpdateConversationDirectory({
  chooseDirectory,
  execute,
  onDirectorySelected,
}: ConversationDirectoryUpdateInput): Promise<"cancelled" | "updated"> {
  const selectedPath = await chooseDirectory();
  if (selectedPath === null) return "cancelled";
  onDirectorySelected?.();
  await execute({
    conversationDirectory: selectedPath,
    name: "preferences.conversation-directory.update",
  });
  return "updated";
}

const visibilityKeyByName: Readonly<Record<string, "dashboard" | SidebarVisibilityKey>> = {
  Analytics: "sessions-analytics",
  "Cloud Sync": "sessions-sync",
  Dashboard: "sessions-dashboard",
  Export: "sessions-export",
  Goals: "harness-goal",
  Hooks: "harness-hooks",
  Insights: "sessions-insights",
  MCP: "harness-mcp",
  Memory: "memory",
  Patterns: "sessions-patterns",
  Rules: "harness-rules",
  Sessions: "sessions-sessions",
  Skills: "harness-skills",
  SubAgents: "harness-subagents",
  "System Prompt": "harness-prompt",
  Workflows: "harness-workflows",
  总览: "dashboard",
  新建任务: "home",
  任务编排: "orchestration",
  对话: "project-conversations",
  置顶: "project-pinned",
  项目: "project-list",
};

export function SettingsPage({
  chat,
  chooseDirectory,
  dataMode,
  dispatch,
  execute,
  fixture,
  initialAgentId,
  state,
  writesDisabled,
}: SettingsPageProps) {
  const [conversationDirectoryError, setConversationDirectoryError] = useState<string | null>(null);
  const [conversationDirectoryUpdate, setConversationDirectoryUpdate] = useState<
    "choosing" | "idle" | "saving"
  >("idle");
  const [refreshingClis, setRefreshingClis] = useState(false);
  const settingsFixture = fixture.features.settings;
  const agentBinaries = settingsFixture.agentBinaries as Readonly<Partial<Record<AgentId, string>>>;
  const apiKeyMasks = settingsFixture.apiKeyMasks as Readonly<Partial<Record<AgentId, string>>>;
  const modelOptions = settingsFixture.modelOptions as Readonly<
    Partial<Record<AgentId, readonly string[]>>
  >;
  const settingsState = state.features;
  if (settingsState === null) throw new Error("Settings requires loaded feature state");
  const configurableAgents =
    dataMode === "real"
      ? (chat?.agentCatalog.flatMap((item) => {
          const agent = fixture.agents.find((candidate) => candidate.id === item.agentId);
          return agent === undefined ? [] : [agent];
        }) ?? [])
      : fixture.agents;
  const selectedAgent =
    configurableAgents.find((agent) => agent.id === initialAgentId) ?? configurableAgents[0];
  const selectedAgentId = selectedAgent?.id;
  const models = settingsState.settingsModels;
  const notifyDone = settingsState.settingsNotifyDone;
  const notifyWait = settingsState.settingsNotifyWait;
  const selectedProvider =
    selectedAgentId === undefined
      ? undefined
      : chat?.providers.find((provider) => provider.id === selectedAgentId);
  const selectedCatalogItem =
    selectedAgentId === undefined
      ? undefined
      : chat?.agentCatalog.find((item) => item.agentId === selectedAgentId);
  const selectedPreference =
    selectedAgentId === undefined
      ? undefined
      : chat?.providerPreferences.find((preference) => preference.providerId === selectedAgentId);
  const selectedPermissionProfileId =
    selectedPreference?.permissionProfileId ?? selectedProvider?.defaultPermissionProfileId;
  const selectedPermissionProfile = selectedProvider?.permissionProfiles.find(
    (profile) => profile.id === selectedPermissionProfileId,
  );
  const permissionProfileIsStale =
    selectedPreference !== undefined &&
    selectedProvider !== undefined &&
    selectedPermissionProfile === undefined;
  const visibilityOn = (name: string): boolean => {
    const key = visibilityKeyByName[name];
    if (key === undefined) return true;
    return key === "dashboard" ? state.dashboardVisible : (state.sidebarVisibility[key] ?? true);
  };
  const toggleVisibility = (name: string) => {
    if (writesDisabled) return;
    const key = visibilityKeyByName[name];
    if (key === "dashboard") {
      dispatch({ type: "settings.dashboard-visible" });
    } else if (key !== undefined) {
      dispatch({ key, type: "settings.sidebar-visible" });
    }
  };
  const toggleAgentVisibility = (agentId: AgentId) => {
    if (writesDisabled) return;
    const currentlyVisible = state.sidebarVisibility[agentId] ?? true;
    if (dataMode === "real") {
      const provider = chat?.providers.find((candidate) => candidate.id === agentId);
      const preference = chat?.providerPreferences.find(
        (candidate) => candidate.providerId === agentId,
      );
      const permissionProfileId =
        preference?.permissionProfileId ?? provider?.defaultPermissionProfileId;
      if (permissionProfileId === undefined) return;
      void execute({
        name: "provider.preference.update",
        permissionProfileId,
        providerId: agentId,
        visibleInSidebar: !currentlyVisible,
      });
      return;
    }
    dispatch({ key: agentId, type: "settings.sidebar-visible" });
  };
  const costTotal = fixture.agents.reduce((sum, agent) => sum + agent.cost, 4.73);
  const tokenTotal = fixture.agents.reduce((sum, agent) => sum + agent.tokenCount, 2_160_000);
  const maxUsageCost = Math.max(...fixture.agents.map((agent) => agent.cost), 0.01);
  const maxDayCost = Math.max(...settingsFixture.usageDays.map(([, value]) => value));

  return (
    <main className="settings-page page-stack" data-screen-label="设置">
      <section className="panel settings-section">
        <h2>外观</h2>
        <div className="appearance-controls">
          <div className="appearance-control">
            <strong>主题</strong>
            <div className="segmented">
              <button
                aria-pressed={state.theme === "dark"}
                disabled={writesDisabled}
                onClick={() => {
                  if (!writesDisabled) dispatch({ theme: "dark", type: "theme.mode" });
                }}
                type="button"
              >
                深色
              </button>
              <button
                aria-pressed={state.theme === "light"}
                disabled={writesDisabled}
                onClick={() => {
                  if (!writesDisabled) dispatch({ theme: "light", type: "theme.mode" });
                }}
                type="button"
              >
                浅色
              </button>
            </div>
          </div>
          <div className="appearance-control">
            <strong>主题色</strong>
            <div className="swatch-row">
              {settingsFixture.accents.map((accent) => (
                <button
                  aria-label={`强调色 ${accent}`}
                  aria-pressed={state.accent === accent}
                  disabled={writesDisabled}
                  key={accent}
                  onClick={() => {
                    if (!writesDisabled) dispatch({ accent, type: "theme.accent" });
                  }}
                  style={{ background: accent, color: accent }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="conversation-project-heading"
        className="panel settings-section conversation-project-settings-section"
      >
        <header>
          <div>
            <h2 id="conversation-project-heading">对话项目</h2>
            <p>新建对话默认在这个目录中运行，Agent 可以在这里读取和创建文件。</p>
          </div>
          <span>内置项目</span>
        </header>
        <div className="conversation-directory-card">
          <span aria-hidden="true" className="conversation-project-icon">
            ◇
          </span>
          <div>
            <strong>对话目录</strong>
            <code aria-label="当前对话目录" title={state.conversationDirectory}>
              {state.conversationDirectory || "目录尚未加载"}
            </code>
            <small>修改只影响之后新建的对话，不会移动已有对话或文件。</small>
          </div>
          <button
            aria-label="更改对话项目目录"
            disabled={writesDisabled || conversationDirectoryUpdate !== "idle"}
            onClick={() => {
              if (writesDisabled || conversationDirectoryUpdate !== "idle") return;
              setConversationDirectoryError(null);
              setConversationDirectoryUpdate("choosing");
              void chooseAndUpdateConversationDirectory({
                chooseDirectory,
                execute,
                onDirectorySelected: () => setConversationDirectoryUpdate("saving"),
              })
                .catch(() => {
                  setConversationDirectoryError("无法更新对话目录，请重试。");
                })
                .finally(() => setConversationDirectoryUpdate("idle"));
            }}
            type="button"
          >
            {conversationDirectoryUpdate === "choosing"
              ? "选择中…"
              : conversationDirectoryUpdate === "saving"
                ? "保存中…"
                : "选择目录"}
          </button>
        </div>
        {conversationDirectoryError === null ? null : (
          <p className="conversation-directory-error" role="alert">
            {conversationDirectoryError}
          </p>
        )}
      </section>

      <section className="panel settings-section customize-section">
        <div>
          <h2>界面自定义</h2>
          <p>勾选侧边栏中显示的模块 —— 主导航、PROJECTS、Agent、HARNESS 与 Sessions Manager</p>
        </div>
        {settingsFixture.visibilityGroups.slice(0, 2).map((group) => (
          <div className="visibility-group" key={group.label}>
            <h3>{group.label}</h3>
            <div className="visibility-grid">
              {group.rows.map(([glyph, name]) => {
                const on = visibilityOn(name);
                return (
                  <button
                    aria-pressed={on}
                    disabled={writesDisabled}
                    key={name}
                    onClick={() => toggleVisibility(name)}
                    type="button"
                  >
                    <span>{glyph}</span>
                    <strong>{name}</strong>
                    <small>{on ? "✓" : "—"}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="visibility-group">
          <h3>AGENTS · {configurableAgents.length}</h3>
          <div className="visibility-grid">
            {configurableAgents.map((agent) => {
              const on = state.sidebarVisibility[agent.id] ?? true;
              return (
                <button
                  aria-pressed={on}
                  disabled={writesDisabled}
                  key={agent.id}
                  onClick={() => toggleAgentVisibility(agent.id)}
                  style={{ "--agent-tone": agent.tone } as CSSProperties}
                  type="button"
                >
                  <span>{agent.glyph}</span>
                  <strong>{agent.name}</strong>
                  <small>{on ? "✓" : "—"}</small>
                </button>
              );
            })}
            {configurableAgents.length === 0 ? (
              <p className="cli-empty-state">
                暂无已检测且已接入的 Agent CLI。请先在下方重新检测。
              </p>
            ) : null}
          </div>
        </div>
        {settingsFixture.visibilityGroups.slice(2).map((group) => (
          <div className="visibility-group" key={group.label}>
            <h3>{group.label}</h3>
            <div className="visibility-grid">
              {group.rows.map(([glyph, name]) => {
                const on = visibilityOn(name);
                return (
                  <button
                    aria-pressed={on}
                    disabled={writesDisabled}
                    key={name}
                    onClick={() => toggleVisibility(name)}
                    type="button"
                  >
                    <span>{glyph}</span>
                    <strong>{name}</strong>
                    <small>{on ? "✓" : "—"}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {dataMode === "real" ? (
        <section className="panel settings-section cli-discovery-section">
          <header>
            <div>
              <h2>本地 CLI 自动检测</h2>
              <p>
                从 PATH、显式配置与常见安装目录安全探测；只运行已知命令的
                <code>--version</code>。
              </p>
            </div>
            <strong>{chat?.cliInstallations.length ?? 0} 个已安装</strong>
            <button
              disabled={writesDisabled || refreshingClis}
              onClick={() => {
                setRefreshingClis(true);
                void execute({ name: "clis.refresh" }).finally(() => setRefreshingClis(false));
              }}
              type="button"
            >
              {refreshingClis ? "检测中…" : "重新检测"}
            </button>
          </header>
          <div className="cli-installation-list" aria-label="已安装的本地 Agent CLI">
            {chat?.cliInstallations.length ? (
              chat.cliInstallations.map((cli) => (
                <article key={cli.command}>
                  <span aria-hidden="true">⌘</span>
                  <div>
                    <strong>{cli.displayName}</strong>
                    <code>{cli.command}</code>
                    <small title={cli.executablePath}>{cli.executablePath}</small>
                  </div>
                  <div>
                    {cli.integratedProviderId === undefined ? (
                      <em>已检测</em>
                    ) : (
                      <em className="is-integrated">已接入</em>
                    )}
                    <small>{cli.version ?? "版本未知"}</small>
                  </div>
                </article>
              ))
            ) : (
              <p className="cli-empty-state">
                暂未检测到已知 Agent CLI。安装后点击“重新检测”即可出现。
              </p>
            )}
          </div>
        </section>
      ) : null}

      <section className="panel settings-section agent-config-section">
        <div>
          <h2>Agent 配置</h2>
          <p>接入的 CLI Agent 的模型、密钥、工作目录与审批策略</p>
        </div>
        <nav className="agent-config-tabs" aria-label="Agent 配置选择">
          {configurableAgents.map((agent) => (
            <button
              aria-pressed={selectedAgent?.id === agent.id}
              key={agent.id}
              onClick={() =>
                dispatch({
                  route: { agentId: agent.id, kind: "settings" },
                  type: "navigate",
                })
              }
              style={{ "--agent-tone": agent.tone } as CSSProperties}
              type="button"
            >
              <span>{agent.glyph}</span>
              {agent.name}
              <i className={`status-dot status-${agent.status}`} />
            </button>
          ))}
        </nav>
        {selectedAgent === undefined || selectedAgentId === undefined ? (
          <div className="agent-config-panel agent-config-empty">
            <p>没有可配置的 Agent。安装并重新检测已接入的 CLI 后即可设置权限。</p>
          </div>
        ) : (
          <div className="agent-config-panel">
            <header>
              <span
                className="agent-config-glyph"
                style={{ "--agent-tone": selectedAgent.tone } as CSSProperties}
              >
                {selectedAgent.glyph}
              </span>
              <div>
                <strong>{selectedAgent.name}</strong>
                <small>
                  {dataMode === "real"
                    ? [selectedCatalogItem?.cli.executablePath, selectedCatalogItem?.cli.version]
                        .filter(Boolean)
                        .join(" · ")
                    : agentBinaries[selectedAgentId]}
                </small>
              </div>
              <strong className="enabled-label">
                {selectedAgent.enabled ? "可用" : "当前不可用"}
              </strong>
            </header>
            <div className="agent-config-fields">
              <div className="config-field">
                <label>模型</label>
                <div className="model-options">
                  {(dataMode === "real"
                    ? [selectedAgent.model]
                    : (modelOptions[selectedAgentId] ?? [selectedAgent.model])
                  ).map((model) => (
                    <button
                      aria-pressed={(models[selectedAgentId] ?? selectedAgent.model) === model}
                      disabled={writesDisabled || dataMode === "real"}
                      key={model}
                      onClick={() => {
                        if (!writesDisabled)
                          dispatch({
                            agentId: selectedAgentId,
                            model,
                            type: "settings.model",
                          });
                      }}
                      style={{ "--agent-tone": selectedAgent.tone } as CSSProperties}
                      type="button"
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </div>
              <div className="config-field horizontal-field">
                <label>认证</label>
                <code>
                  {dataMode === "real" ? "使用 CLI 当前登录状态" : apiKeyMasks[selectedAgentId]}
                </code>
              </div>
              <div className="config-field horizontal-field">
                <label>工作目录</label>
                <code>{selectedAgent.cwd}</code>
              </div>
              {dataMode === "real" && selectedProvider !== undefined ? (
                <div className="config-field permission-profile-field">
                  <label htmlFor={`permission-profile-${selectedAgentId}`}>权限级别</label>
                  <select
                    disabled={writesDisabled}
                    id={`permission-profile-${selectedAgentId}`}
                    onChange={(event) => {
                      void execute({
                        name: "provider.preference.update",
                        permissionProfileId: event.currentTarget.value,
                        providerId: selectedProvider.id,
                        visibleInSidebar:
                          selectedPreference?.visibleInSidebar ??
                          state.sidebarVisibility[selectedAgentId] ??
                          true,
                      });
                    }}
                    value={selectedPermissionProfileId}
                  >
                    {permissionProfileIsStale ? (
                      <option disabled value={selectedPermissionProfileId}>
                        已移除：{selectedPermissionProfileId}（请重新选择）
                      </option>
                    ) : null}
                    {selectedProvider.permissionProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                  {permissionProfileIsStale ? (
                    <div className="permission-profile-note risk-stale">
                      <strong>⚠ 权限档位已失效</strong>
                      <small>
                        CLI 升级后不再提供 {selectedPermissionProfileId}。新建 Session
                        已被阻止，请重新选择一个权限档位。
                      </small>
                    </div>
                  ) : selectedPermissionProfile === undefined ? null : (
                    <div
                      className={`permission-profile-note risk-${selectedPermissionProfile.risk}`}
                    >
                      <strong>
                        {selectedPermissionProfile.risk === "dangerous"
                          ? "⚠ 高风险权限"
                          : selectedPermissionProfile.label}
                      </strong>
                      <small>{selectedPermissionProfile.description}</small>
                      <small>修改只影响之后新建的 Session。</small>
                      {selectedPermissionProfile.permissionEnforcement ===
                      "client_enforced" ? null : (
                        <small>
                          执行保证：{selectedPermissionProfile.permissionEnforcement}
                          ，部分限制由 CLI 或外部 Gateway 决定。
                        </small>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="config-field approval-policy-field">
                  <label>权限级别</label>
                  <div>
                    <strong>演示模式</strong>
                    <small>真实 CLI 模式下可选择原生权限档位，默认使用最高权限。</small>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel settings-section usage-settings-section">
        <header>
          <h2>用量统计</h2>
          <code>
            今日 ${costTotal.toFixed(2)} · {(tokenTotal / 1_000_000).toFixed(2)}M tok
          </code>
          <span />
          <strong>预算 78%</strong>
        </header>
        <div className="usage-bars">
          {settingsFixture.usageDays.map(([day, value], index) => (
            <div key={day}>
              <span
                className={index === settingsFixture.usageDays.length - 1 ? "is-today" : ""}
                style={{ height: `${Math.max(6, Math.round((value / maxDayCost) * 100))}%` }}
              />
              <small>{day}</small>
            </div>
          ))}
        </div>
        <div className="usage-agent-list">
          {fixture.agents.map((agent) => (
            <div className="usage-agent-row" key={agent.id}>
              <span className="agent-glyph" style={{ "--agent-tone": agent.tone } as CSSProperties}>
                {agent.glyph}
              </span>
              <strong>{agent.name}</strong>
              <div>
                <span
                  style={
                    {
                      "--agent-tone": agent.tone,
                      width: `${Math.round((agent.cost / maxUsageCost) * 100)}%`,
                    } as CSSProperties
                  }
                />
              </div>
              <code>
                {agent.tokenCount >= 1_000
                  ? `${Math.round(agent.tokenCount / 1_000)}k`
                  : agent.tokenCount}
              </code>
              <code>${agent.cost.toFixed(2)}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="panel settings-section notification-settings-section">
        <h2>通知与预算</h2>
        <div className="daily-budget-row">
          <strong>每日预算</strong>
          <code>{settingsFixture.budget.daily}</code>
          <div>
            <span />
          </div>
          <span>已用 78%</span>
        </div>
        <label className="notification-toggle">
          <button
            aria-label="任务完成时推送通知"
            aria-pressed={notifyDone}
            className="switch"
            disabled={writesDisabled}
            onClick={() => {
              if (!writesDisabled) dispatch({ type: "settings.notify-done" });
            }}
            type="button"
          >
            <span />
          </button>
          <strong>任务完成时推送通知</strong>
        </label>
        <label className="notification-toggle">
          <button
            aria-label="Agent 等待确认时提醒"
            aria-pressed={notifyWait}
            className="switch"
            disabled={writesDisabled}
            onClick={() => {
              if (!writesDisabled) dispatch({ type: "settings.notify-wait" });
            }}
            type="button"
          >
            <span />
          </button>
          <strong>Agent 等待确认时提醒</strong>
        </label>
      </section>

      {dataMode === "fixture" ? (
        <>
          <section className="panel settings-section projects-settings-section">
            <h2>项目</h2>
            {settingsFixture.projects.map((project) => (
              <div className="settings-project-row" key={project.name}>
                <div>
                  <header>
                    <strong>{project.name}</strong>
                    <code>⎇ {project.branch}</code>
                    <span className={project.dirty ? "is-dirty" : ""}>{project.changes}</span>
                  </header>
                  <small>
                    {project.path} · {project.last}
                  </small>
                </div>
                <aside>
                  {project.agentIds.map((agentId) => {
                    const agent = agentById(fixture, agentId);
                    return (
                      <span
                        className="agent-glyph"
                        key={agent.id}
                        style={{ "--agent-tone": agent.tone } as CSSProperties}
                        title={agent.name}
                      >
                        {agent.glyph}
                      </span>
                    );
                  })}
                </aside>
              </div>
            ))}
          </section>

          <ComparePanel fixture={fixture} writesDisabled={writesDisabled} />
        </>
      ) : null}
    </main>
  );
}

export function ComparePage({
  fixture,
  writesDisabled = false,
}: {
  readonly fixture: SaasFixture;
  readonly writesDisabled?: boolean;
}) {
  return (
    <main className="page-stack" data-screen-label="结果对比">
      <ComparePanel fixture={fixture} writesDisabled={writesDisabled} />
    </main>
  );
}

function ComparePanel({
  fixture,
  writesDisabled,
}: {
  readonly fixture: SaasFixture;
  readonly writesDisabled: boolean;
}) {
  const [adopted, setAdopted] = useState<AgentId | null>(null);
  const results = fixture.features.settings.compareResults;
  const visibleResults = results.flatMap((result) => {
    const agent = fixture.agents.find((candidate) => candidate.id === result.agentId);
    return agent === undefined ? [] : [{ agent, result }];
  });
  const adoptedAgent =
    adopted === null ? undefined : fixture.agents.find((agent) => agent.id === adopted);

  return (
    <section className="panel settings-section compare-section">
      <header className="compare-heading">
        <h2>结果对比</h2>
        <p>同一 prompt 派给 {visibleResults.length} 个 Agent · 滑动窗口 rate limiter</p>
      </header>
      {adoptedAgent === undefined ? null : (
        <div className="success-note">
          已采纳 {adoptedAgent.name} 的实现 — diff 已进入审阅队列,其余分支已归档
        </div>
      )}
      <div className="compare-grid">
        {visibleResults.map(({ agent, result }) => {
          const selected = adopted === result.agentId;
          return (
            <article className={selected ? "is-adopted" : ""} key={result.agentId}>
              <header>
                <span
                  className="agent-glyph"
                  style={{ "--agent-tone": agent.tone } as CSSProperties}
                >
                  {agent.glyph}
                </span>
                <strong>{agent.name}</strong>
                {selected ? <small>✓ 已采纳</small> : null}
              </header>
              <dl>
                <div>
                  <dt>用时</dt>
                  <dd>{result.time}</dd>
                </div>
                <div>
                  <dt>费用</dt>
                  <dd>{result.cost}</dd>
                </div>
                <div>
                  <dt>TOKENS</dt>
                  <dd>{result.tokens}</dd>
                </div>
                <div>
                  <dt>测试</dt>
                  <dd className={result.tests.includes("✓") ? "is-success" : "is-warning"}>
                    {result.tests}
                  </dd>
                </div>
              </dl>
              <p>{result.note}</p>
              <button
                disabled={writesDisabled}
                onClick={() => {
                  if (!writesDisabled) setAdopted(result.agentId);
                }}
                type="button"
              >
                采纳此实现
              </button>
            </article>
          );
        })}
        {visibleResults.length === 0 ? (
          <div className="agent-config-empty">当前没有可对比的 Agent 结果。</div>
        ) : null}
      </div>
    </section>
  );
}
