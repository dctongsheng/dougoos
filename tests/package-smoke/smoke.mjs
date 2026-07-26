import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(join(root, ".artifacts", "desktop-package.json"), "utf8"),
);
if (
  typeof manifest.appPath !== "string" ||
  typeof manifest.legalPath !== "string" ||
  typeof manifest.sourceArchiveUrl !== "string"
) {
  throw new Error("Package manifest does not expose bundled legal materials");
}
const [
  dougoosLicense,
  sourceOffer,
  thirdPartyNotices,
  instrumentSansLicense,
  jetBrainsMonoLicense,
  frontendLicenses,
  codexLicense,
  codexNotice,
  sourceCodexLicense,
  sourceCodexNotice,
] = await Promise.all([
  readFile(join(manifest.legalPath, "DougoOS-LICENSE.txt"), "utf8"),
  readFile(join(manifest.legalPath, "SOURCE.txt"), "utf8"),
  readFile(join(manifest.legalPath, "THIRD_PARTY_NOTICES.md"), "utf8"),
  readFile(join(manifest.legalPath, "Instrument-Sans-OFL.txt"), "utf8"),
  readFile(join(manifest.legalPath, "JetBrains-Mono-OFL.txt"), "utf8"),
  readFile(join(manifest.legalPath, "FRONTEND_THIRD_PARTY_LICENSES.txt"), "utf8"),
  readFile(join(manifest.legalPath, "OpenAI-Codex-Apache-2.0.txt"), "utf8"),
  readFile(join(manifest.legalPath, "OpenAI-Codex-NOTICE.txt"), "utf8"),
  readFile(join(root, "legal", "OpenAI-Codex-Apache-2.0.txt"), "utf8"),
  readFile(join(root, "legal", "OpenAI-Codex-NOTICE.txt"), "utf8"),
]);
if (
  !dougoosLicense.includes("GNU AFFERO GENERAL PUBLIC LICENSE") ||
  !sourceOffer.includes(manifest.sourceArchiveUrl) ||
  !thirdPartyNotices.includes("does not distribute or launch") ||
  !thirdPartyNotices.includes("@agentclientprotocol/claude-agent-acp") ||
  !thirdPartyNotices.includes("@anthropic-ai/claude-agent-sdk") ||
  !thirdPartyNotices.includes("@openai/codex@0.145.0") ||
  !thirdPartyNotices.includes("@openai/codex-darwin-arm64@0.145.0-darwin-arm64") ||
  !thirdPartyNotices.includes("rust-v0.145.0") ||
  !thirdPartyNotices.includes("legal/FRONTEND_THIRD_PARTY_LICENSES.txt") ||
  !thirdPartyNotices.includes("beside this notice in packaged legal directories") ||
  !instrumentSansLicense.includes("Copyright 2022 The Instrument Sans Project Authors") ||
  !instrumentSansLicense.includes("SIL OPEN FONT LICENSE Version 1.1") ||
  !jetBrainsMonoLicense.includes("Copyright 2020 The JetBrains Mono Project Authors") ||
  !jetBrainsMonoLicense.includes("SIL OPEN FONT LICENSE Version 1.1") ||
  !frontendLicenses.includes("react@19.2.8") ||
  !frontendLicenses.includes("react-dom@19.2.8") ||
  !frontendLicenses.includes("scheduler@0.27.0") ||
  !frontendLicenses.includes("react-markdown@10.1.0") ||
  !frontendLicenses.includes("remark-gfm@4.0.1") ||
  !frontendLicenses.includes("zod@4.4.3") ||
  !frontendLicenses.includes("vite@8.1.5") ||
  !frontendLicenses.includes("Copyright (c) Meta Platforms, Inc. and affiliates.") ||
  codexLicense !== sourceCodexLicense ||
  codexNotice !== sourceCodexNotice ||
  !codexLicense.includes("Copyright 2025 OpenAI") ||
  !codexNotice.includes("Copyright (c) 2023-2025 The Ratatui Developers")
) {
  throw new Error("Packaged legal materials are incomplete");
}
await stat(join(manifest.legalPath, "Electron-LICENSE.txt"));
await stat(join(manifest.legalPath, "LICENSES.chromium.html"));
const unpackedModulesPath = join(
  manifest.appPath,
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "node_modules",
);
const [codexPackage, codexPlatformPackage] = await Promise.all([
  readFile(join(unpackedModulesPath, "@openai", "codex", "package.json"), "utf8").then(JSON.parse),
  readFile(join(unpackedModulesPath, "@openai", "codex-darwin-arm64", "package.json"), "utf8").then(
    JSON.parse,
  ),
]);
if (
  codexPackage.name !== "@openai/codex" ||
  codexPackage.version !== "0.145.0" ||
  codexPlatformPackage.name !== "@openai/codex" ||
  codexPlatformPackage.version !== "0.145.0-darwin-arm64"
) {
  throw new Error("Packaged OpenAI Codex versions do not match the bundled legal materials");
}
for (const packagePath of [["@agentclientprotocol", "claude-agent-acp"]]) {
  try {
    await stat(join(unpackedModulesPath, ...packagePath));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  throw new Error(`Packaged app unexpectedly contains ${packagePath.join("/")}`);
}
let anthropicPackages = [];
try {
  anthropicPackages = await readdir(join(unpackedModulesPath, "@anthropic-ai"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const bundledClaudeSdk = anthropicPackages.find((name) => name.startsWith("claude-agent-sdk"));
if (bundledClaudeSdk !== undefined) {
  throw new Error(`Packaged app unexpectedly contains @anthropic-ai/${bundledClaudeSdk}`);
}
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
