import { describe, expect, it } from "vitest";

import type { ChatProviderView } from "./types.js";
import {
  buildHomeChatCommand,
  isAbsoluteWorkspacePath,
  resolveHomeProjectCwd,
  resolveInitialAgentCwd,
} from "./home-task.js";

const provider: ChatProviderView = {
  agentId: "grok",
  capabilities: null,
  displayName: "Grok",
  id: "grok",
  status: "available",
};

describe("Home task handoff", () => {
  it("resolves the built-in conversation project without exposing its directory as UI state", () => {
    expect(resolveHomeProjectCwd({ kind: "conversation" }, "/Users/tester/Documents/Dogoos")).toBe(
      "/Users/tester/Documents/Dogoos",
    );
    expect(
      resolveHomeProjectCwd(
        { kind: "directory", path: "/workspace/project-b" },
        "/Users/tester/Documents/Dogoos",
      ),
    ).toBe("/workspace/project-b");
  });

  it("creates one chat command with the Agent and absolute project selected on Home", () => {
    expect(
      buildHomeChatCommand({
        agentId: "grok",
        cwd: "/workspace/project-b",
        provider,
        requestId: "request:home",
        text: "检查这个项目",
      }),
    ).toEqual({
      agentId: "grok",
      cwd: "/workspace/project-b",
      name: "chat.send",
      providerId: "grok",
      requestId: "request:home",
      sessionMode: "create",
      text: "检查这个项目",
    });
  });

  it("does not submit a shell-only tilde or an unavailable Provider", () => {
    expect(isAbsoluteWorkspacePath("~")).toBe(false);
    expect(
      buildHomeChatCommand({
        agentId: "grok",
        cwd: "~",
        provider,
        requestId: "request:invalid-cwd",
        text: "不会发送",
      }),
    ).toBeNull();
    expect(
      buildHomeChatCommand({
        agentId: "grok",
        cwd: "/workspace",
        provider: { ...provider, status: "unavailable" },
        requestId: "request:unavailable",
        text: "不会发送",
      }),
    ).toBeNull();
  });

  it("shows the Home launch project before an older selected Session", () => {
    expect(
      resolveInitialAgentCwd({
        agentCwd: "/workspace/fixture",
        launchCwd: "/workspace/project-b",
        selectedSessionCwd: "/workspace/project-a",
      }),
    ).toBe("/workspace/project-b");
  });
});
