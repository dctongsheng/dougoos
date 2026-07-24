export const packageManifest = {
  kind: "app",
  name: "@dougoos/web",
  status: "implemented",
} as const;

export {
  CoreApiClient,
  CoreClientError,
  type CoreConnection,
  type CoreFetch,
} from "./core/core-client.js";
export {
  CoreDataSource,
  assignProviders,
  fixtureFromCoreState,
  type CoreConnectionProvider,
  type CoreDataSourceOptions,
} from "./core/core-data-source.js";
export {
  applyEnvelope,
  beginLocalSessionLoad,
  completeLocalSessionLoad,
  stateFromGlobalSnapshot,
  type ApplyEnvelopeResult,
  type CoreViewState,
  type LiveApproval,
  type LiveMessage,
  type LiveSession,
  type LiveTurn,
} from "./core/core-state.js";
