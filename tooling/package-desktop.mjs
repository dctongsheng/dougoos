import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { arch, platform } from "node:process";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";

import { createPackageWithOptions, getRawHeader } from "@electron/asar";
import electronExecutable from "electron";

import { generateDesktopIcon } from "./generate-desktop-icon.mjs";

const execute = promisify(execFile);
const root = process.cwd();
const sourceRepositoryUrl = "https://github.com/dctongsheng/dougoos";
const artifactsRoot = join(root, ".artifacts");
const stagePath = join(artifactsRoot, "desktop-stage");
const packageOutput = join(artifactsRoot, "desktop");
const resourceRoot = join(artifactsRoot, "desktop-resources");
const webResource = join(resourceRoot, "web");
const releaseOutput = join(artifactsRoot, "release");
const manifestPath = join(artifactsRoot, "desktop-package.json");
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  await readFile(join(root, "apps", "desktop", "package.json"), "utf8"),
);
const appVersion = rootPackage.version;
const sourceTag = `v${appVersion}`;
const sourceArchiveUrl = `${sourceRepositoryUrl}/archive/refs/tags/${sourceTag}.tar.gz`;
if (
  typeof appVersion !== "string" ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(appVersion) ||
  desktopPackage.version !== appVersion
) {
  throw new Error("Root and desktop package versions must match as major.minor.patch");
}
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

for (const path of [stagePath, packageOutput, resourceRoot, releaseOutput, manifestPath]) {
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
let appPath;
await mkdir(buildPath, { recursive: true });

if (platform === "darwin") {
  const sourceApp = dirname(dirname(dirname(electronExecutable)));
  const targetApp = join(buildPath, "DougoOS.app");
  appPath = targetApp;
  await cp(sourceApp, targetApp, { recursive: true, verbatimSymlinks: true });
  macInfoPath = join(targetApp, "Contents", "Info.plist");
  await execute("plutil", ["-remove", "ElectronAsarIntegrity", macInfoPath]);
  const plistValues = {
    CFBundleDisplayName: "DougoOS",
    CFBundleExecutable: "DougoOS",
    CFBundleIconFile: "DougoOS.icns",
    CFBundleIdentifier: "com.dougoos.desktop",
    CFBundleName: "DougoOS",
    CFBundleShortVersionString: appVersion,
    CFBundleVersion: appVersion,
    LSApplicationCategoryType: "public.app-category.developer-tools",
    LSMinimumSystemVersion: "13.0",
  };
  for (const [key, value] of Object.entries(plistValues)) {
    await execute("plutil", ["-replace", key, "-string", value, macInfoPath]);
  }
  await execute("plutil", [
    "-replace",
    "NSAppTransportSecurity",
    "-json",
    JSON.stringify({ NSAllowsLocalNetworking: true }),
    macInfoPath,
  ]);
  for (const key of [
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    await execute("plutil", ["-remove", key, macInfoPath]);
  }
  executablePath = join(targetApp, "Contents", "MacOS", "DougoOS");
  await rename(join(targetApp, "Contents", "MacOS", "Electron"), executablePath);
  resourcesPath = join(targetApp, "Contents", "Resources");

  const frameworksPath = join(targetApp, "Contents", "Frameworks");
  for (const suffix of ["", " (Renderer)", " (GPU)", " (Plugin)"]) {
    const oldName = `Electron Helper${suffix}`;
    const newName = `DougoOS Helper${suffix}`;
    const oldAppPath = join(frameworksPath, `${oldName}.app`);
    const helperInfoPath = join(oldAppPath, "Contents", "Info.plist");
    await rename(
      join(oldAppPath, "Contents", "MacOS", oldName),
      join(oldAppPath, "Contents", "MacOS", newName),
    );
    for (const [key, value] of Object.entries({
      CFBundleDisplayName: newName,
      CFBundleExecutable: newName,
      CFBundleIdentifier: `com.dougoos.desktop.helper${suffix.replaceAll(/[ ()]/gu, "")}`,
      CFBundleName: newName,
    })) {
      await execute("plutil", ["-replace", key, "-string", value, helperInfoPath]);
    }
    await rename(oldAppPath, join(frameworksPath, `${newName}.app`));
  }
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
const legalPath = join(resourcesPath, "legal");
await mkdir(legalPath, { recursive: true });
await cp(join(root, "LICENSE"), join(legalPath, "DougoOS-LICENSE.txt"));
await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(legalPath, "THIRD_PARTY_NOTICES.md"));
for (const [path, expectedSha256] of [
  [
    join(root, "legal", "OpenAI-Codex-Apache-2.0.txt"),
    "d17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc",
  ],
  [
    join(root, "legal", "OpenAI-Codex-NOTICE.txt"),
    "9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915",
  ],
]) {
  const actualSha256 = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${relative(root, path)} does not match the OpenAI Codex rust-v0.145.0 source`);
  }
}
for (const [source, destination] of [
  [join(root, "legal", "Instrument-Sans-OFL.txt"), join(legalPath, "Instrument-Sans-OFL.txt")],
  [join(root, "legal", "JetBrains-Mono-OFL.txt"), join(legalPath, "JetBrains-Mono-OFL.txt")],
  [
    join(root, "legal", "FRONTEND_THIRD_PARTY_LICENSES.txt"),
    join(legalPath, "FRONTEND_THIRD_PARTY_LICENSES.txt"),
  ],
  [
    join(root, "legal", "OpenAI-Codex-Apache-2.0.txt"),
    join(legalPath, "OpenAI-Codex-Apache-2.0.txt"),
  ],
  [join(root, "legal", "OpenAI-Codex-NOTICE.txt"), join(legalPath, "OpenAI-Codex-NOTICE.txt")],
]) {
  await cp(source, destination);
}
const electronDistributionPath =
  platform === "darwin"
    ? dirname(dirname(dirname(dirname(electronExecutable))))
    : dirname(electronExecutable);
await cp(join(electronDistributionPath, "LICENSE"), join(legalPath, "Electron-LICENSE.txt"));
await cp(
  join(electronDistributionPath, "LICENSES.chromium.html"),
  join(legalPath, "LICENSES.chromium.html"),
);
await writeFile(
  join(legalPath, "SOURCE.txt"),
  [
    `DougoOS ${appVersion} corresponding source`,
    "",
    `Repository: ${sourceRepositoryUrl}`,
    `Release tag: ${sourceTag}`,
    `Source archive: ${sourceArchiveUrl}`,
    "",
    "DougoOS original source is licensed under AGPL-3.0-only.",
    "Third-party components retain their respective licenses and terms.",
    "",
  ].join("\n"),
  "utf8",
);

let dmgPath;
let dmgSha256;
let dmgSize;
let signing;
if (platform === "darwin" && appPath !== undefined && macInfoPath !== undefined) {
  const iconPath = await generateDesktopIcon(resourceRoot);
  await rm(join(resourcesPath, "electron.icns"), { force: true });
  await cp(iconPath, join(resourcesPath, "DougoOS.icns"));
  await execute("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath]);
  await execute("codesign", ["--verify", "--deep", "--strict", appPath]);
  signing = "ad-hoc";

  await cp(join(legalPath, "DougoOS-LICENSE.txt"), join(buildPath, "LICENSE.txt"));
  await cp(join(legalPath, "SOURCE.txt"), join(buildPath, "SOURCE.txt"));
  await cp(join(legalPath, "THIRD_PARTY_NOTICES.md"), join(buildPath, "THIRD_PARTY_NOTICES.md"));
  await cp(legalPath, join(buildPath, "legal"), { recursive: true });
  await symlink("/Applications", join(buildPath, "Applications"), "dir");
  await mkdir(releaseOutput, { recursive: true });
  dmgPath = join(releaseOutput, `DougoOS-${appVersion}-arm64.dmg`);
  await execute(
    "hdiutil",
    [
      "create",
      "-volname",
      "DougoOS Early Access",
      "-srcfolder",
      buildPath,
      "-format",
      "UDZO",
      "-ov",
      dmgPath,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  dmgSize = (await stat(dmgPath)).size;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(dmgPath)) hash.update(chunk);
  dmgSha256 = hash.digest("hex");
}

await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      arch,
      appPath,
      appVersion,
      buildPath,
      dmgPath,
      dmgSha256,
      dmgSize,
      electronVersion: "43.2.0",
      executablePath,
      legalPath,
      minimumMacOS: platform === "darwin" ? "13.0" : undefined,
      notarized: false,
      platform,
      signing,
      sourceArchiveUrl,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Desktop package: ${buildPath}`);
if (dmgPath !== undefined) console.log(`Early Access DMG: ${dmgPath}`);
console.log(`Package manifest: ${manifestPath}`);
