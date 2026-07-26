import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { _electron as electron } from "@playwright/test";

const execute = promisify(execFile);
const root = process.cwd();
const selectedProvider = process.argv[2] ?? "codex";
const manifest = JSON.parse(
  await readFile(join(root, ".artifacts", "desktop-package.json"), "utf8"),
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "dougoos-packaged-provider-"));
const databasePath = join(temporaryDirectory, "packaged-provider.sqlite");
const userDataPath = join(temporaryDirectory, "user-data");
const application = await electron.launch({
  args: [`--user-data-dir=${userDataPath}`],
  env: {
    ...process.env,
    DOUGOOS_DISABLE_UPDATES: "1",
    DOUGOOS_DATABASE_PATH: databasePath,
  },
  executablePath: manifest.executablePath,
});
const rootPid = application.process().pid;
let trackedProcessIds = new Set([rootPid]);
let result;
let survivingProcessIds;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function descendantProcessIds(parentPid) {
  const { stdout } = await execute("ps", ["-axo", "pid=,ppid="]);
  const children = new Map();
  for (const line of stdout.split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/u);
    const pid = Number(pidText);
    const parent = Number(parentText);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) continue;
    const existing = children.get(parent) ?? [];
    existing.push(pid);
    children.set(parent, existing);
  }
  const descendants = new Set([parentPid]);
  const pending = [parentPid];
  while (pending.length > 0) {
    const parent = pending.pop();
    if (parent === undefined) continue;
    for (const child of children.get(parent) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      pending.push(child);
    }
  }
  return descendants;
}

try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => globalThis.document.title === "DougoOS", undefined, {
    timeout: 45_000,
  });
  const connection = await page.evaluate(async () => {
    if (globalThis.dougoos === undefined) throw new Error("Packaged preload bridge is unavailable");
    return globalThis.dougoos.getCoreConnection();
  });
  result = await page.evaluate(
    async ({ core, cwd, providerId }) => {
      const request = async (path, body) => {
        const response = await globalThis.fetch(`http://127.0.0.1:${core.port}${path}`, {
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          headers: {
            authorization: `Bearer ${core.token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          method: body === undefined ? "GET" : "POST",
        });
        return { body: await response.json(), status: response.status };
      };
      const providers = await request("/api/providers");
      const provider = providers.body.providers?.find((item) => item.id === providerId);
      if (provider === undefined) {
        return { errorCode: "PROVIDER_NOT_REGISTERED", providerId, status: "unavailable" };
      }
      if (provider.status !== "available") {
        return {
          errorCode: provider.status,
          providerId,
          status: "unavailable",
          version: provider.version ?? null,
        };
      }
      const created = await request("/api/sessions", { cwd, providerId });
      if (created.status !== 201) {
        return {
          errorCode: created.body.code ?? "SESSION_CREATE_FAILED",
          providerId,
          status: "failed",
          version: provider.version ?? null,
        };
      }
      const sessionId = created.body.session.id;
      const queued = await request(`/api/sessions/${sessionId}/turns`, {
        clientRequestId: globalThis.crypto.randomUUID(),
        content: [
          {
            text: "Reply with exactly DOUGOOS_PACKAGE_SMOKE_OK. Do not use tools or modify files.",
            type: "text",
          },
        ],
      });
      if (queued.status !== 202) {
        return {
          errorCode: queued.body.code ?? "TURN_CREATE_FAILED",
          providerId,
          status: "failed",
          version: provider.version ?? null,
        };
      }
      const terminal = new Set(["cancelled", "completed", "failed", "interrupted"]);
      const deadline = Date.now() + 120_000;
      let snapshot;
      let turn;
      while (Date.now() < deadline) {
        const response = await request(`/api/sessions/${sessionId}`);
        snapshot = response.body;
        turn = snapshot.turns?.find((item) => item.id === queued.body.turnId);
        if (turn !== undefined && terminal.has(turn.status)) break;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
      }
      return {
        capabilityProtocol: provider.capabilities?.protocolVersion ?? null,
        errorCode: turn?.error?.code ?? null,
        messageKinds: [...new Set(snapshot?.messages?.map((message) => message.kind) ?? [])],
        providerId,
        status: turn?.status ?? "timeout",
        stopReason: turn?.stopReason ?? null,
        version: provider.version ?? null,
      };
    },
    { core: connection, cwd: temporaryDirectory, providerId: selectedProvider },
  );
  if (result.status !== "completed") {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
    const diagnosticText = await readFile(
      join(temporaryDirectory, "logs", "agent-stderr.log"),
      "utf8",
    ).catch(() => "");
    const diagnostics = diagnosticText
      .trim()
      .split("\n")
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line);
          return typeof entry.text === "string" ? [entry.text] : [];
        } catch {
          return [];
        }
      })
      .slice(-3);
    result = { ...result, diagnostics };
  }
  trackedProcessIds = await descendantProcessIds(rootPid);
} finally {
  await application.close();
  const deadline = Date.now() + 10_000;
  while ([...trackedProcessIds].some(processExists) && Date.now() < deadline) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  survivingProcessIds = [...trackedProcessIds].filter(processExists);
  await rm(temporaryDirectory, { force: true, recursive: true });
}

if (survivingProcessIds !== undefined && survivingProcessIds.length > 0) {
  throw new Error(`Packaged Provider process tree did not exit: ${survivingProcessIds.join(", ")}`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result?.status !== "completed") {
  throw new Error("Packaged Provider smoke did not reach completed");
}
