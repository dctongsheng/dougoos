import { z } from "zod";

import { CONTRACT_LIMITS, PROTOCOL_VERSION } from "./limits.js";

const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const RESERVED_JSON_KEY = /(?:^|_)(?:meta|raw_acp|raw_acp_envelope|acp_envelope)(?:_|$)/iu;

export type JsonPrimitive = boolean | number | string | null;
export type BoundedJsonValue =
  JsonPrimitive | readonly BoundedJsonValue[] | { readonly [key: string]: BoundedJsonValue };

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeSingleLinePreview(
  value: string,
  maxCodePoints: number,
): string | undefined {
  const normalized = Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127) ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length === 0) return undefined;
  return Array.from(normalized).slice(0, maxCodePoints).join("");
}

function hasControlCharacter(value: string, allowFormattingWhitespace: boolean): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    if (
      allowFormattingWhitespace &&
      (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d)
    ) {
      return false;
    }
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function jsonUtf8ByteLength(value: unknown): number {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 0 : utf8ByteLength(encoded);
}

/**
 * Security checks operate on one normalized representation so camelCase,
 * PascalCase, kebab-case, and snake_case spellings cannot bypass a key policy.
 */
export function normalizeSecurityKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
}

export function boundedString(
  maxCodePoints: number,
  options: { readonly allowEmpty?: boolean; readonly label?: string } = {},
) {
  const label = options.label ?? "string";
  const base = z.string().refine((value) => !hasControlCharacter(value, false), {
    error: `${label} must not contain control characters`,
  });
  const nonEmpty =
    options.allowEmpty === true
      ? base
      : base.refine((value) => unicodeLength(value) > 0, {
          error: `${label} must not be empty`,
        });
  return nonEmpty.refine((value) => unicodeLength(value) <= maxCodePoints, {
    error: `${label} exceeds ${maxCodePoints} characters`,
  });
}

export function boundedMultilineString(
  maxCodePoints: number,
  options: { readonly allowEmpty?: boolean; readonly label?: string } = {},
) {
  const label = options.label ?? "multiline string";
  const base = z
    .string()
    .refine((value) => !hasControlCharacter(value, true), {
      error: `${label} contains a forbidden control character`,
    })
    .refine((value) => options.allowEmpty === true || unicodeLength(value) > 0, {
      error: `${label} must not be empty`,
    });
  return base.refine((value) => unicodeLength(value) <= maxCodePoints, {
    error: `${label} exceeds ${maxCodePoints} characters`,
  });
}

export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

export const InternalIdSchema = boundedString(CONTRACT_LIMITS.idChars, {
  label: "internal id",
});

export const SessionIdSchema = InternalIdSchema.brand<"SessionId">();
export type SessionId = z.infer<typeof SessionIdSchema>;

export const TurnIdSchema = InternalIdSchema.brand<"TurnId">();
export type TurnId = z.infer<typeof TurnIdSchema>;

export const MessageIdSchema = InternalIdSchema.brand<"MessageId">();
export type MessageId = z.infer<typeof MessageIdSchema>;

export const EventIdSchema = InternalIdSchema.brand<"EventId">();
export type EventId = z.infer<typeof EventIdSchema>;

export const ArtifactIdSchema = InternalIdSchema.brand<"ArtifactId">();
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;

export const ProviderIdSchema = boundedString(CONTRACT_LIMITS.providerIdChars, {
  label: "provider id",
}).regex(PROVIDER_ID_PATTERN, {
  error: "provider id must be a lowercase slug",
});
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * ACP/provider request, option, and provider-session IDs are opaque. They are
 * deliberately not UUID schemas; only size and control-character safety apply.
 */
export const OpaqueIdSchema = boundedString(CONTRACT_LIMITS.opaqueIdChars, {
  label: "opaque id",
});
export type OpaqueId = z.infer<typeof OpaqueIdSchema>;

export const ClientRequestIdSchema = boundedString(CONTRACT_LIMITS.clientRequestIdChars, {
  label: "client request id",
});
export type ClientRequestId = z.infer<typeof ClientRequestIdSchema>;

export const ErrorCodeSchema = boundedString(CONTRACT_LIMITS.errorCodeChars, {
  label: "error code",
}).regex(ERROR_CODE_PATTERN, {
  error: "error code must be uppercase snake case",
});
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

const SafeIntegerSchema = z.number().int().safe().nonnegative();

/**
 * The two brands prevent a local Session snapshot cursor from being assigned
 * to the global event reducer baseline at compile time.
 */
export const GlobalSeqSchema = SafeIntegerSchema.brand<"GlobalSeq">();
export type GlobalSeq = z.infer<typeof GlobalSeqSchema>;

export const SessionSnapshotSeqSchema = SafeIntegerSchema.brand<"SessionSnapshotSeq">();
export type SessionSnapshotSeq = z.infer<typeof SessionSnapshotSeqSchema>;

export const PathSchema = boundedString(CONTRACT_LIMITS.pathChars, {
  allowEmpty: false,
  label: "path",
});
export type ContractPath = z.infer<typeof PathSchema>;

export const CwdSchema = boundedString(CONTRACT_LIMITS.cwdChars, {
  allowEmpty: false,
  label: "cwd",
});
export type Cwd = z.infer<typeof CwdSchema>;

export const TitleSchema = boundedString(CONTRACT_LIMITS.titleChars, {
  label: "title",
});

export const ShortLabelSchema = boundedString(CONTRACT_LIMITS.shortLabelChars, {
  label: "label",
});

export const MessageBodySchema = boundedMultilineString(CONTRACT_LIMITS.messageBodyChars, {
  label: "message body",
});

export const PromptSchema = boundedMultilineString(CONTRACT_LIMITS.promptChars, {
  label: "prompt",
});

export const ToolOutputSchema = boundedMultilineString(CONTRACT_LIMITS.toolOutputChars, {
  allowEmpty: true,
  label: "tool output",
});

const RawJsonValueSchema: z.ZodType<BoundedJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(RawJsonValueSchema),
    z.record(z.string(), RawJsonValueSchema),
  ]),
);

function inspectJsonValue(
  value: BoundedJsonValue,
  path: readonly PropertyKey[],
  depth: number,
  context: z.RefinementCtx,
): void {
  if (depth > CONTRACT_LIMITS.jsonDepth) {
    context.addIssue({
      code: "custom",
      message: `JSON value exceeds maximum depth ${CONTRACT_LIMITS.jsonDepth}`,
      path: [...path],
    });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > CONTRACT_LIMITS.jsonArrayItems) {
      context.addIssue({
        code: "custom",
        message: `JSON array exceeds ${CONTRACT_LIMITS.jsonArrayItems} items`,
        path: [...path],
      });
    }
    for (const [index, item] of value.entries()) {
      inspectJsonValue(item, [...path, index], depth + 1, context);
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > CONTRACT_LIMITS.jsonObjectKeys) {
      context.addIssue({
        code: "custom",
        message: `JSON object exceeds ${CONTRACT_LIMITS.jsonObjectKeys} keys`,
        path: [...path],
      });
    }
    for (const [key, item] of entries) {
      if (
        unicodeLength(key) === 0 ||
        unicodeLength(key) > CONTRACT_LIMITS.shortLabelChars ||
        hasControlCharacter(key, false) ||
        key.startsWith("_") ||
        RESERVED_JSON_KEY.test(normalizeSecurityKey(key))
      ) {
        context.addIssue({
          code: "custom",
          message: "JSON extension key is unsafe or reserved",
          path: [...path, key],
        });
      }
      inspectJsonValue(item, [...path, key], depth + 1, context);
    }
  }
}

export const BoundedJsonValueSchema = RawJsonValueSchema.superRefine((value, context) => {
  inspectJsonValue(value, [], 0, context);
  if (jsonUtf8ByteLength(value) > CONTRACT_LIMITS.jsonValueBytes) {
    context.addIssue({
      code: "custom",
      message: `JSON value exceeds ${CONTRACT_LIMITS.jsonValueBytes} UTF-8 bytes`,
    });
  }
});

export const BoundedJsonObjectSchema = BoundedJsonValueSchema.refine(
  (value): value is { readonly [key: string]: BoundedJsonValue } =>
    value !== null && !Array.isArray(value) && typeof value === "object",
  { error: "expected a bounded JSON object" },
);

export const DeviceIdSchema = z.uuidv4().brand<"DeviceId">();
export type DeviceId = z.infer<typeof DeviceIdSchema>;

export const ArtifactRefSchema = z
  .object({
    artifactId: ArtifactIdSchema,
    byteLength: z.number().int().safe().positive(),
    displayName: ShortLabelSchema,
    mediaType: boundedString(128, { label: "media type" }),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
