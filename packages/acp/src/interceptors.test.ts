import { randomUUID } from "node:crypto";

import { AgentRuntimeEventSchema } from "@dougoos/shared";
import { describe, expect, it, vi } from "vitest";

import { InterceptorChain } from "./interceptors.js";

function promptContext() {
  return {
    cwd: "/tmp/project",
    providerId: "fixture",
    sessionId: randomUUID(),
    signal: new AbortController().signal,
    text: "hello",
    turnId: randomUUID(),
  };
}

describe("InterceptorChain", () => {
  it("runs blocking hooks in order and stops after the first rejection", async () => {
    const calls: string[] = [];
    const chain = new InterceptorChain([
      {
        beforePrompt: () => {
          calls.push("first");
          return Promise.resolve("allow");
        },
      },
      {
        beforePrompt: () => {
          calls.push("second");
          return Promise.resolve("reject");
        },
      },
      {
        beforePrompt: () => {
          calls.push("third");
          return Promise.resolve("allow");
        },
      },
    ]);

    await expect(chain.beforePrompt(promptContext())).resolves.toBe("reject");
    expect(calls).toEqual(["first", "second"]);
  });

  it.each(["exception", "timeout"] as const)("fails permission %s closed", async (mode) => {
    const chain = new InterceptorChain(
      [
        {
          onPermissionRequest: () =>
            mode === "exception"
              ? Promise.reject(new Error("blocked"))
              : new Promise(() => undefined),
        },
      ],
      { timeoutMs: 5 },
    );
    const context = promptContext();
    await expect(
      chain.onPermissionRequest({
        ...context,
        request: {
          options: [{ kind: "reject_once", name: "Reject", optionId: "reject" }],
          toolCall: { toolCallId: "tool" },
        },
        requestId: "permission",
      }),
    ).resolves.toBe("reject");
  });

  it("supports allow while preserving reject precedence", async () => {
    const allow = new InterceptorChain([{ onPermissionRequest: () => Promise.resolve("allow") }]);
    const reject = new InterceptorChain([
      { onPermissionRequest: () => Promise.resolve("allow") },
      { onPermissionRequest: () => Promise.resolve("reject") },
    ]);
    const context = {
      ...promptContext(),
      request: {
        options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
        toolCall: { toolCallId: "tool" },
      },
      requestId: "permission",
    };
    await expect(allow.onPermissionRequest(context)).resolves.toBe("allow");
    await expect(reject.onPermissionRequest(context)).resolves.toBe("reject");
  });

  it("does not let an observer failure block publication", async () => {
    const onObserverError = vi.fn();
    const chain = new InterceptorChain(
      [
        {
          afterEvent: () => Promise.reject(new Error("observer failed")),
        },
      ],
      { onObserverError },
    );
    const event = AgentRuntimeEventSchema.parse({
      event: { state: "idle", type: "session_state" },
      occurredAt: "2026-07-24T00:00:00.000Z",
      sessionId: randomUUID(),
      turnId: null,
    });

    chain.observe(event);
    expect(onObserverError).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onObserverError).toHaveBeenCalledOnce());
  });
});
