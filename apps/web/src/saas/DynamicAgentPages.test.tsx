import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HarnessPage } from "./HarnessPage.js";
import { MemoryPage } from "./MemoryPage.js";
import { CronPage, QueuePage } from "./OperationsPages.js";
import { SessionsPage } from "./SessionsPage.js";
import { ComparePage } from "./SettingsPage.js";
import { saasFixture } from "./fixtures.js";
import { initialSaasState, saasReducer } from "./state.js";
import type { HarnessSection, SaasFixture, SessionsSection } from "./types.js";

const dispatch = () => undefined;
const navigate = () => undefined;

describe("dynamic Agent feature pages", () => {
  it("renders fixed feature fixtures against a real projection containing only Codex", () => {
    const codex = saasFixture.agents.find((agent) => agent.id === "codex");
    if (codex === undefined) throw new Error("Codex fixture is required");
    const fixture: SaasFixture = { ...saasFixture, agents: [codex] };
    const state = saasReducer(initialSaasState, {
      mode: "real",
      snapshot: {
        conversationDirectory: "/Users/tester/Documents/Dogoos",
        fixture,
        revision: 1,
      },
      type: "data.loaded",
    });
    const featureState = state.features;
    if (featureState === null) throw new Error("Feature state was not initialized");

    const cronMarkup = renderToStaticMarkup(
      <CronPage
        dispatch={dispatch}
        featureState={featureState}
        fixture={fixture}
        navigate={navigate}
        writesDisabled={false}
      />,
    );
    expect(cronMarkup).toContain("依赖安全审计");
    expect(cronMarkup).not.toContain("夜间质量流水线");

    const pages = [
      <QueuePage
        dispatch={dispatch}
        featureState={featureState}
        fixture={fixture}
        key="queue"
        navigate={navigate}
        writesDisabled={false}
      />,
      ...(["prompt", "skills", "mcp", "subagents", "goal", "workflows"] as const).map(
        (section: HarnessSection) => (
          <HarnessPage
            dispatch={dispatch}
            featureState={featureState}
            fixture={fixture}
            key={`harness-${section}`}
            section={section}
            writesDisabled={false}
          />
        ),
      ),
      <MemoryPage fixture={fixture} initialTab="recent" key="memory" />,
      <ComparePage fixture={fixture} key="compare" />,
      ...(["dashboard", "sessions", "insights", "analytics"] as const).map(
        (section: SessionsSection) => (
          <SessionsPage
            dispatch={dispatch}
            featureState={featureState}
            fixture={fixture}
            key={`sessions-${section}`}
            navigate={navigate}
            section={section}
            writesDisabled={false}
          />
        ),
      ),
    ];

    expect(() => renderToStaticMarkup(<>{pages}</>)).not.toThrow();
  });
});
