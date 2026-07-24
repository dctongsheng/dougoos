import type {
  CancelRegistryTurnInput,
  CoreRegistry,
  CreateRegistrySessionInput,
  ResolveRegistryApprovalInput,
  StartRegistryTurnInput,
} from "@dougoos/core";

export class EmptyRegistry implements CoreRegistry {
  cancelTurn(input: CancelRegistryTurnInput): "cancelled" {
    void input;
    return "cancelled";
  }

  createSession(input: CreateRegistrySessionInput): never {
    void input;
    throw new Error("No Agent Provider is installed");
  }

  doctor(providerId: string) {
    return {
      checkedAt: new Date().toISOString(),
      providerId,
      reason: "Provider is not registered",
      remediation: "Install and configure a supported Agent Provider",
      status: "unavailable" as const,
    };
  }

  initialize(): void {}

  listProviders(): readonly [] {
    return [];
  }

  onEvent(): () => void {
    return () => undefined;
  }

  resolveApproval(input: ResolveRegistryApprovalInput): never {
    void input;
    throw new Error("No Agent Provider is installed");
  }

  startTurn(input: StartRegistryTurnInput): never {
    void input;
    throw new Error("No Agent Provider is installed");
  }
}
