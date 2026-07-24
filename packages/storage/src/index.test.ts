import { describe, expect, it } from "vitest";

import * as storage from "./index.js";
import {
  JOURNAL_RETENTION_MAX_AGE_MS,
  JOURNAL_RETENTION_MAX_EVENTS,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_SYNCHRONOUS,
  packageManifest,
} from "./index.js";

describe("@dougoos/storage package contract", () => {
  it("exports the implemented strict ESM package manifest", () => {
    expect(packageManifest).toEqual({
      kind: "package",
      name: "@dougoos/storage",
      status: "implemented",
    });
  });

  it("locks the operational SQLite and retention policy", () => {
    expect(SQLITE_BUSY_TIMEOUT_MS).toBe(5_000);
    expect(SQLITE_SYNCHRONOUS).toBe("FULL");
    expect(JOURNAL_RETENTION_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(JOURNAL_RETENTION_MAX_EVENTS).toBe(100_000);
  });

  it("exports an exact narrow runtime allowlist with no raw SQLite escape hatch", () => {
    expect(Object.keys(storage).sort()).toEqual([
      "DEFAULT_MIGRATIONS",
      "JOURNAL_RETENTION_MAX_AGE_MS",
      "JOURNAL_RETENTION_MAX_EVENTS",
      "SQLITE_BUSY_TIMEOUT_MS",
      "SQLITE_SYNCHRONOUS",
      "SQLITE_WAL_AUTOCHECKPOINT_PAGES",
      "StorageError",
      "inspectDatabase",
      "isStorageError",
      "openStorage",
      "packageManifest",
      "readStoragePragmas",
    ]);
  });
});
