import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Connection {
  readonly instanceId: string;
  readonly port: number;
  readonly token: string;
}

interface RendererBridge {
  getCoreConnection(): Promise<Connection>;
  onCoreRestart(listener: () => void): () => void;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("runs Core out of process and recovers after a crash", async () => {
  const root = join(import.meta.dirname, "../../..");
  const desktopPath = join(root, "apps/desktop");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dougoos-desktop-app-"));
  const userDataDirectory = join(temporaryDirectory, "user-data");
  const databasePath = join(temporaryDirectory, "dougoos.sqlite");
  const electronApplication = await electron.launch({
    args: [`--user-data-dir=${userDataDirectory}`, desktopPath],
    env: {
      ...process.env,
      DOUGOOS_DATABASE_PATH: databasePath,
      DOUGOOS_TEST_FAKE_PROVIDER: "1",
    },
  });
  const corePids: number[] = [];

  try {
    const page = await electronApplication.firstWindow();
    await expect(page).toHaveTitle("DougoOS", { timeout: 30_000 });

    await page.evaluate(() => {
      const browser = globalThis as typeof globalThis & {
        __dougoosRestartCount?: number;
        dougoos?: RendererBridge;
      };
      browser.__dougoosRestartCount = 0;
      browser.dougoos?.onCoreRestart(() => {
        browser.__dougoosRestartCount = (browser.__dougoosRestartCount ?? 0) + 1;
      });
    });

    const first = await page.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { dougoos?: RendererBridge }).dougoos;
      if (bridge === undefined) throw new Error("Desktop preload bridge is unavailable");
      return bridge.getCoreConnection();
    });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const ready = await page.evaluate(async (connection) => {
      const response = await fetch(`http://127.0.0.1:${String(connection.port)}/api/health/ready`, {
        headers: { authorization: `Bearer ${connection.token}` },
      });
      return { body: await response.json(), status: response.status };
    }, first);
    expect(ready).toMatchObject({
      body: { instanceId: first.instanceId, status: "ready" },
      status: 200,
    });

    const firstCorePid = await electronApplication.evaluate(({ app }): number => {
      const core = app.getAppMetrics().find((metric) => metric.name === "DougoOS Core");
      if (core === undefined) throw new Error("Core utility PID is unavailable");
      return core.pid;
    });
    corePids.push(firstCorePid);

    await electronApplication.evaluate((_electron, pid): void => {
      process.kill(pid, "SIGTERM");
    }, firstCorePid);

    let second: Connection | undefined;
    await expect
      .poll(
        async () => {
          second = await page.evaluate(async () => {
            const bridge = (globalThis as typeof globalThis & { dougoos?: RendererBridge }).dougoos;
            if (bridge === undefined) throw new Error("Desktop preload bridge is unavailable");
            try {
              return await bridge.getCoreConnection();
            } catch {
              return undefined;
            }
          });
          return second !== undefined && second.instanceId !== first.instanceId;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    if (second === undefined) throw new Error("Core did not recover");

    expect(second.instanceId).not.toBe(first.instanceId);
    expect(second.port).not.toBe(first.port);
    expect(second.token).not.toBe(first.token);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (globalThis as typeof globalThis & { __dougoosRestartCount?: number })
              .__dougoosRestartCount,
        ),
      )
      .toBeGreaterThan(0);

    const oldTokenAccepted = await fetch(
      `http://127.0.0.1:${String(first.port)}/api/health/ready`,
      {
        headers: {
          authorization: `Bearer ${first.token}`,
          origin: "app://dougoos",
        },
      },
    )
      .then((response) => response.ok)
      .catch(() => false);
    expect(oldTokenAccepted).toBe(false);

    const secondReady = await page.evaluate(async (connection) => {
      const response = await fetch(`http://127.0.0.1:${String(connection.port)}/api/health/ready`, {
        headers: { authorization: `Bearer ${connection.token}` },
      });
      return response.ok;
    }, second);
    expect(secondReady).toBe(true);

    const secondCorePid = await electronApplication.evaluate(({ app }): number => {
      const core = app.getAppMetrics().find((metric) => metric.name === "DougoOS Core");
      if (core === undefined) throw new Error("Recovered Core utility PID is unavailable");
      return core.pid;
    });
    corePids.push(secondCorePid);
    expect(secondCorePid).not.toBe(firstCorePid);

    const security = await electronApplication.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      if (window === undefined) throw new Error("Desktop window is unavailable");
      const preferences = window.webContents.getLastWebPreferences();
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
    const rendererGlobals = await page.evaluate(() => ({
      processType: typeof (globalThis as { process?: unknown }).process,
      requireType: typeof (globalThis as { require?: unknown }).require,
    }));
    expect(rendererGlobals).toEqual({
      processType: "undefined",
      requireType: "undefined",
    });
  } finally {
    await electronApplication.close();
    await expect.poll(() => corePids.every((pid) => !processExists(pid))).toBe(true);
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
