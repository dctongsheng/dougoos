import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { saasFixture } from "./fixtures.js";
import { SettingsPage, chooseAndUpdateConversationDirectory } from "./SettingsPage.js";
import { initialSaasState, saasReducer } from "./state.js";
import type { ChatViewSnapshot, SaasState } from "./types.js";

const conversationDirectory = "/Users/tester/Documents/Dogoos";

function loadedState() {
  return saasReducer(initialSaasState, {
    mode: "fixture",
    snapshot: {
      conversationDirectory,
      fixture: saasFixture,
      revision: 1,
    },
    type: "data.loaded",
  });
}

function realLoadedState(permissionProfileId = "agent-full-access"): SaasState {
  const chat: ChatViewSnapshot = {
    agentCatalog: [
      {
        agentId: "codex",
        cli: {
          command: "codex",
          detectedAt: "2026-07-27T04:00:00.000Z",
          displayName: "Codex",
          executablePath: "/safe/bin/codex",
          integratedProviderId: "codex",
          version: "codex 1.0.0",
        },
        displayName: "Codex",
        providerId: "codex",
        status: "available",
      },
    ],
    cliInstallations: [
      {
        command: "codex",
        detectedAt: "2026-07-27T04:00:00.000Z",
        displayName: "Codex",
        executablePath: "/safe/bin/codex",
        integratedProviderId: "codex",
        version: "codex 1.0.0",
      },
      {
        command: "aider",
        detectedAt: "2026-07-27T04:00:00.000Z",
        displayName: "Aider",
        executablePath: "/safe/bin/aider",
        version: "aider 2.0.0",
      },
    ],
    providerPreferences: [
      {
        permissionProfileId,
        providerId: "codex",
        visibleInSidebar: true,
      },
    ],
    providers: [
      {
        agentId: "codex",
        capabilities: null,
        defaultPermissionProfileId: "agent-full-access",
        displayName: "Codex",
        id: "codex",
        installed: true,
        permissionProfiles: [
          {
            description: "关闭审批与 sandbox，以最高权限运行。",
            id: "agent-full-access",
            label: "agent-full-access",
            mechanism: "launch",
            permissionEnforcement: "client_enforced",
            requiresNewSession: true,
            risk: "dangerous",
            semantic: "unrestricted",
          },
        ],
        status: "available",
      },
    ],
    selectedSessionIds: {},
    sessions: [],
  };
  return saasReducer(initialSaasState, {
    mode: "real",
    snapshot: {
      chat,
      conversationDirectory,
      fixture: saasFixture,
      revision: 1,
    },
    type: "data.loaded",
  });
}

describe("Settings conversation project", () => {
  it("shows the complete current directory and future-conversations-only guidance", () => {
    const markup = renderToStaticMarkup(
      <SettingsPage
        chat={null}
        chooseDirectory={() => Promise.resolve(null)}
        dataMode="fixture"
        dispatch={() => undefined}
        execute={() => Promise.resolve()}
        fixture={saasFixture}
        initialAgentId="claude"
        state={loadedState()}
        writesDisabled={false}
      />,
    );

    expect(markup).toContain("对话项目");
    expect(markup).toContain('aria-label="当前对话目录"');
    expect(markup).toContain(conversationDirectory);
    expect(markup).toContain("修改只影响之后新建的对话，不会移动已有对话或文件。");
    expect(markup).toContain('aria-label="更改对话项目目录"');
  });

  it("executes the preference update only after a directory is selected", async () => {
    const execute = vi.fn(() => Promise.resolve());
    const onDirectorySelected = vi.fn();

    await expect(
      chooseAndUpdateConversationDirectory({
        chooseDirectory: () => Promise.resolve("/Users/tester/Workspace/Conversations"),
        execute,
        onDirectorySelected,
      }),
    ).resolves.toBe("updated");
    expect(onDirectorySelected).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      conversationDirectory: "/Users/tester/Workspace/Conversations",
      name: "preferences.conversation-directory.update",
    });
  });

  it("does not execute an update when directory selection is cancelled", async () => {
    const execute = vi.fn(() => Promise.resolve());
    const onDirectorySelected = vi.fn();

    await expect(
      chooseAndUpdateConversationDirectory({
        chooseDirectory: () => Promise.resolve(null),
        execute,
        onDirectorySelected,
      }),
    ).resolves.toBe("cancelled");
    expect(onDirectorySelected).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("propagates selection and save errors for the page to surface", async () => {
    await expect(
      chooseAndUpdateConversationDirectory({
        chooseDirectory: () => Promise.reject(new Error("dialog unavailable")),
        execute: () => Promise.resolve(),
      }),
    ).rejects.toThrow("dialog unavailable");

    await expect(
      chooseAndUpdateConversationDirectory({
        chooseDirectory: () => Promise.resolve("/Users/tester/Workspace/Conversations"),
        execute: () => Promise.reject(new Error("save failed")),
      }),
    ).rejects.toThrow("save failed");
  });

  it("uses the detected integrated catalog for Agent count and permission configuration", () => {
    const state = realLoadedState();
    const liveFixture = {
      ...saasFixture,
      agents: saasFixture.agents.filter((agent) => agent.id === "codex"),
    };
    const markup = renderToStaticMarkup(
      <SettingsPage
        chat={state.chat}
        chooseDirectory={() => Promise.resolve(null)}
        dataMode="real"
        dispatch={() => undefined}
        execute={() => Promise.resolve()}
        fixture={liveFixture}
        initialAgentId="codex"
        state={state}
        writesDisabled={false}
      />,
    );

    expect(markup).toContain("AGENTS · 1");
    expect(markup).toContain("2 个已安装");
    expect(markup).toContain("agent-full-access");
    expect(markup).toContain("⚠ 高风险权限");
    expect(markup).toContain("已检测");
    expect(markup).toContain("已接入");
    expect(markup).not.toContain("自动批准低风险操作");
  });

  it("shows a removed saved profile explicitly until the user selects a valid replacement", () => {
    const state = realLoadedState("removed-after-upgrade");
    const markup = renderToStaticMarkup(
      <SettingsPage
        chat={state.chat}
        chooseDirectory={() => Promise.resolve(null)}
        dataMode="real"
        dispatch={() => undefined}
        execute={() => Promise.resolve()}
        fixture={saasFixture}
        initialAgentId="codex"
        state={state}
        writesDisabled={false}
      />,
    );

    expect(markup).toContain("已移除：removed-after-upgrade（请重新选择）");
    expect(markup).toContain("权限档位已失效");
    expect(markup).toContain("新建 Session 已被阻止");
  });
});
