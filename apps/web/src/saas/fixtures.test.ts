import { describe, expect, it } from "vitest";

import { agentById, FixtureDataSource, saasFixture } from "./fixtures.js";
import { PROTOTYPE_AGENT_IDS } from "./types.js";

describe("FixtureDataSource", () => {
  it("keeps the prototype fixture at its canonical six Agent slots", () => {
    expect(saasFixture.agents.map((agent) => agent.id)).toEqual(PROTOTYPE_AGENT_IDS);
  });

  it("returns independent typed copies", async () => {
    const source = new FixtureDataSource();
    const first = await source.getSnapshot(new AbortController().signal);
    const second = await source.getSnapshot(new AbortController().signal);

    expect(first).toEqual({ fixture: saasFixture, revision: 1 });
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
});

describe("agentById", () => {
  it("fails fast for unknown runtime fixture ids", () => {
    expect(() => agentById(saasFixture, "missing" as "claude")).toThrow(
      "Unknown fixture agent: missing",
    );
  });
});
