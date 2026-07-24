import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { StorageError } from "./errors.js";
import { inspectDatabase } from "./inspect.js";
import { DEFAULT_MIGRATIONS, type Migration } from "./migrations.js";
import { openStorage } from "./store.js";
import {
  createInitializedSession,
  createQueuedTurn,
  createTestContext,
  time,
} from "./test-utils/helpers.js";

const FIRST_DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_DEVICE_ID = "22222222-2222-4222-8222-222222222222";

function expectCode(action: () => unknown, code: StorageError["code"]): void {
  try {
    action();
    throw new Error("expected StorageError");
  } catch (error) {
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe(code);
  }
}

function temporaryPath(prefix: string): {
  readonly databasePath: string;
  readonly directory: string;
} {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return { databasePath: join(directory, "private-agent-state.db"), directory };
}

function directoryHashes(directory: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(join(directory, name)))
          .digest("hex"),
      ]),
  );
}

describe("pseudonymous device and provider storage", () => {
  it("persists one pseudonymous identity, resets it, and survives reopen", () => {
    const { databasePath, directory } = temporaryPath("dougoos-device-persistence-");
    try {
      const firstStore = openStorage(databasePath, { clock: () => time(10) });
      const first = firstStore.getOrCreateDeviceIdentity("1.0.0", () => FIRST_DEVICE_ID);
      expect(first).toEqual({
        classification: "pseudonymous",
        deviceId: FIRST_DEVICE_ID,
        resettable: true,
      });
      expect(firstStore.getOrCreateDeviceIdentity("ignored", () => SECOND_DEVICE_ID)).toEqual(
        first,
      );
      const reset = firstStore.resetDeviceIdentity("1.0.1", () => SECOND_DEVICE_ID);
      expect(reset.deviceId).toBe(SECOND_DEVICE_ID);
      firstStore.close();

      const reopened = openStorage(databasePath);
      expect(reopened.getOrCreateDeviceIdentity("ignored", () => FIRST_DEVICE_ID)).toEqual(reset);
      reopened.close();

      const raw = new BetterSqlite3(databasePath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        expect(
          raw
            .prepare(
              `SELECT device_id AS deviceId, app_version AS appVersion
               FROM devices`,
            )
            .all(),
        ).toEqual([{ appVersion: "1.0.1", deviceId: SECOND_DEVICE_ID }]);
      } finally {
        raw.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps reset failure atomic on both a fresh and existing database", () => {
    const context = createTestContext();
    try {
      expectCode(
        () => context.store.resetDeviceIdentity("1.0.0", () => "not-a-uuid"),
        "DEVICE_RESET_FAILED",
      );
      let raw = new BetterSqlite3(context.databasePath);
      try {
        expect(raw.prepare(`SELECT COUNT(*) AS count FROM devices`).get()).toEqual({ count: 0 });
      } finally {
        raw.close();
      }

      context.store.getOrCreateDeviceIdentity("1.0.0", () => FIRST_DEVICE_ID);
      expectCode(
        () => context.store.resetDeviceIdentity("1.0.1", () => FIRST_DEVICE_ID),
        "DEVICE_RESET_FAILED",
      );
      raw = new BetterSqlite3(context.databasePath);
      try {
        raw.exec(`
          CREATE TRIGGER reject_device_insert
          BEFORE INSERT ON devices
          BEGIN
            SELECT RAISE(ABORT, 'injected device reset failure');
          END;
        `);
      } finally {
        raw.close();
      }
      expectCode(
        () => context.store.resetDeviceIdentity("1.0.1", () => SECOND_DEVICE_ID),
        "DEVICE_RESET_FAILED",
      );
      raw = new BetterSqlite3(context.databasePath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        expect(raw.prepare(`SELECT device_id AS deviceId FROM devices`).all()).toEqual([
          { deviceId: FIRST_DEVICE_ID },
        ]);
      } finally {
        raw.close();
      }
    } finally {
      context.cleanup();
    }
  });

  it("round-trips only shared-schema Provider status values", () => {
    const context = createTestContext();
    try {
      const provider = {
        capabilities: null,
        checkedAt: time(20),
        displayName: "Codex",
        id: "codex",
        processPolicy: {
          maxSessionsPerProcess: 1,
          multiSessionPerProcess: false,
        },
        reason: "not signed in",
        remediation: "sign in locally",
        status: "unauthenticated",
        version: "1.2.3",
      } as const;
      expect(context.store.upsertProviderStatus(provider)).toEqual(provider);
      expect(context.store.listProviderStatuses()).toEqual([provider]);
      expectCode(
        () =>
          context.store.upsertProviderStatus({
            ...provider,
            status: "available",
          }),
        "VALIDATION_FAILED",
      );
    } finally {
      context.cleanup();
    }
  });
});

describe("safe database inspector", () => {
  it("reports only aggregate metadata and leaves a closed source byte-for-byte unchanged", () => {
    const context = createTestContext();
    const privateToken = "sk-private-never-print-this";
    try {
      createInitializedSession(context.store, "session-private-inspect");
      createQueuedTurn(context.store, "session-private-inspect", privateToken);
      context.store.getOrCreateDeviceIdentity("private-app", () => FIRST_DEVICE_ID);
      context.store.close();
      const before = directoryHashes(context.directory);

      const inspection = inspectDatabase(context.databasePath);
      expect(inspection.integrity).toBe("ok");
      expect(inspection.counts).toEqual(
        expect.objectContaining({
          devices: 1,
          messages: 1,
          sessions: 1,
          turns: 1,
        }),
      );
      expect(directoryHashes(context.directory)).toEqual(before);
      const output = JSON.stringify(inspection);
      for (const secret of [
        context.databasePath,
        "private-agent-state.db",
        "/temporary/session-private-inspect",
        "Session session-private-inspect",
        FIRST_DEVICE_ID,
        privateToken,
      ]) {
        expect(output).not.toContain(secret);
      }
    } finally {
      context.cleanup();
    }
  });

  it("accepts owned additive history safely and exact-manifest checks remain strict", () => {
    const { databasePath, directory } = temporaryPath("dougoos-inspect-module-");
    const manifest: readonly Migration[] = [
      ...DEFAULT_MIGRATIONS,
      {
        id: "harness-demo:0001",
        sql: "CREATE TABLE harness_demo(id TEXT PRIMARY KEY) STRICT;",
      },
    ];
    try {
      openStorage(databasePath, { migrations: manifest }).close();
      expect(inspectDatabase(databasePath).migrations.map((migration) => migration.id)).toEqual([
        "storage:0001",
        "harness-demo:0001",
      ]);
      expect(inspectDatabase(databasePath, manifest).migrations).toHaveLength(2);
      expectCode(() => inspectDatabase(databasePath, DEFAULT_MIGRATIONS), "MIGRATION_UNKNOWN");

      const raw = new BetterSqlite3(databasePath);
      try {
        raw.exec("CREATE TABLE unledgered_change(secret TEXT) STRICT;");
      } finally {
        raw.close();
      }
      expectCode(() => inspectDatabase(databasePath), "CORRUPT_READ_MODEL");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("captures committed post-crash WAL state without changing any source file", () => {
    const { databasePath, directory } = temporaryPath("dougoos-inspect-crash-wal-");
    try {
      const moduleUrl = pathToFileURL(join(process.cwd(), "dist", "index.js")).href;
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
            const storage = await import(process.argv[1]);
            const store = storage.openStorage(process.argv[2], {
              clock: () => "2026-07-24T00:00:00.000Z"
            });
            store.getOrCreateDeviceIdentity(
              "crash-child",
              () => "${FIRST_DEVICE_ID}"
            );
            process.exit(0);
          `,
          moduleUrl,
          databasePath,
        ],
        { encoding: "utf8" },
      );
      expect(child.status, child.stderr).toBe(0);
      expect(existsSync(`${databasePath}-wal`)).toBe(true);
      const before = directoryHashes(directory);

      const inspection = inspectDatabase(databasePath);
      expect(inspection.migrations.map((migration) => migration.id)).toEqual(["storage:0001"]);
      expect(inspection.counts.devices).toBe(1);
      expect(directoryHashes(directory)).toEqual(before);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("CLI accepts the documented optional separator and never echoes secrets", () => {
    const { databasePath, directory } = temporaryPath("dougoos-inspect-cli-secret-");
    const privateToken = "private-message-cli-token";
    try {
      const store = openStorage(databasePath, { clock: () => time(10) });
      createInitializedSession(store, "session-cli-private");
      createQueuedTurn(store, "session-cli-private", privateToken);
      store.getOrCreateDeviceIdentity("private", () => FIRST_DEVICE_ID);
      store.close();

      const cliPath = join(process.cwd(), "dist", "db-inspect.js");
      const result = spawnSync(process.execPath, [cliPath, "--", databasePath], {
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ integrity: "ok" }));
      for (const secret of [
        databasePath,
        "private-agent-state.db",
        FIRST_DEVICE_ID,
        privateToken,
        "/temporary/session-cli-private",
      ]) {
        expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
      }

      const missingPath = join(directory, "missing-private.db");
      const missing = spawnSync(process.execPath, [cliPath, "--", missingPath], {
        encoding: "utf8",
      });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toBe("database inspection failed\n");
      expect(`${missing.stdout}${missing.stderr}`).not.toContain(missingPath);
      expect(existsSync(missingPath)).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("fails closed on a foreign-key-corrupt read model", () => {
    const { databasePath, directory } = temporaryPath("dougoos-inspect-foreign-key-");
    try {
      openStorage(databasePath).close();
      const raw = new BetterSqlite3(databasePath);
      try {
        raw.pragma("foreign_keys = OFF");
        raw
          .prepare(
            `INSERT INTO usage_stats(
               turn_id, session_id, input_tokens, output_tokens,
               cached_input_tokens, quality
             ) VALUES ('missing-turn', 'missing-session', 1, 2, NULL, 'exact')`,
          )
          .run();
      } finally {
        raw.close();
      }
      expectCode(() => inspectDatabase(databasePath), "CORRUPT_READ_MODEL");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
