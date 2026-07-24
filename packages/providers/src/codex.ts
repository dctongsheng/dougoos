import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentProvider, SanitizedProcessEnv } from "@dougoos/acp";

import { BundledAcpProvider, type BundledProviderOptions } from "./bundled-provider.js";
import { CODEX_PROCESS_ENV } from "./environment.js";

export const CODEX_ACP_VERSION = "1.1.7";
const CODEX_ACP_ENTRY = fileURLToPath(import.meta.resolve("@agentclientprotocol/codex-acp"));

type LocalAuthProbe = (environment: SanitizedProcessEnv) => boolean;

export interface CodexProviderOptions extends BundledProviderOptions {
  readonly hasLocalAuth?: LocalAuthProbe;
}

function defaultLocalAuthProbe(environment: SanitizedProcessEnv): boolean {
  const codexHome =
    environment.CODEX_HOME ??
    (environment.HOME === undefined ? undefined : join(environment.HOME, ".codex"));
  return codexHome !== undefined && existsSync(join(codexHome, "auth.json"));
}

export class CodexProvider extends BundledAcpProvider {
  readonly displayName = "Codex";
  readonly id = "codex";
  readonly providerEnvironmentNames = CODEX_PROCESS_ENV;
  readonly supportedAdapterVersion = CODEX_ACP_VERSION;

  readonly #hasLocalAuth: LocalAuthProbe;

  constructor(options?: CodexProviderOptions) {
    super({
      adapterEntry: CODEX_ACP_ENTRY,
      adapterVersion: CODEX_ACP_VERSION,
      cliExecutableEnvironmentName: "CODEX_PATH",
      cliProviderId: "codex",
      ...(options === undefined ? {} : { options }),
    });
    this.#hasLocalAuth = options?.hasLocalAuth ?? defaultLocalAuthProbe;
  }

  chooseAuthMethod(
    initialize: Parameters<AgentProvider["chooseAuthMethod"]>[0],
    environment: SanitizedProcessEnv,
  ): string | null {
    const advertised = new Set((initialize.authMethods ?? []).map((method) => method.id));
    if (
      advertised.has("api-key") &&
      (environment.CODEX_API_KEY !== undefined || environment.OPENAI_API_KEY !== undefined)
    ) {
      return "api-key";
    }
    if (advertised.has("chat-gpt") && this.#hasLocalAuth(environment)) {
      return "chat-gpt";
    }
    return null;
  }
}
