import { describe, expect, it } from "vitest";

import { packageManifest } from "./index.js";

describe("@dougoos/web scaffold", () => {
  it("exposes an ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "app",
      name: "@dougoos/web",
      status: "implemented",
    });
  });
});
