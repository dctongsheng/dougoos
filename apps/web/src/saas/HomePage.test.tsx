import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { saasFixture } from "./fixtures.js";
import { HomePage } from "./HomePage.js";
import { initialSaasState, saasReducer } from "./state.js";
import type { ChatViewSnapshot, SaasState } from "./types.js";

const conversationDirectory = "/Users/tester/Documents/Dogoos";
const emptyChat: ChatViewSnapshot = {
  agentCatalog: [],
  cliInstallations: [],
  providerPreferences: [],
  providers: [],
  selectedSessionIds: {},
  sessions: [],
};

function loadedState(overrides: Partial<SaasState> = {}): SaasState {
  const loaded = saasReducer(initialSaasState, {
    mode: "fixture",
    snapshot: {
      conversationDirectory,
      fixture: saasFixture,
      revision: 1,
    },
    type: "data.loaded",
  });
  return { ...loaded, ...overrides };
}

function renderHome(state: SaasState): string {
  return renderToStaticMarkup(
    <HomePage
      chooseDirectory={undefined}
      dispatch={() => undefined}
      onSend={() => undefined}
      requiresAbsolutePath={true}
      state={state}
      writesDisabled={false}
    />,
  );
}

describe("Home project picker", () => {
  it("shows only the 对话 label for the default conversation project", () => {
    const markup = renderHome(
      loadedState({
        homeMenu: "path",
        homeProject: { kind: "conversation" },
      }),
    );

    expect(markup.match(/>对话</gu)).toHaveLength(2);
    expect(markup).not.toContain(conversationDirectory);
  });

  it("shows the selected path for a regular directory project", () => {
    const selectedPath = "/Users/tester/Workspace/project-a";
    const markup = renderHome(
      loadedState({
        homeMenu: null,
        homeProject: { kind: "directory", path: selectedPath },
      }),
    );

    expect(markup).toContain(`<span class="path-value">${selectedPath}</span>`);
    expect(markup).not.toContain(conversationDirectory);
  });

  it("renders a deterministic disabled state when no integrated CLI is detected", () => {
    const markup = renderHome(
      loadedState({
        chat: emptyChat,
        homeDraft: "hello",
        homeMenu: "agent",
      }),
    );

    expect(markup).toContain("未检测到可用 Agent");
    expect(markup).toContain('aria-label="发送任务"');
    expect(markup).toContain('disabled=""');
  });
});
