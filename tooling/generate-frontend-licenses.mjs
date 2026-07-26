import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const outputPath = join(workspaceRoot, "legal", "FRONTEND_THIRD_PARTY_LICENSES.txt");
const applicationManifests = [
  join(workspaceRoot, "apps", "cloud", "package.json"),
  join(workspaceRoot, "apps", "web", "package.json"),
];
const additionalRoots = [
  { name: "@fontsource/instrument-sans", traverse: true },
  { name: "@fontsource/jetbrains-mono", traverse: true },
  // Vite injects its module-preload runtime into both production bundles.
  { name: "vite", traverse: false },
];
const licenseFilePattern = /^(?:copying|licen[cs]e|notice)(?:[._-].*)?$/iu;

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function findInstalledPackage(name, issuerDirectory) {
  let directory = issuerDirectory;
  const root = parse(directory).root;
  while (true) {
    const candidate = join(directory, "node_modules", ...name.split("/"));
    try {
      const packageDirectory = await realpath(candidate);
      const manifest = await readJson(join(packageDirectory, "package.json"));
      if (manifest.name !== name) {
        throw new Error(
          `Resolved ${name} to a package named ${String(manifest.name)} at ${packageDirectory}`,
        );
      }
      return { manifest, packageDirectory };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (directory === root) break;
    directory = dirname(directory);
  }
  throw new Error(
    `Unable to resolve installed frontend dependency ${name} from ${issuerDirectory}`,
  );
}

function declaredLicense(manifest) {
  if (typeof manifest.license === "string" && manifest.license.trim() !== "") {
    return manifest.license.trim();
  }
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
    return manifest.licenses
      .map((license) => (typeof license === "string" ? license : license?.type))
      .filter((license) => typeof license === "string" && license !== "")
      .join(" OR ");
  }
  throw new Error(`${manifest.name}@${manifest.version} does not declare a license`);
}

async function readLicenseFiles(packageDirectory, manifest) {
  const names = (await readdir(packageDirectory))
    .filter((name) => licenseFilePattern.test(name))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const files = [];
  for (const name of names) {
    const path = join(packageDirectory, name);
    if (!(await stat(path)).isFile()) continue;
    files.push({
      content: (await readFile(path, "utf8"))
        .replaceAll("\r\n", "\n")
        .replace(/[ \t]+$/gmu, "")
        .trimEnd(),
      name,
    });
  }
  if (files.length === 0) {
    throw new Error(
      `${manifest.name}@${manifest.version} does not ship a top-level LICENSE, LICENCE, COPYING, or NOTICE file`,
    );
  }
  return files;
}

const dependencyNames = (manifest) =>
  [
    ...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]),
  ].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));

const packageSignature = (entry) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        declaredLicense: entry.declaredLicense,
        files: entry.files,
        name: entry.name,
        version: entry.version,
      }),
    )
    .digest("hex");

async function collectFrontendPackages() {
  const queue = [];
  for (const manifestPath of applicationManifests) {
    const manifest = await readJson(manifestPath);
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ issuerDirectory: dirname(manifestPath), name, traverse: true });
    }
    for (const root of additionalRoots) {
      queue.push({ issuerDirectory: dirname(manifestPath), ...root });
    }
  }

  const traversed = new Set();
  const resolved = new Map();
  const packages = new Map();
  while (queue.length > 0) {
    const request = queue.shift();
    const resolutionKey = `${request.issuerDirectory}\0${request.name}`;
    let installed = resolved.get(resolutionKey);
    if (installed === undefined) {
      installed = await findInstalledPackage(request.name, request.issuerDirectory);
      resolved.set(resolutionKey, installed);
    }
    const packageKey = await realpath(installed.packageDirectory);
    const manifest = installed.manifest;

    if (!manifest.name.startsWith("@dougoos/")) {
      const entry = {
        declaredLicense: declaredLicense(manifest),
        files: await readLicenseFiles(installed.packageDirectory, manifest),
        name: manifest.name,
        version: manifest.version,
      };
      const identity = `${entry.name}@${entry.version}`;
      const existing = packages.get(identity);
      if (existing === undefined) {
        packages.set(identity, entry);
      } else if (packageSignature(existing) !== packageSignature(entry)) {
        throw new Error(`${identity} resolved to conflicting license materials`);
      }
    }

    if (!request.traverse || traversed.has(packageKey)) continue;
    traversed.add(packageKey);
    for (const name of dependencyNames(manifest)) {
      queue.push({
        issuerDirectory: installed.packageDirectory,
        name,
        traverse: true,
      });
    }
  }

  return [...packages.values()].sort((left, right) => {
    const nameOrder = Buffer.compare(Buffer.from(left.name), Buffer.from(right.name));
    return nameOrder !== 0
      ? nameOrder
      : Buffer.compare(Buffer.from(left.version), Buffer.from(right.version));
  });
}

export async function buildFrontendLicenseBundle() {
  const packages = await collectFrontendPackages();
  const lines = [
    "Frontend Third-Party Licenses",
    "================================",
    "",
    "This file is generated deterministically from the installed, lockfile-pinned",
    "production dependency graphs of apps/cloud and apps/web. It also includes",
    "the font packages whose assets and Vite runtime code are emitted into those",
    "production bundles.",
    "",
    "Regenerate with: pnpm legal:frontend:generate",
    `Package entries: ${packages.length.toString()}`,
    "",
  ];
  for (const entry of packages) {
    lines.push(
      "===============================================================================",
      `${entry.name}@${entry.version}`,
      `Declared license: ${entry.declaredLicense}`,
      "-------------------------------------------------------------------------------",
    );
    for (const file of entry.files) {
      lines.push(`[${file.name}]`, file.content, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function verifyFrontendLicenseBundle() {
  const expected = await buildFrontendLicenseBundle();
  let actual;
  try {
    actual = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (actual !== expected) {
    throw new Error(
      `${relative(workspaceRoot, outputPath)} is stale; run pnpm legal:frontend:generate`,
    );
  }
  return expected;
}

const mode = process.argv[2];
if (mode === "--write") {
  const content = await buildFrontendLicenseBundle();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  console.log(
    `Wrote ${relative(workspaceRoot, outputPath)} (${content.length.toString()} characters).`,
  );
} else if (mode === "--check") {
  const content = await verifyFrontendLicenseBundle();
  console.log(`Frontend license bundle is current (${content.length.toString()} characters).`);
} else {
  throw new Error("Usage: node tooling/generate-frontend-licenses.mjs --write|--check");
}
