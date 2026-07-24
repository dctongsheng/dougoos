import { featureFixtures } from "./feature-fixtures.js";
import type { AgentFixture, AgentId, SaasDataSource, SaasFixture } from "./types.js";

export const agentFixtures: readonly AgentFixture[] = [
  {
    cost: 4.21,
    cwd: "~/dev/api-server",
    enabled: true,
    glyph: "❯",
    id: "codex",
    last: "▸ 重写 middleware/auth.ts",
    model: "gpt-5-codex",
    name: "Codex CLI",
    status: "executing",
    task: "重构 auth 中间件为策略模式",
    tokenCount: 182_400,
    tone: "#4fd8e0",
  },
  {
    cost: 1.84,
    cwd: "~/dev/webapp",
    enabled: true,
    glyph: "◆",
    id: "claude",
    last: "⚠ 等待确认: prisma migrate deploy",
    model: "claude-4.5-sonnet",
    name: "Claude Code",
    status: "waiting",
    task: "迁移 users 表到新 schema",
    tokenCount: 96_300,
    tone: "#ff9d66",
  },
  {
    cost: 0.63,
    cwd: "~/dev/ml-pipeline",
    enabled: true,
    glyph: "◭",
    id: "grok",
    last: "…扫描 log/2026-07-21.gz",
    model: "grok-4",
    name: "Grok CLI",
    status: "thinking",
    task: "分析生产环境 crash 日志",
    tokenCount: 54_100,
    tone: "#b48cff",
  },
  {
    cost: 0.94,
    cwd: "~/dev/webapp",
    enabled: true,
    glyph: "⌖",
    id: "cursor",
    last: "✓ tests/parser.spec.ts 14/14",
    model: "composer-2",
    name: "Cursor CLI",
    status: "executing",
    task: "为 parser 补全单元测试",
    tokenCount: 77_800,
    tone: "#6aa5ff",
  },
  {
    cost: 0,
    cwd: "~",
    enabled: true,
    glyph: "π",
    id: "pi",
    last: "—",
    model: "pi-3",
    name: "Pi",
    status: "idle",
    task: "待命",
    tokenCount: 0,
    tone: "#49e0c0",
  },
  {
    cost: 0.12,
    cwd: "~/dev/api-server",
    enabled: true,
    glyph: "☿",
    id: "hermes",
    last: "✓ OpenAPI 文档已生成",
    model: "hermes-4-405b",
    name: "Hermes",
    status: "idle",
    task: "待命",
    tokenCount: 12_400,
    tone: "#ffd166",
  },
  {
    cost: 0,
    cwd: "~",
    enabled: true,
    glyph: "⌁",
    id: "openclaw",
    last: "—",
    model: "default",
    name: "OpenClaw",
    status: "idle",
    task: "待命",
    tokenCount: 0,
    tone: "#ff6b6b",
  },
  {
    cost: 0,
    cwd: "~",
    enabled: true,
    glyph: "◈",
    id: "opencode",
    last: "—",
    model: "auto",
    name: "OpenCode",
    status: "idle",
    task: "待命",
    tokenCount: 0,
    tone: "#d6e4ff",
  },
];

export const saasFixture: SaasFixture = {
  agents: agentFixtures,
  conversations: [
    {
      label: "今天",
      sessions: [
        { agentId: "claude", title: "迁移 users 表到新 schema" },
        { agentId: "codex", title: "重构 auth 中间件为策略模式" },
      ],
    },
    {
      label: "昨天",
      sessions: [
        { agentId: "cursor", title: "修复 webapp 构建缓存失效" },
        { agentId: "grok", title: "API 集成测试补全" },
      ],
    },
    {
      label: "更早",
      sessions: [
        { agentId: "hermes", title: "重构日志管道与告警" },
        { agentId: "pi", title: "依赖升级与安全审计" },
      ],
    },
  ],
  features: featureFixtures,
  notifications: [
    {
      agentId: "claude",
      id: "n1",
      read: false,
      text: "请求执行 prisma migrate deploy",
      time: "刚刚",
      title: "Claude Code 等待确认",
    },
    {
      agentId: "cursor",
      id: "n2",
      read: false,
      text: "parser 单元测试 14/14 通过",
      time: "6 分钟前",
      title: "Cursor CLI 任务完成",
    },
    {
      agentId: null,
      id: "n3",
      read: true,
      text: "今日费用已达预算 78%",
      time: "1 小时前",
      title: "预算提醒",
    },
  ],
  projects: [
    { name: "webapp", path: "~/dev/webapp" },
    { name: "api-server", path: "~/dev/api-server" },
    { name: "ml-pipeline", path: "~/dev/ml-pipeline" },
    { name: "dotfiles", path: "~/dotfiles" },
  ],
  sidebarProjects: [
    {
      initiallyOpen: true,
      name: "13_locla_session_manager",
      sessions: [
        { agentId: "claude", title: "调整 AgentShare 客户端" },
        { agentId: "codex", title: "设计 agentshare 大改版方案" },
      ],
    },
    {
      initiallyOpen: true,
      name: "fyfactor",
      sessions: [
        { agentId: "grok", title: "我想做个点子或者副业数据库" },
        { agentId: "hermes", title: "验证 GitHub 子 agent" },
      ],
    },
    {
      initiallyOpen: false,
      name: "douge_ship_tem_2",
      sessions: [{ agentId: "cursor", title: "落地页动效与模板重构" }],
    },
    {
      initiallyOpen: false,
      name: "001_bian_ai",
      sessions: [{ agentId: "pi", title: "边缘推理 API 选型调研" }],
    },
  ],
  suggestions: [
    "修复 flaky 的 e2e 登录用例",
    "分析昨晚的 crash 日志",
    "为 parser 补全单元测试",
    "重新生成 OpenAPI 文档",
  ],
};

export const cloneSaasFixture = (): SaasFixture => ({
  agents: saasFixture.agents.map((agent) => ({ ...agent })),
  conversations: saasFixture.conversations.map((group) => ({
    ...group,
    sessions: group.sessions.map((session) => ({ ...session })),
  })),
  features: structuredClone(saasFixture.features),
  notifications: saasFixture.notifications.map((notification) => ({ ...notification })),
  projects: saasFixture.projects.map((project) => ({ ...project })),
  sidebarProjects: saasFixture.sidebarProjects.map((project) => ({
    ...project,
    sessions: project.sessions.map((session) => ({ ...session })),
  })),
  suggestions: [...saasFixture.suggestions],
});

export class FixtureDataSource implements SaasDataSource {
  readonly mode = "fixture" as const;

  async execute(_command: Parameters<SaasDataSource["execute"]>[0], signal: AbortSignal) {
    await Promise.resolve();
    if (signal.aborted) throw new DOMException("Fixture command aborted", "AbortError");
  }

  async getSnapshot(signal: AbortSignal) {
    await Promise.resolve();
    if (signal.aborted) throw new DOMException("Fixture load aborted", "AbortError");
    return {
      fixture: cloneSaasFixture(),
      revision: 1,
    };
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

export const agentById = (fixture: SaasFixture, agentId: AgentId): AgentFixture => {
  const agent = fixture.agents.find((candidate) => candidate.id === agentId);
  if (agent === undefined) throw new Error(`Unknown fixture agent: ${agentId}`);
  return agent;
};
