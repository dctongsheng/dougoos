import { CONTRACT_LIMITS } from "@dougoos/shared";
import { describe, expect, it } from "vitest";

import { normalizeSessionUpdate } from "./normalizer.js";
import type { AgentProvider } from "./types.js";

const provider: AgentProvider = {
  available: () => Promise.resolve({ ok: true, version: "fixture" }),
  chooseAuthMethod: () => null,
  displayName: "Fixture",
  id: "fixture",
  permissionEnforcement: "requests_permission",
  processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
  resolveCommand: () => ({ args: [], command: process.execPath }),
};

const context = {
  messageId: () => crypto.randomUUID(),
  provider,
} as const;

describe("normalizeSessionUpdate", () => {
  it("bounds text and replaces an oversized external message ID", () => {
    const events = normalizeSessionUpdate(
      {
        _meta: { privateProviderValue: "must-not-cross" },
        content: { text: "x".repeat(CONTRACT_LIMITS.messageBodyChars + 1), type: "text" },
        messageId: "m".repeat(CONTRACT_LIMITS.idChars + 1),
        sessionUpdate: "agent_message_chunk",
      },
      context,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message_delta" });
    if (events[0]?.type !== "message_delta") throw new Error("message delta missing");
    expect(events[0].messageId).toMatch(/^acp-message-/u);
    expect(events[0].text).toHaveLength(CONTRACT_LIMITS.messageBodyChars);
    expect(JSON.stringify(events[0])).not.toContain("privateProviderValue");
  });

  it("omits an oversized inline diff while retaining the bounded tool update", () => {
    const events = normalizeSessionUpdate(
      {
        content: [
          {
            newText: "x".repeat(CONTRACT_LIMITS.diffEventBytes + 1),
            oldText: "",
            path: "/tmp/large.txt",
            type: "diff",
          },
        ],
        rawOutput: { output: "done" },
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "tool",
      },
      context,
    );

    expect(events.map((event) => event.type)).toEqual(["tool_update"]);
    expect(JSON.stringify(events)).not.toContain("x".repeat(1_000));
  });

  it("runtime-validates Provider-specific normalized events", () => {
    const invalidProvider: AgentProvider = {
      ...provider,
      normalizeMeta: () =>
        [
          {
            messageId: crypto.randomUUID(),
            text: "x".repeat(CONTRACT_LIMITS.messageBodyChars + 1),
            type: "message_delta",
          },
        ] as never,
    };
    expect(() =>
      normalizeSessionUpdate(
        {
          content: { text: "hello", type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
        { ...context, provider: invalidProvider },
      ),
    ).toThrow();
  });
});
