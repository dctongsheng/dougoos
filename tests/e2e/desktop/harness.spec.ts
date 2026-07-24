import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("launches a secure Electron BrowserWindow", async () => {
  expect(test.info().project.name).toBe("desktop");

  const harnessPath = fileURLToPath(new URL("./electron-harness.mjs", import.meta.url));
  const userDataDir = await mkdtemp(join(tmpdir(), "dougoos-electron-harness-"));

  try {
    const electronApplication = await electron.launch({
      args: [`--user-data-dir=${userDataDir}`, harnessPath],
    });

    try {
      expect(electronApplication.process().pid).toBeGreaterThan(0);

      const window = await electronApplication.firstWindow();
      await expect(window).toHaveTitle("DougoOS Desktop Harness");
      await expect(window.getByTestId("title")).toHaveText("DougoOS Desktop Harness");
      await expect(window.getByTestId("status")).toHaveText("browserwindow-ready");

      const security = await electronApplication.evaluate(({ BrowserWindow }) => {
        const [browserWindow] = BrowserWindow.getAllWindows();
        if (browserWindow === undefined) {
          throw new Error("Electron harness did not create a BrowserWindow");
        }

        const preferences = browserWindow.webContents.getLastWebPreferences();
        return {
          contextIsolation: preferences.contextIsolation,
          nodeIntegration: preferences.nodeIntegration,
          sandbox: preferences.sandbox,
          webSecurity: preferences.webSecurity,
        };
      });

      expect(security).toEqual({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      });

      const rendererGlobals = await window.evaluate(() => ({
        processType: typeof (globalThis as { process?: unknown }).process,
        requireType: typeof (globalThis as { require?: unknown }).require,
      }));
      expect(rendererGlobals).toEqual({
        processType: "undefined",
        requireType: "undefined",
      });
    } finally {
      await electronApplication.close();
    }
  } finally {
    await rm(userDataDir, { force: true, recursive: true });
  }
});
