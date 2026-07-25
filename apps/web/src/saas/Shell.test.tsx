import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { saasFixture } from "./fixtures.js";
import { Shell } from "./Shell.js";
import { initialSaasState, saasReducer } from "./state.js";
import type { SaasFixture, SaasState } from "./types.js";

const conversationDirectory = "/Users/tester/Documents/Dogoos";
const conversationSessionId = "session:conversation:one";

function shellState(): SaasState {
  const fixture: SaasFixture = {
    ...saasFixture,
    notifications: [],
    projects: [
      {
        id: "conversation",
        initiallyOpen: true,
        kind: "conversation",
        name: "对话",
        path: conversationDirectory,
        sessions: [
          {
            agentId: "claude",
            sessionId: conversationSessionId,
            title: "帮我整理今天的想法",
          },
        ],
      },
      {
        id: "directory:repo",
        initiallyOpen: false,
        kind: "directory",
        name: "repo",
        path: "/Users/tester/Workspace/repo",
        sessions: [
          {
            agentId: "codex",
            sessionId: "session:repo:one",
            title: "修复项目测试",
          },
        ],
      },
    ],
  };
  const loaded = saasReducer(initialSaasState, {
    mode: "fixture",
    snapshot: {
      conversationDirectory,
      fixture,
      revision: 1,
    },
    type: "data.loaded",
  });
  const hiddenAgentVisibility = Object.fromEntries(
    fixture.agents.map((agent) => [agent.id, false]),
  ) as Partial<SaasState["sidebarVisibility"]>;
  return {
    ...loaded,
    dashboardVisible: false,
    fixture,
    sidebarVisibility: {
      ...loaded.sidebarVisibility,
      ...hiddenAgentVisibility,
      harness: false,
      home: false,
      memory: false,
      orchestration: false,
      "project-conversations": true,
      "project-list": true,
      "project-pinned": false,
      projects: true,
      sessions: false,
    },
  };
}

describe("Shell PROJECTS projection", () => {
  it("renders the built-in conversation project once, open, without its directory name", () => {
    const markup = renderToStaticMarkup(
      <Shell
        dispatch={() => undefined}
        onSessionSelect={() => undefined}
        state={shellState()}
        writesDisabled={false}
      >
        <main>content</main>
      </Shell>,
    );

    expect(markup).toContain('<span class="project-name">对话</span>');
    expect(markup).toMatch(
      /<details(?=[^>]*class="project-tree conversation-project")(?=[^>]*open="")[^>]*>/u,
    );
    expect(markup).not.toContain("最近");
    expect(markup).not.toContain(conversationDirectory);
    expect(markup).not.toContain("Dogoos");
    expect(
      markup.match(new RegExp(`data-session-id="${conversationSessionId}"`, "gu")),
    ).toHaveLength(1);
  });
});
