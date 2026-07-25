import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EARLY_ACCESS_FEED_URL,
  UpdateManager,
  isNewerRelease,
  writeReleaseChunk,
  type UpdateManagerOptions,
  type UpdateReadyPrompt,
} from "./update-manager.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function releaseFixture(
  options: {
    readonly corruptArtifact?: boolean;
    readonly corruptSignature?: boolean;
    readonly version?: string;
    readonly wrongDomain?: boolean;
  } = {},
) {
  const version = options.version ?? "0.2.1";
  const artifact = Buffer.from("verified Early Access DMG");
  const digest = createHash("sha256").update(artifact).digest();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = sign(null, digest, privateKey);
  if (options.corruptSignature) signature[0] = Number(signature[0]) ^ 0xff;
  const origin = options.wrongDomain
    ? "https://downloads.example.com"
    : "https://downloads.dougoos.com";
  const artifactUrl = `${origin}/early-access/macos/arm64/${version}/DougoOS-${version}-arm64.dmg`;
  const manifest = {
    artifact: {
      sha256: digest.toString("hex"),
      signatureUrl: `${artifactUrl}.sig`,
      size: artifact.byteLength,
      url: artifactUrl,
    },
    channel: "early-access",
    minimumMacOS: "13.0",
    publishedAt: "2026-07-25T00:00:00.000Z",
    releaseNotesUrl: "https://dougoos.com/#download",
    schemaVersion: 1,
    version,
  } as const;
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === EARLY_ACCESS_FEED_URL) return Response.json(manifest);
    if (url === artifactUrl) {
      const body = options.corruptArtifact ? Buffer.from("damaged Early Access DMG") : artifact;
      return new Response(body, {
        headers: { "content-length": body.byteLength.toString() },
      });
    }
    if (url === `${artifactUrl}.sig`) return new Response(signature);
    return new Response("not found", { status: 404 });
  });
  return {
    artifact,
    fetch: fetch as unknown as typeof globalThis.fetch,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

async function managerOptions(
  overrides: Partial<UpdateManagerOptions> = {},
): Promise<UpdateManagerOptions> {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "dougoos-updates-"));
  temporaryDirectories.push(cacheDirectory);
  return {
    cacheDirectory,
    canOpenUpdate: vi.fn(async () => true),
    currentVersion: "0.2.0",
    enabled: true,
    openUpdate: vi.fn(async () => undefined),
    publicKeyPem: releaseFixture().publicKeyPem,
    showBusy: vi.fn(async () => undefined),
    showError: vi.fn(async () => undefined),
    showNoUpdate: vi.fn(async () => undefined),
    showReady: vi.fn(async () => true),
    ...overrides,
  };
}

describe("Early Access UpdateManager", () => {
  it("retries short file writes and fails when a writer makes no progress", async () => {
    const output = Buffer.alloc(6);
    let position = 0;
    const shortWriter = {
      write: vi.fn(async (chunk: Uint8Array, offset: number, length: number) => {
        const bytesWritten = Math.min(2, length);
        Buffer.from(chunk).copy(output, position, offset, offset + bytesWritten);
        position += bytesWritten;
        return { bytesWritten };
      }),
    };

    await writeReleaseChunk(shortWriter, Buffer.from("abcdef"));

    expect(output.toString()).toBe("abcdef");
    expect(shortWriter.write).toHaveBeenCalledTimes(3);
    await expect(
      writeReleaseChunk(
        {
          write: vi.fn(async () => ({ bytesWritten: 0 })),
        },
        Buffer.from("x"),
      ),
    ).rejects.toThrow("fully written");
  });

  it("orders stable semantic versions without accepting a downgrade", () => {
    expect(isNewerRelease("0.2.1", "0.2.0")).toBe(true);
    expect(isNewerRelease("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerRelease("0.1.9", "0.2.0")).toBe(false);
  });

  it("streams, hashes, verifies, and opens a trusted release", async () => {
    const fixture = releaseFixture();
    const progress = vi.fn();
    const openUpdate = vi
      .fn<(update: UpdateReadyPrompt) => Promise<void>>()
      .mockResolvedValue(undefined);
    const showReady = vi.fn(async () => true);
    const manager = new UpdateManager(
      await managerOptions({
        fetch: fixture.fetch,
        onProgress: progress,
        openUpdate,
        publicKeyPem: fixture.publicKeyPem,
        showReady,
      }),
    );

    await manager.check({ manual: true });

    expect(showReady).toHaveBeenCalledOnce();
    expect(openUpdate).toHaveBeenCalledOnce();
    const update = openUpdate.mock.calls[0]?.[0];
    expect(update?.version).toBe("0.2.1");
    expect(await readFile(update?.path ?? "")).toEqual(fixture.artifact);
    expect(progress).toHaveBeenLastCalledWith(-1);
  });

  it("fails closed on a bad signature and removes the partial artifact", async () => {
    const fixture = releaseFixture({ corruptSignature: true });
    const showError = vi.fn(async () => undefined);
    const showReady = vi.fn(async () => true);
    const manager = new UpdateManager(
      await managerOptions({
        fetch: fixture.fetch,
        publicKeyPem: fixture.publicKeyPem,
        showError,
        showReady,
      }),
    );

    await manager.check({ manual: true });

    expect(showReady).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("Ed25519 verification failed"));
  });

  it("rejects a damaged artifact before signature verification", async () => {
    const fixture = releaseFixture({ corruptArtifact: true });
    const showError = vi.fn(async () => undefined);
    const showReady = vi.fn(async () => true);
    const manager = new UpdateManager(
      await managerOptions({
        fetch: fixture.fetch,
        publicKeyPem: fixture.publicKeyPem,
        showError,
        showReady,
      }),
    );

    await manager.check({ manual: true });

    expect(showReady).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringMatching(/size|SHA-256/u));
  });

  it("rejects a manifest that references a different download origin", async () => {
    const fixture = releaseFixture({ wrongDomain: true });
    const showError = vi.fn(async () => undefined);
    const manager = new UpdateManager(
      await managerOptions({
        fetch: fixture.fetch,
        publicKeyPem: fixture.publicKeyPem,
        showError,
      }),
    );

    await manager.check({ manual: true });

    expect(showError).toHaveBeenCalledWith(expect.stringContaining("untrusted download URL"));
  });

  it("does not download a downgrade", async () => {
    const fixture = releaseFixture({ version: "0.1.9" });
    const openUpdate = vi
      .fn<(update: UpdateReadyPrompt) => Promise<void>>()
      .mockResolvedValue(undefined);
    const showNoUpdate = vi.fn(async () => undefined);
    const showReady = vi.fn(async () => true);
    const manager = new UpdateManager(
      await managerOptions({
        fetch: fixture.fetch,
        openUpdate,
        publicKeyPem: fixture.publicKeyPem,
        showNoUpdate,
        showReady,
      }),
    );

    await manager.check({ manual: true });

    expect(showNoUpdate).toHaveBeenCalledWith("0.2.0");
    expect(showReady).not.toHaveBeenCalled();
    expect(openUpdate).not.toHaveBeenCalled();
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the artifact stream is interrupted", async () => {
    const fixture = releaseFixture();
    const interruptedFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === EARLY_ACCESS_FEED_URL) {
        return fixture.fetch(input);
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            controller.error(new Error("connection interrupted"));
          },
        }),
        { headers: { "content-length": fixture.artifact.byteLength.toString() } },
      );
    });
    const showError = vi.fn(async () => undefined);
    const showReady = vi.fn(async () => true);
    const manager = new UpdateManager(
      await managerOptions({
        fetch: interruptedFetch as unknown as typeof globalThis.fetch,
        publicKeyPem: fixture.publicKeyPem,
        showError,
        showReady,
      }),
    );

    await manager.check({ manual: true });

    expect(showReady).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("connection interrupted"));
  });

  it("downloads while busy but refuses to open the update package", async () => {
    const fixture = releaseFixture();
    const openUpdate = vi
      .fn<(update: UpdateReadyPrompt) => Promise<void>>()
      .mockResolvedValue(undefined);
    const showBusy = vi.fn(async () => undefined);
    const manager = new UpdateManager(
      await managerOptions({
        canOpenUpdate: vi.fn(async () => false),
        fetch: fixture.fetch,
        openUpdate,
        publicKeyPem: fixture.publicKeyPem,
        showBusy,
      }),
    );

    await manager.check({ manual: true });

    expect(showBusy).toHaveBeenCalledOnce();
    expect(openUpdate).not.toHaveBeenCalled();
  });

  it("keeps scheduled network failures silent but surfaces manual failures", async () => {
    const showError = vi.fn(async () => undefined);
    const manager = new UpdateManager(
      await managerOptions({
        fetch: vi.fn(async () => new Response("offline", { status: 503 })),
        showError,
      }),
    );

    await manager.check({ manual: false });
    expect(showError).not.toHaveBeenCalled();
    await manager.check({ manual: true });
    expect(showError).toHaveBeenCalledOnce();
  });

  it("does not start checks when updates are disabled", async () => {
    const showError = vi.fn(async () => undefined);
    const manager = new UpdateManager(
      await managerOptions({
        enabled: false,
        showError,
      }),
    );

    await manager.check({ manual: true });

    expect(showError).toHaveBeenCalledWith(expect.stringContaining("仅在打包后"));
  });
});
