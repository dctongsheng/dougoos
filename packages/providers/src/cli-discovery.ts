import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

import {
  AgentCliInstallationSchema,
  ListAgentCliInstallationsResponseSchema,
  type AgentCliInstallation,
  type ListAgentCliInstallationsResponse,
} from "@dougoos/shared";

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_VERSION_TIMEOUT_MS = 3_000;
const MAX_VERSION_OUTPUT_BYTES = 4_096;

export interface AgentCliSpec {
  readonly command: string;
  readonly displayName: string;
  readonly environmentOverride?: string;
  readonly integratedProviderId?: string;
}

/**
 * Deliberately bounded to known Agent commands. DougoOS never crawls the whole
 * disk or executes arbitrary files merely because they are executable.
 */
export const KNOWN_AGENT_CLIS: readonly AgentCliSpec[] = [
  { command: "agy", displayName: "Antigravity" },
  { command: "codebuddy", displayName: "CodeBuddy" },
  {
    command: "codex",
    displayName: "Codex",
    environmentOverride: "CODEX_PATH",
    integratedProviderId: "codex",
  },
  { command: "copilot", displayName: "GitHub Copilot CLI" },
  {
    command: "cursor-agent",
    displayName: "Cursor Agent",
    environmentOverride: "CURSOR_AGENT_EXECUTABLE",
    integratedProviderId: "cursor-agent",
  },
  { command: "deveco", displayName: "DevEco CLI" },
  {
    command: "grok",
    displayName: "Grok CLI",
    environmentOverride: "GROK_BIN",
    integratedProviderId: "grok",
  },
  {
    command: "hermes",
    displayName: "Hermes",
    environmentOverride: "HERMES_BIN",
    integratedProviderId: "hermes",
  },
  { command: "kimi", displayName: "Kimi CLI" },
  { command: "kiro-cli", displayName: "Kiro CLI" },
  {
    command: "openclaw",
    displayName: "OpenClaw",
    environmentOverride: "OPENCLAW_BIN",
    integratedProviderId: "openclaw",
  },
  {
    command: "opencode",
    displayName: "OpenCode",
    environmentOverride: "OPENCODE_BIN",
    integratedProviderId: "opencode",
  },
  {
    command: "pi",
    displayName: "Pi",
    environmentOverride: "PI_BIN",
    integratedProviderId: "pi",
  },
  { command: "qwen", displayName: "Qwen Code" },
  { command: "qodercli", displayName: "Qoder CLI" },
  { command: "traecli", displayName: "Trae CLI" },
] as const;

type Environment = Readonly<Record<string, string | undefined>>;
type ResolveExecutable = (spec: AgentCliSpec, environment: Environment) => Promise<string | null>;
type ReadVersion = (
  executablePath: string,
  environment: Environment,
  timeoutMs: number,
) => Promise<string | undefined>;

export interface AgentCliDiscoveryPort {
  detectIntegrated(providerId: string): Promise<AgentCliInstallation | null>;
  scan(options?: { readonly force?: boolean }): Promise<ListAgentCliInstallationsResponse>;
}

export interface AgentCliDiscoveryOptions {
  readonly cacheTtlMs?: number;
  readonly clock?: () => number;
  readonly environment?: Environment;
  readonly readVersion?: ReadVersion;
  readonly resolveExecutable?: ResolveExecutable;
  readonly specs?: readonly AgentCliSpec[];
  readonly versionTimeoutMs?: number;
}

function executableNames(command: string, environment: Environment): readonly string[] {
  if (process.platform !== "win32") return [command];
  const extensions = (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
  return command.includes(".")
    ? [command]
    : [command, ...extensions.map((extension) => `${command}${extension}`)];
}

async function executableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function versionManagerDirectories(home: string): Promise<readonly string[]> {
  const roots = [
    { binSuffix: "bin", root: join(home, ".nvm", "versions", "node") },
    {
      binSuffix: join("installation", "bin"),
      root: join(home, ".local", "share", "fnm", "node-versions"),
    },
  ] as const;
  const directories: string[] = [];
  for (const candidate of roots) {
    try {
      const versions = await readdir(candidate.root, { withFileTypes: true });
      for (const version of versions) {
        if (version.isDirectory()) {
          directories.push(join(candidate.root, version.name, candidate.binSuffix));
        }
      }
    } catch {
      // A missing version manager is the normal case.
    }
  }
  return directories;
}

async function searchDirectories(environment: Environment): Promise<readonly string[]> {
  const home = environment.HOME ?? environment.USERPROFILE ?? homedir();
  const fromPath = (environment.PATH ?? "").split(delimiter).filter(Boolean);
  const common = [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".cargo", "bin"),
    join(home, "Library", "pnpm"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  return [...new Set([...fromPath, ...common, ...(await versionManagerDirectories(home))])];
}

export async function resolveAgentCliExecutable(
  spec: AgentCliSpec,
  environment: Environment = process.env,
): Promise<string | null> {
  const configured =
    spec.environmentOverride === undefined ? undefined : environment[spec.environmentOverride];
  const requested = configured?.trim() || spec.command;
  if (isAbsolute(requested) || requested.includes("/") || requested.includes("\\")) {
    const path = isAbsolute(requested) ? requested : resolve(requested);
    for (const name of executableNames(path, environment)) {
      if (await executableFile(name)) return resolve(name);
    }
    return null;
  }
  for (const directory of await searchDirectories(environment)) {
    for (const name of executableNames(requested, environment)) {
      const candidate = join(directory, name);
      if (await executableFile(candidate)) return resolve(candidate);
    }
  }
  return null;
}

function cleanVersionOutput(value: string): string | undefined {
  const line = value
    .split(/\r?\n/u)
    .map((part) =>
      [...part]
        .filter((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint >= 32 && codePoint !== 127;
        })
        .join("")
        .trim(),
    )
    .find(Boolean);
  return line === undefined ? undefined : line.slice(0, 256);
}

function safeVersionEnvironment(environment: Environment): NodeJS.ProcessEnv {
  const names = [
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SHELL",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
  ] as const;
  return {
    NO_BROWSER: "1",
    ...Object.fromEntries(
      names.flatMap((name) => {
        const value = environment[name];
        return value === undefined ? [] : [[name, value]];
      }),
    ),
  };
}

export function readAgentCliVersion(
  executablePath: string,
  environment: Environment = process.env,
  timeoutMs = DEFAULT_VERSION_TIMEOUT_MS,
): Promise<string | undefined> {
  return new Promise((resolveVersion) => {
    execFile(
      executablePath,
      ["--version"],
      {
        encoding: "utf8",
        env: safeVersionEnvironment(environment),
        maxBuffer: MAX_VERSION_OUTPUT_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          resolveVersion(undefined);
          return;
        }
        resolveVersion(cleanVersionOutput(`${stdout}\n${stderr}`));
      },
    );
  });
}

export class AgentCliDiscovery implements AgentCliDiscoveryPort {
  readonly #cacheTtlMs: number;
  readonly #clock: () => number;
  readonly #environment: Environment;
  readonly #readVersion: ReadVersion;
  readonly #resolveExecutable: ResolveExecutable;
  readonly #specs: readonly AgentCliSpec[];
  readonly #versionTimeoutMs: number;

  #cache: ListAgentCliInstallationsResponse | null = null;
  #cacheExpiresAt = 0;
  #scanPromise: Promise<ListAgentCliInstallationsResponse> | null = null;

  constructor(options: AgentCliDiscoveryOptions = {}) {
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#clock = options.clock ?? Date.now;
    this.#environment = options.environment ?? process.env;
    this.#readVersion = options.readVersion ?? readAgentCliVersion;
    this.#resolveExecutable = options.resolveExecutable ?? resolveAgentCliExecutable;
    this.#specs = options.specs ?? KNOWN_AGENT_CLIS;
    this.#versionTimeoutMs = options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS;
    if (this.#cacheTtlMs < 0) throw new TypeError("cacheTtlMs must not be negative");
    if (this.#versionTimeoutMs < 1) throw new TypeError("versionTimeoutMs must be positive");
  }

  async detectIntegrated(providerId: string): Promise<AgentCliInstallation | null> {
    const spec = this.#specs.find((candidate) => candidate.integratedProviderId === providerId);
    if (spec === undefined) return null;
    return await this.#detect(spec);
  }

  scan(options: { readonly force?: boolean } = {}): Promise<ListAgentCliInstallationsResponse> {
    const now = this.#clock();
    if (!options.force && this.#cache !== null && now < this.#cacheExpiresAt) {
      return Promise.resolve(this.#cache);
    }
    if (this.#scanPromise !== null) return this.#scanPromise;
    this.#scanPromise = (async () => {
      const detected = await Promise.all(this.#specs.map((spec) => this.#detect(spec)));
      const result = ListAgentCliInstallationsResponseSchema.parse({
        checkedAt: new Date(this.#clock()).toISOString(),
        clis: detected.filter((item): item is AgentCliInstallation => item !== null),
      });
      this.#cache = result;
      this.#cacheExpiresAt = this.#clock() + this.#cacheTtlMs;
      return result;
    })().finally(() => {
      this.#scanPromise = null;
    });
    return this.#scanPromise;
  }

  async #detect(spec: AgentCliSpec): Promise<AgentCliInstallation | null> {
    const executablePath = await this.#resolveExecutable(spec, this.#environment);
    if (executablePath === null) return null;
    const version = await this.#readVersion(
      executablePath,
      this.#environment,
      this.#versionTimeoutMs,
    );
    return AgentCliInstallationSchema.parse({
      command: spec.command,
      detectedAt: new Date(this.#clock()).toISOString(),
      displayName: spec.displayName,
      executablePath,
      ...(spec.integratedProviderId === undefined
        ? {}
        : { integratedProviderId: spec.integratedProviderId }),
      ...(version === undefined ? {} : { version }),
    });
  }
}
