import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProviderSchema, type ProviderDoctorResult } from "@dougoos/shared";
import { afterEach, describe, expect, it } from "vitest";

import { generateBearerToken } from "./app.js";
import { startCore, type CoreServer } from "./server.js";
import type { CoreRegistry, CreateRegistrySessionInput } from "./types.js";

const NOW = "2026-07-24T08:00:00.000Z";
const CAPABILITIES = {
  clientProxy: { config: false, fileSystem: false, terminal: false },
  negotiatedAt: NOW,
  permissionEnforcement: "requests_permission",
  protocolVersion: "1",
  session: { close: false, delete: false, list: false, load: false, resume: false },
  turn: { cancel: true, images: false, prompt: true },
} as const;
const PROVIDER = ProviderSchema.parse({
  capabilities: CAPABILITIES,
  checkedAt: NOW,
  displayName: "TCP Fake",
  id: "tcp-fake",
  processPolicy: { maxSessionsPerProcess: 1, multiSessionPerProcess: false },
  status: "available",
  version: "1.0.0",
});

class TcpRegistry implements CoreRegistry {
  failClose = false;
  failInitialize = false;

  cancelTurn() {
    return "cancelling" as const;
  }

  close() {
    if (this.failClose) throw new Error("registry close failed");
  }

  createSession(input: CreateRegistrySessionInput) {
    return {
      capabilities: CAPABILITIES,
      providerSessionId: `provider-${input.sessionId}`,
      title: "TCP session",
    };
  }

  doctor(providerId: string): ProviderDoctorResult {
    return {
      capabilities: CAPABILITIES,
      checkedAt: NOW,
      providerId,
      status: "available",
      version: "1.0.0",
    };
  }

  initialize() {
    if (this.failInitialize) throw new Error("registry unavailable");
  }

  listProviders() {
    return [PROVIDER];
  }

  onEvent() {
    return () => undefined;
  }

  resolveApproval() {}

  startTurn() {}
}

describe("real loopback Core server", () => {
  const directories: string[] = [];
  const servers: CoreServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(async (server) => await server.close()));
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  async function launch(registry = new TcpRegistry()) {
    const directory = mkdtempSync(join(tmpdir(), "dougoos-core-tcp-"));
    directories.push(directory);
    const token = generateBearerToken();
    const server = await startCore({
      appVersion: "0.0.0-test",
      bearerToken: token,
      databasePath: join(directory, "data.db"),
      registry,
    });
    servers.push(server);
    return { directory, server, token };
  }

  it("binds a random 127.0.0.1 port and serves authenticated JSON over real TCP", async () => {
    const { server, token } = await launch();
    expect(server.hostname).toBe("127.0.0.1");
    expect(server.port).toBeGreaterThan(0);
    await expect(server.ready).resolves.toBe(true);

    const url = `http://127.0.0.1:${server.port}`;
    const unauthorized = await fetch(`${url}/api/health/live`);
    expect(unauthorized.status).toBe(401);

    const live = await fetch(`${url}/api/health/live`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({
      instanceId: server.instanceId,
      status: "live",
    });

    const providers = await fetch(`${url}/api/providers`, {
      headers: {
        authorization: `Bearer ${token}`,
        origin: "app://dougoos",
      },
    });
    expect(providers.status).toBe(200);
    expect(await providers.json()).toEqual({ providers: [PROVIDER] });

    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.close()).resolves.toBeUndefined();
    servers.splice(servers.indexOf(server), 1);
  });

  it("closes promptly while an authenticated SSE connection is still active", async () => {
    const { server, token } = await launch();
    await expect(server.ready).resolves.toBe(true);
    const stream = await fetch(`http://127.0.0.1:${server.port}/api/events?afterSeq=0`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stream.status).toBe(200);

    await expect(server.close()).resolves.toBeUndefined();
  });

  it("keeps live available but ready at 503 when Registry initialization fails", async () => {
    const registry = new TcpRegistry();
    registry.failInitialize = true;
    const { server, token } = await launch(registry);
    await expect(server.ready).resolves.toBe(false);
    const url = `http://127.0.0.1:${server.port}`;
    const request = (path: string) =>
      fetch(`${url}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });

    expect((await request("/api/health/live")).status).toBe(200);
    const ready = await request("/api/health/ready");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ code: "CORE_NOT_READY" });
    expect((await request("/api/providers")).status).toBe(503);
  });

  it("streams journal replay and resumes after a real TCP disconnect", async () => {
    const { server, token } = await launch();
    await expect(server.ready).resolves.toBe(true);
    const url = `http://127.0.0.1:${server.port}`;
    const headers = {
      authorization: `Bearer ${token}`,
      origin: "app://dougoos",
    };

    const created = await fetch(`${url}/api/sessions`, {
      body: JSON.stringify({ cwd: directories.at(-1), providerId: "tcp-fake" }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;

    const first = await fetch(`${url}/api/events?afterSeq=0`, {
      headers: { ...headers, accept: "text/event-stream" },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const firstReader = first.body?.getReader();
    if (firstReader === undefined) throw new Error("SSE response did not expose a body");
    const firstFrame = await firstReader.read();
    expect(new TextDecoder().decode(firstFrame.value)).toMatch(/^id: 1\ndata: /u);
    await firstReader.cancel();

    const turn = await fetch(`${url}/api/sessions/${sessionId}/turns`, {
      body: JSON.stringify({
        clientRequestId: "tcp-reconnect",
        content: [{ text: "resume", type: "text" }],
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    });
    expect(turn.status).toBe(202);

    const resumed = await fetch(`${url}/api/events?afterSeq=1`, {
      headers: { ...headers, accept: "text/event-stream" },
    });
    const resumedReader = resumed.body?.getReader();
    if (resumedReader === undefined) throw new Error("SSE response did not expose a body");
    try {
      const replayFrame = await resumedReader.read();
      expect(new TextDecoder().decode(replayFrame.value)).toMatch(/^id: 2\ndata: /u);
    } finally {
      await resumedReader.cancel();
    }
  });

  it("closes the real HTTP listener even when Registry shutdown reports an error", async () => {
    const registry = new TcpRegistry();
    registry.failClose = true;
    const { server, token } = await launch(registry);
    await server.ready;
    await expect(server.close()).rejects.toThrow("registry close failed");
    servers.splice(servers.indexOf(server), 1);

    await expect(
      fetch(`http://127.0.0.1:${server.port}/api/health/live`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    ).rejects.toThrow();
  });
});
