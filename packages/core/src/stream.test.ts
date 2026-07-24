import { AgentEventEnvelopeSchema, type AgentEventEnvelope } from "@dougoos/shared";
import { describe, expect, it } from "vitest";

import { CoreEventHub } from "./event-hub.js";
import { createCoreEventStreamResponse, type EventReplaySource } from "./stream.js";

const NOW = "2026-07-24T08:00:00.000Z";

function envelope(seq: number): AgentEventEnvelope {
  return AgentEventEnvelopeSchema.parse({
    event: { state: "idle", type: "session_state" },
    eventId: `event:${seq}`,
    occurredAt: NOW,
    seq,
    sessionId: "session:stream",
    turnId: null,
    v: 1,
  });
}

async function readFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<readonly string[]> {
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let pending = "";
  while (frames.length < count) {
    const next = await reader.read();
    if (next.done) throw new Error("SSE stream closed before all frames arrived");
    pending += decoder.decode(next.value, { stream: true });
    const parts = pending.split("\n\n");
    pending = parts.pop() ?? "";
    frames.push(...parts.filter((part) => part.length > 0));
  }
  return frames.slice(0, count);
}

describe("Core replay/live SSE stream", () => {
  it("closes the replay/live window and emits only journal-backed events in seq order", async () => {
    const hub = new CoreEventHub();
    const journal = [envelope(1)];
    let injectedAtBoundary = false;
    const replayCursors: number[] = [];
    const source: EventReplaySource = {
      replay(afterSeq) {
        replayCursors.push(afterSeq);
        const boundary = journal.length;
        const events = journal.filter((event) => event.seq > afterSeq && event.seq <= boundary);
        if (!injectedAtBoundary) {
          injectedAtBoundary = true;
          const concurrent = envelope(2);
          journal.push(concurrent);
          hub.publish(concurrent);
        }
        return { events, latestSeq: boundary };
      },
    };

    const response = createCoreEventStreamResponse(source, hub, {
      afterSeq: 0,
      heartbeatIntervalMs: 10_000,
    });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SSE response did not expose a body");
    try {
      const boundaryFrames = await readFrames(reader, 2);
      expect(boundaryFrames.map((frame) => frame.match(/^id: (\d+)/u)?.[1])).toEqual(["1", "2"]);

      // A duplicate/stale notification cannot itself become a frame. The next
      // journal catch-up still discovers the newly committed event.
      hub.publish(envelope(2));
      journal.push(envelope(3));
      hub.publish(envelope(2));
      const liveFrame = await readFrames(reader, 1);
      expect(liveFrame[0]).toMatch(/^id: 3\ndata: /u);
      expect(replayCursors).toEqual([0, 1, 2, 2]);
    } finally {
      await reader.cancel();
    }
    const callsAfterDisconnect = replayCursors.length;
    hub.publish(envelope(3));
    expect(replayCursors).toHaveLength(callsAfterDisconnect);
  });

  it("reconnects from the last applied seq without losing the disconnected suffix", async () => {
    const hub = new CoreEventHub();
    const journal = [envelope(1), envelope(2)];
    const source: EventReplaySource = {
      replay(afterSeq) {
        return {
          events: journal.filter((event) => event.seq > afterSeq),
          latestSeq: journal.length,
        };
      },
    };

    const first = createCoreEventStreamResponse(source, hub, {
      afterSeq: 0,
      heartbeatIntervalMs: 10_000,
    });
    const firstReader = first.body?.getReader();
    if (firstReader === undefined) throw new Error("SSE response did not expose a body");
    expect((await readFrames(firstReader, 1))[0]).toMatch(/^id: 1\ndata: /u);
    await firstReader.cancel();

    const reconnected = createCoreEventStreamResponse(source, hub, {
      afterSeq: 1,
      heartbeatIntervalMs: 10_000,
    });
    const secondReader = reconnected.body?.getReader();
    if (secondReader === undefined) throw new Error("SSE response did not expose a body");
    try {
      expect((await readFrames(secondReader, 1))[0]).toMatch(/^id: 2\ndata: /u);
      journal.push(envelope(3));
      hub.publish(envelope(3));
      expect((await readFrames(secondReader, 1))[0]).toMatch(/^id: 3\ndata: /u);
    } finally {
      await secondReader.cancel();
    }
  });

  it("errors and unsubscribes a live stream when journal catch-up fails", async () => {
    const hub = new CoreEventHub();
    let replayCalls = 0;
    const response = createCoreEventStreamResponse(
      {
        replay(afterSeq) {
          replayCalls += 1;
          if (replayCalls > 1) throw new Error("journal unavailable");
          return { events: [], latestSeq: afterSeq };
        },
      },
      hub,
      { afterSeq: 0, heartbeatIntervalMs: 10_000 },
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SSE response did not expose a body");
    hub.publish(envelope(1));
    await expect(reader.read()).rejects.toThrow("journal unavailable");
    const callsAfterFailure = replayCalls;
    hub.publish(envelope(1));
    expect(replayCalls).toBe(callsAfterFailure);
  });

  it("sends heartbeat comments without advancing the event cursor", async () => {
    const hub = new CoreEventHub();
    const response = createCoreEventStreamResponse(
      {
        replay: (afterSeq) => ({ events: [], latestSeq: afterSeq }),
      },
      hub,
      { afterSeq: 0, heartbeatIntervalMs: 5 },
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SSE response did not expose a body");
    try {
      expect(await readFrames(reader, 1)).toEqual([": heartbeat"]);
    } finally {
      await reader.cancel();
    }
  });
});
