export const VISUAL_MANIFEST_VERSION = 1 as const;

export const ACCENTS = {
  cyan: "#4fd8e0",
  green: "#3ddc84",
  orange: "#ffb454",
  purple: "#b48cff",
} as const;

export const VIEWPORTS = {
  "landing-1024x768": { height: 768, width: 1024 },
  "landing-1440x1000": { height: 1000, width: 1440 },
  "saas-1024x768": { height: 768, width: 1024 },
  "saas-1280x800": { height: 800, width: 1280 },
  "saas-1440x900": { height: 900, width: 1440 },
} as const;

export type AccentName = keyof typeof ACCENTS;
export type ViewportName = keyof typeof VIEWPORTS;
export type SurfaceName = "landing" | "saas";
export type ThemeName = "dark" | "light";
export type EvidenceKind = "production-only" | "prototype-reference" | "source-defect";
export type CaptureMode = "full-page" | "viewport";

export type LocatorSpec =
  | {
      by: "css";
      value: string;
      index?: number | "last";
      scope?: "page" | "screen";
    }
  | {
      by: "placeholder" | "text" | "title";
      value: string;
      exact?: boolean;
      index?: number | "last";
      scope?: "page" | "screen";
    };

export type VisualAction =
  | { type: "click"; locator: LocatorSpec }
  | { type: "click-switch-near-text"; text: string; scope?: "page" | "screen" }
  | { type: "fill"; locator: LocatorSpec; value: string }
  | { type: "focus"; locator: LocatorSpec }
  | { type: "hover"; locator: LocatorSpec }
  | { type: "pointer-down"; locator: LocatorSpec }
  | { type: "scroll-into-view"; locator: LocatorSpec }
  | { type: "wait-for-visible"; locator: LocatorSpec }
  | {
      type: "scroll";
      target: "main" | "page" | "sidebar";
      top: "bottom" | "middle" | "top" | number;
    }
  | { type: "wait"; milliseconds: number };

export interface LandmarkSpec {
  readonly name: string;
  readonly locator: LocatorSpec;
  readonly required?: boolean;
}

interface ReferenceTemplate {
  readonly actions?: readonly VisualAction[];
  readonly captureMode?: CaptureMode;
  readonly description: string;
  readonly expectedScreenLabel?: string;
  readonly extraLandmarks?: readonly LandmarkSpec[];
  readonly id: string;
  readonly interaction?: string;
  readonly kind?: Exclude<EvidenceKind, "production-only">;
  readonly scroll?: {
    readonly main?: "bottom" | "middle" | "top" | number;
    readonly page?: "bottom" | "middle" | "top" | number;
    readonly sidebar?: "bottom" | "middle" | "top" | number;
  };
  readonly surface: SurfaceName;
  readonly tags: readonly string[];
  readonly variant?: {
    readonly accent?: AccentName;
    readonly theme?: ThemeName;
  };
  readonly viewports?: readonly ViewportName[];
}

export interface VisualReferenceCase {
  readonly accent: AccentName;
  readonly actions: readonly VisualAction[];
  readonly captureMode: CaptureMode;
  readonly description: string;
  readonly expectedScreenLabel?: string;
  readonly id: string;
  readonly interaction?: string;
  readonly kind: Exclude<EvidenceKind, "production-only">;
  readonly landmarks: readonly LandmarkSpec[];
  readonly scroll: {
    readonly main: "bottom" | "middle" | "top" | number;
    readonly page: "bottom" | "middle" | "top" | number;
    readonly sidebar: "bottom" | "middle" | "top" | number;
  };
  readonly source:
    | "prototypes/agentos/project/AgentOS Landing.dc.html"
    | "prototypes/agentos/project/AgentOS SaaS.dc.html";
  readonly surface: SurfaceName;
  readonly tags: readonly string[];
  readonly theme: ThemeName;
  readonly viewport: ViewportName;
}

export interface ProductionOnlyCase {
  readonly capture: {
    readonly landmarks: readonly LandmarkSpec[];
    readonly requirements: readonly SemanticRequirement[];
  };
  readonly description: string;
  readonly expected: {
    readonly externalRequests: readonly string[];
    readonly runtimeEffects: readonly Readonly<Record<string, string>>[];
    readonly storageWrites: readonly string[];
  };
  readonly id: string;
  readonly kind: "production-only";
  readonly owner: "chat-ui-001" | "desktop-001" | "landing-ui-001" | "saas-ui-001" | "web-001";
  readonly probe?: {
    readonly actions: readonly VisualAction[];
    readonly landingActions?: readonly LandingSafetyAction[];
  };
  readonly surface: SurfaceName;
  readonly tags: readonly string[];
  readonly viewport: ViewportName;
}

export type LandingSafetyExpectation =
  "dialog-closed" | "dialog-open" | "logged-in" | "logged-out" | "root";

export type LandingSafetyAction =
  | {
      readonly expect: LandingSafetyExpectation;
      readonly id: string;
      readonly locator: LocatorSpec;
      readonly type: "click";
    }
  | {
      readonly expect: LandingSafetyExpectation;
      readonly id: string;
      readonly locator: LocatorSpec;
      readonly position: { readonly x: number; readonly y: number };
      readonly type: "click-position";
    }
  | {
      readonly expect: LandingSafetyExpectation;
      readonly id: string;
      readonly key: string;
      readonly type: "press";
    }
  | {
      readonly expect: LandingSafetyExpectation;
      readonly id: string;
      readonly locator: LocatorSpec;
      readonly type: "fill";
      readonly value: string;
    }
  | {
      readonly expect: LandingSafetyExpectation;
      readonly id: string;
      readonly type: "reload";
    };

export type SemanticRequirement =
  | {
      readonly id: string;
      readonly kind: "disabled" | "enabled" | "hidden" | "visible";
      readonly locator: LocatorSpec;
    }
  | {
      readonly id: string;
      readonly includes: string;
      readonly kind: "text";
      readonly locator: LocatorSpec;
    }
  | {
      readonly equals: readonly string[];
      readonly id: string;
      readonly kind: "attribute-set";
      readonly locator: LocatorSpec;
      readonly name: string;
    };

const text = (
  value: string,
  options: {
    readonly exact?: boolean;
    readonly index?: number | "last";
    readonly scope?: "page" | "screen";
  } = {},
): LocatorSpec => ({ by: "text", exact: true, value, ...options });

const title = (value: string): LocatorSpec => ({ by: "title", value });
const placeholder = (
  value: string,
  options: {
    readonly exact?: boolean;
    readonly index?: number | "last";
    readonly scope?: "page" | "screen";
  } = {},
): LocatorSpec => ({ by: "placeholder", value, ...options });
const css = (
  value: string,
  options: {
    readonly index?: number | "last";
    readonly scope?: "page" | "screen";
  } = {},
): LocatorSpec => ({ by: "css", value, ...options });
const click = (locator: LocatorSpec): VisualAction => ({ locator, type: "click" });
const screenText = (value: string, index?: number | "last"): LocatorSpec =>
  text(value, { index, scope: "screen" });

const SAAS_VIEWPORTS = ["saas-1440x900", "saas-1280x800"] as const;
const LANDING_VIEWPORTS = ["landing-1440x1000", "landing-1024x768"] as const;

const nav = (label: string): readonly VisualAction[] => [click(text(label, { exact: false }))];
const agent = (name: string): readonly VisualAction[] => [click(text(name, { index: 0 }))];
const settings = (): readonly VisualAction[] => [click(text("⚙", { index: "last" }))];
const sm = (name: string): readonly VisualAction[] => [click(text(name))];
const hz = (name: string): readonly VisualAction[] => [click(text(name))];

const commonSaasLandmarks: readonly LandmarkSpec[] = [
  { locator: css("#dc-root > .sc-host > div"), name: "root" },
  { locator: css("#dc-root > .sc-host > div > div:first-child"), name: "sidebar" },
  {
    locator: css("#dc-root > .sc-host > div > div:nth-child(2) > div:first-child"),
    name: "topbar",
  },
];

const commonLandingLandmarks: readonly LandmarkSpec[] = [
  { locator: css('[data-screen-label="落地页"]'), name: "root" },
  { locator: text("AgentOS", { index: 0 }), name: "brand" },
  { locator: css("h1"), name: "hero-title" },
  { locator: text("AgentOS — workspace / local"), name: "product-window-title" },
  { locator: text("FEATURES"), name: "features-heading" },
  { locator: text("SMART ROUTING"), name: "routing-heading" },
  { locator: text("MEMORY"), name: "memory-heading" },
  { locator: text("把所有终端窗口,收进一个 OS"), name: "cta-heading" },
];

const pageCases: readonly ReferenceTemplate[] = [
  {
    description: "New-task manual-routing home screen.",
    expectedScreenLabel: "新建任务",
    id: "saas-home-manual",
    surface: "saas",
    tags: ["page", "home", "real-p0-p1-shell", "fixture-p2-plus-routing"],
  },
  {
    actions: nav("总览"),
    description: "Overview dashboard with six Agent cards and queue/notification summaries.",
    expectedScreenLabel: "总览",
    id: "saas-dashboard",
    surface: "saas",
    tags: ["page", "dashboard", "fixture-p2-plus"],
  },
  {
    actions: nav("定时任务"),
    description: "Scheduled task list and enabled/disabled switches.",
    expectedScreenLabel: "定时任务",
    id: "saas-cron",
    surface: "saas",
    tags: ["page", "task-orchestration", "fixture-p2-plus"],
  },
  {
    actions: nav("长程任务"),
    description: "Long-running task queue in queued/running/done fixture states.",
    expectedScreenLabel: "长程任务",
    id: "saas-queue",
    surface: "saas",
    tags: ["page", "task-orchestration", "fixture-p2-plus"],
  },
  ...[
    ["codex", "Codex CLI"],
    ["claude", "Claude Code"],
    ["grok", "Grok CLI"],
    ["cursor", "Cursor CLI"],
    ["pi", "Pi"],
    ["hermes", "Hermes"],
  ].map(([id, name]): ReferenceTemplate => ({
    actions: agent(name ?? ""),
    description: `${name ?? ""} conversation fixture.`,
    expectedScreenLabel: "Agent 会话",
    id: `saas-agent-${id ?? ""}-session`,
    surface: "saas",
    tags: [
      "page",
      "agent-session",
      id === "codex" || id === "claude" ? "real-p0-p1-target" : "fixture-p2-plus-provider",
    ],
  })),
  ...[
    ["codex", "Codex CLI"],
    ["claude", "Claude Code"],
    ["grok", "Grok CLI"],
    ["cursor", "Cursor CLI"],
    ["pi", "Pi"],
  ].map(([id, name]): ReferenceTemplate => ({
    actions: [...agent(name ?? ""), click(screenText("历史"))],
    description: `${name ?? ""} history subview, including populated and empty fixtures.`,
    expectedScreenLabel: "Agent 会话",
    id: `saas-agent-${id ?? ""}-history`,
    surface: "saas",
    tags: ["page", "agent-history", "fixture-p2-plus-history"],
  })),
  ...[
    ["history", "历史"],
    ["skills", "技能"],
    ["kanban", "看板"],
    ["mcps", "MCPs"],
  ].map(([id, tab]): ReferenceTemplate => ({
    actions: [...agent("Hermes"), click(screenText(tab ?? ""))],
    description: `Hermes-only ${tab ?? ""} module subview.`,
    expectedScreenLabel: "Agent 会话",
    id: `saas-hermes-${id ?? ""}`,
    surface: "saas",
    tags: ["page", "agent-hermes-module", "fixture-p2-plus"],
  })),
  ...[
    ["dash", "Dashboard"],
    ["sessions", "Sessions"],
    ["insights", "Insights"],
    ["analytics", "Analytics"],
    ["patterns", "Patterns"],
    ["export", "Export"],
    ["sync", "Cloud Sync"],
  ].map(([id, label]): ReferenceTemplate => ({
    actions: sm(label ?? ""),
    description: `Sessions Manager ${label ?? ""} fixture page.`,
    expectedScreenLabel: "Sessions Manager",
    id: `saas-sm-${id ?? ""}`,
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["page", "sessions-manager", "fixture-p2-plus"],
  })),
  ...[
    ["prompt", "System Prompt"],
    ["skills", "Skills"],
    ["mcp", "MCP"],
    ["subagents", "SubAgents"],
    ["goals", "Goals"],
    ["workflows", "Workflows"],
    ["hooks", "Hooks"],
    ["rules", "Rules"],
  ].map(([id, label]): ReferenceTemplate => ({
    actions: hz(label ?? ""),
    description: `Harness ${label ?? ""} fixture page.`,
    expectedScreenLabel: "Harness",
    id: `saas-harness-${id ?? ""}`,
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["page", "harness", "fixture-p2-plus"],
  })),
  ...[
    ["graph", "图谱"],
    ["recent", "最近"],
    ["notes", "笔记"],
    ["memory", "记忆"],
  ].map(([id, tab]): ReferenceTemplate => ({
    actions: [...nav("Memory"), click(screenText(tab ?? ""))],
    description: `Memory ${tab ?? ""} fixture subview.`,
    expectedScreenLabel: "Memory",
    id: `saas-memory-${id ?? ""}`,
    surface: "saas",
    tags: ["page", "memory", "fixture-p2-plus"],
  })),
  ...[
    ["appearance", 0, "Appearance controls."],
    ["customize", 255, "Sidebar customization controls."],
    ["agent", 690, "Provider configuration fixture."],
    ["usage-notifications", 1260, "Usage, budget, and notification settings."],
    ["projects", 1720, "Project fixture section."],
    ["compare", "bottom", "Three-Agent result comparison fixture."],
  ].map(([id, top, description]): ReferenceTemplate => ({
    actions: settings(),
    description: String(description),
    expectedScreenLabel: "设置",
    extraLandmarks:
      id === "agent"
        ? [
            {
              locator: css('[data-screen-label="设置"] > div:nth-child(4)'),
              name: "settings-agent-section",
            },
          ]
        : undefined,
    id: `saas-settings-${String(id)}`,
    scroll: { main: top as "bottom" | number },
    surface: "saas",
    tags: ["page", "settings", "fixture-p2-plus"],
  })),
];

const stateCases: readonly ReferenceTemplate[] = [
  {
    actions: [click(screenText("Claude Code"))],
    description: "Home Agent picker overlay.",
    expectedScreenLabel: "新建任务",
    id: "saas-home-agent-menu",
    surface: "saas",
    tags: ["state", "dropdown", "real-p0-p1-provider-picker"],
  },
  {
    actions: [click(screenText("对话"))],
    description: "Home cwd picker overlay.",
    expectedScreenLabel: "新建任务",
    id: "saas-home-path-menu",
    surface: "saas",
    tags: ["state", "dropdown", "real-p0-p1-cwd-picker"],
  },
  {
    actions: [click(screenText("智能路由"))],
    description: "Home automatic-routing selection.",
    expectedScreenLabel: "新建任务",
    id: "saas-home-auto-route",
    surface: "saas",
    tags: ["state", "fixture-p2-plus", "routing"],
  },
  {
    actions: [
      click(
        css(
          "#dc-root > .sc-host > div > div:nth-child(2) > div:first-child > div:nth-last-child(2)",
        ),
      ),
    ],
    description: "Unread notification overlay.",
    expectedScreenLabel: "新建任务",
    extraLandmarks: [
      {
        locator: css('[style*="z-index: 900"]'),
        name: "notification-overlay",
      },
    ],
    id: "saas-notifications-unread",
    surface: "saas",
    tags: ["state", "overlay", "mixed-data-mode"],
  },
  {
    actions: [
      click(
        css(
          "#dc-root > .sc-host > div > div:nth-child(2) > div:first-child > div:nth-last-child(2)",
        ),
      ),
      click(text("全部已读")),
    ],
    description: "Notification overlay after marking every item read.",
    expectedScreenLabel: "新建任务",
    extraLandmarks: [
      {
        locator: css('[style*="z-index: 900"]'),
        name: "notification-overlay",
      },
    ],
    id: "saas-notifications-all-read",
    surface: "saas",
    tags: ["state", "overlay", "mixed-data-mode"],
  },
  {
    actions: agent("Claude Code"),
    description: "Pending ACP approval card (prototype source state).",
    expectedScreenLabel: "Agent 会话",
    extraLandmarks: [
      {
        locator: screenText("把 users 表迁移到新 schema,写好迁移脚本并先跑 dry-run"),
        name: "agent-user-message",
      },
      {
        locator: screenText("$ npx prisma migrate deploy"),
        name: "approval-command",
      },
      {
        locator: placeholder("向 Claude Code 派发任务 · Enter 发送", { scope: "screen" }),
        name: "agent-composer",
      },
    ],
    id: "saas-approval-pending",
    surface: "saas",
    tags: ["state", "approval", "real-p0-p1-target"],
  },
  {
    actions: [...agent("Claude Code"), click(screenText("批准执行"))],
    description: "Approved ACP approval card.",
    expectedScreenLabel: "Agent 会话",
    id: "saas-approval-approved",
    surface: "saas",
    tags: ["state", "approval", "real-p0-p1-target"],
  },
  {
    actions: [...agent("Claude Code"), click(screenText("拒绝"))],
    description: "Denied ACP approval card.",
    expectedScreenLabel: "Agent 会话",
    id: "saas-approval-denied",
    surface: "saas",
    tags: ["state", "approval", "real-p0-p1-target"],
  },
  {
    actions: [...nav("长程任务"), click(title("Claude Code")), click(screenText("派发 →", 0))],
    description: "Dispatched long-running task in running state.",
    expectedScreenLabel: "长程任务",
    id: "saas-queue-running",
    surface: "saas",
    tags: ["state", "fixture-p2-plus", "task-orchestration"],
  },
  {
    actions: [
      ...sm("Sessions"),
      { locator: placeholder("搜索会话标题、项目…"), type: "fill", value: "no-match" },
    ],
    description: "Sessions Manager empty search result.",
    expectedScreenLabel: "Sessions Manager",
    id: "saas-sm-sessions-empty-search",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "sessions-manager", "fixture-p2-plus"],
  },
  {
    actions: [...sm("Insights"), click(screenText("决策"))],
    description: "Sessions Manager insight category filter.",
    expectedScreenLabel: "Sessions Manager",
    id: "saas-sm-insights-filter",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "sessions-manager", "fixture-p2-plus"],
  },
  {
    actions: [
      ...sm("Export"),
      click(screenText("生成导出")),
      { locator: screenText("生成中…"), type: "wait-for-visible" },
    ],
    description: "Sessions Manager export while its demo-only generator is pending.",
    expectedScreenLabel: "Sessions Manager",
    extraLandmarks: [
      {
        locator: screenText("生成中…"),
        name: "sm-export-async-control",
      },
    ],
    id: "saas-sm-export-generating",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "sessions-manager", "async", "demo-only"],
  },
  {
    actions: [
      ...sm("Export"),
      click(screenText("生成导出")),
      {
        locator: screenText("✓ 已生成 Agent Rules · 标准档 · 覆盖 96 场会话,去重合并 342 → 80 条"),
        type: "wait-for-visible",
      },
    ],
    description: "Sessions Manager generated export success note.",
    expectedScreenLabel: "Sessions Manager",
    id: "saas-sm-export-result",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "sessions-manager", "demo-only"],
  },
  {
    actions: [
      ...sm("Cloud Sync"),
      { scope: "screen", text: "本地优先 · 云端同步", type: "click-switch-near-text" },
    ],
    description: "Cloud Sync toggle off (demo only).",
    expectedScreenLabel: "Sessions Manager",
    id: "saas-sm-sync-off",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "cloud-sync", "demo-only"],
  },
  {
    actions: [
      ...sm("Cloud Sync"),
      click(screenText("立即同步")),
      { locator: screenText("同步中…"), type: "wait-for-visible" },
    ],
    description: "Cloud Sync while the demo-only sync timer is pending.",
    expectedScreenLabel: "Sessions Manager",
    extraLandmarks: [
      {
        locator: screenText("同步中…"),
        name: "sm-sync-async-control",
      },
    ],
    id: "saas-sm-sync-syncing",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "cloud-sync", "async", "demo-only"],
  },
  {
    actions: [
      ...sm("Cloud Sync"),
      click(screenText("立即同步")),
      { locator: screenText("上次同步 刚刚"), type: "wait-for-visible" },
    ],
    description: "Cloud Sync after its demo-only timer reaches the just-synced state.",
    expectedScreenLabel: "Sessions Manager",
    extraLandmarks: [
      {
        locator: screenText("上次同步 刚刚"),
        name: "sm-sync-completed-label",
      },
    ],
    id: "saas-sm-sync-completed",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "cloud-sync", "completed", "demo-only"],
  },
  {
    actions: [
      ...agent("Hermes"),
      click(screenText("技能")),
      click(screenText("▸ 运行", 0)),
      { locator: screenText("运行技能:行业调研"), type: "wait-for-visible" },
    ],
    description: "Hermes Skill run visual feedback; prototype timer only, never a business run.",
    expectedScreenLabel: "Agent 会话",
    extraLandmarks: [
      {
        locator: screenText("运行技能:行业调研"),
        name: "hermes-skill-run-message",
      },
    ],
    id: "saas-hermes-skill-running",
    surface: "saas",
    tags: ["state", "agent-hermes-module", "async", "demo-only"],
  },
  {
    actions: [...hz("System Prompt"), click(title("身份人设 · 420 字符"))],
    description: "Expanded System Prompt genome segment.",
    expectedScreenLabel: "Harness",
    extraLandmarks: [
      {
        locator: title("身份人设 · 420 字符"),
        name: "harness-prompt-segment",
      },
      {
        locator: screenText(
          "You are Claude Code, an agentic coding assistant operating in the user’s terminal.",
        ),
        name: "harness-prompt-expanded-body",
      },
    ],
    id: "saas-harness-prompt-segment-open",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "harness", "fixture-p2-plus"],
  },
  {
    actions: [
      ...hz("MCP"),
      { scope: "screen", text: "filesystem", type: "click-switch-near-text" },
    ],
    description: "Harness MCP server disabled state.",
    expectedScreenLabel: "Harness",
    id: "saas-harness-mcp-off",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "harness", "fixture-p2-plus"],
  },
  {
    actions: [...hz("Workflows"), click(screenText("▸ 运行", 0))],
    description: "Harness workflow running state.",
    expectedScreenLabel: "Harness",
    id: "saas-harness-workflow-running",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "harness", "fixture-p2-plus"],
  },
  {
    actions: [
      ...hz("Hooks"),
      {
        scope: "screen",
        text: "自动提炼洞察写入 Memory",
        type: "click-switch-near-text",
      },
    ],
    description: "Harness Hook disabled state.",
    expectedScreenLabel: "Harness",
    id: "saas-harness-hook-off",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "harness", "fixture-p2-plus"],
  },
  {
    actions: [
      ...nav("Memory"),
      { locator: placeholder("搜索记忆与笔记…"), type: "fill", value: "no-match" },
    ],
    description: "Memory empty search result.",
    expectedScreenLabel: "Memory",
    id: "saas-memory-search-empty",
    surface: "saas",
    tags: ["state", "memory", "fixture-p2-plus"],
  },
  {
    actions: [
      ...nav("Memory"),
      click(title("webapp 的 e2e 测试偶发超时,根因是 CI 上共享 redis 端口冲突 · 07-21")),
      {
        locator: screenText("webapp 的 e2e 测试偶发超时,根因是 CI 上共享 redis 端口冲突"),
        type: "wait-for-visible",
      },
    ],
    description: "Memory Galaxy star click opens the filtered Memory list.",
    expectedScreenLabel: "Memory",
    extraLandmarks: [
      {
        locator: screenText("webapp 的 e2e 测试偶发超时,根因是 CI 上共享 redis 端口冲突"),
        name: "memory-star-filtered-result",
      },
    ],
    id: "saas-memory-star-filtered",
    surface: "saas",
    tags: ["state", "memory", "interaction", "fixture-p2-plus"],
  },
  {
    actions: [
      ...agent("Codex CLI"),
      click(screenText("历史")),
      click(screenText("↺ 恢复", 0)),
      {
        locator: screenText("↺ 已恢复会话 #c2e8 · 修复 CI 缓存键漂移 (22 条消息)"),
        type: "wait-for-visible",
      },
    ],
    description:
      "History resume note/session presentation; demo-only and capability-gated, never evidence of ACP resume.",
    expectedScreenLabel: "Agent 会话",
    extraLandmarks: [
      {
        locator: screenText("↺ 已恢复会话 #c2e8 · 修复 CI 缓存键漂移 (22 条消息)"),
        name: "history-resume-note",
      },
      {
        locator: placeholder("向 Codex CLI 派发任务 · Enter 发送", { scope: "screen" }),
        name: "history-resume-composer",
      },
    ],
    id: "saas-agent-codex-history-resume-demo",
    surface: "saas",
    tags: ["state", "agent-history", "demo-only", "capability-gated", "no-unnegotiated-resume"],
  },
  {
    actions: [...settings(), { scope: "screen", text: "已启用", type: "click-switch-near-text" }],
    description: "Selected provider disabled in Settings.",
    expectedScreenLabel: "设置",
    extraLandmarks: [
      {
        locator: css('[data-screen-label="设置"] > div:nth-child(4)'),
        name: "settings-agent-section",
      },
    ],
    id: "saas-settings-agent-disabled",
    scroll: { main: 690 },
    surface: "saas",
    tags: ["state", "settings", "demo-only"],
  },
  {
    actions: [...settings(), click(screenText("o4-mini"))],
    description: "Alternative provider model selected.",
    expectedScreenLabel: "设置",
    id: "saas-settings-model-selected",
    scroll: { main: 690 },
    surface: "saas",
    tags: ["state", "settings", "demo-only"],
  },
  {
    actions: [
      ...settings(),
      {
        scope: "screen",
        text: "自动批准低风险操作",
        type: "click-switch-near-text",
      },
    ],
    description: "Prototype auto-approve toggle; visual demo only and never a permission grant.",
    expectedScreenLabel: "设置",
    id: "saas-settings-auto-approve-demo",
    scroll: { main: 690 },
    surface: "saas",
    tags: ["state", "settings", "demo-only", "security-boundary"],
  },
  {
    actions: [...settings(), click(screenText("总览"))],
    description: "Settings visibility chip hides the Overview sidebar item.",
    expectedScreenLabel: "设置",
    id: "saas-settings-visibility-hidden",
    surface: "saas",
    tags: ["state", "settings", "local-presentation-preference"],
  },
  {
    actions: [...settings(), click(screenText("采纳此实现", 0))],
    description: "Result comparison with one implementation adopted.",
    expectedScreenLabel: "设置",
    id: "saas-settings-compare-adopted",
    scroll: { main: "bottom" },
    surface: "saas",
    tags: ["state", "compare", "fixture-p2-plus"],
  },
  {
    actions: [click(text("置顶")), click(text("限流方案对比 · 3 agents"))],
    description:
      "Known source defect: pinned compare route sets a title but has no matching screen DOM.",
    id: "saas-source-defect-blank-compare",
    kind: "source-defect",
    surface: "saas",
    tags: ["source-defect", "blank-route", "excluded-from-production-diff"],
  },
  {
    actions: [click(text("置顶"))],
    description: "Expanded pinned sidebar tree.",
    expectedScreenLabel: "新建任务",
    id: "saas-sidebar-pinned-open",
    scroll: { sidebar: "middle" },
    surface: "saas",
    tags: ["state", "sidebar", "tree"],
  },
  {
    actions: [
      click(text("PROJECTS")),
      click(text("AGENTS")),
      click(text("HARNESS")),
      click(text("SESSIONS MANAGER")),
    ],
    description: "Collapsed sidebar sections.",
    expectedScreenLabel: "新建任务",
    id: "saas-sidebar-sections-collapsed",
    surface: "saas",
    tags: ["state", "sidebar", "tree"],
  },
  {
    actions: [],
    description: "Sidebar at its deterministic bottom scroll boundary.",
    expectedScreenLabel: "新建任务",
    id: "saas-sidebar-bottom",
    scroll: { sidebar: "bottom" },
    surface: "saas",
    tags: ["state", "sidebar", "scroll"],
  },
  {
    actions: [{ locator: text("新建任务"), type: "hover" }],
    description: "Primary sidebar navigation hover primitive.",
    expectedScreenLabel: "新建任务",
    id: "saas-interaction-nav-hover",
    interaction: "hover",
    surface: "saas",
    tags: ["interaction", "hover", "primitive"],
  },
  {
    actions: [...nav("总览"), { locator: screenText("Claude Code"), type: "hover" }],
    description: "Agent overview card hover primitive.",
    expectedScreenLabel: "总览",
    id: "saas-interaction-card-hover",
    interaction: "hover",
    surface: "saas",
    tags: ["interaction", "hover", "primitive"],
  },
  {
    actions: [{ locator: placeholder("交给我一个任务,或问我任何问题"), type: "focus" }],
    description: "Composer focus primitive.",
    expectedScreenLabel: "新建任务",
    id: "saas-interaction-input-focus",
    interaction: "focus",
    surface: "saas",
    tags: ["interaction", "focus", "primitive"],
  },
  {
    actions: [{ locator: text("➤"), type: "pointer-down" }],
    description: "Home send control active primitive.",
    expectedScreenLabel: "新建任务",
    id: "saas-interaction-send-active",
    interaction: "active",
    surface: "saas",
    tags: ["interaction", "active", "primitive"],
  },
];

const landingCases: readonly ReferenceTemplate[] = [
  {
    captureMode: "full-page",
    description:
      "Entire Landing page: header, hero, product window, Agents, Features, Routing, Memory, stats, CTA, and footer.",
    expectedScreenLabel: "落地页",
    id: "landing-full",
    surface: "landing",
    tags: ["page", "landing", "demo-only-cta"],
  },
  {
    actions: [click(text("登录", { index: 0 }))],
    description: "Landing login modal open.",
    expectedScreenLabel: "落地页",
    id: "landing-login-open",
    surface: "landing",
    tags: ["state", "overlay", "demo-only"],
  },
  {
    actions: [click(text("登录", { index: 0 })), click(screenText("登录", "last"))],
    description: "Landing logged-in presentation state.",
    expectedScreenLabel: "落地页",
    id: "landing-logged-in",
    surface: "landing",
    tags: ["state", "account", "demo-only"],
  },
  {
    actions: [{ locator: text("功能"), type: "hover" }],
    description: "Landing header navigation hover primitive.",
    expectedScreenLabel: "落地页",
    id: "landing-interaction-nav-hover",
    interaction: "hover",
    surface: "landing",
    tags: ["interaction", "hover", "primitive"],
  },
  {
    actions: [{ locator: text("智能任务路由"), type: "hover" }],
    description: "Landing feature card hover primitive.",
    expectedScreenLabel: "落地页",
    id: "landing-interaction-feature-hover",
    interaction: "hover",
    scroll: { page: 1150 },
    surface: "landing",
    tags: ["interaction", "hover", "primitive"],
  },
  {
    actions: [click(text("登录", { index: 0 })), { locator: text("✕"), type: "hover" }],
    description: "Landing modal close hover primitive.",
    expectedScreenLabel: "落地页",
    id: "landing-interaction-modal-close-hover",
    interaction: "hover",
    surface: "landing",
    tags: ["interaction", "hover", "primitive"],
  },
];

const variantCases: readonly ReferenceTemplate[] = [
  ...(["light:green", "dark:cyan", "dark:orange", "dark:purple"] as const).flatMap(
    (variant): readonly ReferenceTemplate[] => {
      const [theme, accent] = variant.split(":") as [ThemeName, AccentName];
      return [
        {
          description: `SaaS shell in ${theme}/${accent}.`,
          expectedScreenLabel: "新建任务",
          id: `saas-home-${theme}-${accent}`,
          surface: "saas",
          tags: ["variant", "theme", "accent", "critical-page"],
          variant: { accent, theme },
          viewports: SAAS_VIEWPORTS,
        },
        {
          actions: agent("Claude Code"),
          description: `Agent conversation in ${theme}/${accent}.`,
          expectedScreenLabel: "Agent 会话",
          id: `saas-agent-claude-${theme}-${accent}`,
          surface: "saas",
          tags: ["variant", "theme", "accent", "critical-page"],
          variant: { accent, theme },
          viewports: SAAS_VIEWPORTS,
        },
        {
          captureMode: "full-page",
          description: `Landing page in ${theme}/${accent}.`,
          expectedScreenLabel: "落地页",
          id: `landing-full-${theme}-${accent}`,
          surface: "landing",
          tags: ["variant", "theme", "accent", "critical-page"],
          variant: { accent, theme },
          viewports: LANDING_VIEWPORTS,
        },
      ];
    },
  ),
];

const withDefaults = (template: ReferenceTemplate, viewport: ViewportName): VisualReferenceCase => {
  const commonLandmarks =
    template.surface === "saas" ? commonSaasLandmarks : commonLandingLandmarks;
  const screenLandmark =
    template.expectedScreenLabel === undefined
      ? []
      : [
          {
            locator: css(`[data-screen-label="${template.expectedScreenLabel}"]`),
            name: "screen",
          },
        ];

  return {
    accent: template.variant?.accent ?? "green",
    actions: template.actions ?? [],
    captureMode: template.captureMode ?? "viewport",
    description: template.description,
    expectedScreenLabel: template.expectedScreenLabel,
    id: `${template.id}--${viewport}`,
    interaction: template.interaction,
    kind: template.kind ?? "prototype-reference",
    landmarks: [...commonLandmarks, ...screenLandmark, ...(template.extraLandmarks ?? [])],
    scroll: {
      main: template.scroll?.main ?? "top",
      page: template.scroll?.page ?? "top",
      sidebar: template.scroll?.sidebar ?? "top",
    },
    source:
      template.surface === "saas"
        ? "prototypes/agentos/project/AgentOS SaaS.dc.html"
        : "prototypes/agentos/project/AgentOS Landing.dc.html",
    surface: template.surface,
    tags: template.tags,
    theme: template.variant?.theme ?? "dark",
    viewport,
  };
};

const expand = (template: ReferenceTemplate): readonly VisualReferenceCase[] => {
  const viewports =
    template.viewports ??
    (template.tags.includes("page")
      ? template.surface === "saas"
        ? SAAS_VIEWPORTS
        : LANDING_VIEWPORTS
      : template.surface === "saas"
        ? (["saas-1440x900"] as const)
        : (["landing-1440x1000"] as const));
  return viewports.map((viewport) => withDefaults(template, viewport));
};

export const visualReferenceCases: readonly VisualReferenceCase[] = [
  ...pageCases,
  ...stateCases,
  ...landingCases,
  ...variantCases,
].flatMap(expand);

const productionContract = (
  requirements: readonly SemanticRequirement[],
  landmarks: readonly LandmarkSpec[],
): Pick<ProductionOnlyCase, "capture" | "expected"> => ({
  capture: { landmarks, requirements },
  expected: { externalRequests: [], runtimeEffects: [], storageWrites: [] },
});

export const productionOnlyCases: readonly ProductionOnlyCase[] = [
  {
    ...productionContract(
      [
        {
          id: "runtime-kind",
          kind: "visible",
          locator: css('main[data-runtime-state="core-starting"]'),
        },
        {
          id: "startup-stages",
          includes: "数据库迁移 → HTTP 监听 → Provider Registry",
          kind: "text",
          locator: css(".system-surface p"),
        },
        { id: "shell-absent", kind: "hidden", locator: css(".app-shell") },
      ],
      [
        { locator: css(".system-surface"), name: "system-surface" },
        { locator: css(".system-surface p"), name: "startup-stage" },
      ],
    ),
    description: "Core startup with migration, HTTP-listen, and Provider Registry progress.",
    id: "saas-production-core-starting",
    kind: "production-only",
    owner: "desktop-001",
    surface: "saas",
    tags: ["loading", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "runtime-kind",
          kind: "visible",
          locator: css('main[data-runtime-state="migration-error"]'),
        },
        {
          id: "structured-code",
          includes: "SQLITE_MIGRATION_FAILED",
          kind: "text",
          locator: css(".system-surface p"),
        },
        { id: "retry-enabled", kind: "enabled", locator: text("重试") },
        { id: "diagnostics-enabled", kind: "enabled", locator: text("诊断") },
      ],
      [
        { locator: css(".system-surface.is-error"), name: "error-surface" },
        { locator: css(".system-actions"), name: "error-actions" },
      ],
    ),
    expected: {
      externalRequests: [],
      runtimeEffects: [{ name: "diagnostics.open", source: "migration" }],
      storageWrites: [],
    },
    probe: { actions: [click(text("诊断"))] },
    description: "Database migration startup failure with retry and diagnostics.",
    id: "saas-production-migration-error",
    kind: "production-only",
    owner: "desktop-001",
    surface: "saas",
    tags: ["error", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "provider-notice",
          includes: "Claude Code 尚未通过本机认证检查",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "doctor-enabled", kind: "enabled", locator: text("运行 doctor") },
        { id: "composer-disabled", kind: "disabled", locator: css(".agent-composer textarea") },
      ],
      [
        { locator: css(".production-state-notice"), name: "provider-notice" },
        { locator: text("运行 doctor"), name: "doctor-control" },
      ],
    ),
    expected: {
      externalRequests: [],
      runtimeEffects: [{ name: "provider.doctor", providerId: "claude-code" }],
      storageWrites: [],
    },
    probe: { actions: [click(text("运行 doctor"))] },
    description: "Provider probing and unavailable-provider diagnostics.",
    id: "saas-production-provider-probing-unavailable",
    kind: "production-only",
    owner: "web-001",
    surface: "saas",
    tags: ["loading", "empty", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "running-notice",
          includes: "Turn 执行中",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "stop-enabled", kind: "enabled", locator: text("停止") },
        { id: "composer-disabled", kind: "disabled", locator: css(".agent-composer textarea") },
      ],
      [
        { locator: css(".production-state-notice"), name: "running-notice" },
        { locator: text("停止"), name: "stop-control" },
      ],
    ),
    expected: {
      externalRequests: [],
      runtimeEffects: [{ name: "turn.cancel", turnId: "turn-visual-running" }],
      storageWrites: [],
    },
    probe: { actions: [click(text("停止"))] },
    description: "Real running Turn with Stop control.",
    id: "saas-production-turn-running",
    kind: "production-only",
    owner: "chat-ui-001",
    surface: "saas",
    tags: ["busy", "cancel", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "cancelling-notice",
          includes: "正在取消 Turn",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "composer-disabled", kind: "disabled", locator: css(".agent-composer textarea") },
        { id: "stop-absent", kind: "hidden", locator: text("停止") },
      ],
      [
        { locator: css(".production-state-notice"), name: "cancelling-notice" },
        { locator: css(".agent-composer"), name: "disabled-composer" },
      ],
    ),
    description: "Turn cancelling after an idempotent cancel request.",
    id: "saas-production-turn-cancelling",
    kind: "production-only",
    owner: "chat-ui-001",
    surface: "saas",
    tags: ["busy", "cancel", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "api-error-code",
          includes: "CORE_REQUEST_FAILED",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "retry-enabled", kind: "enabled", locator: text("重试") },
      ],
      [
        { locator: css(".production-state-notice"), name: "api-error-notice" },
        { locator: text("重试"), name: "retry-control" },
      ],
    ),
    expected: {
      externalRequests: [],
      runtimeEffects: [{ name: "request.retry", requestKey: "agent-conversation" }],
      storageWrites: [],
    },
    probe: { actions: [click(text("重试"))] },
    description: "Structured Core API error in the Agent conversation.",
    id: "saas-production-api-error",
    kind: "production-only",
    owner: "web-001",
    surface: "saas",
    tags: ["error", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "crash-exit-code",
          includes: "exit code 1",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "diagnostics-enabled", kind: "enabled", locator: text("查看诊断") },
        { id: "composer-enabled", kind: "enabled", locator: css(".agent-composer textarea") },
      ],
      [
        { locator: css(".production-state-notice"), name: "crash-notice" },
        { locator: css(".message-list"), name: "readable-history" },
      ],
    ),
    expected: {
      externalRequests: [],
      runtimeEffects: [{ name: "diagnostics.open", source: "agent" }],
      storageWrites: [],
    },
    probe: { actions: [click(text("查看诊断"))] },
    description: "ACP error and crashed Agent process.",
    id: "saas-production-agent-crashed",
    kind: "production-only",
    owner: "chat-ui-001",
    surface: "saas",
    tags: ["error", "crashed", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "fetch-sse-copy",
          includes: "fetch-SSE 已断开",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "composer-disabled", kind: "disabled", locator: css(".agent-composer textarea") },
        { id: "send-disabled", kind: "disabled", locator: css(".agent-composer button") },
      ],
      [
        { locator: css(".production-state-notice"), name: "reconnect-notice" },
        { locator: css(".agent-composer"), name: "disabled-composer" },
      ],
    ),
    description: "fetch-SSE reconnect state with writes disabled.",
    id: "saas-production-sse-reconnecting",
    kind: "production-only",
    owner: "web-001",
    surface: "saas",
    tags: ["recovery", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "replay-gap-copy",
          includes: "REPLAY_GAP",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "composer-disabled", kind: "disabled", locator: css(".agent-composer textarea") },
      ],
      [
        { locator: css(".production-state-notice"), name: "replay-gap-notice" },
        { locator: css(".agent-composer"), name: "paused-composer" },
      ],
    ),
    description: "REPLAY_GAP global snapshot replacement.",
    id: "saas-production-replay-gap",
    kind: "production-only",
    owner: "web-001",
    surface: "saas",
    tags: ["recovery", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "restart-copy",
          includes: "旧连接凭据已丢弃",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "composer-disabled", kind: "disabled", locator: css(".agent-composer textarea") },
        {
          id: "approval-disabled",
          kind: "disabled",
          locator: text("批准执行"),
        },
      ],
      [
        { locator: css(".production-state-notice"), name: "restart-notice" },
        { locator: css(".approval-message"), name: "disabled-approval" },
      ],
    ),
    description: "Core restart while preserving the disabled shell.",
    id: "saas-production-core-restart",
    kind: "production-only",
    owner: "desktop-001",
    surface: "saas",
    tags: ["recovery", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "interrupted-copy",
          includes: "Turn 已中断",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "composer-enabled", kind: "enabled", locator: css(".agent-composer textarea") },
        { id: "stop-absent", kind: "hidden", locator: text("停止") },
      ],
      [
        { locator: css(".production-state-notice"), name: "interrupted-notice" },
        { locator: css(".message-list"), name: "preserved-history" },
      ],
    ),
    description: "Interrupted Turn restored after Core startup.",
    id: "saas-production-turn-interrupted",
    kind: "production-only",
    owner: "chat-ui-001",
    surface: "saas",
    tags: ["recovery", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "security-copy",
          includes: "客户端无法强制阻断其内部工具",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "composer-enabled", kind: "enabled", locator: css(".agent-composer textarea") },
      ],
      [
        { locator: css(".production-state-notice"), name: "capability-warning" },
        { locator: css(".agent-composer"), name: "available-composer" },
      ],
    ),
    description: "Provider cannot guarantee permission requests; client cannot force-block tools.",
    id: "saas-production-capability-warning",
    kind: "production-only",
    owner: "chat-ui-001",
    surface: "saas",
    tags: ["capability-warning", "security", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        {
          id: "busy-copy",
          includes: "Session busy",
          kind: "text",
          locator: css(".production-state-notice"),
        },
        { id: "composer-disabled", kind: "disabled", locator: css(".agent-composer textarea") },
      ],
      [
        { locator: css(".production-state-notice"), name: "busy-notice" },
        { locator: css(".agent-composer"), name: "busy-composer" },
      ],
    ),
    description: "Session busy response prevents a second nonterminal Turn.",
    id: "saas-production-session-busy",
    kind: "production-only",
    owner: "chat-ui-001",
    surface: "saas",
    tags: ["busy", "prototype-missing"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        { id: "collapsed-shell", kind: "visible", locator: css(".app-shell.sidebar-collapsed") },
        {
          id: "mobile-toggle",
          kind: "visible",
          locator: css(".mobile-sidebar-toggle"),
        },
        { id: "approval-enabled", kind: "enabled", locator: text("批准执行") },
      ],
      [
        { locator: css(".app-shell"), name: "constrained-shell" },
        { locator: css(".mobile-sidebar-toggle"), name: "mobile-toggle" },
      ],
    ),
    description:
      "Constrained 1024px shell with collapsed but reachable sidebar and approval controls.",
    id: "saas-production-constrained-sidebar",
    kind: "production-only",
    owner: "saas-ui-001",
    surface: "saas",
    tags: ["constrained", "responsive", "prototype-missing"],
    viewport: "saas-1024x768",
  },
  {
    ...productionContract(
      [
        {
          equals: ["approval", "diff", "note", "text", "think", "tool", "user"],
          id: "seven-message-types",
          kind: "attribute-set",
          locator: css(".message[data-message-type]"),
          name: "data-message-type",
        },
        { id: "composer-enabled", kind: "enabled", locator: css(".agent-composer textarea") },
      ],
      [
        { locator: css(".conversation"), name: "conversation" },
        { locator: css(".message-list"), name: "seven-type-message-list" },
      ],
    ),
    description: "Real seven-message fixture after DTO integration.",
    id: "saas-production-seven-message-types",
    kind: "production-only",
    owner: "chat-ui-001",
    surface: "saas",
    tags: ["real-p0-p1", "actual-diff-pending"],
    viewport: "saas-1440x900",
  },
  {
    ...productionContract(
      [
        { id: "landing-root", kind: "visible", locator: css('[data-screen-label="落地页"]') },
        {
          equals: ["https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg"],
          id: "canonical-early-access-download",
          kind: "attribute-set",
          locator: css(
            'a[href="https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg"]',
          ),
          name: "href",
        },
      ],
      [{ locator: css('[data-screen-label="落地页"]'), name: "landing-root" }],
    ),
    description:
      "Landing keeps demo controls inert while exposing only the approved Early Access download.",
    id: "landing-production-safe-cta",
    kind: "production-only",
    owner: "landing-ui-001",
    probe: {
      actions: [
        {
          locator: css(
            'a[href="https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg"]',
            { index: 0 },
          ),
          type: "focus",
        },
        {
          locator: css(
            'a[href="https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg"]',
            { index: 1 },
          ),
          type: "focus",
        },
        {
          locator: css(
            'a[href="https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg"]',
            { index: "last" },
          ),
          type: "focus",
        },
        click(text("功能")),
        click(text("Agents")),
        click(text("Memory")),
        click(text("文档", { index: 0 })),
        click(text("在线体验 →")),
        click(text("GitHub ↗")),
        click(text("dougoos.com")),
        click(text("文档", { index: "last" })),
        click(text("更新日志")),
        click(title("切换主题")),
        click(title("切换主题")),
      ],
      landingActions: [
        {
          expect: "dialog-open",
          id: "open-register-path",
          locator: text("登录", { index: 0 }),
          type: "click",
        },
        {
          expect: "dialog-open",
          id: "register-is-noop",
          locator: text("注册 dougoos.com"),
          type: "click",
        },
        {
          expect: "dialog-closed",
          id: "close-button",
          locator: text("✕"),
          type: "click",
        },
        {
          expect: "dialog-open",
          id: "open-inner-click-path",
          locator: text("登录", { index: 0 }),
          type: "click",
        },
        {
          expect: "dialog-open",
          id: "inner-click-keeps-dialog",
          locator: css(".login-copy"),
          type: "click",
        },
        {
          expect: "dialog-closed",
          id: "backdrop-closes",
          locator: css(".login-overlay"),
          position: { x: 5, y: 5 },
          type: "click-position",
        },
        {
          expect: "dialog-open",
          id: "open-escape-path",
          locator: text("登录", { index: 0 }),
          type: "click",
        },
        {
          expect: "dialog-closed",
          id: "escape-closes",
          key: "Escape",
          type: "press",
        },
        {
          expect: "dialog-open",
          id: "open-form-path",
          locator: text("登录", { index: 0 }),
          type: "click",
        },
        {
          expect: "dialog-open",
          id: "fill-demo-email",
          locator: placeholder("邮箱"),
          type: "fill",
          value: "visual@example.test",
        },
        {
          expect: "dialog-open",
          id: "fill-demo-password",
          locator: placeholder("密码"),
          type: "fill",
          value: "never-persist-this",
        },
        {
          expect: "logged-in",
          id: "form-login-is-local",
          locator: text("登录", { index: "last", scope: "screen" }),
          type: "click",
        },
        { expect: "logged-out", id: "reset-after-form", type: "reload" },
        {
          expect: "dialog-open",
          id: "open-github-path",
          locator: text("登录", { index: 0 }),
          type: "click",
        },
        {
          expect: "logged-in",
          id: "github-login-is-local",
          locator: css('.login-provider[aria-label="GitHub"]'),
          type: "click",
        },
        { expect: "logged-out", id: "reset-after-github", type: "reload" },
        {
          expect: "dialog-open",
          id: "open-google-path",
          locator: text("登录", { index: 0 }),
          type: "click",
        },
        {
          expect: "logged-in",
          id: "google-login-is-local",
          locator: css('.login-provider[aria-label="Google"]'),
          type: "click",
        },
        { expect: "logged-out", id: "reset-after-google", type: "reload" },
      ],
    },
    surface: "landing",
    tags: ["demo-only", "actual-diff-pending"],
    viewport: "landing-1440x1000",
  },
];

export const visualManifest = {
  actualDiffStatus: {
    landing: "complete",
    saas: "complete",
  },
  animationSampleMilliseconds: 0,
  chromium: "@playwright/test 1.61.1 bundled Chromium",
  colorThresholdPerChannel: 1,
  deterministic: {
    animationPolicy:
      "infinite animations are frozen at cycle start; finite animations and transitions are settled to their end state",
    caret: "hidden",
    externalNetwork: "blocked",
    fixedTime: "2026-07-23T04:05:06.000Z",
    fontWait: 'document.fonts.ready + explicit "Instrument Sans"/"JetBrains Mono" checks',
    intervalPolicy: "prototype 1000ms tick is suppressed before support.js executes",
    locale: "zh-CN",
    randomSeed: 1597463007,
    timezoneId: "Asia/Shanghai",
  },
  geometryThresholdPixels: 1,
  maxDiffPixelRatio: 0.005,
  productionOnlyCases,
  referenceCases: visualReferenceCases,
  schemaVersion: VISUAL_MANIFEST_VERSION,
  ssimMinimum: 0.995,
  viewports: VIEWPORTS,
} as const;

export function validateVisualManifest(): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const visualCase of [...visualReferenceCases, ...productionOnlyCases]) {
    if (ids.has(visualCase.id)) errors.push(`duplicate case id: ${visualCase.id}`);
    ids.add(visualCase.id);
  }

  for (const visualCase of visualReferenceCases) {
    if (!(visualCase.viewport in VIEWPORTS)) {
      errors.push(`${visualCase.id}: unknown viewport ${visualCase.viewport}`);
    }
    if (visualCase.kind === "prototype-reference" && visualCase.expectedScreenLabel === undefined) {
      errors.push(`${visualCase.id}: prototype reference must declare expectedScreenLabel`);
    }
    if (visualCase.captureMode === "full-page" && visualCase.surface !== "landing") {
      errors.push(`${visualCase.id}: only Landing references use full-page capture`);
    }
  }

  const saasProductionCases = productionOnlyCases.filter(
    (visualCase) => visualCase.surface === "saas",
  );
  if (saasProductionCases.length !== 15) {
    errors.push(
      `SaaS production-only contract requires exactly 15 cases, received ${String(
        saasProductionCases.length,
      )}`,
    );
  }
  if (visualManifest.actualDiffStatus.saas.startsWith("pending")) {
    errors.push("SaaS actual/diff evidence exists but actualDiffStatus is still pending");
  }
  const landingProductionReferences = visualReferenceCases.filter(
    (visualCase) => visualCase.surface === "landing" && visualCase.kind !== "source-defect",
  );
  const landingProductionCases = productionOnlyCases.filter(
    (visualCase) => visualCase.surface === "landing",
  );
  if (landingProductionReferences.length !== 15) {
    errors.push(
      `Landing production reference contract requires exactly 15 cases, received ${String(
        landingProductionReferences.length,
      )}`,
    );
  }
  if (landingProductionCases.length !== 1) {
    errors.push(
      `Landing production-only contract requires exactly 1 case, received ${String(
        landingProductionCases.length,
      )}`,
    );
  }
  if (visualManifest.actualDiffStatus.landing.startsWith("pending")) {
    errors.push("Landing actual/diff evidence exists but actualDiffStatus is still pending");
  }
  const landingSafetyCase = landingProductionCases[0];
  if ((landingSafetyCase?.probe?.actions.length ?? 0) < 14) {
    errors.push("Landing production-only case must audit every persistent page control");
  }
  const landingAuditActions = landingSafetyCase?.probe?.landingActions ?? [];
  if (landingAuditActions.length < 19) {
    errors.push("Landing production-only case must audit every login completion and close path");
  }
  if (new Set(landingAuditActions.map((action) => action.id)).size !== landingAuditActions.length) {
    errors.push("Landing production-only case has duplicate safety action ids");
  }
  for (const visualCase of productionOnlyCases) {
    if (visualCase.capture.requirements.length === 0) {
      errors.push(`${visualCase.id}: production-only case has no semantic requirements`);
    }
    if (visualCase.capture.landmarks.length === 0) {
      errors.push(`${visualCase.id}: production-only case has no landmarks`);
    }
    const requirementIds = visualCase.capture.requirements.map((requirement) => requirement.id);
    if (new Set(requirementIds).size !== requirementIds.length) {
      errors.push(`${visualCase.id}: duplicate semantic requirement id`);
    }
    const landmarkNames = visualCase.capture.landmarks.map((landmark) => landmark.name);
    if (new Set(landmarkNames).size !== landmarkNames.length) {
      errors.push(`${visualCase.id}: duplicate production-only landmark name`);
    }
  }

  const requiredReferencePrefixes = [
    "saas-agent-codex-session",
    "saas-agent-claude-session",
    "saas-agent-grok-session",
    "saas-agent-cursor-session",
    "saas-agent-pi-session",
    "saas-agent-hermes-session",
    "saas-hermes-history",
    "saas-hermes-skills",
    "saas-hermes-kanban",
    "saas-hermes-mcps",
    "saas-sm-dash",
    "saas-sm-sessions",
    "saas-sm-insights",
    "saas-sm-analytics",
    "saas-sm-patterns",
    "saas-sm-export",
    "saas-sm-sync",
    "saas-harness-prompt",
    "saas-harness-skills",
    "saas-harness-mcp",
    "saas-harness-subagents",
    "saas-harness-goals",
    "saas-harness-workflows",
    "saas-harness-hooks",
    "saas-harness-rules",
    "saas-memory-graph",
    "saas-memory-recent",
    "saas-memory-notes",
    "saas-memory-memory",
    "saas-settings-appearance",
    "saas-settings-customize",
    "saas-settings-agent",
    "saas-settings-usage-notifications",
    "saas-settings-projects",
    "saas-settings-compare",
    "saas-notifications-unread",
    "saas-approval-pending",
    "saas-approval-approved",
    "saas-approval-denied",
    "saas-sm-export-generating",
    "saas-sm-sync-syncing",
    "saas-sm-sync-completed",
    "saas-hermes-skill-running",
    "saas-memory-star-filtered",
    "saas-agent-codex-history-resume-demo",
    "landing-full",
    "landing-login-open",
    "landing-logged-in",
  ];
  for (const prefix of requiredReferencePrefixes) {
    if (!visualReferenceCases.some((visualCase) => visualCase.id.startsWith(`${prefix}--`))) {
      errors.push(`missing required reference prefix: ${prefix}`);
    }
  }

  const requiredLandmarkCoverage: readonly [prefix: string, landmarkNames: readonly string[]][] = [
    ["saas-notifications-unread", ["notification-overlay"]],
    ["saas-approval-pending", ["agent-user-message", "approval-command", "agent-composer"]],
    ["saas-sm-export-generating", ["sm-export-async-control"]],
    ["saas-sm-sync-syncing", ["sm-sync-async-control"]],
    [
      "saas-harness-prompt-segment-open",
      ["harness-prompt-segment", "harness-prompt-expanded-body"],
    ],
    ["saas-settings-agent", ["settings-agent-section"]],
  ];
  for (const [prefix, landmarkNames] of requiredLandmarkCoverage) {
    const matches = visualReferenceCases.filter((visualCase) =>
      visualCase.id.startsWith(`${prefix}--`),
    );
    for (const landmarkName of landmarkNames) {
      if (
        !matches.some((visualCase) =>
          visualCase.landmarks.some((landmark) => landmark.name === landmarkName),
        )
      ) {
        errors.push(`${prefix}: missing critical landmark ${landmarkName}`);
      }
    }
  }

  const defaultPageCases = visualReferenceCases.filter(
    (visualCase) =>
      visualCase.kind === "prototype-reference" &&
      visualCase.tags.includes("page") &&
      !visualCase.tags.includes("variant") &&
      visualCase.theme === "dark" &&
      visualCase.accent === "green",
  );
  for (const visualCase of defaultPageCases) {
    const required =
      visualCase.surface === "saas"
        ? (["saas-1440x900", "saas-1280x800"] as const)
        : (["landing-1440x1000", "landing-1024x768"] as const);
    const stem = visualCase.id.slice(0, visualCase.id.lastIndexOf("--"));
    for (const viewport of required) {
      if (!visualReferenceCases.some((candidate) => candidate.id === `${stem}--${viewport}`)) {
        errors.push(`${stem}: default page missing ${viewport}`);
      }
    }
  }

  for (const accent of ["cyan", "orange", "purple"] as const) {
    for (const stem of ["saas-home", "saas-agent-claude", "landing-full"] as const) {
      if (
        !visualReferenceCases.some(
          (visualCase) =>
            visualCase.id.startsWith(`${stem}-dark-${accent}--`) &&
            visualCase.theme === "dark" &&
            visualCase.accent === accent,
        )
      ) {
        errors.push(`missing critical dark/${accent} variant for ${stem}`);
      }
    }
  }

  for (const stem of ["saas-home", "saas-agent-claude", "landing-full"] as const) {
    if (
      !visualReferenceCases.some(
        (visualCase) =>
          visualCase.id.startsWith(`${stem}-light-green--`) &&
          visualCase.theme === "light" &&
          visualCase.accent === "green",
      )
    ) {
      errors.push(`missing critical light/green variant for ${stem}`);
    }
  }

  const requiredProductionStates = [
    "loading",
    "error",
    "recovery",
    "capability-warning",
    "constrained",
    "cancel",
  ];
  for (const tag of requiredProductionStates) {
    if (!productionOnlyCases.some((visualCase) => visualCase.tags.includes(tag))) {
      errors.push(`missing production-only future state: ${tag}`);
    }
  }

  return errors;
}
