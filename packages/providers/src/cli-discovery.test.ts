import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentCliDiscovery,
  KNOWN_AGENT_CLIS,
  readAgentCliVersion,
  resolveAgentCliExecutable,
  type AgentCliSpec,
} from "./cli-discovery.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dougoos-cli-discovery-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Agent CLI discovery", () => {
  it("maps every built-in Provider to one bounded known CLI command", () => {
    expect(
      KNOWN_AGENT_CLIS.filter(({ integratedProviderId }) => integratedProviderId !== undefined).map(
        ({ command, integratedProviderId }) => [integratedProviderId, command],
      ),
    ).toEqual([
      ["claude-code", "claude"],
      ["codex", "codex"],
      ["cursor-agent", "cursor-agent"],
      ["grok", "grok"],
      ["hermes", "hermes"],
      ["openclaw", "openclaw"],
      ["opencode", "opencode"],
      ["pi", "pi"],
    ]);
  });

  it("resolves only an executable known command from PATH", async () => {
    const directory = await temporaryDirectory();
    const executable = join(directory, "codex");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(executable, 0o755);
    const spec: AgentCliSpec = {
      command: "codex",
      displayName: "Codex",
      integratedProviderId: "codex",
    };

    await expect(
      resolveAgentCliExecutable(spec, { HOME: directory, PATH: directory }),
    ).resolves.toBe(executable);
    await chmod(executable, 0o644);
    await expect(
      resolveAgentCliExecutable(spec, { HOME: directory, PATH: directory }),
    ).resolves.toBeNull();
  });

  it("uses explicit Provider overrides before PATH", async () => {
    const directory = await temporaryDirectory();
    const configured = join(directory, "company-claude");
    await writeFile(configured, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(configured, 0o755);

    await expect(
      resolveAgentCliExecutable(
        {
          command: "claude",
          displayName: "Claude Code",
          environmentOverride: "CLAUDE_CODE_EXECUTABLE",
        },
        {
          CLAUDE_CODE_EXECUTABLE: configured,
          HOME: directory,
          PATH: "/missing",
        },
      ),
    ).resolves.toBe(configured);
  });

  it("returns installed commands with bounded versions and honors TTL refresh", async () => {
    const now = vi.fn(() => Date.parse("2026-07-24T08:00:00.000Z"));
    const resolveExecutable = vi.fn((spec: AgentCliSpec) =>
      Promise.resolve(spec.command === "codex" ? "/safe/bin/codex" : null),
    );
    const readVersion = vi.fn(() => Promise.resolve("codex-cli 0.145.0"));
    const discovery = new AgentCliDiscovery({
      cacheTtlMs: 30_000,
      clock: now,
      environment: {},
      readVersion,
      resolveExecutable,
      specs: [
        {
          command: "claude",
          displayName: "Claude Code",
          integratedProviderId: "claude-code",
        },
        {
          command: "codex",
          displayName: "Codex",
          integratedProviderId: "codex",
        },
      ],
    });

    await expect(discovery.scan()).resolves.toEqual({
      checkedAt: "2026-07-24T08:00:00.000Z",
      clis: [
        {
          command: "codex",
          detectedAt: "2026-07-24T08:00:00.000Z",
          displayName: "Codex",
          executablePath: "/safe/bin/codex",
          integratedProviderId: "codex",
          version: "codex-cli 0.145.0",
        },
      ],
    });
    await discovery.scan();
    expect(resolveExecutable).toHaveBeenCalledTimes(2);
    await discovery.scan({ force: true });
    expect(resolveExecutable).toHaveBeenCalledTimes(4);
  });

  it("bounds a hanging version probe instead of blocking discovery", async () => {
    const directory = await temporaryDirectory();
    const hanging = join(directory, "hanging-cli");
    await writeFile(hanging, "#!/usr/bin/env node\nsetInterval(() => {}, 1_000);\n", "utf8");
    await chmod(hanging, 0o755);

    await expect(
      readAgentCliVersion(hanging, { PATH: process.env.PATH }, 25),
    ).resolves.toBeUndefined();
  });
});
