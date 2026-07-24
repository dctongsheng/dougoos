import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { GlobalSnapshot, Provider, SessionSnapshot } from "@dougoos/shared";

import { createAcpCoreRegistry } from "./acp-registry.js";
import { generateBearerToken } from "./app.js";
import { startCore } from "./server.js";

const TERMINAL = new Set(["cancelled", "completed", "failed", "interrupted"]);
const SMOKE_TIMEOUT_MS = 120_000;

interface ProviderSmokeResult {
  readonly capabilityProtocol: string | null;
  readonly errorCode: string | null;
  readonly failureClass: "auth" | "config" | "model" | "network" | "other" | "usage_limit" | null;
  readonly messageKinds: readonly string[];
  readonly protocolErrorCode: number | null;
  readonly providerId: string;
  readonly status: string;
  readonly stopReason: string | null;
  readonly version: string | null;
}

function classifyFailure(snapshot: SessionSnapshot | null): ProviderSmokeResult["failureClass"] {
  const text = snapshot?.messages
    .map((message) => ("body" in message ? message.body : ""))
    .join("\n");
  if (text === undefined || text.length === 0) return null;
  if (/(?:usage|rate) limit|quota/iu.test(text)) return "usage_limit";
  if (/unauthori[sz]ed|authentication|log[ -]?in/iu.test(text)) return "auth";
  if (/network|connection|stream disconnected|dns|connect/iu.test(text)) return "network";
  if (/model.{0,40}(?:not|unsupported|unavailable)/isu.test(text)) return "model";
  if (/config/iu.test(text)) return "config";
  return "other";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runProviderSmoke(
  selectedProvider = "all",
): Promise<readonly ProviderSmokeResult[]> {
  const directory = await mkdtemp(join(tmpdir(), "dougoos-provider-smoke-"));
  const token = generateBearerToken();
  const registry = createAcpCoreRegistry({ doctorCwd: directory });
  const server = await startCore({
    appVersion: "provider-smoke",
    bearerToken: token,
    databasePath: join(directory, "smoke.db"),
    registry,
  });
  const baseUrl = `http://127.0.0.1:${String(server.port)}`;
  const request = (path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method: body === undefined ? "GET" : "POST",
    });

  try {
    if (!(await server.ready)) throw new Error("Core did not become ready");
    const providersResponse = await request("/api/providers");
    const providersBody = (await providersResponse.json()) as { providers: Provider[] };
    const providers = providersBody.providers.filter(
      (provider) =>
        provider.status === "available" &&
        (selectedProvider === "all" || provider.id === selectedProvider),
    );
    if (providers.length === 0) {
      throw new Error("No selected authenticated Provider is available");
    }

    const results: ProviderSmokeResult[] = [];
    for (const provider of providers) {
      const created = await request("/api/sessions", {
        cwd: directory,
        providerId: provider.id,
      });
      if (!created.ok) {
        const failure = (await created.json()) as { code?: string };
        results.push({
          capabilityProtocol: provider.capabilities?.protocolVersion ?? null,
          errorCode: failure.code ?? "session_create_failed",
          failureClass: null,
          messageKinds: [],
          protocolErrorCode: null,
          providerId: provider.id,
          status: "session_create_failed",
          stopReason: null,
          version: provider.version ?? null,
        });
        continue;
      }
      const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
      const queued = await request(`/api/sessions/${sessionId}/turns`, {
        clientRequestId: randomUUID(),
        content: [
          {
            text: "Reply with exactly DOUGOOS_SMOKE_OK. Do not use tools and do not modify files.",
            type: "text",
          },
        ],
      });
      const turnId = ((await queued.json()) as { turnId: string }).turnId;
      const deadline = Date.now() + SMOKE_TIMEOUT_MS;
      let snapshot: SessionSnapshot | null = null;
      while (Date.now() < deadline) {
        const response = await request(`/api/sessions/${sessionId}`);
        snapshot = (await response.json()) as SessionSnapshot;
        const turn = snapshot.turns.find((candidate) => candidate.id === turnId);
        if (turn !== undefined && TERMINAL.has(turn.status)) break;
        await sleep(100);
      }
      const turn = snapshot?.turns.find((candidate) => candidate.id === turnId);
      if (turn === undefined || !TERMINAL.has(turn.status)) {
        throw new Error("Provider smoke timed out");
      }
      results.push({
        capabilityProtocol: provider.capabilities?.protocolVersion ?? null,
        errorCode: turn.error?.code ?? null,
        failureClass: turn.status === "failed" ? classifyFailure(snapshot) : null,
        messageKinds: [...new Set(snapshot?.messages.map((message) => message.kind) ?? [])],
        protocolErrorCode:
          typeof turn.error?.details?.actual === "number" ? turn.error.details.actual : null,
        providerId: provider.id,
        status: turn.status,
        stopReason: turn.stopReason,
        version: provider.version ?? null,
      });
    }

    const globalResponse = await request("/api/snapshot");
    if (!globalResponse.ok) {
      const failure = (await globalResponse.json()) as { code?: string };
      throw new Error(`Global snapshot failed: ${failure.code ?? "unknown"}`);
    }
    const global = (await globalResponse.json()) as GlobalSnapshot;
    if (global.activeTurns.length !== 0) {
      throw new Error("Provider smoke left an active Turn");
    }
    return results;
  } finally {
    await server.close().catch(() => undefined);
    await rm(directory, { force: true, recursive: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runProviderSmoke(process.argv[2]).then(
    (results) => process.stdout.write(`${JSON.stringify(results, null, 2)}\n`),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Provider smoke failed"}\n`);
      process.exitCode = 1;
    },
  );
}
