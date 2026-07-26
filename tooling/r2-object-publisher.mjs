import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

function statusCode(error) {
  if (typeof error !== "object" || error === null) return undefined;
  return error.$metadata?.httpStatusCode;
}

function isMissingObject(error) {
  return (
    statusCode(error) === 404 ||
    (typeof error === "object" &&
      error !== null &&
      (error.name === "NotFound" || error.name === "NoSuchKey"))
  );
}

function isPreconditionFailure(error) {
  return (
    statusCode(error) === 412 ||
    (typeof error === "object" && error !== null && error.name === "PreconditionFailed")
  );
}

export async function headObjectOrNull(client, { bucket, key }) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

export function assertObjectMatches(
  head,
  { cacheControl, contentDisposition, contentLength, contentType, key, metadata },
) {
  const mismatches = [];
  if (head.ContentLength !== contentLength) mismatches.push("content length");
  if (head.CacheControl !== cacheControl) mismatches.push("cache control");
  if (head.ContentType !== contentType) mismatches.push("content type");
  if (contentDisposition !== undefined && head.ContentDisposition !== contentDisposition) {
    mismatches.push("content disposition");
  }
  for (const [name, value] of Object.entries(metadata)) {
    if (head.Metadata?.[name.toLowerCase()] !== value) mismatches.push(`metadata ${name}`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `R2 object ${key} conflicts with the prepared release: ${mismatches.join(", ")}`,
    );
  }
}

async function assertObjectBodyMatches(client, { bucket, contentLength, key, sha256 }) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (response.Body === undefined) throw new Error(`R2 object ${key} did not include a body`);
  const hash = createHash("sha256");
  let received = 0;
  for await (const chunk of response.Body) {
    received += chunk.byteLength;
    if (received > contentLength) {
      throw new Error(`R2 object ${key} conflicts with the prepared release: body length`);
    }
    hash.update(chunk);
  }
  if (received !== contentLength || hash.digest("hex") !== sha256) {
    throw new Error(`R2 object ${key} conflicts with the prepared release: body hash`);
  }
}

export async function ensureImmutableObject({
  body,
  bucket,
  cacheControl,
  client,
  contentLength,
  contentType,
  key,
  metadata,
}) {
  const sha256 = metadata.sha256;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error(`R2 immutable object ${key} requires lowercase SHA-256 metadata`);
  }
  const expected = { cacheControl, contentLength, contentType, key, metadata };
  const existing = await headObjectOrNull(client, { bucket, key });
  if (existing !== null) {
    assertObjectMatches(existing, expected);
    await assertObjectBodyMatches(client, { bucket, contentLength, key, sha256 });
    return "existing";
  }

  try {
    await client.send(
      new PutObjectCommand({
        Body: body(),
        Bucket: bucket,
        CacheControl: cacheControl,
        ContentLength: contentLength,
        ContentType: contentType,
        IfNoneMatch: "*",
        Key: key,
        Metadata: metadata,
      }),
    );
  } catch (error) {
    if (!isPreconditionFailure(error)) throw error;
    const racedObject = await headObjectOrNull(client, { bucket, key });
    if (racedObject === null) throw error;
    assertObjectMatches(racedObject, expected);
    await assertObjectBodyMatches(client, { bucket, contentLength, key, sha256 });
    return "existing";
  }

  const uploaded = await headObjectOrNull(client, { bucket, key });
  if (uploaded === null) throw new Error(`R2 object ${key} was not readable after upload`);
  assertObjectMatches(uploaded, expected);
  return "uploaded";
}
