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
  typeof manifest.dmgPath !== "string"
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
