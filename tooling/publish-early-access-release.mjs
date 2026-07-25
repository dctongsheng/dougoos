import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const releaseDirectory = join(root, ".artifacts", "release");
const bucket = process.env.R2_BUCKET ?? "dougoos-releases";
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

for (const [name, value] of Object.entries({
  R2_ACCESS_KEY_ID: accessKeyId,
  R2_ACCOUNT_ID: accountId,
  R2_SECRET_ACCESS_KEY: secretAccessKey,
})) {
  if (value === undefined || value === "") throw new Error(`${name} is required`);
}

const packageManifest = JSON.parse(
  await readFile(join(root, ".artifacts", "desktop-package.json"), "utf8"),
);
const latestPath = join(releaseDirectory, "latest.json");
const latestBody = await readFile(latestPath);
const latest = JSON.parse(latestBody.toString("utf8"));
const version = latest.version;
const artifactName = `DougoOS-${version}-arm64.dmg`;
const artifactPath = packageManifest.dmgPath;
const signaturePath = `${artifactPath}.sig`;
const checksumPath = join(releaseDirectory, "SHA256SUMS");
const artifactManifestPath = join(releaseDirectory, `DougoOS-${version}-release.json`);
const publicKeyPath = join(root, "release", "early-access-public-key.pem");
const prefix = "early-access/macos/arm64";
const versionPrefix = `${prefix}/${version}`;
const versionedArtifactKey = `${versionPrefix}/${artifactName}`;

const client = new S3Client({
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  region: "auto",
});

async function uploadFile({ cacheControl, contentType, key, path }) {
  const size = (await stat(path)).size;
  await client.send(
    new PutObjectCommand({
      Body: createReadStream(path),
      Bucket: bucket,
      CacheControl: cacheControl,
      ContentLength: size,
      ContentType: contentType,
      IfNoneMatch: "*",
      Key: key,
      Metadata: {
        "dougoos-release": version,
      },
    }),
  );
}

async function uploadBytes({ body, cacheControl, contentType, key }) {
  await client.send(
    new PutObjectCommand({
      Body: body,
      Bucket: bucket,
      CacheControl: cacheControl,
      ContentLength: body.byteLength,
      ContentType: contentType,
      Key: key,
      Metadata: {
        "dougoos-release": version,
      },
    }),
  );
}

async function readBoundedPublicBody(response, maximumBytes) {
  if (response.body === null) throw new Error("Public release response did not include a body");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
    throw new Error("Public release response exceeded its declared size limit");
  }
  const chunks = [];
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > maximumBytes) {
        throw new Error("Public release response exceeded its size limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    received,
  );
}

await uploadFile({
  cacheControl: "public, max-age=31536000, immutable",
  contentType: "application/x-apple-diskimage",
  key: versionedArtifactKey,
  path: artifactPath,
});
await uploadFile({
  cacheControl: "public, max-age=31536000, immutable",
  contentType: "application/octet-stream",
  key: `${versionedArtifactKey}.sig`,
  path: signaturePath,
});
await uploadFile({
  cacheControl: "public, max-age=31536000, immutable",
  contentType: "text/plain; charset=utf-8",
  key: `${versionPrefix}/SHA256SUMS`,
  path: checksumPath,
});
await uploadFile({
  cacheControl: "public, max-age=31536000, immutable",
  contentType: "application/json; charset=utf-8",
  key: `${versionPrefix}/DougoOS-${version}-release.json`,
  path: artifactManifestPath,
});

const publicResponse = await globalThis.fetch(latest.artifact.url, {
  cache: "no-store",
  redirect: "error",
  signal: globalThis.AbortSignal.timeout(30 * 60_000),
});
if (!publicResponse.ok || publicResponse.body === null) {
  throw new Error(`Public artifact verification returned HTTP ${publicResponse.status.toString()}`);
}
const publicHash = createHash("sha256");
let publicSize = 0;
const reader = publicResponse.body.getReader();
try {
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    publicSize += next.value.byteLength;
    publicHash.update(next.value);
  }
} finally {
  reader.releaseLock();
}
const publicDigest = publicHash.digest();
if (
  publicSize !== latest.artifact.size ||
  publicDigest.toString("hex") !== latest.artifact.sha256
) {
  throw new Error("Public artifact bytes did not match the prepared release");
}
const publicSignatureResponse = await globalThis.fetch(latest.artifact.signatureUrl, {
  cache: "no-store",
  redirect: "error",
  signal: globalThis.AbortSignal.timeout(15_000),
});
if (!publicSignatureResponse.ok) {
  throw new Error(
    `Public signature verification returned HTTP ${publicSignatureResponse.status.toString()}`,
  );
}
const publicSignature = await readBoundedPublicBody(publicSignatureResponse, 1024);
const publicKey = await readFile(publicKeyPath, "utf8");
if (!verify(null, publicDigest, publicKey, publicSignature)) {
  throw new Error("Public artifact Ed25519 signature did not verify");
}

await uploadBytes({
  body: latestBody,
  cacheControl: "no-cache, no-store, must-revalidate",
  contentType: "application/json; charset=utf-8",
  key: `${prefix}/latest.json`,
});
await client.send(
  new CopyObjectCommand({
    Bucket: bucket,
    CacheControl: "no-cache, no-store, must-revalidate",
    ContentDisposition: `attachment; filename="${artifactName}"`,
    ContentType: "application/x-apple-diskimage",
    CopySource: encodeURI(`${bucket}/${versionedArtifactKey}`),
    Key: `${prefix}/DougoOS.dmg`,
    Metadata: {
      "dougoos-release": version,
      sha256: latest.artifact.sha256,
    },
    MetadataDirective: "REPLACE",
  }),
);
await client.send(
  new CopyObjectCommand({
    Bucket: bucket,
    CacheControl: "no-cache, no-store, must-revalidate",
    ContentType: "application/octet-stream",
    CopySource: encodeURI(`${bucket}/${versionedArtifactKey}.sig`),
    Key: `${prefix}/DougoOS.dmg.sig`,
    Metadata: {
      "dougoos-release": version,
    },
    MetadataDirective: "REPLACE",
  }),
);

const alias = await client.send(
  new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}/DougoOS.dmg` }),
);
if (
  alias.ContentLength !== latest.artifact.size ||
  alias.Metadata?.sha256 !== latest.artifact.sha256
) {
  throw new Error("Published download alias did not match the immutable artifact");
}

console.log(`Published DougoOS ${version} to R2 bucket ${bucket}`);
console.log(`Versioned artifact: ${latest.artifact.url}`);
console.log(`Stable Early Access alias: https://downloads.dougoos.com/${prefix}/DougoOS.dmg`);
