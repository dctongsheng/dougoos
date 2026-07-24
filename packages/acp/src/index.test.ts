import { describe, expect, it } from "vitest";

import { packageManifest } from "./index.js";

describe("@dougoos/acp scaffold", () => {
  it("exposes an ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "package",
      name: "@dougoos/acp",
      status: "implemented",
    });
  });
});
