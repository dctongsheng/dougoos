import { describe, expect, it } from "vitest";

import type {
  AgentEventEnvelope,
  ApiErrorResponse,
  GlobalSnapshot,
  SessionSnapshot,
} from "./index.js";
import {
  AgentEventEnvelopeSchema,
  ApiErrorResponseSchema,
  GlobalSnapshotSchema,
  SessionSnapshotSchema,
} from "./index.js";

const publicSchemaTypesCompile = {
  envelope: AgentEventEnvelopeSchema,
  error: ApiErrorResponseSchema,
  globalSnapshot: GlobalSnapshotSchema,
  sessionSnapshot: SessionSnapshotSchema,
} satisfies {
  readonly envelope: { parse(value: unknown): AgentEventEnvelope };
  readonly error: { parse(value: unknown): ApiErrorResponse };
  readonly globalSnapshot: { parse(value: unknown): GlobalSnapshot };
  readonly sessionSnapshot: { parse(value: unknown): SessionSnapshot };
};

describe("@dougoos/shared public API compilation", () => {
  it("exports each canonical schema/type pair once from the package root", () => {
    expect(Object.keys(publicSchemaTypesCompile)).toEqual([
      "envelope",
      "error",
      "globalSnapshot",
      "sessionSnapshot",
    ]);
  });
});
