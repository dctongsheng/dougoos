import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY, handleAppRequest, resolveWebAsset } from "./protocol.js";

describe("app protocol", () => {
  it("resolves only assets below the web root", () => {
    expect(resolveWebAsset("/tmp/site", "/")).toBe("/tmp/site/index.html");
    expect(resolveWebAsset("/tmp/site", "/assets/app.js")).toBe("/tmp/site/assets/app.js");
    expect(resolveWebAsset("/tmp/site", "/%2e%2e/secret")).toBeNull();
    expect(resolveWebAsset("/tmp/site", "/assets/%00.js")).toBeNull();
  });

  it("serves web files with a strict CSP", async () => {
    const root = await mkdtemp(join(tmpdir(), "dougoos-app-protocol-"));
    try {
      await writeFile(join(root, "index.html"), "<h1>DougoOS</h1>");
      const response = await handleAppRequest(new Request("app://dougoos/"), root);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<h1>DougoOS</h1>");
      expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-inline'");
      expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
