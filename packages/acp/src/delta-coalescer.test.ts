import { CONTRACT_LIMITS, MessageDeltaEventSchema } from "@dougoos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeltaCoalescer } from "./delta-coalescer.js";

describe("DeltaCoalescer", () => {
  afterEach(() => vi.useRealTimers());

  it("merges text within a bounded 50ms window", async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const coalescer = new DeltaCoalescer((event) => events.push(event), 50);
    const messageId = crypto.randomUUID();
    coalescer.add(MessageDeltaEventSchema.parse({ messageId, text: "one", type: "message_delta" }));
    coalescer.add(
      MessageDeltaEventSchema.parse({ messageId, text: " two", type: "message_delta" }),
    );

    await vi.advanceTimersByTimeAsync(49);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{ messageId, text: "one two", type: "message_delta" }]);
  });

  it("rejects an unbounded coalescing window", () => {
    expect(() => new DeltaCoalescer(() => undefined, 51)).toThrow(
      "delta window must be between 0 and 50ms",
    );
  });

  it("flushes instead of constructing an oversized shared event", async () => {
    vi.useFakeTimers();
    const events: { readonly text: string }[] = [];
    const coalescer = new DeltaCoalescer((event) => events.push(event), 50);
    const messageId = crypto.randomUUID();
    const chunk = "x".repeat(60_000);
    coalescer.add(MessageDeltaEventSchema.parse({ messageId, text: chunk, type: "message_delta" }));
    coalescer.add(MessageDeltaEventSchema.parse({ messageId, text: chunk, type: "message_delta" }));

    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.text.length <= CONTRACT_LIMITS.messageBodyChars)).toBe(
      true,
    );
  });
});
