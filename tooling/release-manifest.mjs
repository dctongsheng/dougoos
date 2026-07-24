import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestRelativePath = "release/p0-p1-mvp.json";
const manifestPath = path.join(rootDir, manifestRelativePath);

const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(rootDir, relativePath), "utf8"));

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

const listReleaseInputs = () => {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: rootDir,
      encoding: "buffer",
    },
  );

  const indexEntries = listIndexEntries();

  return output
    .toString("utf8")
    .split("\0")
    .filter((relativePath) => relativePath && relativePath !== manifestRelativePath)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map((relativePath) => ({
      relativePath,
      ...indexEntries.get(relativePath),
    }));
};

const hashReleaseInputs = async (files) => {
  const hash = createHash("sha256");
  hash.update("dougoos-release-inputs-v1\0");

  for (const { mode, objectId, relativePath } of files) {
    const absolutePath = path.join(rootDir, relativePath);
    const stats = mode === "160000" ? undefined : await lstat(absolutePath);
    const content =
      mode === "160000"
        ? Buffer.from(objectId)
        : stats.isSymbolicLink()
          ? Buffer.from(await readlink(absolutePath))
          : await readFile(absolutePath);
    const type =
      mode === "160000" ? "gitlink" : (mode ?? (stats.isSymbolicLink() ? "symlink" : "file"));
    const pathBytes = Buffer.from(relativePath);

    hash.update(`${String(pathBytes.length)}:`);
    hash.update(pathBytes);
    hash.update(`:${type}:${String(content.length)}:`);
    hash.update(content);
    hash.update("\0");
  }

  return hash.digest("hex");
};

const buildManifest = async () => {
  const [
    rootPackage,
    webPackage,
    desktopPackage,
    acpPackage,
    providersPackage,
    storagePackage,
    referenceRun,
    visualManifest,
  ] = await Promise.all([
    readJson("package.json"),
    readJson("apps/web/package.json"),
    readJson("apps/desktop/package.json"),
    readJson("packages/acp/package.json"),
    readJson("packages/providers/package.json"),
    readJson("packages/storage/package.json"),
    readJson("tests/visual/reference/run.json"),
    readJson("tests/visual/reference/manifest.resolved.json"),
  ]);
  const files = listReleaseInputs();
  const referenceCases = visualManifest.referenceCases;
  const productionOnlyCases = visualManifest.productionOnlyCases;
  const productionReferenceCaseCount = referenceCases.filter(
    (visualCase) => visualCase.kind !== "source-defect",
  ).length;

  return {
    schema: "dougoos.release-manifest.v1",
    release: {
      name: "p0-p1-mvp",
      version: rootPackage.version,
    },
    source: {
      algorithm:
        "sha256(path-length:path:type:size:content; git releasable inputs; manifest excluded)",
      fileCount: files.length,
      sha256: await hashReleaseInputs(files),
    },
    runtime: {
      node: rootPackage.engines.node,
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
      recordedOn: "2026-07-24",
      packageTests: {
        command: "pnpm check",
        packageCount: 8,
        passed: 317,
        status: "passed",
      },
      e2e: {
        command: "pnpm test:e2e",
        passed: 14,
        status: "passed",
      },
      visual: {
        command: "pnpm test:visual",
        blockingFindings: {
          productionReferenceDrift: true,
          productionSevenMessageTypesMissingThink: true,
        },
        playwrightTestsFailed: 2,
        playwrightTestsPassed: 7,
        playwrightTestsTotal: 9,
        prototypeReferenceCases: referenceRun.caseCount,
        productionReferenceCases: productionReferenceCaseCount,
        productionOnlyCases: productionOnlyCases.length,
        status: "blocked",
        totalProductionCases: productionReferenceCaseCount + productionOnlyCases.length,
      },
      buildSmoke: {
        command: "pnpm smoke:build",
        esmEntriesImported: 8,
        status: "passed",
      },
    },
  };
};

const usage = "Usage: node tooling/release-manifest.mjs --write|--check";
const mode = process.argv[2];
if (!["--write", "--check"].includes(mode) || process.argv.length !== 3) {
  throw new Error(usage);
}

const expected = `${JSON.stringify(await buildManifest(), null, 2)}\n`;

if (mode === "--write") {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, expected);
  console.log(`release manifest written: ${manifestRelativePath}`);
} else {
  let actual;
  try {
    actual = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Release manifest is missing. Run: pnpm release:manifest`, {
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
        "Release manifest is stale. Run: pnpm release:manifest",
        `recorded source: ${String(actualManifest.source?.fileCount)} files / ${String(actualManifest.source?.sha256)}`,
        `current source: ${String(expectedManifest.source.fileCount)} files / ${String(expectedManifest.source.sha256)}`,
      ].join("\n"),
    );
  }

  console.log(`release manifest verified: ${manifestRelativePath}`);
}
