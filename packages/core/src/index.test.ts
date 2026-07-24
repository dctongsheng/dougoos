import { describe, expect, it } from "vitest";

import { packageManifest } from "./index.js";

describe("@dougoos/core", () => {
  it("exposes an ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "package",
      name: "@dougoos/core",
      status: "implemented",
    });
  });
});
