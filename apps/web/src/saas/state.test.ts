import { describe, expect, it } from "vitest";

import { saasFixture } from "./fixtures.js";
import { routeTask } from "./home-routing.js";
import { initialSaasState, routeMeta, saasReducer } from "./state.js";
import type { Route, SidebarVisibilityKey } from "./types.js";

describe("saasReducer", () => {
  it("loads fixture data through the explicit fixture mode boundary", () => {
    const state = saasReducer(initialSaasState, {
      mode: "fixture",
      snapshot: { fixture: saasFixture, revision: 1 },
      type: "data.loaded",
    });

    expect(state.fixture).toEqual(saasFixture);
    expect(state.connection).toEqual({ kind: "ready", mode: "fixture" });
  });

  it("keeps theme, accent, navigation, and visibility as explicit state", () => {
    const themed = saasReducer(initialSaasState, {
      theme: "light",
      type: "theme.mode",
    });
    const accented = saasReducer(themed, {
      accent: "#4fd8e0",
      type: "theme.accent",
    });
    const hidden = saasReducer(accented, {
      type: "settings.dashboard-visible",
    });
    const navigated = saasReducer(hidden, {
      route: { kind: "queue" },
      type: "navigate",
    });

    expect(navigated).toMatchObject({
      accent: "#4fd8e0",
      dashboardVisible: false,
      route: { kind: "queue" },
      theme: "light",
    });
  });

  it("marks notification fixture rows read without mutating the source fixture", () => {
    const loaded = saasReducer(initialSaasState, {
      mode: "fixture",
      snapshot: { fixture: saasFixture, revision: 1 },
      type: "data.loaded",
    });
    const read = saasReducer(loaded, { type: "notifications.mark-all" });

    expect(read.fixture?.notifications.every((notification) => notification.read)).toBe(true);
    expect(saasFixture.notifications.some((notification) => !notification.read)).toBe(true);
  });

  it("persists every Settings visibility row and cross-route mutable feature state", () => {
    const loaded = saasReducer(initialSaasState, {
      mode: "fixture",
      snapshot: { fixture: saasFixture, revision: 1 },
      type: "data.loaded",
    });
    const visibilityKeys: readonly SidebarVisibilityKey[] = [
      "home",
      "orchestration",
      "memory",
      "project-pinned",
      "project-list",
      "project-conversations",
      "harness-prompt",
      "harness-skills",
      "harness-mcp",
      "harness-subagents",
      "harness-goal",
      "harness-workflows",
      "harness-hooks",
      "harness-rules",
      "sessions-dashboard",
      "sessions-sessions",
      "sessions-insights",
      "sessions-analytics",
      "sessions-patterns",
      "sessions-export",
      "sessions-sync",
      "claude",
      "codex",
      "cursor",
      "grok",
      "pi",
      "hermes",
      "openclaw",
      "opencode",
    ];
    const hidden = visibilityKeys.reduce(
      (state, key) => saasReducer(state, { key, type: "settings.sidebar-visible" }),
      loaded,
    );
    const configured = saasReducer(hidden, {
      agentId: "codex",
      model: "o4",
      type: "settings.model",
    });
    const assigned = saasReducer(configured, {
      agentId: "claude",
      taskId: "t1",
      type: "queue.assignee",
    });
    const navigated = saasReducer(assigned, {
      route: { kind: "home" },
      type: "navigate",
    });

    expect(visibilityKeys.every((key) => navigated.sidebarVisibility[key] === false)).toBe(true);
    expect(navigated.features?.settingsModels.codex).toBe("o4");
    expect(navigated.features?.queueAssignees.t1).toBe("claude");
  });

  it("supports real snapshots and clears source-owned state during source replacement", () => {
    const loaded = saasReducer(initialSaasState, {
      mode: "real",
      snapshot: { fixture: saasFixture, revision: 1 },
      type: "data.loaded",
    });
    const replacing = saasReducer(loaded, { type: "data.source-changing" });
    const replaced = saasReducer(replacing, {
      mode: "real",
      snapshot: {
        fixture: {
          ...saasFixture,
          suggestions: ["source-b"],
        },
        revision: 1,
      },
      type: "data.loaded",
    });

    expect(loaded.connection).toEqual({ kind: "ready", mode: "real" });
    expect(replacing).toMatchObject({ dataRevision: null, features: null, fixture: null });
    expect(replaced.dataRevision).toBe(1);
    expect(replaced.fixture?.suggestions).toEqual(["source-b"]);
  });

  it("atomically replaces every source-derived feature while preserving UI-local preferences", () => {
    const loaded = saasReducer(initialSaasState, {
      mode: "real",
      snapshot: { fixture: saasFixture, revision: 1 },
      type: "data.loaded",
    });
    const themed = saasReducer(
      saasReducer(saasReducer(loaded, { theme: "light", type: "theme.mode" }), {
        accent: "#4fd8e0",
        type: "theme.accent",
      }),
      { key: "pi", type: "settings.sidebar-visible" },
    );
    const locallyMutated = saasReducer(
      saasReducer(
        saasReducer(
          saasReducer(themed, {
            agentId: "pi",
            message: { body: "local-only", id: "local-only", type: "text" },
            type: "agent.message",
          }),
          { agentId: "pi", draft: "unfinished draft", type: "agent.draft" },
        ),
        { status: "running", taskId: "t1", type: "queue.status" },
      ),
      { agentId: "pi", model: "local-model", type: "settings.model" },
    );
    const revisionTwoFixture = {
      ...saasFixture,
      agents: saasFixture.agents.map((agent) =>
        agent.id === "pi" ? { ...agent, enabled: false, model: "pi-live-r2" } : { ...agent },
      ),
      features: {
        ...saasFixture.features,
        agent: {
          ...saasFixture.features.agent,
          initialMessages: {
            ...saasFixture.features.agent.initialMessages,
            pi: [{ body: "live revision two", id: "live-new", type: "text" as const }],
          },
        },
        operations: {
          ...saasFixture.features.operations,
          queue: {
            ...saasFixture.features.operations.queue,
            statuses: {
              ...saasFixture.features.operations.queue.statuses,
              t1: "done" as const,
            },
          },
        },
        settings: {
          ...saasFixture.features.settings,
          initialAutoApprove: {
            ...saasFixture.features.settings.initialAutoApprove,
            pi: true,
          },
          initialNotifyDone: false,
        },
      },
      suggestions: ["LIVE_R2"],
    };
    const updated = saasReducer(locallyMutated, {
      snapshot: { fixture: revisionTwoFixture, revision: 2 },
      type: "data.snapshot",
    });

    expect(updated).toMatchObject({
      accent: "#4fd8e0",
      dataRevision: 2,
      theme: "light",
    });
    expect(updated.sidebarVisibility.pi).toBe(false);
    expect(updated.fixture?.suggestions).toEqual(["LIVE_R2"]);
    expect(updated.features?.agentMessages.pi.map((message) => message.id)).toEqual(["live-new"]);
    expect(updated.features?.agentDrafts.pi).toBe("unfinished draft");
    expect(updated.features?.queueStatuses.t1).toBe("done");
    expect(updated.features?.settingsAgentEnabled.pi).toBe(false);
    expect(updated.features?.settingsAutoApprove.pi).toBe(true);
    expect(updated.features?.settingsModels.pi).toBe("pi-live-r2");
    expect(updated.features?.settingsNotifyDone).toBe(false);

    const stale = saasReducer(updated, {
      snapshot: {
        fixture: { ...saasFixture, suggestions: ["STALE_R1"] },
        revision: 1,
      },
      type: "data.snapshot",
    });
    const duplicate = saasReducer(updated, {
      snapshot: {
        fixture: { ...saasFixture, suggestions: ["DUPLICATE_R2"] },
        revision: 2,
      },
      type: "data.snapshot",
    });
    expect(stale).toBe(updated);
    expect(duplicate).toBe(updated);
  });

  it("keeps a newer subscribed snapshot when an older initial load resolves afterward", () => {
    const revisionTwoFixture = {
      ...saasFixture,
      suggestions: ["SUBSCRIPTION_R2"],
    };
    const subscribed = saasReducer(initialSaasState, {
      snapshot: { fixture: revisionTwoFixture, revision: 2 },
      type: "data.snapshot",
    });
    const lateInitialLoad = saasReducer(subscribed, {
      mode: "real",
      snapshot: { fixture: saasFixture, revision: 1 },
      type: "data.loaded",
    });

    expect(lateInitialLoad.connection).toEqual({ kind: "ready", mode: "real" });
    expect(lateInitialLoad.dataRevision).toBe(2);
    expect(lateInitialLoad.fixture?.suggestions).toEqual(["SUBSCRIPTION_R2"]);
  });
});

describe("routeTask", () => {
  it.each([
    ["修复 flaky e2e 测试", "cursor"],
    ["分析 crash 日志根因", "grok"],
    ["迁移 users 数据库 schema", "claude"],
    ["重构 auth 中间件", "codex"],
    ["重新生成 OpenAPI 文档", "hermes"],
    ["让 OpenClaw 处理网关任务", "openclaw"],
    ["使用 OpenCode 修复这个问题", "opencode"],
    ["解释为什么会这样", "pi"],
    ["实现通用功能", "claude"],
  ] as const)("routes %s to %s", (task, expected) => {
    expect(routeTask(task)).toBe(expected);
  });
});

describe("routeMeta", () => {
  it("exhaustively supplies reader-facing metadata for every route kind", () => {
    const routes: readonly Route[] = [
      { kind: "home" },
      { kind: "dashboard" },
      { kind: "cron" },
      { kind: "queue" },
      { agentId: "claude", kind: "agent", tab: "session" },
      { kind: "memory", tab: "graph" },
      { kind: "sessions", section: "dashboard" },
      { kind: "harness", section: "prompt" },
      { agentId: "codex", kind: "settings" },
      { kind: "compare" },
      { kind: "projects" },
      { kind: "usage" },
    ];

    expect(routes.map((route) => routeMeta(route, () => "Claude Code").label)).toEqual([
      "新建任务",
      "总览",
      "定时任务",
      "长程任务",
      "Claude Code",
      "Memory",
      "Sessions 总览",
      "System Prompt",
      "设置",
      "结果对比",
      "项目",
      "用量统计",
    ]);
  });
});
