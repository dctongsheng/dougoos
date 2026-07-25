import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { GlobalSnapshotSchema } from "@dougoos/shared";

import { StorageError } from "./errors.js";
import { verifyMigrationHistory } from "./migrations.js";
import { buildGlobalSnapshot } from "./snapshots.js";
import {
  DougoStorage,
  SQLITE_BUSY_TIMEOUT_MS,
  openStorage,
  type CreateTurnInput,
} from "./store.js";
import { createInitializedSession, createTestContext, time } from "./test-utils/helpers.js";

interface ChildResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

type PipeChild = ChildProcessByStdio<null, Readable, Readable>;

const DIST_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "index.js")).href;

function runNode(script: string, args: readonly string[]): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stderr, stdout }));
  });
}

function waitForOutput(child: PipeChild, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.includes(marker)) {
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (status) => {
      if (!output.includes(marker)) {
        reject(new Error(`child exited ${String(status)} before ${marker}`));
      }
    });
  });
}

function waitForExit(child: PipeChild): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

function expectCode(action: () => unknown, code: StorageError["code"]): void {
  try {
    action();
    throw new Error("expected StorageError");
  } catch (error) {
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe(code);
  }
}

function countReceipts(databasePath: string): number {
  const db = new BetterSqlite3(databasePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    return Number(
      (
        db.prepare(`SELECT COUNT(*) AS count FROM event_receipts`).get() as {
          readonly count: number;
        }
      ).count,
    );
  } finally {
    db.close();
  }
}

async function waitForFiles(filePaths: readonly string[], timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!filePaths.every((filePath) => existsSync(filePath))) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${filePaths.join(", ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("real SQLite concurrency", () => {
  it("allows exactly one of two processes to create an active Turn", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dougoos-turn-race-"));
    const databasePath = join(directory, "data.db");
    try {
      const setup = openStorage(databasePath, { clock: () => time(20) });
      createInitializedSession(setup, "session-process-race");
      setup.close();

      const script = `
        const { existsSync, writeFileSync } = await import("node:fs");
        const { openStorage } = await import(process.argv[1]);
        const databasePath = process.argv[2];
        const suffix = process.argv[3];
        let store;
        try {
          store = openStorage(databasePath, {
            clock: () => "2026-07-24T00:00:20.000Z"
          });
          writeFileSync(process.argv[4], "ready");
          while (!existsSync(process.argv[5])) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          }
          const result = store.createTurn({
            occurredAt: "2026-07-24T00:00:20.000Z",
            queuedEventId: "event-process-queued-" + suffix,
            request: {
              clientRequestId: "request-process-" + suffix,
              content: [{ text: "process race " + suffix, type: "text" }]
            },
            sessionId: "session-process-race",
            turnId: "turn-process-" + suffix,
            userMessages: [{
              eventId: "event-process-user-" + suffix,
              messageId: "message-process-" + suffix
            }]
          });
          process.stdout.write(JSON.stringify({ kind: "created", result }) + "\\n");
        } catch (error) {
          process.stdout.write(JSON.stringify({
            code: error?.code ?? "UNKNOWN",
            kind: "error"
          }) + "\\n");
        } finally {
          store?.close();
        }
      `;
      const readyA = join(directory, "ready-a");
      const readyB = join(directory, "ready-b");
      const release = join(directory, "release");
      const childA = runNode(script, [DIST_MODULE_URL, databasePath, "a", readyA, release]);
      const childB = runNode(script, [DIST_MODULE_URL, databasePath, "b", readyB, release]);
      await waitForFiles([readyA, readyB]);
      writeFileSync(release, "go");
      const children = await Promise.all([childA, childB]);
      expect(children.every((child) => child.status === 0)).toBe(true);
      const results = children.map(
        (child) =>
          JSON.parse(child.stdout.trim()) as {
            readonly code?: string;
            readonly kind: string;
          },
      );
      expect(results.filter((result) => result.kind === "created")).toHaveLength(1);
      expect(results.filter((result) => result.code === "SESSION_BUSY")).toHaveLength(1);
      expect(results.some((result) => result.code === "DATABASE_BUSY")).toBe(false);

      const verify = openStorage(databasePath);
      const snapshot = verify.getSessionSnapshot("session-process-race");
      expect(snapshot.turns).toHaveLength(1);
      expect(snapshot.turns[0]?.status).toBe("queued");
      expect(snapshot.messages).toHaveLength(1);
      verify.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("classifies a real lock timeout as DATABASE_BUSY, never SESSION_BUSY", async () => {
    const context = createTestContext();
    const releaseLockPath = join(context.directory, "release-lock");
    let child: PipeChild | undefined;
    try {
      createInitializedSession(context.store, "session-lock-timeout");
      const lockChild = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
              import { existsSync } from "node:fs";
              import Database from "better-sqlite3";
              const db = new Database(process.argv[1]);
              const releaseLockPath = process.argv[2];
              const safetyDeadline = Date.now() + ${SQLITE_BUSY_TIMEOUT_MS * 2};
              try {
                db.exec("BEGIN IMMEDIATE");
                process.stdout.write("locked\\n");
                while (!existsSync(releaseLockPath) && Date.now() < safetyDeadline) {
                  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
                }
                if (!existsSync(releaseLockPath)) {
                  process.stderr.write("timed out waiting for parent to release lock\\n");
                  process.exitCode = 2;
                }
                db.exec("ROLLBACK");
              } finally {
                db.close();
              }
            `,
          context.databasePath,
          releaseLockPath,
        ],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child = lockChild;
      await waitForOutput(lockChild, "locked");
      const startedAt = Date.now();
      try {
        expectCode(
          () =>
            context.store.createTurn({
              occurredAt: time(30),
              queuedEventId: "event-lock-timeout-queued",
              request: {
                clientRequestId: "request-lock-timeout",
                content: [{ text: "blocked", type: "text" }],
              },
              sessionId: "session-lock-timeout",
              turnId: "turn-lock-timeout",
              userMessages: [
                {
                  eventId: "event-lock-timeout-user",
                  messageId: "message-lock-timeout",
                },
              ],
            }),
          "DATABASE_BUSY",
        );
      } finally {
        writeFileSync(releaseLockPath, "release");
      }
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_500);
      expect(await waitForExit(lockChild)).toBe(0);
      expect(context.store.getSessionSnapshot("session-lock-timeout").turns).toEqual([]);
    } finally {
      if (child?.exitCode === null) child.kill();
      context.cleanup();
    }
  }, 20_000);

  it("pins a read transaction across a child commit and observes every later intermediate snapshot", async () => {
    const context = createTestContext();
    let reader: BetterSqlite3.Database | undefined;
    try {
      createInitializedSession(context.store, "session-snapshot-baseline");
      const baseline = context.store.replay(0).latestSeq;
      const writer = runNode(
        `
          const { existsSync, writeFileSync } = await import("node:fs");
          const { join } = await import("node:path");
          const { openStorage } = await import(process.argv[1]);
          const store = openStorage(process.argv[2], {
            clock: () => "2026-07-24T00:01:40.000Z"
          });
          const barrierDirectory = process.argv[3];
          const capabilities = {
            clientProxy: { config: false, fileSystem: false, terminal: false },
            negotiatedAt: "2026-07-24T00:00:01.000Z",
            permissionEnforcement: "requests_permission",
            protocolVersion: "1",
            session: {
              close: false, delete: false, list: false, load: false, resume: false
            },
            turn: { cancel: true, images: false, prompt: true }
          };
          writeFileSync(
            join(barrierDirectory, "snapshot-writer-ready"),
            "ready"
          );
          for (let index = 0; index < 12; index += 1) {
            while (!existsSync(join(barrierDirectory, "snapshot-go-" + index))) {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
            }
            const id = "session-concurrent-snapshot-" + index;
            const initialized = {
              capabilities,
              createdAt: "2026-07-24T00:00:00.000Z",
              cwd: "/temporary/" + id,
              id,
              providerId: "codex",
              providerSessionId: "provider-concurrent-" + index,
              source: "dougoos-acp",
              state: "idle",
              title: "Concurrent " + index,
              updatedAt: "2026-07-24T00:00:01.000Z"
            };
            store.createInitializedSession({
              eventId: "event-concurrent-idle-" + index,
              session: initialized
            });
            writeFileSync(
              join(barrierDirectory, "snapshot-committed-" + index),
              "committed"
            );
          }
          store.close();
        `,
        [DIST_MODULE_URL, context.databasePath, context.directory],
      );
      await waitForFiles([join(context.directory, "snapshot-writer-ready")]);

      reader = new BetterSqlite3(context.databasePath, {
        fileMustExist: true,
        readonly: true,
      });
      reader.exec("BEGIN");
      const pinnedSeq = Number(
        (
          reader.prepare(`SELECT last_seq AS lastSeq FROM journal_state`).get() as {
            readonly lastSeq: number;
          }
        ).lastSeq,
      );
      expect(pinnedSeq).toBe(baseline);
      writeFileSync(join(context.directory, "snapshot-go-0"), "go");
      await waitForFiles([join(context.directory, "snapshot-committed-0")]);
      const pinnedSnapshot = buildGlobalSnapshot(reader, ["session-snapshot-baseline"], pinnedSeq);
      expect(GlobalSnapshotSchema.parse(pinnedSnapshot)).toEqual(pinnedSnapshot);
      expect(pinnedSnapshot.snapshotSeq).toBe(pinnedSeq);
      expect(pinnedSnapshot.sessions).toHaveLength(1);
      reader.exec("ROLLBACK");
      reader.close();
      reader = undefined;

      for (let index = 0; index < 12; index += 1) {
        if (index > 0) {
          writeFileSync(join(context.directory, `snapshot-go-${index}`), "go");
          await waitForFiles([join(context.directory, `snapshot-committed-${index}`)]);
        }
        const snapshot = context.store.getGlobalSnapshot(["session-snapshot-baseline"]);
        expect(snapshot.sessions).toHaveLength(index + 2);
        expect(snapshot.snapshotSeq).toBe(baseline + index + 1);
        expect(
          snapshot.includedSessions.every(
            (included) => Number(included.sessionSnapshotSeq) === Number(snapshot.snapshotSeq),
          ),
        ).toBe(true);
        expect(new Set(snapshot.sessions.map((session) => session.id)).size).toBe(
          snapshot.sessions.length,
        );
      }
      const writerResult = await writer;
      expect(writerResult.status, writerResult.stderr).toBe(0);
      const finalSnapshot = context.store.getGlobalSnapshot(["session-snapshot-baseline"]);
      expect(finalSnapshot.sessions).toHaveLength(13);
      expect(finalSnapshot.snapshotSeq).toBe(baseline + 12);
    } finally {
      if (reader?.open) {
        reader.exec("ROLLBACK");
        reader.close();
      }
      context.cleanup();
    }
  });
});

describe("failure atomicity and WAL durability", () => {
  it.each([
    {
      name: "journal sequence update",
      triggerName: "fail_journal_update",
      sql: `
        CREATE TRIGGER fail_journal_update
        BEFORE UPDATE ON journal_state
        BEGIN
          SELECT RAISE(ABORT, 'injected journal failure');
        END;
      `,
    },
    {
      name: "journal event insert",
      triggerName: "fail_session_event_insert",
      sql: `
        CREATE TRIGGER fail_session_event_insert
        BEFORE INSERT ON session_events
        BEGIN
          SELECT RAISE(ABORT, 'injected event failure');
        END;
      `,
    },
    {
      name: "projected message insert",
      triggerName: "fail_message_insert",
      sql: `
        CREATE TRIGGER fail_message_insert
        BEFORE INSERT ON messages
        BEGIN
          SELECT RAISE(ABORT, 'injected message failure');
        END;
      `,
    },
  ])("rolls back the complete createTurn at the $name stage", (testCase) => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-injected-failure");
      const before = context.store.replay(0);
      const input: CreateTurnInput = {
        occurredAt: time(20),
        queuedEventId: "event-injected-failure-queued",
        request: {
          clientRequestId: "request-injected-failure",
          content: [{ text: "must roll back", type: "text" }],
        },
        sessionId: "session-injected-failure",
        turnId: "turn-injected-failure",
        userMessages: [
          {
            eventId: "event-injected-failure-user",
            messageId: "message-injected-failure",
          },
        ],
      };
      const userMessageIdentity = input.userMessages[0];
      if (userMessageIdentity === undefined) throw new Error("missing user-message identity");
      const raw = new BetterSqlite3(context.databasePath);
      try {
        raw.exec(testCase.sql);
      } finally {
        raw.close();
      }
      expectCode(() => context.store.createTurn(input), "PROJECTION_CONFLICT");
      expect(context.store.replay(0)).toEqual(before);
      expect(countReceipts(context.databasePath)).toBe(before.events.length);
      expect(context.store.getSessionSnapshot("session-injected-failure")).toEqual(
        expect.objectContaining({
          messages: [],
          turns: [],
        }),
      );
      const repair = new BetterSqlite3(context.databasePath);
      try {
        repair.exec(`DROP TRIGGER "${testCase.triggerName}"`);
      } finally {
        repair.close();
      }
      expect(context.store.createTurn(input).created).toBe(true);
      const afterRetry = context.store.replay(0);
      expect(afterRetry.latestSeq).toBe(before.latestSeq + 2);
      const retriedEventIds = new Set<string>([input.queuedEventId, userMessageIdentity.eventId]);
      expect(afterRetry.events.filter((event) => retriedEventIds.has(event.eventId))).toHaveLength(
        2,
      );
      expect(countReceipts(context.databasePath)).toBe(before.events.length + 2);
      expect(context.store.getSessionSnapshot("session-injected-failure")).toEqual(
        expect.objectContaining({
          messages: [expect.objectContaining({ id: userMessageIdentity.messageId })],
          turns: [expect.objectContaining({ id: input.turnId })],
        }),
      );
    } finally {
      context.cleanup();
    }
  });

  it("rolls back an uncommitted transaction after abrupt process exit", () => {
    const directory = mkdtempSync(join(tmpdir(), "dougoos-crash-rollback-"));
    const databasePath = join(directory, "data.db");
    try {
      const setup = openStorage(databasePath, { clock: () => time(20) });
      createInitializedSession(setup, "session-uncommitted-crash");
      const before = setup.replay(0);
      const originalTitle = setup.getSessionSnapshot("session-uncommitted-crash").session.title;
      const retryInput: CreateTurnInput = {
        occurredAt: time(30),
        queuedEventId: "event-crash-retry-queued",
        request: {
          clientRequestId: "request-crash-retry",
          content: [{ text: "retry after process crash", type: "text" }],
        },
        sessionId: "session-uncommitted-crash",
        turnId: "turn-crash-retry",
        userMessages: [
          {
            eventId: "event-crash-retry-user",
            messageId: "message-crash-retry",
          },
        ],
      };
      setup.close();

      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
            import Database from "better-sqlite3";
            const db = new Database(process.argv[1]);
            db.exec("BEGIN IMMEDIATE");
            db.prepare(
              "UPDATE sessions SET title = 'UNCOMMITTED' WHERE id = ?"
            ).run("session-uncommitted-crash");
            db.exec("UPDATE journal_state SET last_seq = last_seq + 1");
            db.prepare(
              \`INSERT INTO event_receipts(
                 event_id, seq, payload_sha256, payload_bytes, received_at
               ) VALUES (?, ?, ?, ?, ?)\`
            ).run(
              "${retryInput.queuedEventId}",
              ${before.latestSeq + 1},
              "0".repeat(64),
              1,
              "2026-07-24T00:00:30.000Z"
            );
            process.exit(0);
          `,
          databasePath,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(child.status, child.stderr).toBe(0);

      const reopened = openStorage(databasePath);
      expect(reopened.replay(0)).toEqual(before);
      expect(reopened.getSessionSnapshot("session-uncommitted-crash").session.title).toBe(
        originalTitle,
      );
      expect(countReceipts(databasePath)).toBe(before.events.length);
      expect(reopened.createTurn(retryInput).created).toBe(true);
      expect(reopened.replay(0).latestSeq).toBe(before.latestSeq + 2);
      expect(countReceipts(databasePath)).toBe(before.events.length + 2);
      reopened.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("maps SQLITE_FULL distinctly and leaves sequence plus read model unchanged", () => {
    const context = createTestContext();
    try {
      createInitializedSession(context.store, "session-database-full");
      const before = context.store.replay(0);
      const input: CreateTurnInput = {
        occurredAt: time(20),
        queuedEventId: "event-database-full-queued",
        request: {
          clientRequestId: "request-database-full",
          content: [{ text: "x".repeat(100_000), type: "text" }],
        },
        sessionId: "session-database-full",
        turnId: "turn-database-full",
        userMessages: [
          {
            eventId: "event-database-full-user",
            messageId: "message-database-full",
          },
        ],
      };
      context.store.close();
      const raw = new BetterSqlite3(context.databasePath);
      raw.pragma("foreign_keys = ON");
      try {
        const pageCount = Number(raw.pragma("page_count", { simple: true }));
        expect(
          Number(
            raw.pragma(`max_page_count = ${pageCount}`, {
              simple: true,
            }),
          ),
        ).toBe(pageCount);
        const constrainedStore = new DougoStorage(raw, verifyMigrationHistory(raw), {
          clock: () => time(100),
        });
        expectCode(() => constrainedStore.createTurn(input), "DATABASE_FULL");
        expect(constrainedStore.replay(0)).toEqual(before);
        expect(constrainedStore.getSessionSnapshot("session-database-full").turns).toEqual([]);
        expect(countReceipts(context.databasePath)).toBe(before.events.length);
        raw.pragma("max_page_count = 4294967294");
        expect(constrainedStore.createTurn(input).created).toBe(true);
        expect(constrainedStore.replay(0).latestSeq).toBe(before.latestSeq + 2);
        expect(countReceipts(context.databasePath)).toBe(before.events.length + 2);
      } finally {
        if (raw.open) raw.close();
      }
    } finally {
      context.cleanup();
    }
  });

  it("reports a pinned reader on TRUNCATE checkpoint, then succeeds without data loss", () => {
    const context = createTestContext();
    let reader: BetterSqlite3.Database | undefined;
    try {
      createInitializedSession(context.store, "session-checkpoint-reader");
      reader = new BetterSqlite3(context.databasePath, {
        fileMustExist: true,
        readonly: true,
      });
      reader.exec("BEGIN");
      reader.prepare("SELECT COUNT(*) FROM session_events").get();

      context.store.createTurn({
        occurredAt: time(20),
        queuedEventId: "event-checkpoint-queued",
        request: {
          clientRequestId: "request-checkpoint",
          content: [{ text: "checkpoint", type: "text" }],
        },
        sessionId: "session-checkpoint-reader",
        turnId: "turn-checkpoint",
        userMessages: [
          {
            eventId: "event-checkpoint-user",
            messageId: "message-checkpoint",
          },
        ],
      });
      expect(context.store.checkpoint("TRUNCATE").busy).toBe(1);
      reader.exec("ROLLBACK");
      reader.close();
      reader = undefined;
      expect(context.store.checkpoint("TRUNCATE")).toEqual(
        expect.objectContaining({ busy: 0, log: 0, mode: "TRUNCATE" }),
      );
      expect(context.store.getSessionSnapshot("session-checkpoint-reader").turns).toHaveLength(1);
    } finally {
      if (reader?.open) {
        reader.exec("ROLLBACK");
        reader.close();
      }
      context.cleanup();
    }
  }, 15_000);
});
