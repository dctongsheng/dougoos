import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { arch, platform } from "node:process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { createPackageWithOptions, getRawHeader } from "@electron/asar";
import electronExecutable from "electron";

const execute = promisify(execFile);
const root = process.cwd();
const artifactsRoot = join(root, ".artifacts");
const stagePath = join(artifactsRoot, "desktop-stage");
const packageOutput = join(artifactsRoot, "desktop");
const resourceRoot = join(artifactsRoot, "desktop-resources");
const webResource = join(resourceRoot, "web");
const manifestPath = join(artifactsRoot, "desktop-package.json");
const pnpmScript = process.env.npm_execpath;
if (pnpmScript === undefined) {
  throw new Error("package-desktop must be launched through pnpm");
}

async function materializeProductionDependencies() {
  const nodeModulesPath = join(stagePath, "node_modules");
  const virtualNodeModulesPath = join(nodeModulesPath, ".pnpm", "node_modules");
  const topLevelEntries = await readdir(virtualNodeModulesPath);

  for (const entry of topLevelEntries) {
    const virtualEntryPath = join(virtualNodeModulesPath, entry);
    const entryStat = await lstat(virtualEntryPath);

    if (entry.startsWith("@") && entryStat.isDirectory()) {
      for (const scopedEntry of await readdir(virtualEntryPath)) {
        const sourcePath = join(virtualEntryPath, scopedEntry);
        const sourceStat = await lstat(sourcePath);
        if (!sourceStat.isSymbolicLink()) {
          continue;
        }

        const destinationPath = join(nodeModulesPath, entry, scopedEntry);
        await rm(destinationPath, { force: true, recursive: true });
        await cp(await realpath(sourcePath), destinationPath, {
          dereference: true,
          recursive: true,
        });
      }
      continue;
    }

    if (!entryStat.isSymbolicLink()) {
      continue;
    }

    const destinationPath = join(nodeModulesPath, entry);
    await rm(destinationPath, { force: true, recursive: true });
    await cp(await realpath(virtualEntryPath), destinationPath, {
      dereference: true,
      recursive: true,
    });
  }

  await rm(join(nodeModulesPath, ".pnpm"), { recursive: true });
}

for (const path of [stagePath, packageOutput, resourceRoot, manifestPath]) {
  await rm(path, { force: true, recursive: true });
}
await mkdir(artifactsRoot, { recursive: true });

await execute(
  process.execPath,
  [pnpmScript, "--filter", "@dougoos/desktop", "deploy", "--prod", "--legacy", stagePath],
  {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  },
);
await execute(process.execPath, [pnpmScript, "install", "--frozen-lockfile"], {
  cwd: root,
  env: { ...process.env, CI: "true" },
  maxBuffer: 8 * 1024 * 1024,
});
await rm(join(stagePath, "node_modules", ".pnpm", "node_modules", "@dougoos", "desktop"), {
  force: true,
});
await materializeProductionDependencies();
await cp(join(root, "apps", "web", "dist", "site"), webResource, {
  recursive: true,
});

const buildPath = join(packageOutput, `DougoOS-${platform}-${arch}`);
let executablePath;
let macInfoPath;
let resourcesPath;
await mkdir(buildPath, { recursive: true });

if (platform === "darwin") {
  const sourceApp = dirname(dirname(dirname(electronExecutable)));
  const targetApp = join(buildPath, "DougoOS.app");
  await cp(sourceApp, targetApp, { recursive: true, verbatimSymlinks: true });
  macInfoPath = join(targetApp, "Contents", "Info.plist");
  await execute("plutil", ["-remove", "ElectronAsarIntegrity", macInfoPath]);
  await execute("plutil", [
    "-replace",
    "CFBundleIdentifier",
    "-string",
    "com.dougoos.desktop",
    macInfoPath,
  ]);
  await execute("plutil", ["-replace", "CFBundleExecutable", "-string", "DougoOS", macInfoPath]);
  executablePath = join(targetApp, "Contents", "MacOS", "DougoOS");
  await rename(join(targetApp, "Contents", "MacOS", "Electron"), executablePath);
  resourcesPath = join(targetApp, "Contents", "Resources");
} else {
  const sourceDist = dirname(electronExecutable);
  await cp(sourceDist, buildPath, { recursive: true, verbatimSymlinks: true });
  executablePath =
    platform === "win32" ? join(buildPath, "electron.exe") : join(buildPath, "electron");
  resourcesPath = join(buildPath, "resources");
}

await rm(join(resourcesPath, "default_app.asar"), { force: true });
await rm(join(resourcesPath, "default_app"), { force: true, recursive: true });
const appAsarPath = join(resourcesPath, "app.asar");
await createPackageWithOptions(stagePath, appAsarPath, {
  // Provider adapters launch native descendants and therefore require real
  // filesystem paths. Keeping production dependencies outside the archive also
  // lets their normal Node resolution find transitive and optional packages.
  unpackDir: "node_modules",
});
if (macInfoPath !== undefined) {
  const { headerString } = getRawHeader(appAsarPath);
  const hash = createHash("sha256").update(headerString).digest("hex");
  await execute("plutil", [
    "-insert",
    "ElectronAsarIntegrity",
    "-json",
    JSON.stringify({
      "Resources/app.asar": {
        algorithm: "SHA256",
        hash,
      },
    }),
    macInfoPath,
  ]);
}
await cp(webResource, join(resourcesPath, "web"), { recursive: true });

await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      arch,
      buildPath,
      electronVersion: "43.2.0",
      executablePath,
      platform,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Desktop package: ${buildPath}`);
console.log(`Package manifest: ${manifestPath}`);
