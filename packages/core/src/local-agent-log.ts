import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  redactAgentStderrText,
  type AgentPermissionAuditEntry,
  type AgentStderrLogEntry,
} from "@dougoos/acp";

const DEFAULT_MAX_BYTES = 20 * 1_024 * 1_024;
const DEFAULT_MAX_FILES = 5;

export interface RotatingAgentLogOptions {
  readonly directory: string;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly onError?: (error: unknown) => void;
}

interface RotatingJsonLineLogOptions extends RotatingAgentLogOptions {
  readonly fileName: string;
}

class RotatingJsonLineLog {
  readonly #directory: string;
  readonly #filePath: string;
  readonly #maxBytes: number;
  readonly #maxFiles: number;
  readonly #onError: ((error: unknown) => void) | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: RotatingJsonLineLogOptions) {
    this.#directory = options.directory;
    this.#filePath = join(options.directory, options.fileName);
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.#onError = options.onError;
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1_024) {
      throw new TypeError("maxBytes must be a safe integer of at least 1024");
    }
    if (!Number.isSafeInteger(this.#maxFiles) || this.#maxFiles < 1 || this.#maxFiles > 20) {
      throw new TypeError("maxFiles must be an integer between 1 and 20");
    }
  }

  close(): Promise<void> {
    return this.#queue;
  }

  write(line: string): void {
    void this.#enqueue(line);
  }

  writeDurably(line: string): Promise<void> {
    return this.#enqueue(line);
  }

  #enqueue(line: string): Promise<void> {
    const operation = this.#queue.then(() => this.#append(line));
    this.#queue = operation.catch((error: unknown) => {
      try {
        this.#onError?.(error);
      } catch {
        // A diagnostics observer must never destabilize the Core process.
      }
    });
    return operation;
  }

  async #append(line: string): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const currentSize = await stat(this.#filePath).then(
      (value) => value.size,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return 0;
        throw error;
      },
    );
    const lineBytes = Buffer.byteLength(line);
    if (currentSize > 0 && currentSize + lineBytes > this.#maxBytes) {
      await this.#rotate();
    }
    await appendFile(this.#filePath, line, { encoding: "utf8", mode: 0o600 });
  }

  async #rotate(): Promise<void> {
    if (this.#maxFiles === 1) {
      await rm(this.#filePath, { force: true });
      return;
    }
    for (let index = this.#maxFiles - 1; index >= 1; index -= 1) {
      const source = index === 1 ? this.#filePath : `${this.#filePath}.${String(index - 1)}`;
      const target = `${this.#filePath}.${String(index)}`;
      await rm(target, { force: true });
      await rename(source, target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

export class RotatingAgentLog {
  readonly #log: RotatingJsonLineLog;

  constructor(options: RotatingAgentLogOptions) {
    this.#log = new RotatingJsonLineLog({ ...options, fileName: "agent-stderr.log" });
  }

  close(): Promise<void> {
    return this.#log.close();
  }

  write(entry: AgentStderrLogEntry): void {
    const text = redactAgentStderrText(entry.text);
    if (text.length === 0) return;
    this.#log.write(`${JSON.stringify({ ...entry, text })}\n`);
  }
}

export class RotatingPermissionAuditLog {
  readonly #log: RotatingJsonLineLog;

  constructor(options: RotatingAgentLogOptions) {
    this.#log = new RotatingJsonLineLog({ ...options, fileName: "permission-audit.log" });
  }

  close(): Promise<void> {
    return this.#log.close();
  }

  write(entry: AgentPermissionAuditEntry): Promise<void> {
    return this.#log.writeDurably(`${JSON.stringify(entry)}\n`);
  }
}
