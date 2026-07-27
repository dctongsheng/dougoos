import { describe, expect, it } from "vitest";

import {
  agentById,
  FIXTURE_CONVERSATION_DIRECTORY,
  FixtureDataSource,
  saasFixture,
} from "./fixtures.js";
import { PROTOTYPE_AGENT_IDS } from "./types.js";

describe("FixtureDataSource", () => {
  it("keeps the prototype fixture at its canonical six Agent slots", () => {
    expect(saasFixture.agents.map((agent) => agent.id)).toEqual(PROTOTYPE_AGENT_IDS);
  });

  it("returns independent typed copies", async () => {
    const source = new FixtureDataSource();
    const first = await source.getSnapshot(new AbortController().signal);
    const second = await source.getSnapshot(new AbortController().signal);

    expect(first).toEqual({
      conversationDirectory: FIXTURE_CONVERSATION_DIRECTORY,
      fixture: saasFixture,
      revision: 1,
    });
    expect(first).not.toBe(second);
    expect(first.fixture.agents).not.toBe(second.fixture.agents);
  });

  it("honors cancellation before publishing fixture state", async () => {
    const source = new FixtureDataSource();
    const controller = new AbortController();
    controller.abort();

    await expect(source.getSnapshot(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("publishes an updated built-in conversation project after a preference change", async () => {
    const source = new FixtureDataSource();
    let published: Awaited<ReturnType<FixtureDataSource["getSnapshot"]>> | undefined;
    const unsubscribe = source.subscribe((snapshot) => {
      published = snapshot;
    });

    await source.execute(
      {
        conversationDirectory: "/Users/ryo/Workspace/Conversations",
        name: "preferences.conversation-directory.update",
      },
      new AbortController().signal,
    );
    unsubscribe();

    expect(published?.conversationDirectory).toBe("/Users/ryo/Workspace/Conversations");
    expect(published?.fixture.projects[0]).toMatchObject({
      id: "conversation",
      path: "/Users/ryo/Workspace/Conversations",
    });
  });
});

describe("agentById", () => {
  it("fails fast for unknown runtime fixture ids", () => {
    expect(() => agentById(saasFixture, "missing" as "claude")).toThrow(
      "Unknown fixture agent: missing",
    );
  });

  it("does not fall back to prototype Agents missing from a live fixture", () => {
    expect(() => agentById({ ...saasFixture, agents: [] }, "claude")).toThrow(
      "Unknown fixture agent: claude",
    );
  });
});
