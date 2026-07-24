export * from "./errors.js";
export * from "./interceptors.js";
export * from "./registry.js";
export * from "./repl.js";
export * from "./stderr.js";
export * from "./types.js";

export const packageManifest = {
  kind: "package",
  name: "@dougoos/acp",
  status: "implemented",
} as const;
