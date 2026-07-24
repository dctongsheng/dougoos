import { describe, expect, it } from "vitest";

import { packageManifest } from "./index.js";

describe("@dougoos/providers scaffold", () => {
  it("exposes an ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "package",
      name: "@dougoos/providers",
      status: "implemented",
    });
  });
});
