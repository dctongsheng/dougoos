import { z } from "zod";

import { IsoTimestampSchema, PathSchema, ProviderIdSchema, boundedString } from "./primitives.js";

export const AgentCliCommandSchema = boundedString(64, {
  label: "agent CLI command",
}).regex(/^[a-z0-9][a-z0-9-]*$/u, {
  error: "agent CLI command must be a lowercase command name",
});
export type AgentCliCommand = z.infer<typeof AgentCliCommandSchema>;

export const AgentCliInstallationSchema = z
  .object({
    command: AgentCliCommandSchema,
    detectedAt: IsoTimestampSchema,
    displayName: boundedString(128, { label: "agent CLI display name" }),
    executablePath: PathSchema,
    integratedProviderId: ProviderIdSchema.optional(),
    version: boundedString(256, { label: "agent CLI version" }).optional(),
  })
  .strict();
export type AgentCliInstallation = z.infer<typeof AgentCliInstallationSchema>;
