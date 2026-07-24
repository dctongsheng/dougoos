import type { AgentRuntimeEvent } from "@dougoos/shared";

import type {
  BeforePromptVerdict,
  PermissionContext,
  PermissionVerdict,
  PromptContext,
  SessionInterceptor,
} from "./types.js";

const DEFAULT_INTERCEPTOR_TIMEOUT_MS = 2_000;
const DEFAULT_OBSERVER_QUEUE_LIMIT = 256;

export interface InterceptorChainOptions {
  readonly observerQueueLimit?: number;
  readonly onObserverError?: (error: unknown) => void;
  readonly timeoutMs?: number;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("interceptor timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Blocking interceptors are deterministic and fail closed. Observer hooks run
 * through a bounded asynchronous queue and can never delay event publication.
 */
export class InterceptorChain {
  readonly #interceptors: readonly SessionInterceptor[];
  readonly #observerQueueLimit: number;
  readonly #onObserverError: (error: unknown) => void;
  readonly #timeoutMs: number;

  #observerQueue: AgentRuntimeEvent[] = [];
  #observerRunning = false;

  constructor(
    interceptors: readonly SessionInterceptor[] = [],
    options: InterceptorChainOptions = {},
  ) {
    this.#interceptors = [...interceptors];
    this.#observerQueueLimit = options.observerQueueLimit ?? DEFAULT_OBSERVER_QUEUE_LIMIT;
    this.#onObserverError = options.onObserverError ?? (() => undefined);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_INTERCEPTOR_TIMEOUT_MS;
    if (this.#observerQueueLimit < 1) throw new Error("observerQueueLimit must be positive");
    if (this.#timeoutMs < 1) throw new Error("timeoutMs must be positive");
  }

  async beforePrompt(context: PromptContext): Promise<BeforePromptVerdict> {
    for (const interceptor of this.#interceptors) {
      if (interceptor.beforePrompt === undefined) continue;
      try {
        const verdict = await withTimeout(interceptor.beforePrompt(context), this.#timeoutMs);
        if (verdict === "reject") return "reject";
      } catch {
        return "reject";
      }
    }
    return "allow";
  }

  async onPermissionRequest(context: PermissionContext): Promise<PermissionVerdict> {
    for (const interceptor of this.#interceptors) {
      if (interceptor.onPermissionRequest === undefined) continue;
      try {
        const verdict = await withTimeout(
          interceptor.onPermissionRequest(context),
          this.#timeoutMs,
        );
        if (verdict === "reject") return "reject";
      } catch {
        return "reject";
      }
    }
    return "ask";
  }

  observe(event: AgentRuntimeEvent): void {
    if (!this.#interceptors.some((interceptor) => interceptor.afterEvent !== undefined)) return;
    if (this.#observerQueue.length >= this.#observerQueueLimit) {
      this.#onObserverError(new Error("interceptor observer queue is full"));
      return;
    }
    this.#observerQueue.push(event);
    if (!this.#observerRunning) void this.#drainObservers();
  }

  async #drainObservers(): Promise<void> {
    this.#observerRunning = true;
    try {
      for (;;) {
        const event = this.#observerQueue.shift();
        if (event === undefined) return;
        for (const interceptor of this.#interceptors) {
          if (interceptor.afterEvent === undefined) continue;
          try {
            await interceptor.afterEvent(event);
          } catch (error) {
            this.#onObserverError(error);
          }
        }
      }
    } finally {
      this.#observerRunning = false;
      if (this.#observerQueue.length > 0) void this.#drainObservers();
    }
  }
}
