import type {
  AgentId,
  AgentStatus,
  AgentTab,
  MemoryTab,
  RuntimePresentationKind,
} from "./types.js";

export type AgentMessage =
  | {
      readonly body: string;
      readonly id: string;
      readonly state?: "complete" | "streaming";
      readonly type: "note" | "text" | "think" | "user";
    }
  | {
      readonly arg: string;
      readonly id: string;
      readonly result: string;
      readonly tool: string;
      readonly type: "tool";
    }
  | {
      readonly additions: number;
      readonly deletions: number;
      readonly file: string;
      readonly id: string;
      readonly lines: readonly string[];
      readonly type: "diff";
    }
  | {
      readonly approved: boolean | null;
      readonly body: string;
      readonly command: string;
      readonly id: string;
      readonly note: string;
      readonly options?: readonly {
        readonly kind: "allow" | "reject";
        readonly label: string;
        readonly optionId: string;
      }[];
      readonly requestId?: string;
      readonly status?: "allowed" | "cancelled" | "expired" | "pending" | "rejected";
      readonly turnId?: string;
      readonly type: "approval";
    };

export interface AgentHistoryItem {
  readonly date: string;
  readonly messageCount: number;
  readonly project: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly tokens: string;
}

export const agentInitialMessages: Readonly<Record<AgentId, readonly AgentMessage[]>> = {
  claude: [
    {
      body: "把 users 表迁移到新 schema,写好迁移脚本并先跑 dry-run",
      id: "m1",
      type: "user",
    },
    {
      arg: "prisma/schema.prisma",
      id: "m2",
      result: "2.1k tok",
      tool: "Read",
      type: "tool",
    },
    {
      arg: "npx prisma migrate diff --preview",
      id: "m3",
      result: "exit 0",
      tool: "Bash",
      type: "tool",
    },
    {
      body: "差异已确认:users 表新增 tenant_id 与软删除字段,需要回填数据。迁移分两阶段:先扩列回填,再收紧约束。dry-run 通过。",
      id: "m4",
      type: "text",
    },
    {
      additions: 48,
      deletions: 12,
      file: "migrations/20260721_users_v2.sql",
      id: "m5",
      lines: [
        "+ ALTER TABLE users ADD COLUMN tenant_id uuid;",
        "+ ALTER TABLE users ADD COLUMN deleted_at timestamptz;",
        "+ UPDATE users SET tenant_id = o.tenant_id FROM orgs o ...;",
        "- DROP INDEX users_email_key;",
        "+ CREATE UNIQUE INDEX users_email_tenant_key ON users(email, tenant_id);",
      ],
      type: "diff",
    },
    {
      approved: null,
      body: "⚠ 权限请求 — 需要你确认",
      command: "npx prisma migrate deploy",
      id: "m6",
      note: "将对 webapp 生产数据库执行结构变更,不可自动回滚",
      type: "approval",
    },
  ],
  codex: [
    {
      body: "把 auth 中间件重构成可插拔的策略模式,保持现有行为不变",
      id: "x1",
      type: "user",
    },
    {
      arg: '"authMiddleware" src/',
      id: "x2",
      result: "14 处引用",
      tool: "Grep",
      type: "tool",
    },
    {
      body: "计划:① 抽出 AuthStrategy 接口 ② JWT / ApiKey / Session 三个实现 ③ 引用点切换到工厂函数。开始执行。",
      id: "x3",
      type: "text",
    },
    {
      arg: "middleware/auth.ts",
      id: "x4",
      result: "+120 −86",
      tool: "Edit",
      type: "tool",
    },
    {
      body: "▸ 运行 tests/auth.spec.ts … 9/14 通过",
      id: "x5",
      type: "note",
    },
  ],
  cursor: [
    { body: "为 parser 补全单元测试,目标覆盖率 90%", id: "u1", type: "user" },
    {
      arg: "tests/parser.spec.ts",
      id: "u2",
      result: "+214 −0",
      tool: "Edit",
      type: "tool",
    },
    {
      body: "14 个用例全部通过,分支覆盖率 91.4%,已在工作区待提交。",
      id: "u3",
      type: "text",
    },
    { body: "✓ 任务完成 · 用时 17m", id: "u4", type: "note" },
  ],
  grok: [
    { body: "分析昨晚生产环境的 crash 日志,找出根因", id: "g1", type: "user" },
    {
      body: "正在扫描 log/2026-07-21.gz (1.2 GB) …",
      id: "g2",
      type: "think",
    },
  ],
  hermes: [],
  openclaw: [],
  opencode: [],
  pi: [],
};

export const agentHistories: Readonly<Record<AgentId, readonly AgentHistoryItem[]>> = {
  claude: [
    {
      date: "07-20 22:14",
      messageCount: 34,
      project: "webapp",
      sessionId: "#a3f2",
      summary: "重构支付 webhook 重试逻辑",
      tokens: "412k",
    },
    {
      date: "07-19 16:40",
      messageCount: 18,
      project: "webapp",
      sessionId: "#98c1",
      summary: "修复 SSR hydration 报错",
      tokens: "156k",
    },
  ],
  codex: [
    {
      date: "07-20 21:02",
      messageCount: 22,
      project: "api-server",
      sessionId: "#c2e8",
      summary: "修复 CI 缓存键漂移",
      tokens: "188k",
    },
    {
      date: "07-18 10:33",
      messageCount: 41,
      project: "api-server",
      sessionId: "#b011",
      summary: "gRPC 网关脚手架",
      tokens: "520k",
    },
  ],
  cursor: [
    {
      date: "07-20 15:27",
      messageCount: 15,
      project: "webapp",
      sessionId: "#61aa",
      summary: "抽离表单校验 hooks",
      tokens: "98k",
    },
  ],
  grok: [
    {
      date: "07-17 09:12",
      messageCount: 26,
      project: "ml-pipeline",
      sessionId: "#77de",
      summary: "训练数据去重脚本",
      tokens: "302k",
    },
  ],
  hermes: [
    {
      date: "07-21 09:05",
      messageCount: 9,
      project: "api-server",
      sessionId: "#4f02",
      summary: "生成 OpenAPI 文档",
      tokens: "64k",
    },
  ],
  openclaw: [],
  opencode: [],
  pi: [],
};

export const hermesSkills = [
  ["⌕", "行业调研", "检索近 7 天 AI 自动化动态,输出带来源的摘要简报", 18],
  ["✉", "外联邮件", "按品牌语气为目标客户生成 3 封个性化 outreach 邮件", 42],
  ["¶", "SEO 长文", "围绕关键词生成结构化博客文章,含标题矩阵与内链建议", 11],
  ["◫", "社媒内容", "一稿多发:Twitter/X、LinkedIn 帖子与配图脚本", 27],
  ["⧉", "API 文档", "扫描路由与 schema,重新生成 OpenAPI 文档并校验示例", 9],
  ["✦", "写入 Memory", "把产出摘要沉淀到共享记忆,供其他 Agent 检索", 63],
] as const;

export const hermesMcps = [
  ["browser", "stdio · playwright 无头浏览器", 12, true],
  ["gmail", "http · 邮件草稿与发送(发送需确认)", 6, true],
  ["notion", "http · 知识库读写", 9, true],
  ["analytics", "stdio · GA4 查询", 4, false],
] as const;

export const hermesKanbanColumns = [
  {
    cards: [
      { project: "webapp", title: "为新功能页写 landing 文案", when: "今天" },
      { project: "其他", title: "整理 Q3 客户访谈引用", when: "明天" },
    ],
    color: "var(--mut)",
    name: "待办",
  },
  {
    cards: [{ project: "其他", title: "AI 自动化行业周报 #12", when: "刚刚" }],
    color: "var(--think)",
    name: "进行中",
  },
  {
    cards: [
      { project: "api-server", title: "OpenAPI 文档重新生成", when: "09:05" },
      { project: "其他", title: "欢迎邮件序列 3 封", when: "昨天" },
    ],
    color: "var(--ac-fg)",
    name: "已完成",
  },
] as const;

export const defaultAgentTabs: readonly [AgentTab, string, string][] = [
  ["session", "❯", "对话"],
  ["history", "↺", "历史"],
];

export const hermesAgentTabs: readonly [AgentTab, string, string][] = [
  ...defaultAgentTabs,
  ["skills", "✦", "技能"],
  ["kanban", "▦", "看板"],
  ["mcps", "⚙", "MCPs"],
];

export interface ProductionStateNoticeFixture {
  readonly action?: string;
  readonly body: string;
  readonly tone: "error" | "info" | "warning";
  readonly title: string;
}

export const runtimeStateNotices: Readonly<
  Partial<Record<RuntimePresentationKind, ProductionStateNoticeFixture>>
> = {
  "agent-crashed": {
    action: "查看诊断",
    body: "ACP transport closed unexpectedly · exit code 1",
    title: "Agent 进程已崩溃",
    tone: "error",
  },
  "api-error": {
    action: "重试",
    body: "CORE_REQUEST_FAILED · Agent transport 返回不可恢复错误。",
    title: "Core API 请求失败",
    tone: "error",
  },
  "capability-warning": {
    body: "此 Provider 不保证发起 permission request;客户端无法强制阻断其内部工具。",
    title: "权限能力有限",
    tone: "warning",
  },
  "core-restart": {
    body: "旧连接凭据已丢弃;等待新 instanceId、port 与 bearer token。",
    title: "本地 Core 正在重启",
    tone: "warning",
  },
  "provider-probing-unavailable": {
    action: "运行 doctor",
    body: "Claude Agent 在 0.2.0 中暂不可用；当前版本不包含或启动 Anthropic adapter。Codex 可用。",
    title: "正在探测 Provider · 1 个不可用",
    tone: "warning",
  },
  "replay-gap": {
    body: "事件游标已超出保留窗口;正在用全局快照替换本地读模型。",
    title: "检测到 REPLAY_GAP",
    tone: "warning",
  },
  "session-busy": {
    body: "已有一个 running Turn;请等待完成或先停止当前 Turn。",
    title: "Session busy",
    tone: "warning",
  },
  "sse-reconnecting": {
    body: "fetch-SSE 已断开;写操作暂时禁用,连接恢复后将从 lastAppliedSeq 重放。",
    title: "正在重新连接 Core…",
    tone: "warning",
  },
  "turn-cancelling": {
    body: "取消请求已提交,正在等待 Agent 安全停止。",
    title: "正在取消 Turn…",
    tone: "warning",
  },
  "turn-failed": {
    body: "Agent 未能完成本次 Turn。错误详情已保留,可以检查后重新发送。",
    title: "Turn 执行失败",
    tone: "error",
  },
  "turn-interrupted": {
    body: "启动恢复事务已把未完成 Turn 标记为 interrupted,历史消息保持可读。",
    title: "Turn 已中断",
    tone: "warning",
  },
  "turn-running": {
    action: "停止",
    body: "正在流式接收 Agent 更新;当前 Session 不接受第二个 Turn。",
    title: "Turn 执行中",
    tone: "info",
  },
};

export const agentStatusLabels: Readonly<Record<AgentStatus, string>> = {
  executing: "执行中",
  idle: "空闲",
  thinking: "思考中",
  waiting: "等待确认",
};

export interface CronTaskFixture {
  readonly agentId: AgentId;
  readonly id: string;
  readonly last: string;
  readonly next: string;
  readonly schedule: string;
  readonly title: string;
}

export const cronTasks: readonly CronTaskFixture[] = [
  {
    agentId: "claude",
    id: "c1",
    last: "✓ 昨晚成功",
    next: "今晚 02:00",
    schedule: "每日 02:00",
    title: "夜间质量流水线",
  },
  {
    agentId: "hermes",
    id: "c2",
    last: "✓ 昨晚成功",
    next: "今晚 02:30",
    schedule: "每日 02:30",
    title: "重新生成 OpenAPI 文档",
  },
  {
    agentId: "codex",
    id: "c3",
    last: "— 已暂停",
    next: "07-27 09:00",
    schedule: "每周一 09:00",
    title: "依赖安全审计",
  },
  {
    agentId: "hermes",
    id: "c4",
    last: "✓ 上周五",
    next: "07-24 17:00",
    schedule: "每周五 17:00",
    title: "AI 行业周报",
  },
];

export const initialCronEnabled: Readonly<Record<string, boolean>> = {
  c1: true,
  c2: true,
  c3: false,
  c4: true,
};

export type QueueStatus = "done" | "queued" | "running";

export interface QueueTaskFixture {
  readonly id: string;
  readonly project: string;
  readonly result?: string;
  readonly title: string;
}

export const queueTasks: readonly QueueTaskFixture[] = [
  { id: "t1", project: "webapp", title: "修复 flaky 的 e2e 登录用例" },
  { id: "t2", project: "webapp", title: "React 19 依赖升级审计" },
  {
    id: "t3",
    project: "api-server",
    result: "✓ 已完成 · $0.12",
    title: "REST API 生成 OpenAPI 文档",
  },
];

export const initialQueueAssignees: Readonly<Record<string, AgentId | undefined>> = {
  t2: "codex",
  t3: "hermes",
};

export const initialQueueStatuses: Readonly<Record<string, QueueStatus>> = {
  t1: "queued",
  t2: "queued",
  t3: "done",
};

export interface MemoryItemFixture {
  readonly agent: AgentId;
  readonly body?: string;
  readonly date: string;
  readonly id: string;
  readonly kind: "note" | "omi";
  readonly project: string;
  readonly score: number;
  readonly title: string;
  readonly x: number;
  readonly y: number;
}

export const memoryItems: readonly MemoryItemFixture[] = [
  {
    agent: "cursor",
    date: "07-21",
    id: "me1",
    kind: "omi",
    project: "webapp",
    score: 0.95,
    title: "webapp 的 e2e 测试偶发超时,根因是 CI 上共享 redis 端口冲突",
    x: 62,
    y: 38,
  },
  {
    agent: "claude",
    date: "07-21",
    id: "me2",
    kind: "omi",
    project: "webapp",
    score: 0.9,
    title: "users 表迁移采用两阶段方案:先扩列回填,再收紧约束",
    x: 40,
    y: 55,
  },
  {
    agent: "codex",
    date: "07-20",
    id: "me3",
    kind: "omi",
    project: "api-server",
    score: 0.8,
    title: "auth 中间件已切换为策略模式,新增 strategy 需在工厂注册",
    x: 55,
    y: 64,
  },
  {
    agent: "hermes",
    body: "staging 验证 → 数据库备份 → 灰度 10% → 观察 30min → 全量。回滚脚本在 ops/rollback.sh。",
    date: "07-20",
    id: "me4",
    kind: "note",
    project: "api-server",
    score: 0.75,
    title: "发布清单 v3",
    x: 66,
    y: 20,
  },
  {
    agent: "grok",
    date: "07-19",
    id: "me5",
    kind: "omi",
    project: "ml-pipeline",
    score: 0.7,
    title: "crash 根因:worker 池重连时复用已关闭句柄,已加存活检查",
    x: 30,
    y: 40,
  },
  {
    agent: "claude",
    date: "07-18",
    id: "me6",
    kind: "omi",
    project: "api-server",
    score: 0.6,
    title: "rate limiter 最终采纳滑动窗口 + Redis sorted set 实现",
    x: 70,
    y: 50,
  },
  {
    agent: "pi",
    body: "Agent 权限申请流程、常用 prompt 模板、审批策略约定(写库/部署必须人工批准)。",
    date: "07-17",
    id: "me7",
    kind: "note",
    project: "其他",
    score: 0.5,
    title: "新同学 onboarding",
    x: 35,
    y: 74,
  },
  {
    agent: "grok",
    date: "07-16",
    id: "me8",
    kind: "omi",
    project: "api-server",
    score: 0.45,
    title: "k6 压测脚本位于 scripts/load/,基准 100 req/min",
    x: 20,
    y: 62,
  },
  {
    agent: "hermes",
    date: "07-15",
    id: "me9",
    kind: "omi",
    project: "api-server",
    score: 0.4,
    title: "生产部署窗口:工作日 14:00–17:00,周五冻结",
    x: 48,
    y: 25,
  },
  {
    agent: "cursor",
    body: "parser 重写、废弃 v1 API、统一 CI 缓存策略、补齐 webhook 重试监控。",
    date: "07-14",
    id: "me10",
    kind: "note",
    project: "webapp",
    score: 0.35,
    title: "Q3 技术债清单",
    x: 78,
    y: 74,
  },
  {
    agent: "hermes",
    date: "07-13",
    id: "me11",
    kind: "omi",
    project: "api-server",
    score: 0.3,
    title: "OpenAPI 文档由 Hermes 每晚 02:00 自动重新生成",
    x: 82,
    y: 32,
  },
  {
    agent: "claude",
    body: "按 diff 审查:安全 → 性能 → 可读性,输出分级建议(blocker/major/minor)。",
    date: "07-11",
    id: "me12",
    kind: "note",
    project: "其他",
    score: 0.3,
    title: "Prompt 模板:代码审查",
    x: 25,
    y: 82,
  },
  {
    agent: "grok",
    date: "07-10",
    id: "me13",
    kind: "omi",
    project: "ml-pipeline",
    score: 0.25,
    title: "训练数据去重用 minhash,相似度阈值 0.86",
    x: 14,
    y: 26,
  },
  {
    agent: "pi",
    date: "07-08",
    id: "me14",
    kind: "omi",
    project: "其他",
    score: 0.2,
    title: "Pi 仅用于快速问答,不授予仓库写权限",
    x: 88,
    y: 66,
  },
];

export const memoryLinks = [
  [0, 1],
  [1, 9],
  [2, 5],
  [5, 7],
  [3, 8],
  [8, 10],
  [4, 12],
  [6, 11],
] as const;

export const memoryTabLabels: readonly [MemoryTab, string][] = [
  ["recent", "最近"],
  ["notes", "笔记"],
  ["omi", "记忆"],
  ["graph", "图谱"],
];

export interface SessionRowFixture {
  readonly agentId: AgentId;
  readonly category: string;
  readonly date: string;
  readonly duration: string;
  readonly live: boolean;
  readonly project: string;
  readonly title: string;
  readonly tokens: string;
}

export const sessionRows: readonly SessionRowFixture[] = [
  {
    agentId: "codex",
    category: "重构",
    date: "今天",
    duration: "23m",
    live: true,
    project: "api-server",
    title: "重构 auth 中间件为策略模式",
    tokens: "182k",
  },
  {
    agentId: "claude",
    category: "功能构建",
    date: "今天",
    duration: "11m",
    live: true,
    project: "webapp",
    title: "迁移 users 表到新 schema",
    tokens: "96k",
  },
  {
    agentId: "grok",
    category: "Bug 排查",
    date: "今天",
    duration: "4m",
    live: true,
    project: "ml-pipeline",
    title: "分析生产环境 crash 日志",
    tokens: "54k",
  },
  {
    agentId: "cursor",
    category: "测试",
    date: "今天",
    duration: "17m",
    live: true,
    project: "webapp",
    title: "为 parser 补全单元测试",
    tokens: "78k",
  },
  {
    agentId: "claude",
    category: "深度专注",
    date: "07-20",
    duration: "42m",
    live: false,
    project: "webapp",
    title: "重构支付 webhook 重试逻辑",
    tokens: "412k",
  },
  {
    agentId: "codex",
    category: "Bug 排查",
    date: "07-20",
    duration: "31m",
    live: false,
    project: "api-server",
    title: "修复 CI 缓存键漂移",
    tokens: "188k",
  },
  {
    agentId: "cursor",
    category: "重构",
    date: "07-20",
    duration: "18m",
    live: false,
    project: "webapp",
    title: "抽离表单校验 hooks",
    tokens: "98k",
  },
  {
    agentId: "hermes",
    category: "文档",
    date: "07-21",
    duration: "9m",
    live: false,
    project: "api-server",
    title: "REST API 生成 OpenAPI 文档",
    tokens: "64k",
  },
  {
    agentId: "claude",
    category: "Bug 排查",
    date: "07-19",
    duration: "26m",
    live: false,
    project: "webapp",
    title: "修复 SSR hydration 报错",
    tokens: "156k",
  },
  {
    agentId: "codex",
    category: "功能构建",
    date: "07-18",
    duration: "55m",
    live: false,
    project: "api-server",
    title: "gRPC 网关脚手架",
    tokens: "520k",
  },
];

export const sessionInsights = [
  {
    agentId: "claude",
    category: "决策",
    date: "07-21",
    project: "webapp",
    source: "#a3f2",
    text: "users 表迁移采用两阶段方案:先扩列回填,再收紧约束 — 避免锁表与不可回滚风险。",
  },
  {
    agentId: "claude",
    category: "决策",
    date: "07-18",
    project: "api-server",
    source: "#98c1",
    text: "rate limiter 最终采纳滑动窗口 + Redis sorted set,兼顾精度与降级路径。",
  },
  {
    agentId: "cursor",
    category: "经验",
    date: "07-21",
    project: "webapp",
    source: "#61aa",
    text: "e2e 偶发超时的根因是 CI 上共享 redis 端口冲突 — 隔离资源后 flaky 消失。",
  },
  {
    agentId: "grok",
    category: "经验",
    date: "07-19",
    project: "ml-pipeline",
    source: "#77de",
    text: "worker 池重连时复用已关闭句柄会在并发下触发空指针,acquire 前必须做存活检查。",
  },
  {
    agentId: "grok",
    category: "技巧",
    date: "07-10",
    project: "ml-pipeline",
    source: "#77de",
    text: "训练数据去重用 minhash,相似度阈值 0.86 时误杀率与召回率平衡最佳。",
  },
  {
    agentId: "codex",
    category: "摘要",
    date: "今天",
    project: "api-server",
    source: "#c2e8",
    text: "auth 中间件重构为可插拔策略模式,JWT/ApiKey/Session 三实现,14/14 测试通过。",
  },
  {
    agentId: "pi",
    category: "Prompt 质量",
    date: "07-15",
    project: "其他",
    source: "—",
    text: "Bug 类 prompt 普遍缺少复现步骤 — 附最小复现命令可平均减少 2 轮往返。",
  },
] as const;

export const sessionPatterns = [
  {
    count: 9,
    description: "所有写库/部署操作先跑预演,确认差异后再真实执行。",
    name: "先 dry-run 后执行",
    tags: ["数据库", "部署"],
    trend: "↑ 上升",
    up: true,
  },
  {
    count: 6,
    description: "扩列回填与收紧约束分两次上线,保证每一步可回滚。",
    name: "两阶段数据库迁移",
    tags: ["数据库", "webapp"],
    trend: "↑ 上升",
    up: true,
  },
  {
    count: 5,
    description: "先固定失败用例再改实现,避免掩盖真实根因。",
    name: "测试先行修 flaky",
    tags: ["测试", "CI"],
    trend: "→ 平稳",
    up: false,
  },
  {
    count: 4,
    description: "多实现共存的模块抽出接口 + 工厂注册,新增实现零侵入。",
    name: "策略模式抽象",
    tags: ["重构", "api-server"],
    trend: "→ 平稳",
    up: false,
  },
  {
    count: 3,
    description: "性能敏感改动同时提交 k6 脚本与基准数据。",
    name: "压测脚本随实现交付",
    tags: ["性能", "k6"],
    trend: "↑ 上升",
    up: true,
  },
] as const;

export const sessionFeatureFixtures = {
  analytics: {
    kpis: [
      ["平均会话时长", "28m"],
      ["平均费用 / 会话", "$1.36"],
      ["洞察率", "2.7/会话"],
      ["工具调用", "486"],
    ],
    modelUsage: [
      ["claude", "claude-4.5-sonnet", "412k", 100],
      ["codex", "gpt-5-codex", "388k", 94],
      ["grok", "grok-4", "302k", 73],
      ["cursor", "composer-2", "98k", 24],
      ["hermes", "hermes-4-405b", "64k", 16],
    ],
    trend: [
      ["周二", 50],
      ["周三", 79],
      ["周四", 33],
      ["周五", 91],
      ["周六", 70],
      ["周日", 26],
      ["今天", 100],
    ],
  },
  dashboard: {
    activity: [
      ["周四", 4, 40],
      ["周五", 7, 70],
      ["周六", 3, 30],
      ["周日", 2, 20],
      ["周一", 6, 60],
      ["周二", 8, 80],
      ["今天", 10, 100],
    ],
    kpis: [
      ["会话总数", "128", "5 个来源", false],
      ["已分析", "96", "75%", true],
      ["提炼洞察", "342", "7 天 +38", false],
      ["覆盖项目", "4", "仓库", false],
    ],
    sources: [
      ["codex", 28, 100],
      ["claude", 24, 86],
      ["cursor", 19, 68],
      ["grok", 12, 43],
      ["hermes", 9, 32],
    ],
  },
  export: {
    depths: [
      ["精要", "精要 ~25"],
      ["标准", "标准 ~80"],
      ["完整", "完整 ~200"],
    ],
    formats: [
      ["Agent Rules", "CLAUDE.md / .cursorrules 可执行规则"],
      ["Knowledge Brief", "人类可读的知识摘要 markdown"],
      ["Obsidian", "带 YAML frontmatter 的笔记"],
      ["Notion", "可导入 Notion 的结构化块"],
    ],
    initialDepth: "标准",
    initialFormat: "Agent Rules",
  },
  insightCategories: ["全部", "摘要", "决策", "经验", "技巧", "Prompt 质量"],
  insights: sessionInsights,
  patterns: sessionPatterns,
  rows: sessionRows,
  sync: {
    devices: [
      ["⌘", "MacBook Pro (本机)", "macOS · 128 场会话 · 全量"],
      ["▢", "Mac mini · 工作室", "macOS · 上次可见 3 分钟前"],
    ],
    initialEnabled: true,
  },
} as const;

export const harnessFeatureFixtures = {
  goals: [
    {
      description: "webapp 分支覆盖率从 71% 提升到 85%,优先补 parser 与表单校验。",
      done: 16,
      name: "测试覆盖率 → 85%",
      next: "补 checkout 流程分支用例",
      owners: ["cursor", "claude"],
      percent: 64,
      status: "进行中",
      statusTone: "var(--think)",
      total: 25,
    },
    {
      description: "12 个 v1 端点迁移到 v2 并下线,调用方全部切换。",
      done: 5,
      name: "v1 API 全量下线",
      next: "迁移 /v1/orders 调用方",
      owners: ["codex", "hermes"],
      percent: 42,
      status: "进行中",
      statusTone: "var(--think)",
      total: 12,
    },
    {
      description: "Q3 技术债清单 8 项:CI 缓存统一、webhook 监控、parser 重写…",
      done: 2,
      name: "技术债清零 · Q3",
      next: "webhook 重试监控接入",
      owners: ["claude"],
      percent: 25,
      status: "落后",
      statusTone: "var(--wait)",
      total: 8,
    },
  ],
  hooks: [
    {
      command: "agentos insights extract --session $ID",
      event: "SessionEnd",
      id: "h1",
      name: "自动提炼洞察写入 Memory",
      runs: 96,
      tone: "var(--ac-fg)",
    },
    {
      command: 'agentos guard --match "deploy|migrate|drop"',
      event: "PreToolUse",
      id: "h2",
      name: "写库/部署命令拦截审批",
      runs: 23,
      tone: "var(--wait)",
    },
    {
      command: 'ntfy publish agentos "$MSG"',
      event: "Notification",
      id: "h3",
      name: "桌面通知转发到手机",
      runs: 141,
      tone: "var(--think)",
    },
    {
      command: "agentos context inject --proj $CWD",
      event: "SessionStart",
      id: "h4",
      name: "注入项目规则与相关记忆",
      runs: 128,
      tone: "var(--ac-fg)",
    },
  ],
  initialHooks: { h1: true, h2: true, h3: false, h4: true },
  initialMcps: {
    analytics: false,
    browser: true,
    filesystem: true,
    gmail: true,
    notion: true,
  },
  mcps: [
    {
      description: "受限工作区读写 · 白名单 ~/dev",
      id: "filesystem",
      name: "filesystem",
      tools: 8,
      transport: "stdio",
      users: ["claude", "codex", "cursor"],
    },
    {
      description: "playwright 无头浏览器",
      id: "browser",
      name: "browser",
      tools: 12,
      transport: "stdio",
      users: ["hermes", "grok"],
    },
    {
      description: "邮件草稿与发送(发送需确认)",
      id: "gmail",
      name: "gmail",
      tools: 6,
      transport: "http",
      users: ["hermes"],
    },
    {
      description: "知识库读写",
      id: "notion",
      name: "notion",
      tools: 9,
      transport: "http",
      users: ["hermes", "claude"],
    },
    {
      description: "GA4 查询",
      id: "analytics",
      name: "analytics",
      tools: 4,
      transport: "stdio",
      users: ["hermes"],
    },
  ],
  promptCategories: [
    { color: "oklch(62% 0.145 161)", id: "identity", name: "身份人设" },
    { color: "oklch(60% 0.105 245)", id: "tools", name: "工具能力" },
    { color: "oklch(55% 0.03 255)", id: "rules", name: "行为规则" },
    { color: "oklch(70% 0.105 75)", id: "tone", name: "语气风格" },
    { color: "oklch(60% 0.14 27)", id: "forbidden", name: "禁忌约束" },
    { color: "oklch(56% 0.105 305)", id: "safety", name: "安全保密" },
    { color: "oklch(63% 0.075 118)", id: "docs", name: "文档引用" },
  ],
  promptGenomes: [
    {
      agentId: "claude",
      characters: 6062,
      file: "~/.claude/CLAUDE.md + system",
      segments: [
        {
          body: "You are Claude Agent, an agentic coding assistant operating in the user’s terminal.",
          category: "identity",
          mass: 420,
        },
        {
          body: "5 个子代理(Explore / general-purpose / Plan …)+ 13 项技能;并发派发时放同一条消息里并行运行。",
          category: "tools",
          mass: 3300,
        },
        {
          body: "Keep edits minimal; never commit unless asked; prefer str_replace over rewrites.",
          category: "rules",
          mass: 1900,
        },
        {
          body: "Be concise. Avoid preamble. Answer in ≤4 lines unless detail is requested.",
          category: "tone",
          mass: 260,
        },
        {
          body: "Never exfiltrate secrets; refuse to write malware; redact API keys in output.",
          category: "safety",
          mass: 182,
        },
      ],
    },
    {
      agentId: "codex",
      characters: 4180,
      file: "~/.codex/instructions.md",
      segments: [
        {
          body: "You are Codex CLI, a precise coding agent that plans before it edits.",
          category: "identity",
          mass: 350,
        },
        {
          body: "shell / apply_patch / read_file;patch 必须是最小 diff,禁止整文件重写。",
          category: "tools",
          mass: 1800,
        },
        {
          body: "Always run tests after edits; if 3 consecutive failures, stop and report.",
          category: "rules",
          mass: 1600,
        },
        {
          body: "Never push to remote; never modify .git; never touch prod configs.",
          category: "forbidden",
          mass: 430,
        },
      ],
    },
    {
      agentId: "grok",
      characters: 2900,
      file: "~/.grok/system.txt",
      segments: [
        {
          body: "You are Grok CLI, a root-cause analyst. Think in hypotheses, verify with evidence.",
          category: "identity",
          mass: 300,
        },
        {
          body: "bash / grep / tail;大文件先采样再全量,输出必须附证据行号。",
          category: "tools",
          mass: 900,
        },
        {
          body: "每个结论标注置信度;无法复现时给出三个最可能假设并排序。",
          category: "rules",
          mass: 1300,
        },
        { body: "直接、量化、不修饰。用数据说话,结论先行。", category: "tone", mass: 400 },
      ],
    },
    {
      agentId: "pi",
      characters: 2450,
      file: "~/.pi/prompt.md",
      segments: [
        {
          body: "You are an expert coding assistant operating inside pi, a coding agent harness.",
          category: "identity",
          mass: 90,
        },
        {
          body: "read · bash · edit · write —— 四个原子工具,外加项目里可能挂载的自定义工具。",
          category: "tools",
          mass: 360,
        },
        {
          body: "Keep edits[].oldText as small as possible while still being unique in the file.",
          category: "rules",
          mass: 880,
        },
        {
          body: "Pi 文档:仅当用户问到 pi 本身(SDK / 扩展 / 主题 / 技能)时才去读取。",
          category: "docs",
          mass: 1090,
        },
        { body: "Be concise in your responses.", category: "tone", mass: 30 },
      ],
    },
    {
      agentId: "hermes",
      characters: 9800,
      file: "/opt/hermes/persona.yaml",
      segments: [
        {
          body: "Hermes 是外联与知识型 Agent:调研、写作、文档、邮件,人格稳定、署名一致。",
          category: "identity",
          mass: 2200,
        },
        {
          body: "browser / gmail / notion / image_gen;发送类动作(邮件、发帖)一律先出草稿等确认。",
          category: "tools",
          mass: 3800,
        },
        {
          body: '所有引用必须带来源链接;数据超过 30 天标注"可能过时"。',
          category: "rules",
          mass: 1900,
        },
        {
          body: "品牌语气:专业但不生硬;中文内容禁用翻译腔;标题不超过 18 字。",
          category: "tone",
          mass: 1200,
        },
        {
          body: "客户名单与报价保密;外发内容不得包含内部路径与代号。",
          category: "safety",
          mass: 700,
        },
      ],
    },
  ],
  rules: [
    {
      date: "07-21",
      description: "先 dry-run 后执行;组件一律函数式;禁用 any;提交信息用中文。",
      file: "CLAUDE.md",
      project: "webapp",
      ruleCount: 23,
      source: "Export",
    },
    {
      date: "07-20",
      description: "测试文件与实现同目录;mock 只在 __fixtures__;快照测试禁用。",
      file: ".cursorrules",
      project: "webapp",
      ruleCount: 14,
      source: "手写",
    },
    {
      date: "07-21",
      description: "API 变更必须同步 OpenAPI;错误码集中在 errors.ts;禁止裸 SQL。",
      file: "AGENTS.md",
      project: "api-server",
      ruleCount: 19,
      source: "Export",
    },
    {
      date: "07-17",
      description: "数据处理脚本必须可断点续跑;随机种子固定 42;产物写 artifacts/。",
      file: "CLAUDE.md",
      project: "ml-pipeline",
      ruleCount: 11,
      source: "手写",
    },
  ],
  skills: [
    {
      calls: 38,
      description: "检索近 7 天动态,输出带来源的摘要简报",
      name: "行业调研",
      users: ["hermes", "pi"],
      version: "1.4",
    },
    {
      calls: 57,
      description: "按 diff 审查:安全 → 性能 → 可读性,输出分级建议",
      name: "代码审查",
      users: ["claude", "codex"],
      version: "2.1",
    },
    {
      calls: 12,
      description: "数据库迁移拆为扩列回填 + 收紧约束两步,自动生成回滚脚本",
      name: "两阶段迁移",
      users: ["claude"],
      version: "1.0",
    },
    {
      calls: 9,
      description: "生成 k6 脚本与基准数据,回归对比自动标红",
      name: "压测基准",
      users: ["grok", "codex"],
      version: "1.2",
    },
    {
      calls: 11,
      description: "关键词矩阵 + 结构化博客文章 + 内链建议",
      name: "SEO 长文",
      users: ["hermes"],
      version: "3.0",
    },
    {
      calls: 16,
      description: "循环运行失败用例,定位共享资源冲突",
      name: "Flaky 猎手",
      users: ["cursor"],
      version: "1.1",
    },
  ],
  subagents: [
    {
      agentId: "claude",
      description: "只读侦察兵:快速扫仓库结构与关键实现,产出摘要供主 Agent 规划。",
      host: "Claude Agent",
      model: "claude-4-haiku",
      name: "Explore",
      spawns: 214,
      tools: ["read", "grep", "ls"],
    },
    {
      agentId: "claude",
      description: "先出实施计划与风险点,主 Agent 确认后才动手改代码。",
      host: "Claude Agent",
      model: "claude-4.5-sonnet",
      name: "Plan",
      spawns: 87,
      tools: ["read", "grep"],
    },
    {
      agentId: "codex",
      description: "diff 审查分身:安全 → 性能 → 可读性,输出分级意见。",
      host: "Codex CLI",
      model: "o4-mini",
      name: "Reviewer",
      spawns: 63,
      tools: ["read", "diff"],
    },
    {
      agentId: "grok",
      description: "专职复现:循环运行失败用例并采集最小复现命令。",
      host: "Grok CLI",
      model: "grok-4-fast",
      name: "Repro",
      spawns: 41,
      tools: ["bash", "tail"],
    },
    {
      agentId: "hermes",
      description: "低成本初稿分身:邮件/文案先出 3 版草稿,主体只做终审。",
      host: "Hermes",
      model: "hermes-4-70b",
      name: "Drafter",
      spawns: 52,
      tools: ["notion", "browser"],
    },
  ],
  workflows: [
    {
      id: "f1",
      last: "昨晚",
      name: "夜间质量流水线",
      runs: 31,
      steps: [
        { agentId: "hermes", name: "重新生成 API 文档", status: "✓ 成功" },
        { agentId: "cursor", name: "全量测试 + 覆盖率", status: "✓ 14/14" },
        { agentId: "grok", name: "扫描错误日志", status: "✓ 无新增" },
        { agentId: "claude", name: "汇总晨报写入 Memory", status: "✓ 已写入" },
      ],
      trigger: "cron · 每日 02:00",
    },
    {
      id: "f2",
      last: "07-21",
      name: "CI 失败自愈",
      runs: 12,
      steps: [
        { agentId: "grok", name: "定位失败根因", status: "✓ 根因" },
        { agentId: "codex", name: "生成修复 patch", status: "✓ +38 −6" },
        { agentId: "cursor", name: "回归测试", status: "✓ 通过" },
        { agentId: "claude", name: "等待人工批准合入", status: "⚠ 待确认" },
      ],
      trigger: "事件 · CI failed",
    },
    {
      id: "f3",
      last: "07-18",
      name: "发布内容套件",
      runs: 7,
      steps: [
        { agentId: "hermes", name: "changelog 草稿", status: "—" },
        { agentId: "hermes", name: "博客 + 社媒帖", status: "—" },
        { agentId: "pi", name: "FAQ 问答对", status: "—" },
      ],
      trigger: "手动",
    },
  ],
} as const;

export const settingsFeatureFixtures = {
  accents: ["#3ddc84", "#4fd8e0", "#ffb454", "#b48cff"],
  agentBinaries: {
    claude: "DougoOS 0.2.0 · 暂不可用",
    codex: "/usr/local/bin/codex · v3.4.1",
    cursor: "/usr/local/bin/cursor-agent · v0.52",
    grok: "~/.grok/bin/grok · v1.9.2",
    hermes: "/opt/hermes/hermes · v4.0.1",
    openclaw: "/usr/local/bin/openclaw · v1.0.0",
    opencode: "/usr/local/bin/opencode · v1.0.0",
    pi: "~/.pi/bin/pi · v0.9.4",
  } satisfies Readonly<Record<AgentId, string>>,
  apiKeyMasks: {
    claude: "当前版本不接受凭据",
    codex: "codex-••••••••7f21",
    cursor: "cursor-••••••••7f21",
    grok: "grok-••••••••7f21",
    hermes: "hermes-••••••••7f21",
    openclaw: "使用 CLI 登录",
    opencode: "使用 CLI 登录",
    pi: "pi-••••••••7f21",
  } satisfies Readonly<Record<AgentId, string>>,
  budget: {
    daily: "$25.00",
    percent: "78%",
    used: "$19.48 / $25.00",
  },
  compareResults: [
    {
      agentId: "claude",
      cost: "$1.84",
      note: "滑动窗口 + Redis sorted set,含限流降级路径与指标埋点,实现最稳。",
      tests: "12/12 ✓",
      time: "4m 12s",
      tokens: "96k",
    },
    {
      agentId: "codex",
      cost: "$0.92",
      note: "固定窗口计数器,实现最简、最快,但窗口边界有突发放大问题。",
      tests: "11/12",
      time: "2m 58s",
      tokens: "71k",
    },
    {
      agentId: "grok",
      cost: "$2.31",
      note: "令牌桶实现,额外补了 k6 压测脚本,改动面最大。",
      tests: "12/12 ✓",
      time: "6m 03s",
      tokens: "188k",
    },
  ] satisfies readonly {
    readonly agentId: AgentId;
    readonly cost: string;
    readonly note: string;
    readonly tests: string;
    readonly time: string;
    readonly tokens: string;
  }[],
  initialAutoApprove: {
    claude: false,
    codex: true,
    cursor: true,
    grok: false,
    hermes: false,
    openclaw: false,
    opencode: false,
    pi: false,
  } as Readonly<Record<AgentId, boolean>>,
  initialNotifyDone: true as boolean,
  initialNotifyWait: true as boolean,
  projects: [
    {
      agentIds: ["codex", "hermes"],
      branch: "main",
      changes: "3 处未提交",
      dirty: true,
      last: "2 分钟前",
      name: "api-server",
      path: "~/dev/api-server",
    },
    {
      agentIds: ["claude", "cursor"],
      branch: "feat/schema-v2",
      changes: "12 处未提交",
      dirty: true,
      last: "刚刚",
      name: "webapp",
      path: "~/dev/webapp",
    },
    {
      agentIds: ["grok"],
      branch: "main",
      changes: "工作区干净",
      dirty: false,
      last: "14 分钟前",
      name: "ml-pipeline",
      path: "~/dev/ml-pipeline",
    },
    {
      agentIds: [],
      branch: "main",
      changes: "工作区干净",
      dirty: false,
      last: "3 天前",
      name: "dotfiles",
      path: "~/dotfiles",
    },
  ] satisfies readonly {
    readonly agentIds: readonly AgentId[];
    readonly branch: string;
    readonly changes: string;
    readonly dirty: boolean;
    readonly last: string;
    readonly name: string;
    readonly path: string;
  }[],
  usageDays: [
    ["周二", 6.2],
    ["周三", 9.8],
    ["周四", 4.1],
    ["周五", 11.3],
    ["周六", 8.7],
    ["周日", 3.2],
    ["今天", 12.47],
  ] as const,
  visibilityGroups: [
    {
      label: "主导航",
      rows: [
        ["＋", "新建任务"],
        ["▦", "总览"],
        ["▤", "任务编排"],
        ["✦", "Memory"],
      ],
    },
    {
      label: "PROJECTS 模块",
      rows: [
        ["⚑", "置顶"],
        ["❒", "项目"],
        ["❯", "对话"],
      ],
    },
    {
      label: "HARNESS 模块",
      rows: [
        ["¶", "System Prompt"],
        ["✦", "Skills"],
        ["⚙", "MCP"],
        ["⛬", "SubAgents"],
        ["◎", "Goals"],
        ["⧉", "Workflows"],
        ["⚓", "Hooks"],
        ["§", "Rules"],
      ],
    },
    {
      label: "SESSIONS MANAGER 模块",
      rows: [
        ["⊞", "Dashboard"],
        ["❐", "Sessions"],
        ["☉", "Insights"],
        ["▥", "Analytics"],
        ["✧", "Patterns"],
        ["⇩", "Export"],
        ["☁", "Cloud Sync"],
      ],
    },
  ] as const,
  modelOptions: {
    claude: ["claude-4.5-opus", "claude-4.5-sonnet", "claude-4-haiku"],
    codex: ["gpt-5-codex", "o4", "o4-mini"],
    cursor: ["composer-2", "auto"],
    grok: ["grok-4", "grok-4-fast"],
    hermes: ["hermes-4-405b", "hermes-4-70b"],
    openclaw: ["default"],
    opencode: ["auto"],
    pi: ["pi-3"],
  } satisfies Readonly<Record<AgentId, readonly string[]>>,
} as const;

export const featureFixtures = {
  agent: {
    histories: agentHistories,
    initialMessages: agentInitialMessages,
    kanban: hermesKanbanColumns,
    mcps: hermesMcps,
    skills: hermesSkills,
    tabs: {
      default: defaultAgentTabs,
      hermes: hermesAgentTabs,
    },
    runtimeStates: runtimeStateNotices,
  },
  memory: {
    items: memoryItems,
    links: memoryLinks,
    tabs: memoryTabLabels,
  },
  harness: harnessFeatureFixtures,
  operations: {
    cron: {
      enabled: initialCronEnabled,
      tasks: cronTasks,
    },
    queue: {
      assignees: initialQueueAssignees,
      statuses: initialQueueStatuses,
      tasks: queueTasks,
    },
    statusLabels: agentStatusLabels,
  },
  sessions: sessionFeatureFixtures,
  settings: settingsFeatureFixtures,
} as const;

export type FeatureFixtures = typeof featureFixtures;
