import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = process.cwd();
const releaseDirectory = join(root, ".artifacts", "release");
const packageManifestPath = join(root, ".artifacts", "desktop-package.json");
const publicKeyPath = join(root, "release", "early-access-public-key.pem");

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { digest: hash.digest(), size: (await stat(path)).size };
}

async function requiredPrivateKey() {
  const value = process.env.DOUGOOS_RELEASE_PRIVATE_KEY;
  if (value !== undefined && value.trim() !== "") {
    return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
  }

  const path = process.env.DOUGOOS_RELEASE_PRIVATE_KEY_FILE;
  if (path !== undefined && path.trim() !== "") {
    return readFile(path, "utf8");
  }

  throw new Error(
    "DOUGOOS_RELEASE_PRIVATE_KEY or DOUGOOS_RELEASE_PRIVATE_KEY_FILE is required to prepare an Early Access release",
  );
}

const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  await readFile(join(root, "apps", "desktop", "package.json"), "utf8"),
);
const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
const version = rootPackage.version;

if (
  typeof version !== "string" ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) ||
  desktopPackage.version !== version ||
  packageManifest.appVersion !== version
) {
  throw new Error("Release version must match root, desktop, and package manifests");
}
if (
  packageManifest.platform !== "darwin" ||
  packageManifest.arch !== "arm64" ||
  packageManifest.minimumMacOS !== "13.0" ||
  packageManifest.signing !== "ad-hoc" ||
  packageManifest.notarized !== false ||
  typeof packageManifest.dmgPath !== "string"
) {
  throw new Error("Early Access release requires the verified macOS arm64 ad-hoc DMG package");
}

const publicKeyPem = await readFile(publicKeyPath, "utf8");
const privateKey = createPrivateKey(await requiredPrivateKey());
const derivedPublicKey = createPublicKey(privateKey).export({ format: "pem", type: "spki" });
if (derivedPublicKey !== publicKeyPem) {
  throw new Error("Release private key does not match the public key embedded in DougoOS");
}

const artifactName = `DougoOS-${version}-arm64.dmg`;
if (basename(packageManifest.dmgPath) !== artifactName) {
  throw new Error("Desktop package did not use the canonical Early Access artifact name");
}
const artifact = await sha256File(packageManifest.dmgPath);
if (
  packageManifest.dmgSize !== artifact.size ||
  packageManifest.dmgSha256 !== artifact.digest.toString("hex")
) {
  throw new Error("Desktop package manifest does not match the DMG bytes");
}

const signature = sign(null, artifact.digest, privateKey);
if (!verify(null, artifact.digest, publicKeyPem, signature)) {
  throw new Error("Generated Ed25519 signature did not verify");
}
const signaturePath = `${packageManifest.dmgPath}.sig`;
await writeFile(signaturePath, signature, { mode: 0o600 });

const releaseBase = `https://downloads.dougoos.com/early-access/macos/arm64/${version}`;
const latest = {
  artifact: {
    sha256: artifact.digest.toString("hex"),
    signatureUrl: `${releaseBase}/${artifactName}.sig`,
    size: artifact.size,
    url: `${releaseBase}/${artifactName}`,
  },
  channel: "early-access",
  minimumMacOS: "13.0",
  publishedAt: new Date().toISOString(),
  releaseNotesUrl: "https://dougoos.com/#download",
  schemaVersion: 1,
  version,
};
const latestPath = join(releaseDirectory, "latest.json");
await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");

const checksumPath = join(releaseDirectory, "SHA256SUMS");
await writeFile(checksumPath, `${latest.artifact.sha256}  ${artifactName}\n`, "utf8");

const sourceCommit =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const artifactManifest = {
  schema: "dougoos.early-access-artifact.v1",
  release: {
    channel: "early-access",
    publishedAt: latest.publishedAt,
    version,
  },
  source: {
    commit: sourceCommit,
    tag: `v${version}`,
  },
  artifact: {
    file: artifactName,
    sha256: latest.artifact.sha256,
    signature: `${artifactName}.sig`,
    signatureAlgorithm: "Ed25519(SHA-256(file-bytes))",
    size: artifact.size,
  },
  platform: {
    arch: "arm64",
    bundleId: "com.dougoos.desktop",
    minimumMacOS: "13.0",
    notarized: false,
    operatingSystem: "macOS",
    signing: "ad-hoc",
  },
  verification: {
    commands: [
      "pnpm check",
      "pnpm test:e2e",
      "pnpm test:visual",
      "pnpm smoke:build",
      "pnpm smoke:package",
    ],
    status: "passed-before-publish",
  },
};
const artifactManifestPath = join(releaseDirectory, `DougoOS-${version}-release.json`);
await writeFile(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`, "utf8");

console.log(`Prepared Early Access release ${version}`);
console.log(`DMG: ${packageManifest.dmgPath}`);
console.log(`Signature: ${signaturePath}`);
console.log(`Update manifest: ${latestPath}`);
console.log(`Artifact manifest: ${artifactManifestPath}`);
