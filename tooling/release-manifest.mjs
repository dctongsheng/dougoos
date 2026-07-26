import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GIT_BLOB_MAX_BUFFER = 64 * 1024 * 1024;

const releaseDefinitions = {
  "p0-p1-mvp": {
    manifestRelativePath: "release/p0-p1-mvp.json",
    recordedOn: "2026-07-24",
    sourceRef: "p0-p1-mvp",
    verification: {
      packageTests: {
        command: "pnpm check",
        packageCount: 8,
        passed: 319,
        status: "passed",
      },
      e2e: {
        command: "pnpm test:e2e",
        passed: 15,
        status: "passed",
      },
      visual: {
        command: "pnpm test:visual",
        blockingFindings: [],
        playwrightTestsFailed: 0,
        playwrightTestsPassed: 9,
        playwrightTestsTotal: 9,
        prototypeReferenceCases: 156,
        productionReferenceCases: 155,
        productionOnlyCases: 16,
        status: "passed",
        totalProductionCases: 171,
      },
      buildSmoke: {
        command: "pnpm smoke:build",
        esmEntriesImported: 8,
        status: "passed",
      },
    },
  },
  "v0.2.0": {
    manifestRelativePath: "release/v0.2.0.json",
    recordedOn: "2026-07-26",
    sourceRef: "v0.2.0",
    verification: {
      gates: [
        { command: "pnpm check", status: "passed" },
        { command: "pnpm test:e2e", status: "passed" },
        { command: "pnpm test:visual", status: "passed" },
        { command: "pnpm smoke:build", status: "passed" },
        { command: "pnpm smoke:package", status: "passed" },
      ],
      releaseReview: {
        blockingFindings: [],
        document: "docs/plan/reviews/early-access-0.2.0-02.md",
        status: "passed",
      },
    },
  },
};

const readReleaseNodeVersion = async (source) => {
  const rawVersion = await source.read(".nvmrc");
  const version = rawVersion.toString("utf8").trim();

  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(".nvmrc must contain one exact stable Node.js version");
  }
  if (rawVersion.toString("utf8") !== `${version}\n`) {
    throw new Error(".nvmrc must contain only the exact Node.js version followed by a newline");
  }

  return version;
};

const refExists = (ref) => {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: rootDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const createRefSource = (ref, manifestRelativePath) => {
  const entriesOutput = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", ref], {
    cwd: rootDir,
    encoding: "buffer",
  });
  const entries = entriesOutput
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const tabIndex = record.indexOf("\t");
      const [mode, type, objectId] = record.slice(0, tabIndex).split(" ");
      return { mode, objectId, relativePath: record.slice(tabIndex + 1), type };
    });
  const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  return {
    files: entries
      .filter((entry) => entry.relativePath !== manifestRelativePath)
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)),
      ),
    async read(relativePath) {
      const entry = byPath.get(relativePath);
      if (entry === undefined || entry.type !== "blob") {
        throw new Error(`${relativePath} is not a file in ${ref}`);
      }
      return execFileSync("git", ["cat-file", "blob", entry.objectId], {
        cwd: rootDir,
        encoding: "buffer",
        maxBuffer: GIT_BLOB_MAX_BUFFER,
      });
    },
    ref,
  };
};

const listIndexEntries = () => {
  const output = execFileSync("git", ["ls-files", "--stage", "-z"], {
    cwd: rootDir,
    encoding: "buffer",
  });
  const entries = new Map();

  for (const record of output.toString("utf8").split("\0").filter(Boolean)) {
    const tabIndex = record.indexOf("\t");
    const [mode, objectId] = record.slice(0, tabIndex).split(" ");
    entries.set(record.slice(tabIndex + 1), { mode, objectId });
  }

  return entries;
};

const createWorktreeSource = (sourceRef, manifestRelativePath) => {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: rootDir,
      encoding: "buffer",
    },
  );
  const indexEntries = listIndexEntries();
  return {
    files: output
      .toString("utf8")
      .split("\0")
      .filter((relativePath) => relativePath && relativePath !== manifestRelativePath)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((relativePath) => ({
        relativePath,
        type: "worktree",
        ...indexEntries.get(relativePath),
      })),
    read(relativePath) {
      return readFile(path.join(rootDir, relativePath));
    },
    ref: sourceRef,
  };
};

const hashReleaseInputs = async (source) => {
  const hash = createHash("sha256");
  hash.update("dougoos-release-inputs-v1\0");

  for (const { mode, objectId, relativePath, type } of source.files) {
    let content;
    let fileType;
    if (type === "commit" || mode === "160000") {
      content = Buffer.from(objectId);
      fileType = "gitlink";
    } else if (type === "blob") {
      content = execFileSync("git", ["cat-file", "blob", objectId], {
        cwd: rootDir,
        encoding: "buffer",
        maxBuffer: GIT_BLOB_MAX_BUFFER,
      });
      fileType = mode;
    } else {
      const absolutePath = path.join(rootDir, relativePath);
      const stats = await lstat(absolutePath);
      content = stats.isSymbolicLink()
        ? Buffer.from(await readlink(absolutePath))
        : await readFile(absolutePath);
      fileType = mode ?? (stats.isSymbolicLink() ? "symlink" : "file");
    }
    const pathBytes = Buffer.from(relativePath);
    hash.update(`${String(pathBytes.length)}:`);
    hash.update(pathBytes);
    hash.update(`:${fileType}:${String(content.length)}:`);
    hash.update(content);
    hash.update("\0");
  }

  return hash.digest("hex");
};

const readJson = async (source, relativePath) =>
  JSON.parse((await source.read(relativePath)).toString("utf8"));

const buildManifest = async (name, definition, source) => {
  const [
    releaseNodeVersion,
    rootPackage,
    webPackage,
    desktopPackage,
    acpPackage,
    providersPackage,
    storagePackage,
    referenceRun,
  ] = await Promise.all([
    readReleaseNodeVersion(source),
    readJson(source, "package.json"),
    readJson(source, "apps/web/package.json"),
    readJson(source, "apps/desktop/package.json"),
    readJson(source, "packages/acp/package.json"),
    readJson(source, "packages/providers/package.json"),
    readJson(source, "packages/storage/package.json"),
    readJson(source, "tests/visual/reference/run.json"),
  ]);
  const nodeEngineCompatibility = rootPackage.engines?.node;
  if (typeof nodeEngineCompatibility !== "string" || nodeEngineCompatibility.length === 0) {
    throw new Error("package.json#engines.node must declare Node.js compatibility");
  }

  return {
    schema: "dougoos.release-manifest.v1",
    release: {
      name,
      version: rootPackage.version,
    },
    source: {
      algorithm:
        "sha256(path-length:path:type:size:content; Git ref or releasable worktree inputs; current manifest excluded)",
      fileCount: source.files.length,
      ref: source.ref,
      sha256: await hashReleaseInputs(source),
    },
    runtime: {
      node: releaseNodeVersion,
      nodeEngineCompatibility,
      pnpm: rootPackage.packageManager,
      chromium: referenceRun.browser.version,
    },
    dependencies: {
      acpSdk: acpPackage.dependencies["@agentclientprotocol/sdk"],
      betterSqlite3: storagePackage.dependencies["better-sqlite3"],
      claudeAgentAcp: providersPackage.dependencies["@agentclientprotocol/claude-agent-acp"],
      codexAcp: providersPackage.dependencies["@agentclientprotocol/codex-acp"],
      electron: desktopPackage.devDependencies.electron,
      playwright: rootPackage.devDependencies["@playwright/test"],
      react: webPackage.dependencies.react,
      typescript: rootPackage.devDependencies.typescript,
    },
    verification: {
      recordedOn: definition.recordedOn,
      ...definition.verification,
    },
  };
};

const usage = "Usage: node tooling/release-manifest.mjs --write|--check [--name p0-p1-mvp|v0.2.0]";
const args = process.argv.slice(2);
const mode = args.shift();
let name = "p0-p1-mvp";
if (args.length > 0) {
  if (args[0] !== "--name" || args.length !== 2) throw new Error(usage);
  name = args[1];
}
if (!["--write", "--check"].includes(mode) || !(name in releaseDefinitions)) {
  throw new Error(usage);
}

const definition = releaseDefinitions[name];
const manifestPath = path.join(rootDir, definition.manifestRelativePath);
const useRef = refExists(definition.sourceRef);
if (mode === "--check" && !useRef) {
  throw new Error(`Release source ref is missing: ${definition.sourceRef}`);
}
const source = useRef
  ? createRefSource(definition.sourceRef, definition.manifestRelativePath)
  : createWorktreeSource(definition.sourceRef, definition.manifestRelativePath);
const expected = `${JSON.stringify(await buildManifest(name, definition, source), null, 2)}\n`;

if (mode === "--write") {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, expected);
  console.log(
    `release manifest written: ${definition.manifestRelativePath} (${useRef ? definition.sourceRef : "worktree"})`,
  );
} else {
  let actual;
  try {
    actual = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Release manifest is missing: ${definition.manifestRelativePath}`, {
        cause: error,
      });
    }
    throw error;
  }
  if (actual !== expected) {
    const actualManifest = JSON.parse(actual);
    const expectedManifest = JSON.parse(expected);
    throw new Error(
      [
        `Release manifest is stale: ${definition.manifestRelativePath}`,
        `recorded source: ${String(actualManifest.source?.fileCount)} files / ${String(actualManifest.source?.sha256)}`,
        `expected source: ${String(expectedManifest.source.fileCount)} files / ${String(expectedManifest.source.sha256)}`,
      ].join("\n"),
    );
  }
  console.log(
    `release manifest verified: ${definition.manifestRelativePath} @ ${definition.sourceRef}`,
  );
}
