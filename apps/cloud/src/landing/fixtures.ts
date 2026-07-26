import type {
  LandingAgent,
  LandingFeature,
  LandingKpi,
  LandingProductCard,
  LandingRoute,
  LandingStat,
  MemoryStar,
} from "./types.js";

interface AgentVisual {
  readonly glyph: string;
  readonly hue: string;
}

const agentVisuals = {
  claude: { glyph: "✳", hue: "#d97757" },
  codex: { glyph: "⌬", hue: "#4fd8e0" },
  cursor: { glyph: "▮", hue: "#7aa2f7" },
  grok: { glyph: "𝕏", hue: "#b48cff" },
  hermes: { glyph: "☿", hue: "#ffd166" },
  pi: { glyph: "π", hue: "#3ddc84" },
} as const satisfies Readonly<Record<string, AgentVisual>>;

type AgentKey = keyof typeof agentVisuals;

interface AgentSeed {
  readonly bin: string;
  readonly dot: string;
  readonly key: AgentKey;
  readonly name: string;
  readonly pulse: string;
}

const agentSeeds: readonly AgentSeed[] = [
  {
    bin: "codex",
    dot: "#4fd8e0",
    key: "codex",
    name: "Codex",
    pulse: "pulse 1.4s infinite",
  },
  {
    bin: "0.2.0 暂不可用",
    dot: "rgba(140,160,150,.35)",
    key: "claude",
    name: "Claude Agent",
    pulse: "none",
  },
  {
    bin: "grok",
    dot: "#ffb454",
    key: "grok",
    name: "Grok",
    pulse: "pulse .9s steps(1) infinite",
  },
  {
    bin: "cursor-agent",
    dot: "rgba(140,160,150,.35)",
    key: "cursor",
    name: "Cursor",
    pulse: "none",
  },
  {
    bin: "pi",
    dot: "#3ddc84",
    key: "pi",
    name: "Pi",
    pulse: "pulse 1.4s infinite",
  },
  {
    bin: "hermes",
    dot: "rgba(140,160,150,.35)",
    key: "hermes",
    name: "Hermes",
    pulse: "none",
  },
];

export const landingAgents: readonly LandingAgent[] = agentSeeds.map((agent) => ({
  ...agentVisuals[agent.key],
  bin: agent.bin,
  dot: agent.dot,
  name: agent.name,
  pulse: agent.pulse,
}));

export const landingKpis: readonly LandingKpi[] = [
  { color: "#3ddc84", label: "活跃 Agent", value: "3/5" },
  { color: "#ffb454", label: "等待确认", value: "1" },
  { color: "var(--text,#f2f7f3)", label: "今日费用", value: "$12.40" },
  { color: "var(--text,#f2f7f3)", label: "今日 Tokens", value: "2.9M" },
];

interface ProductCardSeed {
  readonly border: string;
  readonly key: AgentKey;
  readonly last: string;
  readonly name: string;
  readonly status: string;
  readonly statusColor: string;
  readonly task: string;
}

const productCardSeeds: readonly ProductCardSeed[] = [
  {
    border: "var(--bd,rgba(255,255,255,.07))",
    key: "claude",
    last: "请使用其他 Provider",
    name: "Claude Agent",
    status: "暂不可用",
    statusColor: "#8a968e",
    task: "DougoOS 0.2.0 不包含或启动 Anthropic adapter",
  },
  {
    border: "var(--bd,rgba(255,255,255,.07))",
    key: "codex",
    last: "analyzing test history…",
    name: "Codex",
    status: "思考中",
    statusColor: "#b48cff",
    task: "为 CI 写 flaky 测试重试脚本",
  },
  {
    border: "color-mix(in srgb, #ffb454 40%, transparent)",
    key: "grok",
    last: "⚠ 需要确认:写入生产配置",
    name: "Grok",
    status: "等待确认",
    statusColor: "#ffb454",
    task: "k6 压测:限流网关 2k RPS",
  },
];

export const landingProductCards: readonly LandingProductCard[] = productCardSeeds.map((card) => ({
  ...card,
  ...agentVisuals[card.key],
}));

export const landingFeatures: readonly LandingFeature[] = [
  {
    body: "按任务类型与 Agent 长处自动派发,支持定时任务与长程队列,跑完自动回报。",
    glyph: "⇶",
    title: "智能任务路由",
  },
  {
    body: "会话按 Agent 与项目分组,进行中与历史一目了然,随时恢复任意一条继续跑。",
    glyph: "❐",
    title: "层级会话管理",
  },
  {
    body: "决策、教训、原子事实沉淀成可检索的图谱,跨 Agent 共享,不再重复踩坑。",
    glyph: "✦",
    title: "Memory 记忆图谱",
  },
  {
    body: "System Prompt、Skills、MCP、Hooks、Rules、SubAgents 集中配置,一处生效。",
    glyph: "⚙",
    title: "HARNESS 编排",
  },
  {
    body: "同一道题发给多个 Agent,并排比较耗时、费用、测试通过率,择优采纳。",
    glyph: "⧉",
    title: "结果对比",
  },
  {
    body: "Token 与费用按 Agent、按项目追踪,预算护栏 + 敏感操作人工审批。",
    glyph: "▥",
    title: "预算与审批",
  },
];

interface RouteSeed {
  readonly agent: string;
  readonly confidence: string;
  readonly key: AgentKey;
  readonly task: string;
}

const routeSeeds: readonly RouteSeed[] = [
  {
    agent: "Cursor",
    confidence: "93%",
    key: "cursor",
    task: "把 users 表迁移到新 schema",
  },
  { agent: "Codex", confidence: "91%", key: "codex", task: "写一个日志清洗脚本" },
  { agent: "Grok", confidence: "88%", key: "grok", task: "对网关做 2k RPS 压测" },
];

export const landingRoutes: readonly LandingRoute[] = routeSeeds.map((route) => ({
  ...route,
  ...agentVisuals[route.key],
}));

export const memoryStars: readonly MemoryStar[] = [
  { glow: 18, opacity: 0.95, size: 10, x: 22, y: 56 },
  { glow: 14, opacity: 0.9, size: 8, x: 60, y: 22 },
  { glow: 10, opacity: 0.7, size: 6, x: 78, y: 60 },
  { glow: 8, opacity: 0.6, size: 5, x: 40, y: 34 },
  { glow: 6, opacity: 0.5, size: 4, x: 12, y: 26 },
  { glow: 6, opacity: 0.45, size: 4, x: 88, y: 30 },
  { glow: 8, opacity: 0.55, size: 5, x: 50, y: 74 },
  { glow: 5, opacity: 0.4, size: 3, x: 70, y: 82 },
];

export const landingStats: readonly LandingStat[] = [
  { label: "0.2.0 可用 Agent CLI", value: "5" },
  { label: "本周托管会话", value: "128" },
  { label: "DougoOS 云端同步", value: "关闭" },
  { label: "需要盯着的窗口", value: "1" },
];
