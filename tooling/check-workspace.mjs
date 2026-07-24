import { glob, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function parseWorkspacePatterns(source) {
  const patterns = [];
  let readingPackages = false;

  for (const line of source.split(/\r?\n/u)) {
    if (/^packages:\s*$/u.test(line)) {
      readingPackages = true;
      continue;
    }
    if (!readingPackages) {
      continue;
    }
    if (/^\S/u.test(line)) {
      break;
    }

    const match = /^\s+-\s+(.+?)\s*$/u.exec(line);
    if (match?.[1] === undefined) {
      continue;
    }

    const rawPattern = match[1];
    const pattern =
      (rawPattern.startsWith('"') && rawPattern.endsWith('"')) ||
      (rawPattern.startsWith("'") && rawPattern.endsWith("'"))
        ? rawPattern.slice(1, -1)
        : rawPattern;
    patterns.push(pattern);
  }

  if (patterns.length === 0) {
    throw new Error("pnpm-workspace.yaml must declare at least one packages pattern");
  }

  return patterns;
}

const workspaceSource = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
const workspacePatterns = parseWorkspacePatterns(workspaceSource);
const includePatterns = workspacePatterns.filter((pattern) => !pattern.startsWith("!"));
const excludePatterns = workspacePatterns
  .filter((pattern) => pattern.startsWith("!"))
  .map((pattern) => `${pattern.slice(1).replace(/\/$/u, "")}/package.json`);
const packageJsonPaths = new Set();

for (const pattern of includePatterns) {
  const packagePattern = `${pattern.replace(/\/$/u, "")}/package.json`;
  for await (const packageJsonPath of glob(packagePattern, {
    cwd: root,
    exclude: excludePatterns,
  })) {
    packageJsonPaths.add(packageJsonPath);
  }
}

if (packageJsonPaths.size === 0) {
  throw new Error("pnpm-workspace.yaml patterns did not match any package.json files");
}

const workspaces = new Map();

for (const packageJsonPath of [...packageJsonPaths].sort()) {
  const workspacePath = relative(root, dirname(join(root, packageJsonPath)));
  const packageJson = JSON.parse(await readFile(join(root, packageJsonPath), "utf8"));
  if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
    throw new Error(`${workspacePath}/package.json must declare a package name`);
  }
  if (workspaces.has(packageJson.name)) {
    throw new Error(`duplicate workspace package name: ${packageJson.name}`);
  }

  workspaces.set(packageJson.name, { packageJson, workspacePath });
}

const packages = new Map();

for (const [packageName, { packageJson, workspacePath }] of workspaces) {
  if (packageJson.type !== "module") {
    throw new Error(`${packageName} must declare ESM with "type": "module"`);
  }

  for (const requiredScript of ["build", "debug", "lint", "test", "typecheck"]) {
    if (typeof packageJson.scripts?.[requiredScript] !== "string") {
      throw new Error(`${packageName} is missing the ${requiredScript} script`);
    }
  }

  const readme = await readFile(join(root, workspacePath, "README.md"), "utf8");
  const debugCommand = `pnpm --filter ${packageName} debug`;
  if (!readme.includes(debugCommand)) {
    throw new Error(`${workspacePath}/README.md must include: ${debugCommand}`);
  }

  const internalDependencies = new Set();
  for (const field of dependencyFields) {
    for (const [dependency, specifier] of Object.entries(packageJson[field] ?? {})) {
      if (dependency.startsWith("@dougoos/") && !workspaces.has(dependency)) {
        throw new Error(`${packageName} ${field} references unknown workspace ${dependency}`);
      }
      if (!workspaces.has(dependency)) {
        continue;
      }
      if (typeof specifier !== "string" || !specifier.startsWith("workspace:")) {
        throw new Error(
          `${packageName} ${field} must use the workspace protocol for ${dependency}`,
        );
      }

      internalDependencies.add(dependency);
    }
  }

  packages.set(packageName, internalDependencies);
}

const visiting = new Set();
const visited = new Set();

function visit(packageName, path = []) {
  if (visiting.has(packageName)) {
    throw new Error(`workspace dependency cycle: ${[...path, packageName].join(" -> ")}`);
  }
  if (visited.has(packageName)) {
    return;
  }

  visiting.add(packageName);
  for (const dependency of packages.get(packageName) ?? []) {
    visit(dependency, [...path, packageName]);
  }
  visiting.delete(packageName);
  visited.add(packageName);
}

for (const packageName of [...packages.keys()].sort()) {
  visit(packageName);
}

const rootPackageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
for (const [name, version] of Object.entries(rootPackageJson.devDependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`root devDependency ${name} must use an exact version, got ${version}`);
  }
}

console.log(
  `workspace contract ok: ${packages.size} dynamically discovered ESM packages, acyclic dependency graph`,
);
