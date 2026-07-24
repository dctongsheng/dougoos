import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";

import { AcpRuntimeError, toRuntimeError } from "./errors.js";

describe("ACP runtime error mapping", () => {
  it("preserves existing structured runtime failures", () => {
    const failure = new AcpRuntimeError({
      code: "AGENT_FAILED",
      message: "Agent failed",
      retryable: false,
    });
    expect(toRuntimeError(failure)).toBe(failure);
  });

  it("maps turn authentication failures without retaining free-form diagnostics", () => {
    expect(toRuntimeError(RequestError.authRequired({ secret: "never expose" }))).toMatchObject({
      payload: {
        code: "PROVIDER_UNAVAILABLE",
        details: { operation: "create_turn", phase: "auth" },
        retryable: false,
      },
    });
  });

  it("retains only the safe numeric JSON-RPC code for other request failures", () => {
    expect(new RequestError(-32_603, "unsafe free-form diagnostic")).toSatisfy((failure) => {
      const mapped = toRuntimeError(failure);
      expect(mapped.payload).toEqual({
        code: "AGENT_FAILED",
        details: {
          actual: -32_603,
          operation: "create_turn",
          phase: "turn",
        },
        message: "Agent failed",
        retryable: true,
      });
      expect(mapped.message).not.toContain("unsafe");
      return true;
    });
  });
});
