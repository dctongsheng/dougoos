import { _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(join(root, ".artifacts", "desktop-package.json"), "utf8"),
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "dougoos-persistence-smoke-"));
const databasePath = join(temporaryDirectory, "persistent.sqlite");
const userDataPath = join(temporaryDirectory, "user-data");
const conversationDirectory = join(temporaryDirectory, "conversations");
await mkdir(conversationDirectory);

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launch() {
  return electron.launch({
    args: [`--user-data-dir=${userDataPath}`],
    env: {
      ...process.env,
      DOUGOOS_DATABASE_PATH: databasePath,
      DOUGOOS_DISABLE_UPDATES: "1",
      DOUGOOS_TEST_FAKE_PROVIDER: "1",
    },
    executablePath: manifest.executablePath,
  });
}

async function closeApplication(application) {
  const processIds = new Set([application.process().pid]);
  const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
  for (const metric of metrics) processIds.add(metric.pid);
  await application.close();
  const deadline = Date.now() + 10_000;
  while ([...processIds].some(processExists) && Date.now() < deadline) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  const survivors = [...processIds].filter(processExists);
  if (survivors.length > 0) {
    throw new Error(`Persistent package process tree did not exit: ${survivors.join(", ")}`);
  }
}

async function openClient(application) {
  const page = await application.firstWindow();
  await page.waitForFunction(() => globalThis.document.title === "DougoOS", undefined, {
    timeout: 30_000,
  });
  const connection = await page.evaluate(async () => {
    if (globalThis.dougoos === undefined) throw new Error("Packaged preload bridge is unavailable");
    return globalThis.dougoos.getCoreConnection();
  });
  const request = (path, options = {}) =>
    page.evaluate(
      async ({ core, options: requestOptions, path: requestPath }) => {
        const response = await globalThis.fetch(`http://127.0.0.1:${core.port}${requestPath}`, {
          ...requestOptions,
          headers: {
            authorization: `Bearer ${core.token}`,
            ...(requestOptions.body === undefined ? {} : { "content-type": "application/json" }),
          },
        });
        return { body: await response.json(), status: response.status };
      },
      { core: connection, options, path },
    );
  return { request };
}

let firstApplication;
let secondApplication;
try {
  firstApplication = await launch();
  const first = await openClient(firstApplication);
  const preferences = await first.request("/api/preferences", {
    body: JSON.stringify({ conversationDirectory }),
    method: "POST",
  });
  if (
    preferences.status !== 200 ||
    preferences.body.conversationDirectory !== conversationDirectory
  ) {
    throw new Error(`Packaged preferences were not saved: ${JSON.stringify(preferences)}`);
  }
  const created = await first.request("/api/sessions", {
    body: JSON.stringify({ cwd: conversationDirectory, providerId: "test-fake" }),
    method: "POST",
  });
  if (created.status !== 201 || typeof created.body.session?.id !== "string") {
    throw new Error(`Persistent packaged Session was not created: ${JSON.stringify(created)}`);
  }
  const sessionId = created.body.session.id;
  const completedFirstApplication = firstApplication;
  firstApplication = undefined;
  await closeApplication(completedFirstApplication);

  secondApplication = await launch();
  const second = await openClient(secondApplication);
  const [restoredPreferences, restoredSession, restoredSnapshot, restoredProviders] =
    await Promise.all([
      second.request("/api/preferences"),
      second.request(`/api/sessions/${sessionId}`),
      second.request("/api/snapshot"),
      second.request("/api/providers"),
    ]);
  if (
    restoredPreferences.status !== 200 ||
    restoredPreferences.body.conversationDirectory !== conversationDirectory
  ) {
    throw new Error("Conversation directory did not survive packaged restart");
  }
  if (
    restoredSession.status !== 200 ||
    restoredSession.body.session?.id !== sessionId ||
    restoredSession.body.session?.cwd !== conversationDirectory ||
    restoredSession.body.session?.providerId !== "test-fake"
  ) {
    throw new Error("SQLite Session, cwd, or Provider selection did not survive packaged restart");
  }
  if (
    restoredSnapshot.status !== 200 ||
    !restoredSnapshot.body.sessions?.some((session) => session.id === sessionId)
  ) {
    throw new Error("Restored project/session index did not include the persisted Session");
  }
  if (
    restoredProviders.status !== 200 ||
    !restoredProviders.body.providers?.some((provider) => provider.id === "test-fake")
  ) {
    throw new Error("Packaged Provider registry did not recover after restart");
  }
  await stat(databasePath);
} finally {
  if (firstApplication !== undefined) await closeApplication(firstApplication);
  if (secondApplication !== undefined) await closeApplication(secondApplication);
  await rm(temporaryDirectory, { force: true, recursive: true });
}

console.log(
  "Packaged persistence smoke passed (SQLite, Provider selection, conversation directory, and project/session index).",
);
