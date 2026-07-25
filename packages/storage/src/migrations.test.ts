import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { StorageError } from "./errors.js";
import {
  DEFAULT_MIGRATIONS,
  STORAGE_BASE_CORE_SCHEMA_SHA256,
  type Migration,
} from "./migrations.js";
import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_WAL_AUTOCHECKPOINT_PAGES,
  openStorage,
  readStoragePragmas,
} from "./store.js";
import { createTestContext } from "./test-utils/helpers.js";

function temporaryPath(): { readonly directory: string; readonly filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "dougoos-migration-test-"));
  return { directory, filePath: join(directory, "data.db") };
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

function snapshotFiles(directory: string): Readonly<{
  readonly files: readonly Readonly<{ readonly name: string; readonly sha256: string }>[];
}> {
  return {
    files: readdirSync(directory)
      .sort()
      .map((name) => ({
        name,
        sha256: createHash("sha256")
          .update(readFileSync(join(directory, name)))
          .digest("hex"),
      })),
  };
}

function persistentJournalMode(filePath: string): string {
  const raw = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
  try {
    return String(raw.pragma("journal_mode", { simple: true })).toLowerCase();
  } finally {
    raw.close();
  }
}

function persistedDatabaseState(filePath: string): Readonly<{
  readonly devices: readonly unknown[];
  readonly migrations: readonly unknown[];
  readonly schema: readonly unknown[];
  readonly userVersion: number;
}> {
  const raw = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
  try {
    return {
      devices: raw.prepare(`SELECT * FROM devices ORDER BY singleton`).all(),
      migrations: raw.prepare(`SELECT * FROM schema_migrations ORDER BY ordinal`).all(),
      schema: raw
        .prepare(
          `SELECT type, name, tbl_name AS tableName, sql
           FROM sqlite_schema
           ORDER BY type, name`,
        )
        .all(),
      userVersion: Number(raw.pragma("user_version", { simple: true })),
    };
  } finally {
    raw.close();
  }
}

describe("append-only migration runner and SQLite policy", () => {
  it("applies the fixed manifest once and reopens without mutation", () => {
    const { directory, filePath } = temporaryPath();
    try {
      const first = openStorage(filePath);
      expect(first.appliedMigrations.map((migration) => migration.id)).toEqual(
        DEFAULT_MIGRATIONS.map((migration) => migration.id),
      );
      first.close();
      const before = readFileSync(filePath);

      const second = openStorage(filePath);
      expect(second.appliedMigrations).toHaveLength(DEFAULT_MIGRATIONS.length);
      second.close();
      expect(readFileSync(filePath)).toEqual(before);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("upgrades a storage:0001 database with the additive settings module", () => {
    const { directory, filePath } = temporaryPath();
    const base = DEFAULT_MIGRATIONS[0];
    if (base === undefined) throw new Error("storage base migration is missing");
    try {
      openStorage(filePath, { migrations: [base] }).close();
      const upgraded = openStorage(filePath);
      expect(upgraded.appliedMigrations.map((migration) => migration.id)).toEqual([
        "storage:0001",
        "settings:0001",
      ]);
      upgraded.close();

      const raw = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
      try {
        expect(raw.prepare(`SELECT type FROM sqlite_schema WHERE name = 'settings'`).get()).toEqual(
          { type: "table" },
        );
        expect(Number(raw.pragma("user_version", { simple: true }))).toBe(
          DEFAULT_MIGRATIONS.length,
        );
      } finally {
        raw.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("configures every connection for file-backed WAL and fixed pragmas", () => {
    const context = createTestContext();
    try {
      const pragmas = readStoragePragmas(context.databasePath);
      expect(pragmas).toEqual({
        busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
        foreignKeys: true,
        journalMode: "wal",
        synchronous: 2,
        walAutocheckpointPages: SQLITE_WAL_AUTOCHECKPOINT_PAGES,
      });
      expect(context.store.checkpoint("PASSIVE")).toEqual(
        expect.objectContaining({ busy: 0, mode: "PASSIVE" }),
      );
    } finally {
      context.cleanup();
    }
  });

  it("rejects a duplicate manifest before creating or mutating the database file", () => {
    const { directory, filePath } = temporaryPath();
    const duplicate: readonly Migration[] = [
      { id: "module:0001", sql: "SELECT 1;" },
      { id: "module:0001", sql: "SELECT 2;" },
    ];
    try {
      expectCode(() => openStorage(filePath, { migrations: duplicate }), "MIGRATION_DUPLICATE_ID");
      expect(() => readFileSync(filePath)).toThrow();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rolls back a failed migration without deleting the existing schema", () => {
    const { directory, filePath } = temporaryPath();
    const manifest: readonly Migration[] = [
      ...DEFAULT_MIGRATIONS,
      {
        expectedCoreSchemaSha256: STORAGE_BASE_CORE_SCHEMA_SHA256,
        id: "storage:0002",
        sql: `
          CREATE TABLE migration_should_rollback(id TEXT PRIMARY KEY) STRICT;
          INSERT INTO missing_table(value) VALUES ('fail');
        `,
      },
    ];
    try {
      openStorage(filePath).close();
      expectCode(() => openStorage(filePath, { migrations: manifest }), "MIGRATION_FAILED");
      const raw = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
      try {
        const applied = raw.prepare(`SELECT id FROM schema_migrations ORDER BY ordinal`).all();
        expect(applied).toEqual(DEFAULT_MIGRATIONS.map((migration) => ({ id: migration.id })));
        expect(
          raw
            .prepare(
              `SELECT 1 FROM sqlite_schema
               WHERE type = 'table' AND name = 'migration_should_rollback'`,
            )
            .get(),
        ).toBeUndefined();
        expect(Number(raw.pragma("user_version", { simple: true }))).toBe(
          DEFAULT_MIGRATIONS.length,
        );
      } finally {
        raw.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    {
      name: "required active-Turn index",
      sql: "DROP INDEX one_active_turn_per_session;",
    },
    {
      name: "required sessions table",
      sql: "DROP TABLE sessions;",
    },
    {
      name: "journal singleton",
      sql: "DELETE FROM journal_state;",
    },
    {
      name: "unexpected core column",
      sql: "ALTER TABLE sessions ADD COLUMN unexpected TEXT;",
    },
    {
      name: "unexpected core index",
      sql: "CREATE INDEX unexpected_sessions_title ON sessions(title);",
    },
  ])("rolls back an additive migration that destroys the $name postcondition", (testCase) => {
    const { directory, filePath } = temporaryPath();
    const manifest: readonly Migration[] = [
      ...DEFAULT_MIGRATIONS,
      { id: "bad-module:0001", sql: testCase.sql },
    ];
    try {
      openStorage(filePath).close();
      expectCode(() => openStorage(filePath, { migrations: manifest }), "MIGRATION_FAILED");
      const raw = new BetterSqlite3(filePath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        expect(
          raw
            .prepare(
              `SELECT id, ordinal
                 FROM schema_migrations
                 ORDER BY ordinal`,
            )
            .all(),
        ).toEqual(
          DEFAULT_MIGRATIONS.map((migration, index) => ({
            id: migration.id,
            ordinal: index + 1,
          })),
        );
        expect(Number(raw.pragma("user_version", { simple: true }))).toBe(
          DEFAULT_MIGRATIONS.length,
        );
        expect(
          raw
            .prepare(
              `SELECT COUNT(*) AS count
                 FROM journal_state
                 WHERE singleton = 1`,
            )
            .get(),
        ).toEqual({ count: 1 });
        expect(
          raw
            .prepare(
              `SELECT type
                 FROM sqlite_schema
                 WHERE name = 'one_active_turn_per_session'`,
            )
            .get(),
        ).toEqual({ type: "index" });
        expect(
          raw
            .prepare(
              `SELECT type
                 FROM sqlite_schema
                 WHERE name = 'sessions'`,
            )
            .get(),
        ).toEqual({ type: "table" });
        expect(
          (
            raw.pragma("table_info('sessions')") as {
              readonly name: string;
            }[]
          ).some((column) => column.name === "unexpected"),
        ).toBe(false);
        expect(
          raw
            .prepare(
              `SELECT 1
                 FROM sqlite_schema
                 WHERE name = 'unexpected_sessions_title'`,
            )
            .get(),
        ).toBeUndefined();
      } finally {
        raw.close();
      }
      openStorage(filePath).close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("fails closed on checksum drift", () => {
    const { directory, filePath } = temporaryPath();
    try {
      openStorage(filePath).close();
      const drifted: readonly Migration[] = [
        { id: "storage:0001", sql: `${DEFAULT_MIGRATIONS[0]?.sql ?? ""}\nSELECT 1;` },
      ];
      expectCode(() => openStorage(filePath, { migrations: drifted }), "MIGRATION_DRIFT");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("fails closed on an unknown applied migration", () => {
    const { directory, filePath } = temporaryPath();
    try {
      openStorage(filePath).close();
      const raw = new BetterSqlite3(filePath);
      try {
        raw
          .prepare(
            `INSERT INTO schema_migrations(id, ordinal, checksum, applied_at)
             VALUES ('future:0001', ?, ?, '2026-07-24T00:00:00.000Z')`,
          )
          .run(DEFAULT_MIGRATIONS.length + 1, "0".repeat(64));
        raw.pragma(`user_version = ${DEFAULT_MIGRATIONS.length + 1}`);
      } finally {
        raw.close();
      }
      expectCode(() => openStorage(filePath), "MIGRATION_UNKNOWN");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("does not add migration tables to an unrelated or newer database", () => {
    const { directory, filePath } = temporaryPath();
    try {
      const raw = new BetterSqlite3(filePath);
      raw.exec(`CREATE TABLE unrelated(id TEXT PRIMARY KEY) STRICT;`);
      raw.pragma("user_version = 7");
      raw.close();

      expectCode(() => openStorage(filePath), "MIGRATION_UNKNOWN");
      const verify = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
      try {
        expect(
          verify.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'schema_migrations'`).get(),
        ).toBeUndefined();
        expect(
          verify.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'unrelated'`).get(),
        ).toEqual({ 1: 1 });
      } finally {
        verify.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects an empty generic migration ledger colliding with an unrelated database", () => {
    const { directory, filePath } = temporaryPath();
    try {
      const raw = new BetterSqlite3(filePath);
      raw.exec(`
        CREATE TABLE schema_migrations(
          id TEXT PRIMARY KEY,
          ordinal INTEGER NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE unrelated(secret TEXT) STRICT;
      `);
      raw.close();

      expectCode(() => openStorage(filePath), "MIGRATION_UNKNOWN");
      const verify = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
      try {
        expect(
          verify.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'sessions'`).get(),
        ).toBeUndefined();
      } finally {
        verify.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("does not mutate a fake owner and ledger missing its schema fingerprint", () => {
    const { directory, filePath } = temporaryPath();
    try {
      const raw = new BetterSqlite3(filePath);
      raw.exec(`
        CREATE TABLE storage_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        INSERT INTO storage_metadata(key, value)
        VALUES ('owner', '@dougoos/storage:v1');
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 1),
          checksum TEXT NOT NULL CHECK (length(checksum) = 64),
          applied_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE unrelated(secret TEXT) STRICT;
      `);
      raw.close();
      expect(persistentJournalMode(filePath)).toBe("delete");
      const before = snapshotFiles(directory);

      expectCode(() => openStorage(filePath), "CORRUPT_READ_MODEL");

      expect(persistentJournalMode(filePath)).toBe("delete");
      expect(snapshotFiles(directory)).toEqual(before);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("switches a fully verified owned DELETE database to WAL", () => {
    const { directory, filePath } = temporaryPath();
    try {
      openStorage(filePath).close();
      const raw = new BetterSqlite3(filePath);
      expect(String(raw.pragma("journal_mode = DELETE", { simple: true })).toLowerCase()).toBe(
        "delete",
      );
      raw.close();
      expect(persistentJournalMode(filePath)).toBe("delete");

      const reopened = openStorage(filePath);
      expect(readStoragePragmas(filePath).journalMode).toBe("wal");
      reopened.close();
      expect(persistentJournalMode(filePath)).toBe("wal");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    {
      corrupt(raw: BetterSqlite3.Database) {
        raw.exec(`UPDATE journal_state SET last_seq = last_seq + 1 WHERE singleton = 1`);
      },
      name: "journal range",
    },
    {
      corrupt(raw: BetterSqlite3.Database) {
        raw.exec(`DROP INDEX one_active_turn_per_session`);
      },
      name: "core schema",
    },
  ])("leaves a corrupt owned DELETE database byte-for-byte unchanged: $name", (testCase) => {
    const { directory, filePath } = temporaryPath();
    try {
      openStorage(filePath).close();
      const raw = new BetterSqlite3(filePath);
      raw.pragma("journal_mode = DELETE");
      testCase.corrupt(raw);
      raw.close();
      expect(persistentJournalMode(filePath)).toBe("delete");
      const before = snapshotFiles(directory);

      expect(() => openStorage(filePath)).toThrowError(StorageError);

      expect(persistentJournalMode(filePath)).toBe("delete");
      expect(snapshotFiles(directory)).toEqual(before);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rolls back bootstrap plus storage:0001 when fresh base application fails", () => {
    const { directory, filePath } = temporaryPath();
    let clockCalls = 0;
    try {
      expectCode(
        () =>
          openStorage(filePath, {
            clock: () => {
              clockCalls += 1;
              return clockCalls === 1 ? "2026-07-24T00:00:00.000Z" : "not-a-timestamp";
            },
          }),
        "MIGRATION_FAILED",
      );
      const raw = new BetterSqlite3(filePath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        expect(
          raw
            .prepare(
              `SELECT name
               FROM sqlite_schema
               WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
               ORDER BY name`,
            )
            .all(),
        ).toEqual([]);
        expect(Number(raw.pragma("user_version", { simple: true }))).toBe(0);
        expect(String(raw.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("delete");
      } finally {
        raw.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("preserves prior ledger, version, schema, data, mode, and files on pending failure", () => {
    const { directory, filePath } = temporaryPath();
    const manifest: readonly Migration[] = [
      ...DEFAULT_MIGRATIONS,
      {
        id: "hostile-module:0001",
        sql: `
          CREATE TABLE pending_should_rollback(id TEXT PRIMARY KEY) STRICT;
          UPDATE devices SET app_version = 'mutated';
          INSERT INTO missing_table(value) VALUES ('fail');
        `,
      },
    ];
    try {
      const baseline = openStorage(filePath, {
        clock: () => "2026-07-24T00:00:00.000Z",
      });
      baseline.getOrCreateDeviceIdentity("1.0.0", () => "11111111-1111-4111-8111-111111111111");
      baseline.close();
      const raw = new BetterSqlite3(filePath);
      raw.pragma("journal_mode = DELETE");
      raw.close();
      const stateBefore = persistedDatabaseState(filePath);
      const filesBefore = snapshotFiles(directory);

      expectCode(() => openStorage(filePath, { migrations: manifest }), "MIGRATION_FAILED");

      expect(persistentJournalMode(filePath)).toBe("delete");
      expect(persistedDatabaseState(filePath)).toEqual(stateBefore);
      expect(snapshotFiles(directory)).toEqual(filesBefore);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("allows an owned additive module migration and reopens with the same manifest", () => {
    const { directory, filePath } = temporaryPath();
    const manifest: readonly Migration[] = [
      ...DEFAULT_MIGRATIONS,
      {
        id: "harness-demo:0001",
        sql: "CREATE TABLE harness_demo(id TEXT PRIMARY KEY) STRICT;",
      },
    ];
    try {
      const first = openStorage(filePath, { migrations: manifest });
      expect(first.appliedMigrations.map((migration) => migration.id)).toEqual([
        ...DEFAULT_MIGRATIONS.map((migration) => migration.id),
        "harness-demo:0001",
      ]);
      first.close();
      const second = openStorage(filePath, { migrations: manifest });
      expect(second.appliedMigrations).toHaveLength(DEFAULT_MIGRATIONS.length + 1);
      second.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    {
      name: "same-shape devices recreation without its CHECK constraint",
      sql: `
        DROP TABLE devices;
        CREATE TABLE devices (
          singleton INTEGER PRIMARY KEY,
          device_id TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          app_version TEXT NOT NULL
        ) STRICT;
      `,
    },
    {
      name: "core UPDATE",
      sql: "UPDATE devices SET app_version = 'mutated' WHERE singleton = 1;",
    },
    {
      name: "core DELETE",
      sql: "DELETE FROM devices WHERE singleton = 1;",
    },
    {
      name: "core INSERT",
      sql: `
        INSERT INTO providers_status(provider_id, provider_json, checked_at)
        VALUES ('injected-provider', '{}', '2026-07-24T00:00:00.000Z');
      `,
    },
  ])("rolls back a module migration attempting $name", (testCase) => {
    const { directory, filePath } = temporaryPath();
    const deviceId = "11111111-1111-4111-8111-111111111111";
    try {
      const baseline = openStorage(filePath, { clock: () => "2026-07-24T00:00:00.000Z" });
      baseline.getOrCreateDeviceIdentity("1.0.0", () => deviceId);
      baseline.close();

      const before = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
      const originalDevice = before
        .prepare(
          `SELECT singleton, device_id AS deviceId, created_at AS createdAt,
                  app_version AS appVersion
           FROM devices`,
        )
        .all();
      const originalDevicesSql = before
        .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'devices'`)
        .get();
      before.close();

      const manifest: readonly Migration[] = [
        ...DEFAULT_MIGRATIONS,
        { id: "hostile-module:0001", sql: testCase.sql },
      ];
      expectCode(() => openStorage(filePath, { migrations: manifest }), "MIGRATION_FAILED");

      const raw = new BetterSqlite3(filePath, { fileMustExist: true, readonly: true });
      try {
        expect(
          raw.prepare(`SELECT id, ordinal FROM schema_migrations ORDER BY ordinal`).all(),
        ).toEqual(
          DEFAULT_MIGRATIONS.map((migration, index) => ({
            id: migration.id,
            ordinal: index + 1,
          })),
        );
        expect(Number(raw.pragma("user_version", { simple: true }))).toBe(
          DEFAULT_MIGRATIONS.length,
        );
        expect(
          raw
            .prepare(
              `SELECT singleton, device_id AS deviceId, created_at AS createdAt,
                      app_version AS appVersion
               FROM devices`,
            )
            .all(),
        ).toEqual(originalDevice);
        expect(
          raw
            .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'devices'`)
            .get(),
        ).toEqual(originalDevicesSql);
        expect(raw.prepare(`SELECT COUNT(*) AS count FROM providers_status`).get()).toEqual({
          count: 0,
        });
      } finally {
        raw.close();
      }

      const reopened = openStorage(filePath);
      expect(
        reopened.getOrCreateDeviceIdentity("ignored", () => "22222222-2222-4222-8222-222222222222")
          .deviceId,
      ).toBe(deviceId);
      reopened.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each(["fresh install", "upgrade from storage:0001"] as const)(
    "applies a later additive storage version on %s without validating the final schema too early",
    (mode) => {
      const { directory, filePath } = temporaryPath();
      const manifest: readonly Migration[] = [
        ...DEFAULT_MIGRATIONS,
        {
          expectedCoreSchemaSha256: STORAGE_BASE_CORE_SCHEMA_SHA256,
          id: "storage:0002",
          sql: `
            CREATE TABLE storage_future_records(
              id TEXT PRIMARY KEY,
              label TEXT NOT NULL
            ) STRICT;
            CREATE INDEX storage_future_records_label
            ON storage_future_records(label);
          `,
        },
      ];
      try {
        if (mode === "upgrade from storage:0001") {
          const base = DEFAULT_MIGRATIONS[0];
          if (base === undefined) throw new Error("storage base migration is missing");
          openStorage(filePath, { migrations: [base] }).close();
        }
        const upgraded = openStorage(filePath, { migrations: manifest });
        expect(upgraded.appliedMigrations.map((migration) => migration.id)).toEqual([
          ...DEFAULT_MIGRATIONS.map((migration) => migration.id),
          "storage:0002",
        ]);
        upgraded.close();
        const raw = new BetterSqlite3(filePath, {
          fileMustExist: true,
          readonly: true,
        });
        try {
          expect(
            raw
              .prepare(
                `SELECT type
                 FROM sqlite_schema
                 WHERE name = 'storage_future_records_label'`,
              )
              .get(),
          ).toEqual({ type: "index" });
          expect(Number(raw.pragma("user_version", { simple: true }))).toBe(
            DEFAULT_MIGRATIONS.length + 1,
          );
        } finally {
          raw.close();
        }
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      migrations: [{ id: "bad-id", sql: "SELECT 1;" }],
      name: "invalid id",
      options: {},
    },
    {
      migrations: [{ id: "module:0001", sql: "SELECT 1;" }],
      name: "missing storage base prefix",
      options: {},
    },
    {
      migrations: DEFAULT_MIGRATIONS,
      name: "non-ISO migration clock",
      options: { clock: () => "not-an-iso-timestamp" },
    },
  ] as const)("fails fast on $name without creating a database file", (testCase) => {
    const { directory, filePath } = temporaryPath();
    try {
      expect(() =>
        openStorage(filePath, {
          migrations: testCase.migrations,
          ...testCase.options,
        }),
      ).toThrow();
      expect(() => readFileSync(filePath)).toThrow();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([
    {
      corrupt(raw: BetterSqlite3.Database) {
        raw.exec("DROP TABLE journal_state;");
      },
      name: "required table",
    },
    {
      corrupt(raw: BetterSqlite3.Database) {
        raw.exec("DROP INDEX one_active_turn_per_session;");
      },
      name: "required partial index",
    },
    {
      corrupt(raw: BetterSqlite3.Database) {
        raw.exec("DELETE FROM journal_state;");
      },
      name: "journal singleton",
    },
  ])("fails closed when the $name is missing", (testCase) => {
    const { directory, filePath } = temporaryPath();
    try {
      openStorage(filePath).close();
      const raw = new BetterSqlite3(filePath);
      testCase.corrupt(raw);
      raw.close();
      expect(() => openStorage(filePath)).toThrowError(StorageError);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("never rebuilds a corrupt database", () => {
    const { directory, filePath } = temporaryPath();
    const bytes = Buffer.from("not-a-sqlite-database");
    try {
      writeFileSync(filePath, bytes);
      expect(() => openStorage(filePath)).toThrow();
      expect(readFileSync(filePath)).toEqual(bytes);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
