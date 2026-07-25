import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(join(root, ".artifacts", "desktop-package.json"), "utf8"),
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "dougoos-package-smoke-"));
const databasePath = join(temporaryDirectory, "packaged.sqlite");
const userDataPath = join(temporaryDirectory, "user-data");
const application = await electron.launch({
  args: [`--user-data-dir=${userDataPath}`],
  env: {
    ...process.env,
    DOUGOOS_DATABASE_PATH: databasePath,
    DOUGOOS_DISABLE_UPDATES: "1",
    DOUGOOS_TEST_FAKE_PROVIDER: "1",
  },
  executablePath: manifest.executablePath,
});
const processIds = new Set([application.process().pid]);
let survivors;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => globalThis.document.title === "DougoOS", undefined, {
    timeout: 30_000,
  });
  const connection = await page.evaluate(async () => {
    if (globalThis.dougoos === undefined) throw new Error("Packaged preload bridge is unavailable");
    return globalThis.dougoos.getCoreConnection();
  });
  const ready = await page.evaluate(async (core) => {
    const response = await globalThis.fetch(`http://127.0.0.1:${core.port}/api/health/ready`, {
      headers: { authorization: `Bearer ${core.token}` },
    });
    return { body: await response.json(), status: response.status };
  }, connection);
  if (ready.status !== 200 || ready.body.status !== "ready") {
    throw new Error(`Packaged Core was not ready: ${JSON.stringify(ready)}`);
  }
  const fakeSession = await page.evaluate(
    async ({ core, cwd }) => {
      const request = async (path, body) => {
        const response = await globalThis.fetch(`http://127.0.0.1:${core.port}${path}`, {
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${core.token}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
        return { body: await response.json(), status: response.status };
      };
      const session = await request("/api/sessions", {
        cwd,
        providerId: "test-fake",
      });
      if (session.status !== 201) return { session, turn: null };
      const sessionId = session.body.session.id;
      const turn = await request(`/api/sessions/${sessionId}/turns`, {
        clientRequestId: globalThis.crypto.randomUUID(),
        content: [{ text: "[fake:delayed] package close", type: "text" }],
      });
      return { session, turn };
    },
    { core: connection, cwd: temporaryDirectory },
  );
  if (fakeSession.session.status !== 201 || fakeSession.turn?.status !== 202) {
    throw new Error(`Packaged Fake session failed: ${JSON.stringify(fakeSession)}`);
  }
  const metrics = await application.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    metrics: app.getAppMetrics().map(({ name, pid, serviceName, type }) => ({
      name,
      pid,
      serviceName,
      type,
    })),
  }));
  if (!metrics.isPackaged) throw new Error("Package smoke launched a source app");
  const core = metrics.metrics.find((metric) => metric.name === "DougoOS Core");
  if (core === undefined || core.type !== "Utility") {
    throw new Error(
      `Packaged Core utility process was not found: ${JSON.stringify(metrics.metrics)}`,
    );
  }
  for (const metric of metrics.metrics) processIds.add(metric.pid);
  await stat(databasePath);
} finally {
  await application.close();
  const deadline = Date.now() + 10_000;
  while ([...processIds].some(processExists) && Date.now() < deadline) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  survivors = [...processIds].filter(processExists);
  await rm(temporaryDirectory, { force: true, recursive: true });
}

if (survivors.length > 0) {
  throw new Error(`Packaged process tree did not exit: ${survivors.join(", ")}`);
}

console.log(
  `Packaged Electron smoke passed (${manifest.platform}-${manifest.arch}, Electron ${manifest.electronVersion}).`,
);
