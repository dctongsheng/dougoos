import { dirname, join } from "node:path";

import {
  createAcpCoreRegistry,
  startCore,
  type CoreRegistry,
  type CoreServer,
} from "@dougoos/core";

import type { CoreWorkerCommand, CoreWorkerEvent } from "./contracts.js";
import { FakeRegistry } from "./fake-registry.js";

const parentPort = process.parentPort;
let server: CoreServer | null = null;
let closing = false;

function createRegistry(doctorCwd: string): CoreRegistry {
  return process.env.DOUGOOS_TEST_FAKE_PROVIDER === "1"
    ? new FakeRegistry()
    : createAcpCoreRegistry({
        doctorCwd,
        localLogDirectory: join(doctorCwd, "logs"),
      });
}

function post(event: CoreWorkerEvent): void {
  parentPort.postMessage(event);
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Core failed to start";
  return message.replaceAll(/[\r\n\t]/gu, " ").slice(0, 512) || "Core failed to start";
}

async function closeAndExit(exitCode: number): Promise<never> {
  if (closing) await new Promise<never>(() => undefined);
  closing = true;
  if (server !== null) {
    const active = server;
    server = null;
    await active.close().catch(() => undefined);
  }
  post({ type: "core.stopped" });
  process.exit(exitCode);
}

async function start(command: Extract<CoreWorkerCommand, { type: "core.start" }>): Promise<void> {
  if (server !== null || closing) return;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = await startCore({
        appVersion: command.appVersion,
        bearerToken: command.token,
        databasePath: command.databasePath,
        defaultConversationDirectory: command.defaultConversationDirectory,
        registry: createRegistry(dirname(command.databasePath)),
      });
      await candidate.ready;
      if (command.previousPort === undefined || candidate.port !== command.previousPort) {
        server = candidate;
        post({
          instanceId: candidate.instanceId,
          port: candidate.port,
          type: "core.ready",
        });
        return;
      }
      await candidate.close();
    }
    throw new Error("Core could not allocate a new port");
  } catch (error) {
    post({
      code: "CORE_START_FAILED",
      message: safeMessage(error),
      type: "core.failed",
    });
    await closeAndExit(1);
  }
}

parentPort.on("message", (event) => {
  const command = event.data as CoreWorkerCommand;
  if (command.type === "core.start") {
    void start(command);
  } else if (command.type === "core.shutdown") {
    void closeAndExit(0);
  }
});

process.once("SIGINT", () => void closeAndExit(0));
process.once("SIGTERM", () => void closeAndExit(0));
process.once("uncaughtException", (error) => {
  post({ code: "CORE_START_FAILED", message: safeMessage(error), type: "core.failed" });
  void closeAndExit(1);
});
process.once("unhandledRejection", (error) => {
  post({ code: "CORE_START_FAILED", message: safeMessage(error), type: "core.failed" });
  void closeAndExit(1);
});
