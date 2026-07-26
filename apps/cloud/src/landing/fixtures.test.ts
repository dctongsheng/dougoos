import { describe, expect, it } from "vitest";

import {
  landingAgents,
  landingFeatures,
  landingKpis,
  landingProductCards,
  landingRoutes,
  landingStats,
  memoryStars,
} from "./fixtures.js";

describe("Landing fixture boundary", () => {
  it("preserves the complete prototype inventory", () => {
    expect(landingAgents).toHaveLength(6);
    expect(landingFeatures).toHaveLength(6);
    expect(landingKpis).toHaveLength(4);
    expect(landingProductCards).toHaveLength(3);
    expect(landingRoutes).toHaveLength(3);
    expect(landingStats).toHaveLength(4);
    expect(memoryStars).toHaveLength(8);
  });

  it("keeps the Landing-specific Agent glyph and hue map", () => {
    expect(landingAgents.map(({ glyph, hue, name }) => ({ glyph, hue, name }))).toEqual([
      { glyph: "⌬", hue: "#4fd8e0", name: "Codex" },
      { glyph: "✳", hue: "#d97757", name: "Claude Agent" },
      { glyph: "𝕏", hue: "#b48cff", name: "Grok" },
      { glyph: "▮", hue: "#7aa2f7", name: "Cursor" },
      { glyph: "π", hue: "#3ddc84", name: "Pi" },
      { glyph: "☿", hue: "#ffd166", name: "Hermes" },
    ]);
  });

  it("presents Claude Agent as unavailable instead of routing or executing it", () => {
    expect(landingAgents.find(({ name }) => name === "Claude Agent")).toMatchObject({
      bin: "0.2.0 暂不可用",
      pulse: "none",
    });
    expect(landingProductCards.find(({ name }) => name === "Claude Agent")).toMatchObject({
      status: "暂不可用",
    });
    expect(landingRoutes).not.toContainEqual(expect.objectContaining({ agent: "Claude Agent" }));
    expect(landingKpis).toContainEqual({
      color: "#3ddc84",
      label: "活跃 Agent",
      value: "3/5",
    });
    expect(landingStats).toContainEqual({ label: "0.2.0 可用 Agent CLI", value: "5" });
  });
});
