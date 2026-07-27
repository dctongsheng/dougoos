export {
  AcpCoreRegistry,
  createAcpCoreRegistry,
  type AcpCoreRegistryOptions,
} from "./acp-registry.js";
export {
  CoreRuntime,
  createCoreRuntime,
  generateBearerToken,
  type CoreLifecycleState,
} from "./app.js";
export { CoreError } from "./errors.js";
export { CoreEventHub, type CoreEventListener } from "./event-hub.js";
export {
  RotatingAgentLog,
  RotatingPermissionAuditLog,
  type RotatingAgentLogOptions,
} from "./local-agent-log.js";
export { startCore, type CoreServer, type StartCoreOptions } from "./server.js";
export {
  createCoreEventStreamResponse,
  type CoreEventStreamOptions,
  type EventReplaySource,
} from "./stream.js";
export type {
  CancelRegistryTurnInput,
  CoreDependencies,
  CoreRegistry,
  CoreSecurityOptions,
  CreateRegistrySessionInput,
  MaybePromise,
  RegistrySession,
  RegistryEventListener,
  ResolveRegistryApprovalInput,
  StartRegistryTurnInput,
} from "./types.js";

export const packageManifest = {
  kind: "package",
  name: "@dougoos/core",
  status: "implemented",
} as const;
