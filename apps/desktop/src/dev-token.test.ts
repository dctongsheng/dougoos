import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeRotatedDevToken } from "./dev-token.js";

describe("writeRotatedDevToken", () => {
  it("atomically rotates a mode-0600 token file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dougoos-dev-token-"));
    const path = join(directory, ".dev-token");
    try {
      await writeRotatedDevToken(path, "first-token");
      await writeRotatedDevToken(path, "second-token");

      expect(await readFile(path, "utf8")).toBe("second-token\n");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
