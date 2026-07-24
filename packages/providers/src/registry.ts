import type { AgentProvider } from "@dougoos/acp";
import type { ProviderDoctorResult } from "@dougoos/shared";

import { ClaudeCodeProvider } from "./claude-code.js";
import { AgentCliDiscovery, type AgentCliDiscoveryPort } from "./cli-discovery.js";
import { CodexProvider } from "./codex.js";
import { CursorAgentProvider } from "./cursor-agent.js";
import { doctorProvider, doctorProviders, type ProviderDoctorOptions } from "./doctor.js";
import { GrokProvider } from "./grok.js";
import { HermesProvider } from "./hermes.js";
import { OpenClawProvider } from "./openclaw.js";
import { OpenCodeProvider } from "./opencode.js";
import { PiProvider } from "./pi.js";

export function createBuiltinProviders(
  cliDiscovery: AgentCliDiscoveryPort = new AgentCliDiscovery(),
): readonly AgentProvider[] {
  return [
    new ClaudeCodeProvider({ cliDiscovery }),
    new CodexProvider({ cliDiscovery }),
    new CursorAgentProvider({ cliDiscovery }),
    new GrokProvider({ cliDiscovery }),
    new HermesProvider({ cliDiscovery }),
    new OpenClawProvider({ cliDiscovery }),
    new OpenCodeProvider({ cliDiscovery }),
    new PiProvider({ cliDiscovery }),
  ];
}

export class AgentProviderRegistry {
  readonly #providers: ReadonlyMap<string, AgentProvider>;

  constructor(providers: readonly AgentProvider[] = createBuiltinProviders()) {
    this.#providers = new Map(providers.map((provider) => [provider.id, provider]));
    if (this.#providers.size !== providers.length) {
      throw new Error("Provider IDs must be unique");
    }
  }

  doctor(providerId: string, options: ProviderDoctorOptions): Promise<ProviderDoctorResult> {
    const provider = this.#providers.get(providerId);
    if (provider === undefined) {
      throw new Error("Provider is not registered");
    }
    return doctorProvider(provider, options);
  }

  doctorAll(options: ProviderDoctorOptions): Promise<readonly ProviderDoctorResult[]> {
    return doctorProviders(this.list(), options);
  }

  get(providerId: string): AgentProvider | undefined {
    return this.#providers.get(providerId);
  }

  list(): readonly AgentProvider[] {
    return [...this.#providers.values()];
  }
}
