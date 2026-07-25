import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { saasFixture } from "./fixtures.js";
import { SettingsPage, chooseAndUpdateConversationDirectory } from "./SettingsPage.js";
import { initialSaasState, saasReducer } from "./state.js";

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
});
