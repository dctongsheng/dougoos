import { generateBearerToken } from "@dougoos/core";

import { isCoreWorkerEvent, type CoreConnection, type CoreWorkerCommand } from "./contracts.js";

export interface UtilityProcessLike {
  readonly pid: number | undefined;
  kill(): boolean;
  off(event: "exit", listener: (code: number) => void): this;
  off(event: "message", listener: (message: unknown) => void): this;
  off(event: "spawn", listener: () => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "spawn", listener: () => void): this;
  postMessage(message: CoreWorkerCommand): void;
}

export interface CoreProcessManagerOptions {
  readonly appVersion: string;
  readonly databasePath: string;
  readonly handshakeTimeoutMs?: number;
  readonly random?: () => number;
  readonly restartBaseDelayMs?: number;
  readonly restartMaxDelayMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly spawn: () => UtilityProcessLike;
  readonly tokenFactory?: () => string;
}

type ConnectionListener = (connection: CoreConnection) => void;

export class CoreProcessManager {
  readonly #appVersion: string;
  readonly #databasePath: string;
  readonly #handshakeTimeoutMs: number;
  readonly #listeners = new Set<ConnectionListener>();
  readonly #random: () => number;
  readonly #restartBaseDelayMs: number;
  readonly #restartMaxDelayMs: number;
  readonly #shutdownTimeoutMs: number;
  readonly #spawn: () => UtilityProcessLike;
  readonly #tokenFactory: () => string;

  #connection: CoreConnection | null = null;
  #generation = 0;
  #lastPort: number | undefined;
  #process: UtilityProcessLike | null = null;
  #restartAttempt = 0;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #startPromise: Promise<CoreConnection> | null = null;
  #stopping = false;

  constructor(options: CoreProcessManagerOptions) {
    this.#appVersion = options.appVersion;
    this.#databasePath = options.databasePath;
    // Core readiness includes bounded, parallel doctor checks for every
    // installed Provider. Eight local CLIs can legitimately need more than
    // twenty seconds on a cold launch even though each individual probe is
    // bounded.
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 60_000;
    this.#random = options.random ?? Math.random;
    this.#restartBaseDelayMs = options.restartBaseDelayMs ?? 250;
    this.#restartMaxDelayMs = options.restartMaxDelayMs ?? 10_000;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? 3_000;
    this.#spawn = options.spawn;
    this.#tokenFactory = options.tokenFactory ?? generateBearerToken;
  }

  get connection(): CoreConnection | null {
    return this.#connection;
  }

  get processId(): number | undefined {
    return this.#process?.pid;
  }

  onConnection(listener: ConnectionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): Promise<CoreConnection> {
    if (this.#connection !== null) return Promise.resolve(this.#connection);
    this.#stopping = false;
    this.#startPromise ??= this.#launch();
    return this.#startPromise;
  }

  async restart(): Promise<CoreConnection> {
    this.#stopping = false;
    this.#cancelScheduledRestart();
    const active = this.#process;
    this.#connection = null;
    this.#startPromise = null;
    this.#process = null;
    this.#generation += 1;
    if (active !== null) await this.#stopProcess(active);
    this.#restartAttempt = 0;
    this.#startPromise = this.#launch();
    return this.#startPromise;
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#cancelScheduledRestart();
    const active = this.#process;
    this.#connection = null;
    this.#startPromise = null;
    this.#process = null;
    this.#generation += 1;
    if (active !== null) await this.#stopProcess(active);
  }

  killForTest(): void {
    if (this.#process === null || !this.#process.kill()) {
      throw new Error("Core utility process is not running");
    }
  }

  async #launch(): Promise<CoreConnection> {
    const generation = ++this.#generation;
    const previousPort = this.#lastPort;
    const token = this.#tokenFactory();
    const process = this.#spawn();
    this.#process = process;

    const ready = new Promise<CoreConnection>((resolve, reject) => {
      let sentStart = false;
      const cleanup = (): void => {
        process.off("spawn", onSpawn);
        process.off("message", onMessage);
        process.off("exit", onExitBeforeReady);
      };
      const onSpawn = (): void => {
        if (sentStart) return;
        sentStart = true;
        process.postMessage({
          appVersion: this.#appVersion,
          databasePath: this.#databasePath,
          ...(previousPort === undefined ? {} : { previousPort }),
          token,
          type: "core.start",
        });
      };
      const onMessage = (message: unknown): void => {
        if (!isCoreWorkerEvent(message)) return;
        if (message.type === "core.failed") {
          cleanup();
          reject(new Error(message.message));
          return;
        }
        if (message.type !== "core.ready") return;
        if (previousPort !== undefined && message.port === previousPort) {
          cleanup();
          reject(new Error("Core reused the previous port"));
          return;
        }
        cleanup();
        resolve({ instanceId: message.instanceId, port: message.port, token });
      };
      const onExitBeforeReady = (code: number): void => {
        cleanup();
        reject(new Error(`Core exited before ready with code ${String(code)}`));
      };
      process.on("spawn", onSpawn);
      process.on("message", onMessage);
      process.on("exit", onExitBeforeReady);
    });

    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const handshakeTimeout = new Promise<never>((_, reject) => {
        handshakeTimer = setTimeout(
          () => reject(new Error("Core ready handshake timed out")),
          this.#handshakeTimeoutMs,
        );
      });
      const connection = await Promise.race([ready, handshakeTimeout]);
      if (this.#stopping || generation !== this.#generation) {
        await this.#stopProcess(process);
        throw new Error("Core start was superseded");
      }
      this.#connection = connection;
      this.#lastPort = connection.port;
      this.#startPromise = null;
      this.#restartAttempt = 0;
      process.on("exit", () => this.#handleExit(generation, process));
      for (const listener of this.#listeners) listener(connection);
      return connection;
    } catch (error) {
      if (this.#process === process) this.#process = null;
      process.kill();
      this.#startPromise = null;
      throw error;
    } finally {
      if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
    }
  }

  #handleExit(generation: number, process: UtilityProcessLike): void {
    if (generation !== this.#generation || process !== this.#process) return;
    this.#process = null;
    this.#connection = null;
    this.#startPromise = null;
    if (this.#stopping) return;
    this.#scheduleRestart();
  }

  #scheduleRestart(): void {
    if (this.#restartTimer !== null || this.#stopping) return;
    const exponential = Math.min(
      this.#restartMaxDelayMs,
      this.#restartBaseDelayMs * 2 ** this.#restartAttempt,
    );
    this.#restartAttempt += 1;
    const jittered = Math.max(0, Math.round(exponential * (0.8 + this.#random() * 0.4)));
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#stopping) return;
      this.#startPromise = this.#launch();
      void this.#startPromise.catch(() => {
        this.#startPromise = null;
        this.#scheduleRestart();
      });
    }, jittered);
  }

  #cancelScheduledRestart(): void {
    if (this.#restartTimer === null) return;
    clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
  }

  #stopProcess(process: UtilityProcessLike): Promise<void> {
    if (process.pid === undefined) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        process.off("exit", onExit);
        resolve();
      };
      const onExit = (): void => finish();
      process.on("exit", onExit);
      process.postMessage({ type: "core.shutdown" });
      const timer = setTimeout(() => {
        process.kill();
        finish();
      }, this.#shutdownTimeoutMs);
    });
  }
}
