import { CONTRACT_LIMITS, type AgentUiEvent } from "@dougoos/shared";

const MAX_DELTA_WINDOW_MS = 50;

type DeltaEvent = Extract<AgentUiEvent, { type: "message_delta" | "thought_delta" }>;

interface PendingDelta {
  readonly messageId: DeltaEvent["messageId"];
  readonly type: DeltaEvent["type"];
  text: string;
  timer: ReturnType<typeof setTimeout>;
}

export class DeltaCoalescer {
  readonly #emit: (event: DeltaEvent) => void;
  readonly #windowMs: number;
  readonly #pending = new Map<string, PendingDelta>();

  constructor(emit: (event: DeltaEvent) => void, windowMs = MAX_DELTA_WINDOW_MS) {
    if (windowMs < 0 || windowMs > MAX_DELTA_WINDOW_MS) {
      throw new Error(`delta window must be between 0 and ${String(MAX_DELTA_WINDOW_MS)}ms`);
    }
    this.#emit = emit;
    this.#windowMs = windowMs;
  }

  add(event: DeltaEvent): void {
    const key = `${event.type}:${event.messageId}`;
    const pending = this.#pending.get(key);
    if (pending !== undefined) {
      if (pending.text.length + event.text.length > CONTRACT_LIMITS.messageBodyChars) {
        this.#flush(key);
        this.add(event);
        return;
      }
      pending.text += event.text;
      return;
    }
    const next: PendingDelta = {
      messageId: event.messageId,
      text: event.text,
      timer: setTimeout(() => this.#flush(key), this.#windowMs),
      type: event.type,
    };
    this.#pending.set(key, next);
  }

  flushAll(): void {
    for (const key of [...this.#pending.keys()]) this.#flush(key);
  }

  #flush(key: string): void {
    const pending = this.#pending.get(key);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.#pending.delete(key);
    this.#emit({
      messageId: pending.messageId,
      text: pending.text,
      type: pending.type,
    });
  }
}
