import { describe, expect, it } from "vitest";

import { EarlyAccessReleaseManifestSchema } from "./releases.js";

const manifest = {
  artifact: {
    sha256: "a".repeat(64),
    signatureUrl:
      "https://downloads.dougoos.com/early-access/macos/arm64/0.2.0/DougoOS-0.2.0-arm64.dmg.sig",
    size: 512,
    url: "https://downloads.dougoos.com/early-access/macos/arm64/0.2.0/DougoOS-0.2.0-arm64.dmg",
  },
  channel: "early-access",
  minimumMacOS: "13.0",
  publishedAt: "2026-07-25T00:00:00.000Z",
  releaseNotesUrl: "https://dougoos.com/releases/0.2.0",
  schemaVersion: 1,
  version: "0.2.0",
} as const;

describe("EarlyAccessReleaseManifestSchema", () => {
  it("accepts the bounded public release contract", () => {
    expect(EarlyAccessReleaseManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("rejects prerelease versions, oversized artifacts, and unknown fields", () => {
    expect(
      EarlyAccessReleaseManifestSchema.safeParse({
        ...manifest,
        version: "0.2.1-beta.1",
      }).success,
    ).toBe(false);
    expect(
      EarlyAccessReleaseManifestSchema.safeParse({
        ...manifest,
        artifact: { ...manifest.artifact, size: 6 * 1024 * 1024 * 1024 },
      }).success,
    ).toBe(false);
    expect(
      EarlyAccessReleaseManifestSchema.safeParse({
        ...manifest,
        downloadToken: "must-not-exist",
      }).success,
    ).toBe(false);
  });
});
