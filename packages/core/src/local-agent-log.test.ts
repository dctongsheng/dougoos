import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RotatingAgentLog } from "./local-agent-log.js";

describe("RotatingAgentLog", () => {
  it("writes bounded private files, rotates, and reapplies redaction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dougoos-agent-log-"));
    try {
      const log = new RotatingAgentLog({
        directory,
        maxBytes: 1_024,
        maxFiles: 3,
      });
      for (let index = 0; index < 3; index += 1) {
        log.write({
          occurredAt: `2026-07-24T00:00:0${String(index)}.000Z`,
          providerId: "fixture",
          sessionId: `session-${String(index)}`,
          text:
            "credential sk-sensitive123 operator@example.com /Users/operator/private " +
            "x".repeat(700),
          truncated: false,
        });
      }
      await log.close();

      const files = (await readdir(directory)).sort();
      expect(files).toEqual(["agent-stderr.log", "agent-stderr.log.1", "agent-stderr.log.2"]);
      const rendered = (
        await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")))
      ).join("\n");
      expect(rendered).toContain("[REDACTED CREDENTIAL]");
      expect(rendered).toContain("[REDACTED EMAIL]");
      expect(rendered).not.toContain("sk-sensitive123");
      expect(rendered).not.toContain("operator@example.com");
      expect(rendered).not.toContain("/Users/operator");
      expect((await stat(join(directory, "agent-stderr.log"))).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
