import { describe, expect, it } from "vitest";

import { packageManifest } from "./index.js";

describe("@dougoos/desktop", () => {
  it("exposes an ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "app",
      name: "@dougoos/desktop",
      status: "implemented",
    });
  });
});
