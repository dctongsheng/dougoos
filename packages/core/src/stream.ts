import type { AgentEventEnvelope } from "@dougoos/shared";

import type { CoreEventHub } from "./event-hub.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const SSE_HEADERS = {
  "cache-control": "no-cache, no-store",
  connection: "keep-alive",
  "content-type": "text/event-stream; charset=utf-8",
  "x-accel-buffering": "no",
} as const;

export interface EventReplaySource {
  replay(
    afterSeq: number,
    sessionId?: string,
  ): {
    readonly events: readonly AgentEventEnvelope[];
    readonly latestSeq: number;
  };
}

export interface CoreEventStreamOptions {
  readonly afterSeq: number;
  readonly heartbeatIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
}

function eventFrame(event: AgentEventEnvelope): Uint8Array {
  return new TextEncoder().encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
}

function heartbeatFrame(): Uint8Array {
  return new TextEncoder().encode(": heartbeat\n\n");
}

/**
 * Subscribe before reading the journal watermark, then use the journal as the
 * source of truth for both the initial replay and every live wake-up. This
 * closes the replay/live window and also prevents an uncommitted or duplicate
 * fan-out notification from becoming an SSE frame.
 */
export function createCoreEventStreamResponse(
  source: EventReplaySource,
  hub: CoreEventHub,
  options: CoreEventStreamOptions,
): Response {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  if (
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 1 ||
    heartbeatIntervalMs > 60_000
  ) {
    throw new TypeError("heartbeat interval must be an integer between 1 and 60000ms");
  }

  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let scanCursor: number | undefined;
  let pendingWakeup = false;
  let catchingUp = false;
  let unsubscribe = (): void => undefined;

  function cleanup(): void {
    if (closed) return;
    closed = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    unsubscribe();
    options.signal?.removeEventListener("abort", abort);
  }

  function abort(): void {
    if (closed) return;
    try {
      controller?.close();
    } finally {
      cleanup();
    }
  }

  const fail = (error: unknown): void => {
    if (closed) return;
    try {
      controller?.error(error);
    } finally {
      cleanup();
    }
  };

  const emit = (events: readonly AgentEventEnvelope[]): void => {
    if (closed || controller === undefined) return;
    for (const event of events) controller.enqueue(eventFrame(event));
  };

  const catchUp = (): void => {
    if (closed || scanCursor === undefined) {
      pendingWakeup = true;
      return;
    }
    if (catchingUp) {
      pendingWakeup = true;
      return;
    }
    catchingUp = true;
    try {
      do {
        pendingWakeup = false;
        const replay = source.replay(scanCursor, options.sessionId);
        scanCursor = replay.latestSeq;
        emit(replay.events);
      } while (pendingWakeup);
    } catch (error) {
      fail(error);
    } finally {
      catchingUp = false;
    }
  };

  unsubscribe = hub.subscribe(() => {
    catchUp();
  });

  let initial: ReturnType<EventReplaySource["replay"]>;
  try {
    initial = source.replay(options.afterSeq, options.sessionId);
    scanCursor = initial.latestSeq;
  } catch (error) {
    unsubscribe();
    throw error;
  }

  const readable = new ReadableStream<Uint8Array>({
    cancel() {
      cleanup();
    },
    start(streamController) {
      controller = streamController;
      emit(initial.events);
      if (pendingWakeup) catchUp();
      if (!closed) {
        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            streamController.enqueue(heartbeatFrame());
          } catch (error) {
            fail(error);
          }
        }, heartbeatIntervalMs);
      }
    },
  });

  if (options.signal?.aborted === true) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  return new Response(readable, { headers: SSE_HEADERS });
}
