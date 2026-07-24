import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProviderDoctorResult } from "@dougoos/shared";

import { generateBearerToken, packageManifest, startCore, type CoreRegistry } from "./index.js";

const directory = mkdtempSync(join(tmpdir(), "dougoos-core-debug-"));
const token = generateBearerToken();
const registry: CoreRegistry = {
  cancelTurn: () => "cancelled",
  createSession: () => {
    throw new Error("No debug Provider is configured");
  },
  doctor: (providerId): ProviderDoctorResult => ({
    checkedAt: new Date().toISOString(),
    providerId,
    reason: "Provider is not configured",
    remediation: "Run provider doctor after configuring a local Provider",
    status: "unavailable",
  }),
  initialize: () => undefined,
  listProviders: () => [],
  onEvent: () => () => undefined,
  resolveApproval: () => undefined,
  startTurn: () => undefined,
};

try {
  const server = await startCore({
    appVersion: "0.0.0-debug",
    bearerToken: token,
    databasePath: join(directory, "data.db"),
    registry,
  });
  try {
    const ready = await server.ready;
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health/ready`, {
      headers: { authorization: `Bearer ${token}` },
    });
    process.stdout.write(
      `${JSON.stringify({
        ...packageManifest,
        debug: ready && response.ok ? "ready" : "not_ready",
        hostname: server.hostname,
        httpStatus: response.status,
      })}\n`,
    );
  } finally {
    await server.close();
  }
} finally {
  rmSync(directory, { force: true, recursive: true });
}
