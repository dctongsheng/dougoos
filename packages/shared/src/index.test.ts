import { describe, expect, it } from "vitest";

import {
  MAX_DIFF_EVENT_UTF8_BYTES,
  MAX_TOOL_OUTPUT_CHARS,
  OPERATIONAL_LIMITS,
  PROTOCOL_VERSION,
  packageManifest,
} from "./index.js";

describe("@dougoos/shared public contract", () => {
  it("exposes an implemented strict-ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "package",
      name: "@dougoos/shared",
      status: "implemented",
    });
  });

  it("exports one protocol version and centralized exact/operational limits", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(MAX_TOOL_OUTPUT_CHARS).toBe(30_000);
    expect(MAX_DIFF_EVENT_UTF8_BYTES).toBe(1_048_576);
    expect(OPERATIONAL_LIMITS.promptUtf8Bytes).toBeGreaterThan(0);
  });
});
