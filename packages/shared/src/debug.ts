import {
  AgentEventEnvelopeSchema,
  CreateTurnRequestSchema,
  MAX_DIFF_EVENT_UTF8_BYTES,
  MAX_TOOL_OUTPUT_CHARS,
  OPERATIONAL_LIMITS,
  packageManifest,
} from "./index.js";

const occurredAt = new Date().toISOString();

const envelope = AgentEventEnvelopeSchema.parse({
  event: {
    from: null,
    status: "queued",
    type: "turn_state",
  },
  eventId: "debug:event",
  occurredAt,
  seq: 1,
  sessionId: "debug:session",
  turnId: "debug:turn",
  v: 1,
});

const request = CreateTurnRequestSchema.parse({
  clientRequestId: "debug/request",
  content: [{ text: "Validate the shared protocol", type: "text" }],
});

process.stdout.write(
  `${JSON.stringify({
    envelope,
    limits: {
      diffEventUtf8Bytes: MAX_DIFF_EVENT_UTF8_BYTES,
      promptUtf8Bytes: OPERATIONAL_LIMITS.promptUtf8Bytes,
      toolOutputChars: MAX_TOOL_OUTPUT_CHARS,
    },
    package: packageManifest,
    request,
  })}\n`,
);
