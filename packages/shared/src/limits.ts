/** Exact limits prescribed by the accepted architecture. */
export const MAX_TOOL_OUTPUT_CHARS = 30_000;
export const MAX_DIFF_EVENT_UTF8_BYTES = 1_048_576;

/**
 * The other bounds are the MVP operational policy. The accepted ADRs require
 * bounded inputs but do not prescribe these numbers.
 */
export const OPERATIONAL_LIMITS = {
  activeSessions: 32,
  approvalOptions: 32,
  approvalsPerSessionSnapshot: 1_000,
  clientRequestIdChars: 128,
  cwdChars: 4_096,
  detailsBytes: 16 * 1_024,
  diffEventBytes: MAX_DIFF_EVENT_UTF8_BYTES,
  errorCodeChars: 96,
  errorMessageChars: 1_024,
  globalSnapshotBytes: 16 * 1_048_576,
  idChars: 128,
  includedSessions: 64,
  jsonArrayItems: 64,
  jsonDepth: 8,
  jsonObjectKeys: 64,
  jsonValueBytes: 64 * 1_024,
  messageBodyChars: 100_000,
  messagesPerSessionSnapshot: 10_000,
  maxPendingApprovals: 256,
  opaqueIdChars: 256,
  pathChars: 4_096,
  promptChars: 100_000,
  promptContentParts: 16,
  promptUtf8Bytes: 512 * 1_024,
  providerIdChars: 64,
  providers: 64,
  requestedSessions: 32,
  requestBodyBytes: 2 * 1_048_576,
  sessionSnapshotBytes: 8 * 1_048_576,
  sessions: 5_000,
  shortLabelChars: 128,
  titleChars: 256,
  toolOutputChars: MAX_TOOL_OUTPUT_CHARS,
  turnsPerSessionSnapshot: 1_000,
} as const;

export const CONTRACT_LIMITS = OPERATIONAL_LIMITS;
export const PROTOCOL_VERSION = 1 as const;
export const REPLAY_GAP = "REPLAY_GAP" as const;
export const SESSION_BUSY = "SESSION_BUSY" as const;
