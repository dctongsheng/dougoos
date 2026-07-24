import { describe, expect, it } from "vitest";

import {
  createLandingPresentationState,
  parseLandingDisplayOptions,
  reduceLandingPresentation,
} from "./state.js";

describe("Landing presentation state", () => {
  it("accepts only the four visual accents and two themes", () => {
    expect(parseLandingDisplayOptions("?accent=purple&theme=light")).toEqual({
      accent: "purple",
      theme: "light",
    });
    expect(parseLandingDisplayOptions("?accent=red&theme=system&visualCase=unsafe")).toEqual({
      accent: "green",
      theme: "dark",
    });
  });

  it("keeps login as an in-memory presentation state", () => {
    const initial = createLandingPresentationState({ accent: "green", theme: "dark" });
    const open = reduceLandingPresentation(initial, { type: "open-login" });
    expect(open).toEqual({ ...initial, loginOpen: true });

    const loggedIn = reduceLandingPresentation(open, { type: "complete-demo-login" });
    expect(loggedIn).toEqual({ ...initial, loggedIn: true });
    expect(reduceLandingPresentation(loggedIn, { type: "open-login" })).toBe(loggedIn);
  });

  it("toggles the visual theme without creating a persistence side effect", () => {
    const initial = createLandingPresentationState({ accent: "cyan", theme: "dark" });
    expect(reduceLandingPresentation(initial, { type: "toggle-theme" })).toEqual({
      ...initial,
      theme: "light",
    });
  });
});
