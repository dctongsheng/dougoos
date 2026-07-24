import { z } from "zod";

import { ErrorPayloadSchema, SafeDiagnosticTextSchema } from "./errors.js";
import { IsoTimestampSchema, ProviderIdSchema, boundedString } from "./primitives.js";

export const PermissionEnforcementSchema = z.enum([
  "client_enforced",
  "not_guaranteed",
  "requests_permission",
]);
export type PermissionEnforcement = z.infer<typeof PermissionEnforcementSchema>;

/**
 * A normalized, per-session snapshot of capabilities actually negotiated with
 * ACP. Missing or false fields never imply support; raw ACP capability objects
 * and provider `_meta` are intentionally not representable.
 */
export const ProviderCapabilitySnapshotSchema = z
  .object({
    clientProxy: z
      .object({
        config: z.boolean(),
        fileSystem: z.boolean(),
        terminal: z.boolean(),
      })
      .strict(),
    negotiatedAt: IsoTimestampSchema,
    permissionEnforcement: PermissionEnforcementSchema,
    protocolVersion: z.literal("1"),
    session: z
      .object({
        close: z.boolean(),
        delete: z.boolean(),
        list: z.boolean(),
        load: z.boolean(),
        resume: z.boolean(),
      })
      .strict(),
    turn: z
      .object({
        cancel: z.boolean(),
        images: z.boolean(),
        prompt: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type ProviderCapabilitySnapshot = z.infer<typeof ProviderCapabilitySnapshotSchema>;

export const ProviderProcessPolicySchema = z
  .object({
    maxSessionsPerProcess: z.number().int().min(1).max(64),
    multiSessionPerProcess: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.multiSessionPerProcess && value.maxSessionsPerProcess !== 1) {
      context.addIssue({
        code: "custom",
        message: "single-session providers must set maxSessionsPerProcess to 1",
        path: ["maxSessionsPerProcess"],
      });
    }
  });
export type ProviderProcessPolicy = z.infer<typeof ProviderProcessPolicySchema>;

export const ProviderStatusSchema = z.enum([
  "available",
  "handshake_failed",
  "incompatible",
  "probing",
  "unauthenticated",
  "unavailable",
]);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderSchema = z
  .object({
    /**
     * Latest doctor handshake result. It is an observed snapshot, never a
     * configured promise of what a future Session will negotiate.
     */
    capabilities: ProviderCapabilitySnapshotSchema.nullable(),
    checkedAt: IsoTimestampSchema,
    displayName: boundedString(128, { label: "provider display name" }),
    id: ProviderIdSchema,
    processPolicy: ProviderProcessPolicySchema,
    reason: SafeDiagnosticTextSchema.optional(),
    remediation: SafeDiagnosticTextSchema.optional(),
    status: ProviderStatusSchema,
    version: boundedString(128, { label: "provider version" }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "available") {
      if (value.version === undefined || value.capabilities === null) {
        context.addIssue({
          code: "custom",
          message: "available Provider requires version and observed capability snapshot",
          path: ["capabilities"],
        });
      }
      if (value.reason !== undefined || value.remediation !== undefined) {
        context.addIssue({
          code: "custom",
          message: "available Provider must not carry failure diagnostics",
          path: ["reason"],
        });
      }
      return;
    }

    if (value.capabilities !== null) {
      context.addIssue({
        code: "custom",
        message: "non-available Provider must not expose a capability snapshot",
        path: ["capabilities"],
      });
    }
    if (value.status === "probing") {
      if (value.reason !== undefined || value.remediation !== undefined) {
        context.addIssue({
          code: "custom",
          message: "probing Provider must not report a completed failure",
          path: ["reason"],
        });
      }
    } else if (value.reason === undefined || value.remediation === undefined) {
      context.addIssue({
        code: "custom",
        message: "unavailable Provider requires safe reason and remediation",
        path: ["reason"],
      });
    }
  });
export type Provider = z.infer<typeof ProviderSchema>;
export const ProviderSummarySchema = ProviderSchema;
export type ProviderSummary = Provider;

const DoctorAvailableSchema = z
  .object({
    capabilities: ProviderCapabilitySnapshotSchema,
    checkedAt: IsoTimestampSchema,
    providerId: ProviderIdSchema,
    status: z.literal("available"),
    version: boundedString(128, { label: "provider version" }),
  })
  .strict();

const DoctorUnavailableSchema = z
  .object({
    checkedAt: IsoTimestampSchema,
    providerId: ProviderIdSchema,
    reason: SafeDiagnosticTextSchema,
    remediation: SafeDiagnosticTextSchema,
    status: z.enum(["incompatible", "unauthenticated", "unavailable"]),
    version: boundedString(128, { label: "provider version" }).optional(),
  })
  .strict();

const DoctorHandshakeFailedSchema = z
  .object({
    checkedAt: IsoTimestampSchema,
    error: ErrorPayloadSchema,
    providerId: ProviderIdSchema,
    status: z.literal("handshake_failed"),
    version: boundedString(128, { label: "provider version" }).optional(),
  })
  .strict();

export const ProviderDoctorResultSchema = z.union([
  DoctorAvailableSchema,
  DoctorUnavailableSchema,
  DoctorHandshakeFailedSchema,
]);
export type ProviderDoctorResult = z.infer<typeof ProviderDoctorResultSchema>;
