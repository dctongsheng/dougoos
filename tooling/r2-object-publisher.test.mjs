import assert from "node:assert/strict";
import { test } from "node:test";

import { createHash } from "node:crypto";

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { ensureImmutableObject } from "./r2-object-publisher.mjs";

const desired = {
  body: () => Buffer.from("release"),
  bucket: "releases",
  cacheControl: "public, max-age=31536000, immutable",
  contentLength: 7,
  contentType: "application/octet-stream",
  key: "0.2.0/artifact",
  metadata: {
    "dougoos-release": "0.2.0",
    sha256: createHash("sha256").update("release").digest("hex"),
  },
};

const matchingHead = {
  CacheControl: desired.cacheControl,
  ContentLength: desired.contentLength,
  ContentType: desired.contentType,
  Metadata: desired.metadata,
};

const missing = () =>
  Object.assign(new Error("missing"), {
    $metadata: { httpStatusCode: 404 },
    name: "NotFound",
  });

const conflict = () =>
  Object.assign(new Error("precondition failed"), {
    $metadata: { httpStatusCode: 412 },
    name: "PreconditionFailed",
  });

test("uploads and verifies an absent immutable object", async () => {
  let head = null;
  let putCount = 0;
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) {
        if (head === null) throw missing();
        return head;
      }
      assert.ok(command instanceof PutObjectCommand);
      putCount += 1;
      head = matchingHead;
      return {};
    },
  };

  await assert.doesNotReject(
    ensureImmutableObject({ ...desired, client }).then((result) => {
      assert.equal(result, "uploaded");
    }),
  );
  assert.equal(putCount, 1);
});

test("accepts an identical object left by a partial prior run", async () => {
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) return matchingHead;
      assert.ok(command instanceof GetObjectCommand);
      return { Body: [Buffer.from("release")] };
    },
  };

  assert.equal(await ensureImmutableObject({ ...desired, client }), "existing");
});

test("rejects a conflicting object at the same immutable key", async () => {
  const client = {
    async send(command) {
      assert.ok(command instanceof HeadObjectCommand);
      return {
        ...matchingHead,
        Metadata: { ...matchingHead.Metadata, sha256: "0".repeat(64) },
      };
    },
  };

  await assert.rejects(
    ensureImmutableObject({ ...desired, client }),
    /conflicts with the prepared release: metadata sha256/u,
  );
});

test("accepts an identical object won by a concurrent uploader", async () => {
  let headCount = 0;
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) {
        headCount += 1;
        if (headCount === 1) throw missing();
        return matchingHead;
      }
      if (command instanceof GetObjectCommand) return { Body: [Buffer.from("release")] };
      assert.ok(command instanceof PutObjectCommand);
      throw conflict();
    },
  };

  assert.equal(await ensureImmutableObject({ ...desired, client }), "existing");
});

test("rejects a conflicting object won by a concurrent uploader", async () => {
  let headCount = 0;
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) {
        headCount += 1;
        if (headCount === 1) throw missing();
        return { ...matchingHead, ContentLength: 8 };
      }
      assert.ok(command instanceof PutObjectCommand);
      throw conflict();
    },
  };

  await assert.rejects(
    ensureImmutableObject({ ...desired, client }),
    /conflicts with the prepared release: content length/u,
  );
});

test("rejects forged matching metadata when existing bytes differ", async () => {
  const client = {
    async send(command) {
      if (command instanceof HeadObjectCommand) return matchingHead;
      assert.ok(command instanceof GetObjectCommand);
      return { Body: [Buffer.from("forgery")] };
    },
  };

  await assert.rejects(
    ensureImmutableObject({ ...desired, client }),
    /conflicts with the prepared release: body hash/u,
  );
});
