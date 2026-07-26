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

import { assertObjectMatches, ensureImmutableObject } from "./r2-object-publisher.mjs";

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

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function uploadFile({ cacheControl, contentType, expectedSha256, key, path }) {
  const size = (await stat(path)).size;
  const sha256 = expectedSha256 ?? (await sha256File(path));
  await ensureImmutableObject({
    body: () => createReadStream(path),
    bucket,
    cacheControl,
    client,
    contentLength: size,
    contentType,
    key,
    metadata: {
      "dougoos-release": version,
      sha256,
    },
  });
  return { sha256, size };
}

async function uploadBytes({ body, cacheControl, contentType, key }) {
  const sha256 = createHash("sha256").update(body).digest("hex");
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
        sha256,
      },
    }),
  );
  return { sha256, size: body.byteLength };
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
  expectedSha256: latest.artifact.sha256,
  key: versionedArtifactKey,
  path: artifactPath,
});
const signatureDetails = await uploadFile({
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

// Promote the small signature alias first. A failure before the DMG alias is
// updated leaves the previous downloadable DMG intact; a new signature beside
// it is harmless and the installed-client manifest still points at immutable
// versioned objects.
await client.send(
  new CopyObjectCommand({
    Bucket: bucket,
    CacheControl: "no-cache, no-store, must-revalidate",
    ContentType: "application/octet-stream",
    CopySource: encodeURI(`${bucket}/${versionedArtifactKey}.sig`),
    Key: `${prefix}/DougoOS.dmg.sig`,
    Metadata: {
      "dougoos-release": version,
      sha256: signatureDetails.sha256,
    },
    MetadataDirective: "REPLACE",
  }),
);

const signatureAlias = await client.send(
  new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}/DougoOS.dmg.sig` }),
);
assertObjectMatches(signatureAlias, {
  cacheControl: "no-cache, no-store, must-revalidate",
  contentLength: signatureDetails.size,
  contentType: "application/octet-stream",
  key: `${prefix}/DougoOS.dmg.sig`,
  metadata: {
    "dougoos-release": version,
    sha256: signatureDetails.sha256,
  },
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

const alias = await client.send(
  new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}/DougoOS.dmg` }),
);
assertObjectMatches(alias, {
  cacheControl: "no-cache, no-store, must-revalidate",
  contentDisposition: `attachment; filename="${artifactName}"`,
  contentLength: latest.artifact.size,
  contentType: "application/x-apple-diskimage",
  key: `${prefix}/DougoOS.dmg`,
  metadata: {
    "dougoos-release": version,
    sha256: latest.artifact.sha256,
  },
});

// Promote the update manifest last. Until this write succeeds, installed
// clients keep seeing the previous release even if the human-facing alias has
// already been refreshed.
const latestDetails = await uploadBytes({
  body: latestBody,
  cacheControl: "no-cache, no-store, must-revalidate",
  contentType: "application/json; charset=utf-8",
  key: `${prefix}/latest.json`,
});
const latestHead = await client.send(
  new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}/latest.json` }),
);
assertObjectMatches(latestHead, {
  cacheControl: "no-cache, no-store, must-revalidate",
  contentLength: latestDetails.size,
  contentType: "application/json; charset=utf-8",
  key: `${prefix}/latest.json`,
  metadata: {
    "dougoos-release": version,
    sha256: latestDetails.sha256,
  },
});

console.log(`Published DougoOS ${version} to R2 bucket ${bucket}`);
console.log(`Versioned artifact: ${latest.artifact.url}`);
console.log(`Stable Early Access alias: https://downloads.dougoos.com/${prefix}/DougoOS.dmg`);
