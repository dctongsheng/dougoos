import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SessionSchema,
  AgentRuntimeEventSchema,
  type ActiveTurnStatus,
  type AgentRuntimeEvent,
  type ProviderCapabilitySnapshot,
  type Session,
} from "@dougoos/shared";

import {
  openStorage,
  type CreateTurnResult,
  type DougoStorage,
  type StorageOpenOptions,
} from "../store.js";

export const BASE_TIME = "2026-07-24T00:00:00.000Z";

export function time(second: number): string {
  return new Date(Date.parse(BASE_TIME) + second * 1_000).toISOString();
}

export const TEST_CAPABILITIES: ProviderCapabilitySnapshot = {
  clientProxy: { config: false, fileSystem: false, terminal: false },
  negotiatedAt: time(1),
  permissionEnforcement: "requests_permission",
  protocolVersion: "1",
  session: { close: false, delete: false, list: false, load: false, resume: false },
  turn: { cancel: true, images: false, prompt: true },
};

export interface TestContext {
  readonly databasePath: string;
  readonly directory: string;
  readonly store: DougoStorage;
  cleanup(): void;
}

export function createTestContext(options: StorageOpenOptions = {}): TestContext {
  const directory = mkdtempSync(join(tmpdir(), "dougoos-storage-test-"));
  const databasePath = join(directory, "data.db");
  const store = openStorage(databasePath, {
    clock: options.clock ?? (() => time(100)),
    ...(options.eventIdFactory === undefined ? {} : { eventIdFactory: options.eventIdFactory }),
    ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
  });
  return {
    cleanup() {
      store.close();
      rmSync(directory, { force: true, recursive: true });
    },
    databasePath,
    directory,
    store,
  };
}

export function startingSession(sessionId: string): Session {
  return SessionSchema.parse({
    capabilities: null,
    createdAt: time(0),
    cwd: `/temporary/${sessionId}`,
    id: sessionId,
    providerId: "codex",
    providerSessionId: null,
    source: "dougoos-acp",
    state: "starting",
    title: `Session ${sessionId}`,
    updatedAt: time(0),
  });
}

export function createInitializedSession(store: DougoStorage, sessionId: string): Session {
  const starting = startingSession(sessionId);
  const initialized = SessionSchema.parse({
    ...starting,
    capabilities: TEST_CAPABILITIES,
    providerSessionId: `provider-${sessionId}`,
    state: "idle",
    updatedAt: time(1),
  });
  store.createInitializedSession({
    eventId: `event-${sessionId}-idle`,
    session: initialized,
  });
  return initialized;
}

export function createQueuedTurn(
  store: DougoStorage,
  sessionId: string,
  suffix: string,
  second = 2,
): CreateTurnResult {
  return store.createTurn({
    occurredAt: time(second),
    queuedEventId: `event-queued-${suffix}`,
    request: {
      clientRequestId: `request-${suffix}`,
      content: [{ text: `prompt-${suffix}`, type: "text" }],
    },
    sessionId,
    turnId: `turn-${suffix}`,
    userMessages: [
      {
        eventId: `event-user-${suffix}`,
        messageId: `message-user-${suffix}`,
      },
    ],
  });
}

export function appendTurnState(
  store: DougoStorage,
  sessionId: string,
  turnId: string,
  from: ActiveTurnStatus,
  status: ActiveTurnStatus,
  second: number,
): void {
  store.appendAndProject({
    eventId: `event-${turnId}-${status}-${second}`,
    runtimeEvent: AgentRuntimeEventSchema.parse({
      event: { from, status, type: "turn_state" },
      occurredAt: time(second),
      sessionId,
      turnId,
    }),
  });
}

export function makeRuntimeEvent(
  sessionId: string,
  turnId: string | null,
  second: number,
  event: unknown,
): AgentRuntimeEvent {
  return AgentRuntimeEventSchema.parse({
    event,
    occurredAt: time(second),
    sessionId,
    turnId,
  });
}

export function createRunningTurn(store: DougoStorage, sessionId: string, suffix: string): string {
  const turnId = createQueuedTurn(store, sessionId, suffix).turnId;
  appendTurnState(store, sessionId, turnId, "queued", "starting", 3);
  appendTurnState(store, sessionId, turnId, "starting", "running", 4);
  return turnId;
}
