import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import type { CoreWorkerCommand } from "./contracts.js";
import {
  CoreProcessManager,
  type CoreProcessManagerOptions,
  type UtilityProcessLike,
} from "./core-process.js";

class FakeUtilityProcess extends EventEmitter implements UtilityProcessLike {
  static nextPid = 100;
  readonly commands: CoreWorkerCommand[] = [];
  readonly instanceId: string;
  readonly port: number;
  pid: number | undefined;

  constructor(index: number) {
    super();
    this.instanceId = `instance-${String(index)}`;
    this.pid = FakeUtilityProcess.nextPid++;
    this.port = 40_000 + index;
    setTimeout(() => this.emit("spawn"), 0);
  }

  kill(): boolean {
    if (this.pid === undefined) return false;
    this.pid = undefined;
    this.emit("exit", 9);
    return true;
  }

  postMessage(command: CoreWorkerCommand): void {
    this.commands.push(command);
    if (command.type === "core.shutdown") {
      setTimeout(() => {
        this.pid = undefined;
        this.emit("exit", 0);
      }, 0);
      return;
    }
    setTimeout(() => {
      this.emit("message", {
        instanceId: this.instanceId,
        port: this.port,
        type: "core.ready",
      });
    }, 0);
  }
}

function setup(overrides: Partial<CoreProcessManagerOptions> = {}): {
  manager: CoreProcessManager;
  processes: FakeUtilityProcess[];
} {
  const processes: FakeUtilityProcess[] = [];
  const manager = new CoreProcessManager({
    appVersion: "test",
    databasePath: "/tmp/test.sqlite",
    defaultConversationDirectory: "/tmp/Documents/Dogoos",
    handshakeTimeoutMs: 500,
    random: () => 0.5,
    restartBaseDelayMs: 1,
    restartMaxDelayMs: 2,
    shutdownTimeoutMs: 20,
    spawn: () => {
      const process = new FakeUtilityProcess(processes.length + 1);
      processes.push(process);
      return process;
    },
    tokenFactory: () => `token-${String(processes.length)}`,
    ...overrides,
  });
  return { manager, processes };
}

describe("CoreProcessManager", () => {
  it("waits for ready and sends the token over the parent channel", async () => {
    const { manager, processes } = setup();
    const connection = await manager.start();

    expect(connection).toEqual({
      instanceId: "instance-1",
      port: 40_001,
      token: "token-0",
    });
    expect(processes[0]?.commands).toEqual([
      {
        appVersion: "test",
        databasePath: "/tmp/test.sqlite",
        defaultConversationDirectory: "/tmp/Documents/Dogoos",
        token: "token-0",
        type: "core.start",
      },
    ]);
    await manager.stop();
  });

  it("rotates the full connection tuple on an explicit restart", async () => {
    const { manager } = setup();
    const first = await manager.start();
    const second = await manager.restart();

    expect(second.instanceId).not.toBe(first.instanceId);
    expect(second.port).not.toBe(first.port);
    expect(second.token).not.toBe(first.token);
    await manager.stop();
  });

  it("uses exponential recovery after an unexpected exit", async () => {
    const { manager, processes } = setup();
    const connections: string[] = [];
    manager.onConnection((connection) => connections.push(connection.instanceId));
    await manager.start();
    processes[0]?.kill();

    await expect.poll(() => manager.connection?.instanceId, { timeout: 500 }).toBe("instance-2");
    expect(connections).toEqual(["instance-1", "instance-2"]);
    await manager.stop();
  });

  it("does not restart after shutdown", async () => {
    const { manager, processes } = setup();
    await manager.start();
    await manager.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(processes).toHaveLength(1);
    expect(manager.connection).toBeNull();
  });
});
