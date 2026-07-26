import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = process.cwd();
const manifest = JSON.parse(
  await readFile(join(root, ".artifacts", "desktop-package.json"), "utf8"),
);

if (
  manifest.platform !== "darwin" ||
  manifest.arch !== "arm64" ||
  manifest.signing !== "ad-hoc" ||
  manifest.notarized !== false ||
  typeof manifest.appPath !== "string" ||
  typeof manifest.dmgPath !== "string" ||
  typeof manifest.legalPath !== "string" ||
  typeof manifest.sourceArchiveUrl !== "string"
) {
  throw new Error("Package manifest is not a macOS arm64 Early Access release");
}

const plistPath = join(manifest.appPath, "Contents", "Info.plist");
const { stdout: plistJson } = await execute("plutil", ["-convert", "json", "-o", "-", plistPath]);
const plist = JSON.parse(plistJson);
const expected = {
  CFBundleDisplayName: "DougoOS",
  CFBundleExecutable: "DougoOS",
  CFBundleIconFile: "DougoOS.icns",
  CFBundleIdentifier: "com.dougoos.desktop",
  CFBundleName: "DougoOS",
  CFBundleShortVersionString: manifest.appVersion,
  CFBundleVersion: manifest.appVersion,
  LSMinimumSystemVersion: "13.0",
};
for (const [key, value] of Object.entries(expected)) {
  if (plist[key] !== value) throw new Error(`Info.plist ${key} did not equal ${value}`);
}
if (plist.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true) {
  throw new Error("Packaged app must not allow arbitrary network loads");
}
if (plist.NSAppTransportSecurity?.NSAllowsLocalNetworking !== true) {
  throw new Error("Packaged app must retain explicit localhost networking");
}
for (const key of [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
]) {
  if (key in plist) throw new Error(`Packaged app retained unused privacy prompt: ${key}`);
}

await stat(join(manifest.appPath, "Contents", "Resources", "DougoOS.icns"));
const [
  dougoosLicense,
  sourceOffer,
  thirdPartyNotices,
  electronLicense,
  instrumentSansLicense,
  jetBrainsMonoLicense,
  frontendLicenses,
  codexLicense,
  codexNotice,
  sourceCodexLicense,
  sourceCodexNotice,
] = await Promise.all([
  readFile(join(manifest.legalPath, "DougoOS-LICENSE.txt"), "utf8"),
  readFile(join(manifest.legalPath, "SOURCE.txt"), "utf8"),
  readFile(join(manifest.legalPath, "THIRD_PARTY_NOTICES.md"), "utf8"),
  readFile(join(manifest.legalPath, "Electron-LICENSE.txt"), "utf8"),
  readFile(join(manifest.legalPath, "Instrument-Sans-OFL.txt"), "utf8"),
  readFile(join(manifest.legalPath, "JetBrains-Mono-OFL.txt"), "utf8"),
  readFile(join(manifest.legalPath, "FRONTEND_THIRD_PARTY_LICENSES.txt"), "utf8"),
  readFile(join(manifest.legalPath, "OpenAI-Codex-Apache-2.0.txt"), "utf8"),
  readFile(join(manifest.legalPath, "OpenAI-Codex-NOTICE.txt"), "utf8"),
  readFile(join(root, "legal", "OpenAI-Codex-Apache-2.0.txt"), "utf8"),
  readFile(join(root, "legal", "OpenAI-Codex-NOTICE.txt"), "utf8"),
]);
if (
  !dougoosLicense.includes("GNU AFFERO GENERAL PUBLIC LICENSE") ||
  !dougoosLicense.includes("Version 3, 19 November 2007")
) {
  throw new Error("Packaged DougoOS AGPL license is missing or invalid");
}
if (
  !sourceOffer.includes(`Release tag: v${manifest.appVersion}`) ||
  !sourceOffer.includes(manifest.sourceArchiveUrl)
) {
  throw new Error("Packaged corresponding-source offer does not match this release");
}
if (
  !thirdPartyNotices.includes("does not distribute or launch") ||
  !thirdPartyNotices.includes("@agentclientprotocol/claude-agent-acp") ||
  !thirdPartyNotices.includes("@anthropic-ai/claude-agent-sdk") ||
  !thirdPartyNotices.includes("@openai/codex@0.145.0") ||
  !thirdPartyNotices.includes("@openai/codex-darwin-arm64@0.145.0-darwin-arm64") ||
  !thirdPartyNotices.includes("rust-v0.145.0") ||
  !thirdPartyNotices.includes("legal/FRONTEND_THIRD_PARTY_LICENSES.txt") ||
  !thirdPartyNotices.includes("beside this notice in packaged legal directories")
) {
  throw new Error("Packaged third-party notice omits required component or license-bundle details");
}
if (!electronLicense.includes("Copyright (c) Electron contributors")) {
  throw new Error("Packaged Electron license is missing or invalid");
}
if (
  !instrumentSansLicense.includes("Copyright 2022 The Instrument Sans Project Authors") ||
  !instrumentSansLicense.includes("SIL OPEN FONT LICENSE Version 1.1") ||
  !jetBrainsMonoLicense.includes("Copyright 2020 The JetBrains Mono Project Authors") ||
  !jetBrainsMonoLicense.includes("SIL OPEN FONT LICENSE Version 1.1")
) {
  throw new Error("Packaged font licenses are missing or invalid");
}
for (const token of [
  "react@19.2.8",
  "react-dom@19.2.8",
  "scheduler@0.27.0",
  "react-markdown@10.1.0",
  "remark-gfm@4.0.1",
  "zod@4.4.3",
  "vite@8.1.5",
  "Copyright (c) Meta Platforms, Inc. and affiliates.",
]) {
  if (!frontendLicenses.includes(token)) {
    throw new Error(`Packaged frontend license bundle is missing ${token}`);
  }
}
if (
  codexLicense !== sourceCodexLicense ||
  codexNotice !== sourceCodexNotice ||
  !codexLicense.includes("Copyright 2025 OpenAI") ||
  !codexNotice.includes("Copyright (c) 2023-2025 The Ratatui Developers")
) {
  throw new Error("Packaged OpenAI Codex LICENSE or NOTICE is missing or modified");
}
await stat(join(manifest.legalPath, "LICENSES.chromium.html"));
for (const name of ["LICENSE.txt", "SOURCE.txt", "THIRD_PARTY_NOTICES.md"]) {
  await stat(join(manifest.buildPath, name));
}
for (const name of [
  "FRONTEND_THIRD_PARTY_LICENSES.txt",
  "Instrument-Sans-OFL.txt",
  "JetBrains-Mono-OFL.txt",
  "OpenAI-Codex-Apache-2.0.txt",
  "OpenAI-Codex-NOTICE.txt",
]) {
  await stat(join(manifest.buildPath, "legal", name));
}
const unpackedModulesPath = join(
  manifest.appPath,
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "node_modules",
);
const [codexPackage, codexPlatformPackage] = await Promise.all([
  readFile(join(unpackedModulesPath, "@openai", "codex", "package.json"), "utf8").then(JSON.parse),
  readFile(join(unpackedModulesPath, "@openai", "codex-darwin-arm64", "package.json"), "utf8").then(
    JSON.parse,
  ),
]);
if (
  codexPackage.name !== "@openai/codex" ||
  codexPackage.version !== "0.145.0" ||
  codexPlatformPackage.name !== "@openai/codex" ||
  codexPlatformPackage.version !== "0.145.0-darwin-arm64"
) {
  throw new Error("Packaged OpenAI Codex versions do not match the bundled legal materials");
}
for (const packagePath of [["@agentclientprotocol", "claude-agent-acp"]]) {
  try {
    await stat(join(unpackedModulesPath, ...packagePath));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  throw new Error(`Packaged app unexpectedly contains ${packagePath.join("/")}`);
}
let anthropicPackages = [];
try {
  anthropicPackages = await readdir(join(unpackedModulesPath, "@anthropic-ai"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const bundledClaudeSdk = anthropicPackages.find((name) => name.startsWith("claude-agent-sdk"));
if (bundledClaudeSdk !== undefined) {
  throw new Error(`Packaged app unexpectedly contains @anthropic-ai/${bundledClaudeSdk}`);
}
await execute("codesign", ["--verify", "--deep", "--strict", manifest.appPath]);
const { stderr: signingDetails } = await execute("codesign", [
  "-dv",
  "--verbose=4",
  manifest.appPath,
]);
const teamIdentifier = signingDetails.match(/^TeamIdentifier=(.+)$/mu)?.[1]?.trim();
if (
  !signingDetails.includes("Signature=adhoc") ||
  (teamIdentifier !== undefined && teamIdentifier !== "not set")
) {
  throw new Error("Packaged app did not use the expected ad-hoc signature");
}

const frameworks = await readdir(join(manifest.appPath, "Contents", "Frameworks"));
if (frameworks.some((name) => name.startsWith("Electron Helper"))) {
  throw new Error("Packaged app leaked Electron helper product names");
}
for (const expectedHelper of [
  "DougoOS Helper.app",
  "DougoOS Helper (Renderer).app",
  "DougoOS Helper (GPU).app",
  "DougoOS Helper (Plugin).app",
]) {
  if (!frameworks.includes(expectedHelper)) {
    throw new Error(`Packaged app is missing ${expectedHelper}`);
  }
}

await execute("hdiutil", ["verify", manifest.dmgPath], { maxBuffer: 8 * 1024 * 1024 });
const hash = createHash("sha256");
for await (const chunk of createReadStream(manifest.dmgPath)) hash.update(chunk);
const size = (await stat(manifest.dmgPath)).size;
if (size !== manifest.dmgSize || hash.digest("hex") !== manifest.dmgSha256) {
  throw new Error("DMG bytes did not match the desktop package manifest");
}

console.log(
  `Early Access package verified: DougoOS ${manifest.appVersion} (${size.toString()} bytes, ad-hoc, not notarized).`,
);
