#!/usr/bin/env node

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";

import type { InitializeResponse } from "@agentclientprotocol/sdk";

import { DefaultAgentSessionRegistry } from "./registry.js";
import type { AgentProvider, AgentSessionRegistry, AgentTurnHandle } from "./types.js";

export interface ReplOptions {
  readonly cwd: string;
  readonly input: Readable;
  readonly output: Writable;
  readonly providerId: string;
  readonly registry: AgentSessionRegistry;
}

export async function runAcpRepl(options: ReplOptions): Promise<void> {
  const session = await options.registry.create({
    cwd: options.cwd,
    providerId: options.providerId,
  });
  const lines = createInterface({ input: options.input, terminal: false });
  let activeTurn: AgentTurnHandle | undefined;
  const unsubscribe = session.subscribe((runtimeEvent) => {
    options.output.write(`${JSON.stringify(runtimeEvent.event)}\n`);
  });

  options.output.write(
    "ACP REPL ready. Enter a prompt, /approve <requestId> <optionId>, /cancel, or /quit.\n",
  );
  try {
    for await (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      if (line === "/quit") break;
      if (line === "/cancel") {
        await activeTurn?.cancel();
        continue;
      }
      if (line.startsWith("/approve ")) {
        const [, requestId, optionId] = line.split(/\s+/u);
        if (requestId === undefined || optionId === undefined) {
          options.output.write("Usage: /approve <requestId> <optionId>\n");
        } else {
          await session.resolveApproval(requestId, optionId);
        }
        continue;
      }
      if (activeTurn !== undefined) {
        options.output.write("A Turn is already active. Use /cancel or wait for completion.\n");
        continue;
      }
      activeTurn = await session.startTurn({ text: line, turnId: crypto.randomUUID() });
      void activeTurn.completion.finally(() => {
        activeTurn = undefined;
      });
    }
  } finally {
    unsubscribe();
    lines.close();
    await session.dispose();
  }
}

interface CliArguments {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly providerId: string;
}

function parseArguments(argv: readonly string[]): CliArguments {
  let command: string | undefined;
  let cwd = process.cwd();
  let providerId = "command";
  const args: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--") {
      continue;
    } else if (value === "--command" && next !== undefined) {
      command = next;
      index += 1;
    } else if (value === "--cwd" && next !== undefined) {
      cwd = next;
      index += 1;
    } else if (value === "--provider" && next !== undefined) {
      providerId = next;
      index += 1;
    } else if (value === "--arg" && next !== undefined) {
      args.push(next);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${value ?? ""}`);
    }
  }
  if (command === undefined) {
    throw new Error("--command is required");
  }
  return { args, command, cwd, providerId };
}

class ReplCommandProvider implements AgentProvider {
  readonly defaultPermissionProfileId = "external";
  readonly displayName: string;
  readonly id: string;
  readonly permissionEnforcement = "not_guaranteed" as const;
  readonly permissionProfiles: AgentProvider["permissionProfiles"] = [
    {
      description: "Permissions are controlled by the explicitly supplied ACP command.",
      id: "external",
      label: "External command policy",
      mechanism: "external",
      permissionEnforcement: "not_guaranteed",
      requiresNewSession: true,
      risk: "dangerous",
      semantic: "external",
    },
  ];
  readonly processPolicy = { maxSessionsPerProcess: 1, multiSessionPerProcess: false } as const;
  readonly #args: readonly string[];
  readonly #command: string;

  constructor(options: CliArguments) {
    this.#args = options.args;
    this.#command = options.command;
    this.displayName = options.providerId;
    this.id = options.providerId;
  }

  available(): Promise<{ readonly ok: true; readonly version: string }> {
    return Promise.resolve({ ok: true, version: "command" });
  }

  chooseAuthMethod(initialize: InitializeResponse): string | null {
    return initialize.authMethods?.[0]?.id ?? null;
  }

  resolveCommand(): {
    readonly args: readonly string[];
    readonly command: string;
  } {
    return { args: this.#args, command: this.#command };
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const provider = new ReplCommandProvider(options);
  const registry = new DefaultAgentSessionRegistry({ providers: [provider] });
  try {
    await runAcpRepl({
      cwd: options.cwd,
      input: process.stdin,
      output: process.stdout,
      providerId: provider.id,
      registry,
    });
  } finally {
    await registry.disposeAll();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "ACP REPL failed"}\n`);
    process.exitCode = 1;
  });
}
