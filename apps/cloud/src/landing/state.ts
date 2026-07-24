import {
  LANDING_ACCENTS,
  type LandingAccent,
  type LandingDisplayOptions,
  type LandingTheme,
} from "./types.js";

export interface LandingPresentationState extends LandingDisplayOptions {
  readonly loggedIn: boolean;
  readonly loginOpen: boolean;
}

export type LandingPresentationAction =
  | { readonly type: "close-login" }
  | { readonly type: "complete-demo-login" }
  | { readonly type: "open-login" }
  | { readonly type: "toggle-theme" };

const landingThemes = new Set<LandingTheme>(["dark", "light"]);

const isLandingAccent = (value: string): value is LandingAccent =>
  Object.hasOwn(LANDING_ACCENTS, value);

const isLandingTheme = (value: string): value is LandingTheme =>
  landingThemes.has(value as LandingTheme);

export const parseLandingDisplayOptions = (search: string): LandingDisplayOptions => {
  const params = new URLSearchParams(search);
  const accent = params.get("accent") ?? "";
  const theme = params.get("theme") ?? "";
  return {
    accent: isLandingAccent(accent) ? accent : "green",
    theme: isLandingTheme(theme) ? theme : "dark",
  };
};

export const createLandingPresentationState = (
  display: LandingDisplayOptions,
): LandingPresentationState => ({
  ...display,
  loggedIn: false,
  loginOpen: false,
});

export const reduceLandingPresentation = (
  state: LandingPresentationState,
  action: LandingPresentationAction,
): LandingPresentationState => {
  switch (action.type) {
    case "close-login":
      return { ...state, loginOpen: false };
    case "complete-demo-login":
      return { ...state, loggedIn: true, loginOpen: false };
    case "open-login":
      return state.loggedIn ? state : { ...state, loginOpen: true };
    case "toggle-theme":
      return { ...state, theme: state.theme === "light" ? "dark" : "light" };
  }
};
