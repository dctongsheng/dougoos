import { AgentEventEnvelopeSchema, type AgentEventEnvelope } from "@dougoos/shared";

export type CoreEventListener = (event: AgentEventEnvelope) => void;

export class CoreEventHub {
  readonly #listeners = new Set<CoreEventListener>();

  publish(event: AgentEventEnvelope): void {
    const parsed = AgentEventEnvelopeSchema.parse(event);
    for (const listener of this.#listeners) {
      try {
        listener(parsed);
      } catch {
        // A fan-out consumer cannot roll back the committed journal write or
        // prevent delivery to the other consumers.
      }
    }
  }

  publishAll(events: readonly AgentEventEnvelope[]): void {
    for (const event of events) this.publish(event);
  }

  subscribe(listener: CoreEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
