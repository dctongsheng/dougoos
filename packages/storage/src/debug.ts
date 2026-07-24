import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectDatabase, openStorage } from "./index.js";

const directory = mkdtempSync(join(tmpdir(), "dougoos-storage-debug-"));
const databasePath = join(directory, "data.db");
const now = "2026-07-24T00:00:00.000Z";
const store = openStorage(databasePath, { clock: () => now });
let closed = false;

try {
  const identity = store.getOrCreateDeviceIdentity("debug");
  const checkpoint = store.checkpoint();
  store.close();
  closed = true;
  const inspection = inspectDatabase(databasePath);
  process.stdout.write(
    `${JSON.stringify({
      checkpointBusy: checkpoint.busy,
      classification: identity.classification,
      integrity: inspection.integrity,
      journalMode: inspection.pragmas.journalMode,
      migrations: inspection.migrations.map((migration) => migration.id),
      native: "better-sqlite3",
      resettable: identity.resettable,
      sqliteVersion: inspection.sqliteVersion,
    })}\n`,
  );
} finally {
  if (!closed) store.close();
  rmSync(directory, { force: true, recursive: true });
}
