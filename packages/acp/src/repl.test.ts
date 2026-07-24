import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { InitializeResponse } from "@agentclientprotocol/sdk";
import { afterEach, expect, it, vi } from "vitest";

import { DefaultAgentSessionRegistry } from "./registry.js";
import { runAcpRepl } from "./repl.js";
import type { AgentProvider } from "./types.js";

const fixtureAgent = join(import.meta.dirname, "../test/fixtures/fake-agent.mjs");
const temporaryDirectories: string[] = [];

class ReplFixtureProvider implements AgentProvider {
  readonly displayName = "REPL Fixture";
  readonly id = "repl-fixture";
  readonly permissionEnforcement = "requests_permission" as const;
  readonly processPolicy = { maxSessionsPerProcess: 1, multiSessionPerProcess: false } as const;

  available(): Promise<{ readonly ok: true; readonly version: string }> {
    return Promise.resolve({ ok: true, version: "fixture" });
  }

  chooseAuthMethod(initialize: InitializeResponse): string | null {
    return initialize.authMethods?.[0]?.id ?? null;
  }

  resolveCommand() {
    return { args: [fixtureAgent], command: process.execPath };
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

it("runs approval and cancellation through the headless REPL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dougoos-repl-"));
  temporaryDirectories.push(directory);
  const registry = new DefaultAgentSessionRegistry({
    deltaWindowMs: 5,
    providers: [new ReplFixtureProvider()],
  });
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";
  output.on("data", (chunk: Buffer) => {
    rendered += chunk.toString("utf8");
  });
  const running = runAcpRepl({
    cwd: directory,
    input,
    output,
    providerId: "repl-fixture",
    registry,
  });

  await vi.waitFor(() => expect(rendered).toContain("ACP REPL ready"));
  input.write("[approval]\n");
  await vi.waitFor(() => expect(rendered).toContain('"type":"approval_request"'));
  const approvalLine = rendered
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as {
          readonly options?: readonly { readonly kind: string; readonly optionId: string }[];
          readonly requestId?: string;
          readonly type?: string;
        };
      } catch {
        return null;
      }
    })
    .find((entry) => entry?.type === "approval_request");
  const allow = approvalLine?.options?.find((option) => option.kind === "allow");
  if (approvalLine?.requestId === undefined || allow === undefined) {
    throw new Error("REPL approval was not rendered");
  }
  input.write(`/approve ${approvalLine.requestId} ${allow.optionId}\n`);
  await vi.waitFor(
    () => expect(rendered.match(/"type":"turn_end"/gu)?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: 2_000 },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  input.write("[cancel]\n");
  input.write("/cancel\n");
  await vi.waitFor(
    () => expect(rendered.match(/"type":"turn_end"/gu)?.length ?? 0).toBeGreaterThanOrEqual(2),
    { timeout: 2_000 },
  );
  expect(rendered).toContain('"stopReason":"cancelled"');

  input.end("/quit\n");
  await running;
  await registry.disposeAll();
});
