import {
  AcpRuntimeError,
  DefaultAgentSessionRegistry,
  errorPayload,
  type AgentProvider,
  type AgentSessionRegistry,
  type AgentSessionRegistryOptions,
  type AgentStderrLogEntry,
  type SanitizedProcessEnv,
} from "@dougoos/acp";
import { ProviderDoctorResultSchema, type ProviderDoctorResult } from "@dougoos/shared";

import { CLAUDE_AGENT_DISABLED_REASON, CLAUDE_AGENT_DISABLED_REMEDIATION } from "./claude-code.js";
import { providerProcessEnvironment } from "./environment.js";

type RegistryFactory = (options: AgentSessionRegistryOptions) => AgentSessionRegistry;

export interface ProviderDoctorOptions {
  readonly clock?: () => string;
  readonly cwd: string;
  readonly environment?: SanitizedProcessEnv;
  readonly handshakeTimeoutMs?: number;
  readonly onAgentStderr?: (entry: AgentStderrLogEntry) => void;
  readonly registryFactory?: RegistryFactory;
}

function now(clock: (() => string) | undefined): string {
  return new Date(clock?.() ?? Date.now()).toISOString();
}

function unauthenticatedResult(
  provider: AgentProvider,
  checkedAt: string,
  version: string | undefined,
): ProviderDoctorResult {
  if (provider.id === "claude-code") {
    return ProviderDoctorResultSchema.parse({
      checkedAt,
      providerId: provider.id,
      reason: CLAUDE_AGENT_DISABLED_REASON,
      remediation: CLAUDE_AGENT_DISABLED_REMEDIATION,
      status: "unavailable",
    });
  }
  return ProviderDoctorResultSchema.parse({
    checkedAt,
    providerId: provider.id,
    reason: `${provider.displayName} authentication is required.`,
    remediation: `Sign in to ${provider.displayName} or configure an approved API key, then retry Provider doctor.`,
    status: "unauthenticated",
    ...(version === undefined ? {} : { version }),
  });
}

export async function doctorProvider(
  provider: AgentProvider,
  options: ProviderDoctorOptions,
): Promise<ProviderDoctorResult> {
  const checkedAt = now(options.clock);
  const availability = await provider.available();
  if (!availability.ok) {
    return ProviderDoctorResultSchema.parse({
      checkedAt,
      providerId: provider.id,
      reason: availability.reason ?? "The Provider is unavailable.",
      remediation:
        availability.remediation ?? "Repair the Provider installation, then retry doctor.",
      status: availability.kind === "incompatible" ? "incompatible" : "unavailable",
      ...(availability.version === undefined ? {} : { version: availability.version }),
    });
  }
  if (availability.version === undefined) {
    return ProviderDoctorResultSchema.parse({
      checkedAt,
      providerId: provider.id,
      reason: "The Provider did not report a usable version.",
      remediation: "Repair the Provider installation, then retry doctor.",
      status: "unavailable",
    });
  }

  const registryFactory =
    options.registryFactory ??
    ((registryOptions: AgentSessionRegistryOptions) =>
      new DefaultAgentSessionRegistry(registryOptions));
  const registry = registryFactory({
    environment: options.environment ?? providerProcessEnvironment(),
    ...(options.handshakeTimeoutMs === undefined
      ? {}
      : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    ...(options.onAgentStderr === undefined ? {} : { onAgentStderr: options.onAgentStderr }),
    providers: [provider],
  });

  try {
    const session = await registry.create({ cwd: options.cwd, providerId: provider.id });
    const capabilities = session.capabilities;
    await session.dispose();
    return ProviderDoctorResultSchema.parse({
      capabilities,
      checkedAt,
      providerId: provider.id,
      status: "available",
      version: availability.version,
    });
  } catch (error) {
    if (error instanceof AcpRuntimeError) {
      if (
        error.payload.code === "PROVIDER_UNAVAILABLE" &&
        error.payload.details?.phase === "auth"
      ) {
        return unauthenticatedResult(provider, checkedAt, availability.version);
      }
      if (error.payload.code === "PROTOCOL_VERSION_UNSUPPORTED") {
        return ProviderDoctorResultSchema.parse({
          checkedAt,
          providerId: provider.id,
          reason: "The Provider ACP protocol version is incompatible with this release.",
          remediation: "Install the exact supported adapter version, then retry Provider doctor.",
          status: "incompatible",
          version: availability.version,
        });
      }
      return ProviderDoctorResultSchema.parse({
        checkedAt,
        error: error.payload,
        providerId: provider.id,
        status: "handshake_failed",
        version: availability.version,
      });
    }
    return ProviderDoctorResultSchema.parse({
      checkedAt,
      error: errorPayload("ACP_HANDSHAKE_FAILED", true, {
        operation: "initialize",
        phase: "handshake",
        providerId: provider.id,
      }),
      providerId: provider.id,
      status: "handshake_failed",
      version: availability.version,
    });
  } finally {
    await registry.disposeAll().catch(() => undefined);
  }
}

export async function doctorProviders(
  providers: readonly AgentProvider[],
  options: ProviderDoctorOptions,
): Promise<readonly ProviderDoctorResult[]> {
  return Promise.all(providers.map((provider) => doctorProvider(provider, options)));
}
