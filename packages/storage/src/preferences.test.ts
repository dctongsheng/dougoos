import { rmSync } from "node:fs";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { StorageError } from "./errors.js";
import { openStorage } from "./store.js";
import { createTestContext } from "./test-utils/helpers.js";

describe("conversation-directory preference storage", () => {
  it("uses a fixed key, upserts a validated absolute path, and persists it", () => {
    const context = createTestContext();
    const first = join(context.directory, "first");
    const second = join(context.directory, "second");
    try {
      expect(context.store.getConversationDirectory()).toBeNull();
      expect(context.store.setConversationDirectory(first)).toBe(first);
      expect(context.store.setConversationDirectory(second)).toBe(second);
      expect(context.store.getConversationDirectory()).toBe(second);
      context.store.close();

      const raw = new BetterSqlite3(context.databasePath, {
        fileMustExist: true,
        readonly: true,
      });
      try {
        expect(raw.prepare(`SELECT key, value_json AS valueJson FROM settings`).all()).toEqual([
          { key: "conversation.directory", valueJson: JSON.stringify(second) },
        ]);
      } finally {
        raw.close();
      }

      const reopened = openStorage(context.databasePath);
      expect(reopened.getConversationDirectory()).toBe(second);
      reopened.close();
    } finally {
      rmSync(context.directory, { force: true, recursive: true });
    }
  });

  it("rejects invalid inputs without storing their value in error details", () => {
    const context = createTestContext();
    try {
      for (const value of ["relative/path", "~/Documents/Dogoos", ""]) {
        try {
          context.store.setConversationDirectory(value);
          throw new Error("expected setConversationDirectory to fail");
        } catch (error) {
          expect(error).toBeInstanceOf(StorageError);
          expect((error as StorageError).code).toBe("VALIDATION_FAILED");
          if (value.length > 0) {
            expect(JSON.stringify((error as StorageError).details ?? {})).not.toContain(value);
          }
        }
      }
      expect(context.store.getConversationDirectory()).toBeNull();
    } finally {
      context.cleanup();
    }
  });

  it("fails closed when the fixed setting contains the wrong JSON type", () => {
    const context = createTestContext();
    try {
      context.store.close();
      const raw = new BetterSqlite3(context.databasePath, { fileMustExist: true });
      try {
        raw
          .prepare(`INSERT INTO settings(key, value_json) VALUES (?, ?)`)
          .run("conversation.directory", "42");
      } finally {
        raw.close();
      }
      const reopened = openStorage(context.databasePath);
      try {
        expect(() => reopened.getConversationDirectory()).toThrowError(
          expect.objectContaining({ code: "CORRUPT_READ_MODEL" }),
        );
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(context.directory, { force: true, recursive: true });
    }
  });
});
