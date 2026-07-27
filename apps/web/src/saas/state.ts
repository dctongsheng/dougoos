import type {
  AgentId,
  Route,
  RouteMeta,
  SaasAction,
  SaasFeatureState,
  SaasFixture,
  SaasDataSnapshot,
  SaasState,
} from "./types.js";

const featureStateFrom = (fixture: SaasFixture): SaasFeatureState => ({
  agentDrafts: Object.fromEntries(fixture.agents.map((agent) => [agent.id, ""])) as Record<
    AgentId,
    string
  >,
  agentMessages: Object.fromEntries(
    fixture.agents.map((agent) => [
      agent.id,
      [...(fixture.features.agent.initialMessages[agent.id] ?? [])],
    ]),
  ) as SaasFeatureState["agentMessages"],
  cronEnabled: { ...fixture.features.operations.cron.enabled },
  harnessHookOn: { ...fixture.features.harness.initialHooks },
  harnessMcpOn: { ...fixture.features.harness.initialMcps },
  harnessRunningWorkflow: null,
  queueAssignees: { ...fixture.features.operations.queue.assignees },
  queueStatuses: { ...fixture.features.operations.queue.statuses },
  sessionCategory: "全部",
  sessionDepth: fixture.features.sessions.export.initialDepth,
  sessionExportState: "idle",
  sessionFormat: fixture.features.sessions.export.initialFormat,
  sessionQuery: "",
  sessionSyncEnabled: fixture.features.sessions.sync.initialEnabled,
  sessionSyncState: "idle",
  settingsAgentEnabled: Object.fromEntries(
    fixture.agents.map((agent) => [agent.id, agent.enabled]),
  ) as Record<AgentId, boolean>,
  settingsModels: Object.fromEntries(
    fixture.agents.map((agent) => [agent.id, agent.model]),
  ) as Record<AgentId, string>,
  settingsNotifyDone: fixture.features.settings.initialNotifyDone,
  settingsNotifyWait: fixture.features.settings.initialNotifyWait,
});

const withFeatures = (
  state: SaasState,
  update: (features: SaasFeatureState) => SaasFeatureState,
): SaasState => (state.features === null ? state : { ...state, features: update(state.features) });

/**
 * A DataSource snapshot owns the fixture and every feature value derived from
 * that fixture. Applying them together prevents source rows and rendered
 * feature state from describing different revisions.
 *
 * UI-local preferences live outside this replacement (theme, accent, route,
 * sidebar visibility, dashboard visibility, Home draft/project/mode, in-progress
 * Agent drafts, and shell state), so a live server snapshot cannot silently
 * erase those choices. Rendered messages remain snapshot-owned.
 */
const replaceSourceSnapshot = (state: SaasState, snapshot: SaasDataSnapshot): SaasState => {
  const nextFeatures = featureStateFrom(snapshot.fixture);
  const agentIds = new Set(snapshot.fixture.agents.map((agent) => agent.id));
  const selectableAgentIds = new Set(
    snapshot.chat?.agentCatalog.map((agent) => agent.agentId) ??
      snapshot.fixture.agents.map((agent) => agent.id),
  );
  const fallbackAgentId = snapshot.chat?.agentCatalog[0]?.agentId ?? snapshot.fixture.agents[0]?.id;
  const homeAgentId = selectableAgentIds.has(state.homeAgentId)
    ? state.homeAgentId
    : (fallbackAgentId ?? state.homeAgentId);
  const route =
    (state.route.kind === "agent" || state.route.kind === "settings") &&
    !agentIds.has(state.route.agentId)
      ? { kind: "home" as const }
      : state.route;
  const dynamicVisibility = Object.fromEntries(
    snapshot.fixture.agents.map((agent) => [
      agent.id,
      snapshot.chat?.providerPreferences.find((preference) => preference.providerId === agent.id)
        ?.visibleInSidebar ??
        state.sidebarVisibility[agent.id] ??
        true,
    ]),
  );
  return {
    ...state,
    chat: snapshot.chat ?? null,
    conversationDirectory: snapshot.conversationDirectory,
    dataRevision: snapshot.revision,
    features:
      state.features === null
        ? nextFeatures
        : {
            ...nextFeatures,
            agentDrafts: {
              ...nextFeatures.agentDrafts,
              ...state.features.agentDrafts,
            },
          },
    fixture: snapshot.fixture,
    homeAgentId,
    route,
    sidebarVisibility: {
      ...state.sidebarVisibility,
      ...dynamicVisibility,
    },
  };
};

export const initialSaasState: SaasState = {
  accent: "#3ddc84",
  chat: null,
  collapsedSidebar: false,
  connection: { kind: "loading", stage: "正在加载本地工作区…" },
  conversationDirectory: "",
  dataRevision: null,
  dashboardVisible: true,
  features: null,
  fixture: null,
  homeAgentId: "claude",
  homeDraft: "",
  homeMenu: null,
  homeMode: "manual",
  homeProject: { kind: "conversation" },
  notificationOpen: false,
  route: { kind: "home" },
  sidebarVisibility: {
    claude: true,
    codex: true,
    cursor: true,
    grok: true,
    harness: true,
    "harness-goal": true,
    "harness-hooks": true,
    "harness-mcp": true,
    "harness-prompt": true,
    "harness-rules": true,
    "harness-skills": true,
    "harness-subagents": true,
    "harness-workflows": true,
    hermes: true,
    home: true,
    memory: true,
    openclaw: true,
    opencode: true,
    orchestration: true,
    pi: true,
    "project-conversations": true,
    "project-list": true,
    "project-pinned": true,
    projects: true,
    sessions: true,
    "sessions-analytics": true,
    "sessions-dashboard": true,
    "sessions-export": true,
    "sessions-insights": true,
    "sessions-patterns": true,
    "sessions-sessions": true,
    "sessions-sync": true,
  },
  theme: "dark",
};

export const saasReducer = (state: SaasState, action: SaasAction): SaasState => {
  switch (action.type) {
    case "agent.approval":
      return withFeatures(state, (features) => ({
        ...features,
        agentMessages: {
          ...features.agentMessages,
          [action.agentId]: (features.agentMessages[action.agentId] ?? []).map((message) =>
            message.id === action.messageId && message.type === "approval"
              ? { ...message, approved: action.approved }
              : message,
          ),
        },
      }));
    case "agent.draft":
      return withFeatures(state, (features) => ({
        ...features,
        agentDrafts: { ...features.agentDrafts, [action.agentId]: action.draft },
      }));
    case "agent.message":
      return withFeatures(state, (features) => ({
        ...features,
        agentMessages: {
          ...features.agentMessages,
          [action.agentId]: [...(features.agentMessages[action.agentId] ?? []), action.message],
        },
      }));
    case "agent.runtime":
      return state.fixture === null
        ? state
        : {
            ...state,
            fixture: {
              ...state.fixture,
              agents: state.fixture.agents.map((agent) =>
                agent.id === action.agentId
                  ? {
                      ...agent,
                      last: action.last,
                      status: action.status,
                      task: action.task,
                    }
                  : agent,
              ),
            },
          };
    case "data.failed":
      return {
        ...state,
        connection: { kind: "error", message: action.message },
      };
    case "data.loaded":
      return state.dataRevision !== null && action.snapshot.revision <= state.dataRevision
        ? {
            ...state,
            connection: { kind: "ready", mode: action.mode },
          }
        : replaceSourceSnapshot(
            {
              ...state,
              connection: { kind: "ready", mode: action.mode },
            },
            action.snapshot,
          );
    case "data.retry":
      return {
        ...state,
        connection: { kind: "loading", stage: "正在重新加载本地工作区…" },
      };
    case "data.snapshot":
      return state.dataRevision !== null && action.snapshot.revision <= state.dataRevision
        ? state
        : replaceSourceSnapshot(state, action.snapshot);
    case "data.source-changing":
      return {
        ...state,
        chat: null,
        connection: { kind: "loading", stage: "正在切换数据源…" },
        dataRevision: null,
        features: null,
        fixture: null,
      };
    case "cron.toggle":
      return withFeatures(state, (features) => ({
        ...features,
        cronEnabled: {
          ...features.cronEnabled,
          [action.id]: !features.cronEnabled[action.id],
        },
      }));
    case "harness.hook-toggle":
      return withFeatures(state, (features) => ({
        ...features,
        harnessHookOn: {
          ...features.harnessHookOn,
          [action.id]: !features.harnessHookOn[action.id],
        },
      }));
    case "harness.mcp-toggle":
      return withFeatures(state, (features) => ({
        ...features,
        harnessMcpOn: {
          ...features.harnessMcpOn,
          [action.id]: !features.harnessMcpOn[action.id],
        },
      }));
    case "harness.workflow":
      return withFeatures(state, (features) => ({
        ...features,
        harnessRunningWorkflow: action.id,
      }));
    case "home.agent":
      return { ...state, homeAgentId: action.agentId, homeMenu: null };
    case "home.draft":
      return { ...state, homeDraft: action.draft };
    case "home.menu":
      return {
        ...state,
        homeMenu: state.homeMenu === action.menu ? null : action.menu,
      };
    case "home.mode":
      return { ...state, homeMenu: null, homeMode: action.mode };
    case "home.project":
      return { ...state, homeMenu: null, homeProject: action.project };
    case "navigate":
      return { ...state, homeMenu: null, notificationOpen: false, route: action.route };
    case "notifications.read":
      return state.fixture === null
        ? state
        : {
            ...state,
            fixture: {
              ...state.fixture,
              notifications: state.fixture.notifications.map((notification) =>
                notification.id === action.id ? { ...notification, read: true } : notification,
              ),
            },
            notificationOpen: false,
          };
    case "notifications.read-agent":
      return state.fixture === null
        ? state
        : {
            ...state,
            fixture: {
              ...state.fixture,
              notifications: state.fixture.notifications.map((notification) =>
                notification.agentId === action.agentId
                  ? { ...notification, read: true }
                  : notification,
              ),
            },
          };
    case "notifications.mark-all":
      return state.fixture === null
        ? state
        : {
            ...state,
            fixture: {
              ...state.fixture,
              notifications: state.fixture.notifications.map((notification) => ({
                ...notification,
                read: true,
              })),
            },
          };
    case "notifications.toggle":
      return { ...state, notificationOpen: !state.notificationOpen };
    case "queue.assignee":
      return withFeatures(state, (features) => ({
        ...features,
        queueAssignees: {
          ...features.queueAssignees,
          [action.taskId]: action.agentId,
        },
      }));
    case "queue.status":
      return withFeatures(state, (features) => ({
        ...features,
        queueStatuses: {
          ...features.queueStatuses,
          [action.taskId]: action.status,
        },
      }));
    case "sessions.category":
      return withFeatures(state, (features) => ({
        ...features,
        sessionCategory: action.category,
      }));
    case "sessions.depth":
      return withFeatures(state, (features) => ({
        ...features,
        sessionDepth: action.depth,
        sessionExportState: "idle",
      }));
    case "sessions.export-state":
      return withFeatures(state, (features) => ({
        ...features,
        sessionExportState: action.state,
      }));
    case "sessions.format":
      return withFeatures(state, (features) => ({
        ...features,
        sessionExportState: "idle",
        sessionFormat: action.format,
      }));
    case "sessions.query":
      return withFeatures(state, (features) => ({
        ...features,
        sessionQuery: action.query,
      }));
    case "sessions.sync-enabled":
      return withFeatures(state, (features) => ({
        ...features,
        sessionSyncEnabled: action.enabled,
        sessionSyncState: "idle",
      }));
    case "sessions.sync-state":
      return withFeatures(state, (features) => ({
        ...features,
        sessionSyncState: action.state,
      }));
    case "settings.agent-enabled":
      return withFeatures(state, (features) => ({
        ...features,
        settingsAgentEnabled: {
          ...features.settingsAgentEnabled,
          [action.agentId]: !features.settingsAgentEnabled[action.agentId],
        },
      }));
    case "sidebar.toggle":
      return { ...state, collapsedSidebar: !state.collapsedSidebar };
    case "sidebar.set":
      return { ...state, collapsedSidebar: action.collapsed };
    case "settings.model":
      return withFeatures(state, (features) => ({
        ...features,
        settingsModels: {
          ...features.settingsModels,
          [action.agentId]: action.model,
        },
      }));
    case "settings.notify-done":
      return withFeatures(state, (features) => ({
        ...features,
        settingsNotifyDone: !features.settingsNotifyDone,
      }));
    case "settings.notify-wait":
      return withFeatures(state, (features) => ({
        ...features,
        settingsNotifyWait: !features.settingsNotifyWait,
      }));
    case "settings.dashboard-visible":
      return { ...state, dashboardVisible: !state.dashboardVisible };
    case "settings.sidebar-visible":
      return {
        ...state,
        sidebarVisibility: {
          ...state.sidebarVisibility,
          [action.key]: !state.sidebarVisibility[action.key],
        },
      };
    case "theme.accent":
      return { ...state, accent: action.accent };
    case "theme.mode":
      return { ...state, theme: action.theme };
  }
};

export const routeMeta = (route: Route, agentName: (agentId: AgentId) => string): RouteMeta => {
  switch (route.kind) {
    case "agent":
      return { label: agentName(route.agentId), subtitle: "Agent 会话" };
    case "compare":
      return { label: "结果对比", subtitle: "same prompt · 3 agents" };
    case "cron":
      return { label: "定时任务", subtitle: "scheduled" };
    case "dashboard":
      return { label: "总览", subtitle: "overview" };
    case "harness": {
      const metadata = {
        goal: ["Goals", "长期目标"],
        hooks: ["Hooks", "生命周期钩子"],
        mcp: ["MCP", "server 注册表"],
        prompt: ["System Prompt", "提示词基因组"],
        rules: ["Rules", "项目规则文件"],
        skills: ["Skills", "技能包注册表"],
        subagents: ["SubAgents", "子代理编队"],
        workflows: ["Workflows", "多 Agent 流水线"],
      } as const;
      const [label, subtitle] = metadata[route.section];
      return { label, subtitle };
    }
    case "home":
      return { label: "新建任务", subtitle: "new task" };
    case "memory":
      return { label: "Memory", subtitle: "memories & notes" };
    case "projects":
      return { label: "项目", subtitle: "repositories" };
    case "queue":
      return { label: "长程任务", subtitle: "long-running queue" };
    case "sessions": {
      const metadata = {
        analytics: ["Analytics", "跨会话分析"],
        dashboard: ["Sessions 总览", "sessions manager"],
        export: ["Export", "跨会话导出"],
        insights: ["Insights", "洞察提炼"],
        patterns: ["Patterns", "重复模式"],
        sessions: ["Sessions", "all recorded sessions"],
        sync: ["Cloud Sync", "本地优先同步"],
      } as const;
      const [label, subtitle] = metadata[route.section];
      return { label, subtitle };
    }
    case "settings":
      return { label: "设置", subtitle: "preferences" };
    case "usage":
      return { label: "用量统计", subtitle: "tokens & cost" };
  }
};
