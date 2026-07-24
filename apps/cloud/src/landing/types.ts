export const LANDING_ACCENTS = {
  cyan: "#4fd8e0",
  green: "#3ddc84",
  orange: "#ffb454",
  purple: "#b48cff",
} as const;

export type LandingAccent = keyof typeof LANDING_ACCENTS;
export type LandingTheme = "dark" | "light";

export interface LandingDisplayOptions {
  readonly accent: LandingAccent;
  readonly theme: LandingTheme;
}

export interface LandingAgent {
  readonly bin: string;
  readonly dot: string;
  readonly glyph: string;
  readonly hue: string;
  readonly name: string;
  readonly pulse: string;
}

export interface LandingKpi {
  readonly color: string;
  readonly label: string;
  readonly value: string;
}

export interface LandingProductCard {
  readonly border: string;
  readonly glyph: string;
  readonly hue: string;
  readonly last: string;
  readonly name: string;
  readonly status: string;
  readonly statusColor: string;
  readonly task: string;
}

export interface LandingFeature {
  readonly body: string;
  readonly glyph: string;
  readonly title: string;
}

export interface LandingRoute {
  readonly agent: string;
  readonly confidence: string;
  readonly glyph: string;
  readonly hue: string;
  readonly task: string;
}

export interface MemoryStar {
  readonly glow: number;
  readonly opacity: number;
  readonly size: number;
  readonly x: number;
  readonly y: number;
}

export interface LandingStat {
  readonly label: string;
  readonly value: string;
}
