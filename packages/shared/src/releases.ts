import { z } from "zod";

import { IsoTimestampSchema, boundedString } from "./primitives.js";

const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const MINIMUM_MACOS_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const ReleaseVersionSchema = boundedString(32, { label: "release version" }).regex(
  RELEASE_VERSION_PATTERN,
  "release version must be major.minor.patch",
);
export type ReleaseVersion = z.infer<typeof ReleaseVersionSchema>;

export const EarlyAccessReleaseArtifactSchema = z
  .object({
    sha256: z.string().regex(SHA256_PATTERN, "sha256 must be lowercase hexadecimal"),
    signatureUrl: z.url(),
    size: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024 * 1024),
    url: z.url(),
  })
  .strict();
export type EarlyAccessReleaseArtifact = z.infer<typeof EarlyAccessReleaseArtifactSchema>;

export const EarlyAccessReleaseManifestSchema = z
  .object({
    artifact: EarlyAccessReleaseArtifactSchema,
    channel: z.literal("early-access"),
    minimumMacOS: z.string().regex(MINIMUM_MACOS_PATTERN, "minimum macOS must be major.minor"),
    publishedAt: IsoTimestampSchema,
    releaseNotesUrl: z.url(),
    schemaVersion: z.literal(1),
    version: ReleaseVersionSchema,
  })
  .strict();
export type EarlyAccessReleaseManifest = z.infer<typeof EarlyAccessReleaseManifestSchema>;
