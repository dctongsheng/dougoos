import { describe, expect, it } from "vitest";

import { packageManifest } from "./index.js";

describe("@dougoos/cloud boundary", () => {
  it("exposes an ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "app",
      name: "@dougoos/cloud",
      status: "health-stub",
    });
  });
});
