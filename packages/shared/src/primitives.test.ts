import { describe, expect, it } from "vitest";

import {
  ArtifactRefSchema,
  BoundedJsonValueSchema,
  CONTRACT_LIMITS,
  CwdSchema,
  GlobalSeqSchema,
  InternalIdSchema,
  IsoTimestampSchema,
  MessageBodySchema,
  OpaqueIdSchema,
  PathSchema,
  PromptSchema,
  ProviderIdSchema,
  SessionSnapshotSeqSchema,
  TitleSchema,
  jsonUtf8ByteLength,
} from "./index.js";

describe("primitive boundary policy", () => {
  it("enforces ID bounds without pretending opaque provider IDs are UUIDs", () => {
    expect(InternalIdSchema.safeParse("i".repeat(CONTRACT_LIMITS.idChars)).success).toBe(true);
    expect(InternalIdSchema.safeParse("i".repeat(CONTRACT_LIMITS.idChars + 1)).success).toBe(false);
    expect(OpaqueIdSchema.safeParse("request/opaque ? id").success).toBe(true);
    expect(OpaqueIdSchema.safeParse("o".repeat(CONTRACT_LIMITS.opaqueIdChars)).success).toBe(true);
    expect(OpaqueIdSchema.safeParse("o".repeat(CONTRACT_LIMITS.opaqueIdChars + 1)).success).toBe(
      false,
    );
    expect(ProviderIdSchema.safeParse("a".repeat(CONTRACT_LIMITS.providerIdChars)).success).toBe(
      true,
    );
    expect(
      ProviderIdSchema.safeParse("a".repeat(CONTRACT_LIMITS.providerIdChars + 1)).success,
    ).toBe(false);
    expect(ProviderIdSchema.safeParse("Codex").success).toBe(false);
  });

  it("counts Unicode code points for text limits", () => {
    expect(TitleSchema.safeParse("😀".repeat(CONTRACT_LIMITS.titleChars)).success).toBe(true);
    expect(TitleSchema.safeParse("😀".repeat(CONTRACT_LIMITS.titleChars + 1)).success).toBe(false);
    expect(MessageBodySchema.safeParse("m".repeat(CONTRACT_LIMITS.messageBodyChars)).success).toBe(
      true,
    );
    expect(
      MessageBodySchema.safeParse("m".repeat(CONTRACT_LIMITS.messageBodyChars + 1)).success,
    ).toBe(false);
    expect(PromptSchema.safeParse("p".repeat(CONTRACT_LIMITS.promptChars)).success).toBe(true);
    expect(PromptSchema.safeParse("p".repeat(CONTRACT_LIMITS.promptChars + 1)).success).toBe(false);
    expect(MessageBodySchema.safeParse("line one\n\tline two\r\nline three").success).toBe(true);
    expect(PromptSchema.safeParse("first\nsecond").success).toBe(true);
    expect(MessageBodySchema.safeParse("bad\u0000content").success).toBe(false);
  });

  it("bounds cwd/path and rejects control characters", () => {
    expect(CwdSchema.safeParse("c".repeat(CONTRACT_LIMITS.cwdChars)).success).toBe(true);
    expect(CwdSchema.safeParse("c".repeat(CONTRACT_LIMITS.cwdChars + 1)).success).toBe(false);
    expect(PathSchema.safeParse("p".repeat(CONTRACT_LIMITS.pathChars)).success).toBe(true);
    expect(PathSchema.safeParse("p".repeat(CONTRACT_LIMITS.pathChars + 1)).success).toBe(false);
    expect(PathSchema.safeParse("a\u0000b").success).toBe(false);
  });

  it("validates ISO timestamps and separately brands global/local cursors", () => {
    expect(IsoTimestampSchema.safeParse("2026-07-24T01:02:03.000Z").success).toBe(true);
    expect(IsoTimestampSchema.safeParse("2026-07-24 01:02:03").success).toBe(false);
    expect(GlobalSeqSchema.safeParse(0).success).toBe(true);
    expect(SessionSnapshotSeqSchema.safeParse(0).success).toBe(true);
    for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(GlobalSeqSchema.safeParse(invalid).success).toBe(false);
      expect(SessionSnapshotSeqSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("bounds explicit JSON extension values by UTF-8 bytes, shape, and depth", () => {
    const exactText = "x".repeat(CONTRACT_LIMITS.jsonValueBytes - 2);
    expect(jsonUtf8ByteLength(exactText)).toBe(CONTRACT_LIMITS.jsonValueBytes);
    expect(BoundedJsonValueSchema.safeParse(exactText).success).toBe(true);
    expect(BoundedJsonValueSchema.safeParse(`${exactText}x`).success).toBe(false);
    expect(
      BoundedJsonValueSchema.safeParse(
        Array.from({ length: CONTRACT_LIMITS.jsonArrayItems }, (_, index) => index),
      ).success,
    ).toBe(true);
    expect(
      BoundedJsonValueSchema.safeParse(
        Array.from({ length: CONTRACT_LIMITS.jsonArrayItems + 1 }, (_, index) => index),
      ).success,
    ).toBe(false);

    let nested: unknown = "leaf";
    for (let depth = 0; depth < CONTRACT_LIMITS.jsonDepth + 1; depth += 1) {
      nested = { level: nested };
    }
    expect(BoundedJsonValueSchema.safeParse(nested).success).toBe(false);
    expect(BoundedJsonValueSchema.safeParse({ _meta: {} }).success).toBe(false);
    expect(BoundedJsonValueSchema.safeParse({ raw_acp_envelope: {} }).success).toBe(false);
    expect(BoundedJsonValueSchema.safeParse({ rawAcp: {} }).success).toBe(false);
    expect(BoundedJsonValueSchema.safeParse({ acpEnvelope: {} }).success).toBe(false);
  });

  it("keeps artifact references strict and content-addressed", () => {
    const artifact = {
      artifactId: "artifact:one",
      byteLength: 1,
      displayName: "result.txt",
      mediaType: "text/plain",
      sha256: "a".repeat(64),
    };
    expect(ArtifactRefSchema.safeParse(artifact).success).toBe(true);
    expect(ArtifactRefSchema.safeParse({ ...artifact, path: "/tmp/result.txt" }).success).toBe(
      false,
    );
    expect(ArtifactRefSchema.safeParse({ ...artifact, sha256: "bad" }).success).toBe(false);
  });
});
