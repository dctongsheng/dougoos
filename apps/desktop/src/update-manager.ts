import { EarlyAccessReleaseManifestSchema, type EarlyAccessReleaseManifest } from "@dougoos/shared";
import { createHash, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export const EARLY_ACCESS_FEED_URL =
  "https://downloads.dougoos.com/early-access/macos/arm64/latest.json";
export const EARLY_ACCESS_DOWNLOAD_ORIGIN = "https://downloads.dougoos.com";

const EARLY_ACCESS_PATH_PREFIX = "/early-access/macos/arm64/";
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MANIFEST_LIMIT_BYTES = 64 * 1024;
const SIGNATURE_LIMIT_BYTES = 1024;

export interface UpdateReadyPrompt {
  readonly path: string;
  readonly version: string;
}

export interface UpdateManagerOptions {
  readonly cacheDirectory: string;
  readonly canOpenUpdate: () => Promise<boolean>;
  readonly currentVersion: string;
  readonly enabled: boolean;
  readonly fetch?: typeof globalThis.fetch;
  readonly onProgress?: (progress: number) => void;
  readonly openUpdate: (update: UpdateReadyPrompt) => Promise<void>;
  readonly publicKeyPem: string;
  readonly showBusy: () => Promise<void>;
  readonly showError: (message: string) => Promise<void>;
  readonly showNoUpdate: (version: string) => Promise<void>;
  readonly showReady: (update: UpdateReadyPrompt) => Promise<boolean>;
}

export interface UpdateCheckOptions {
  readonly manual: boolean;
}

function parseVersion(value: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (match === null) throw new Error(`Unsupported release version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerRelease(candidate: string, current: string): boolean {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  for (let index = 0; index < candidateParts.length; index += 1) {
    const difference = Number(candidateParts[index]) - Number(currentParts[index]);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

interface ReleaseDestination {
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
  ): Promise<{ readonly bytesWritten: number }>;
}

export async function writeReleaseChunk(
  destination: ReleaseDestination,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await destination.write(chunk, offset, chunk.byteLength - offset);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("Release artifact could not be fully written to disk");
    }
    offset += bytesWritten;
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) throw new Error("Release response did not include a body");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new Error("Release response exceeded its declared size limit");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > maxBytes) throw new Error("Release response exceeded its size limit");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validateReleaseUrls(manifest: EarlyAccessReleaseManifest): void {
  const expectedDirectory = `${EARLY_ACCESS_PATH_PREFIX}${manifest.version}/`;
  const artifact = new URL(manifest.artifact.url);
  const signature = new URL(manifest.artifact.signatureUrl);
  const releaseNotes = new URL(manifest.releaseNotesUrl);

  for (const url of [artifact, signature]) {
    if (
      url.origin !== EARLY_ACCESS_DOWNLOAD_ORIGIN ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !url.pathname.startsWith(expectedDirectory)
    ) {
      throw new Error("Release manifest referenced an untrusted download URL");
    }
  }
  if (artifact.pathname !== `${expectedDirectory}DougoOS-${manifest.version}-arm64.dmg`) {
    throw new Error("Release manifest referenced an unexpected artifact name");
  }
  if (signature.href !== `${artifact.href}.sig`) {
    throw new Error("Release signature URL did not match the artifact URL");
  }
  if (
    releaseNotes.origin !== "https://dougoos.com" ||
    releaseNotes.username !== "" ||
    releaseNotes.password !== ""
  ) {
    throw new Error("Release notes URL is not trusted");
  }
}

export class UpdateManager {
  readonly #cacheDirectory: string;
  readonly #canOpenUpdate: () => Promise<boolean>;
  readonly #currentVersion: string;
  readonly #enabled: boolean;
  readonly #fetch: typeof globalThis.fetch;
  readonly #onProgress: (progress: number) => void;
  readonly #openUpdate: (update: UpdateReadyPrompt) => Promise<void>;
  readonly #publicKeyPem: string;
  readonly #showBusy: () => Promise<void>;
  readonly #showError: (message: string) => Promise<void>;
  readonly #showNoUpdate: (version: string) => Promise<void>;
  readonly #showReady: (update: UpdateReadyPrompt) => Promise<boolean>;

  #checkPromise: Promise<void> | null = null;
  #firstTimer: ReturnType<typeof setTimeout> | null = null;
  #intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: UpdateManagerOptions) {
    this.#cacheDirectory = options.cacheDirectory;
    this.#canOpenUpdate = options.canOpenUpdate;
    this.#currentVersion = options.currentVersion;
    this.#enabled = options.enabled;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#onProgress = options.onProgress ?? (() => undefined);
    this.#openUpdate = options.openUpdate;
    this.#publicKeyPem = options.publicKeyPem;
    this.#showBusy = options.showBusy;
    this.#showError = options.showError;
    this.#showNoUpdate = options.showNoUpdate;
    this.#showReady = options.showReady;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  start(): void {
    if (!this.#enabled || this.#firstTimer !== null || this.#intervalTimer !== null) return;
    this.#firstTimer = setTimeout(() => {
      this.#firstTimer = null;
      void this.check({ manual: false });
      this.#intervalTimer = setInterval(() => {
        void this.check({ manual: false });
      }, CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);
  }

  stop(): void {
    if (this.#firstTimer !== null) clearTimeout(this.#firstTimer);
    if (this.#intervalTimer !== null) clearInterval(this.#intervalTimer);
    this.#firstTimer = null;
    this.#intervalTimer = null;
    this.#onProgress(-1);
  }

  check(options: UpdateCheckOptions): Promise<void> {
    if (!this.#enabled) {
      return options.manual
        ? this.#showError("Early Access 更新仅在打包后的 macOS Apple Silicon 客户端中启用。")
        : Promise.resolve();
    }
    this.#checkPromise ??= this.#performCheck(options).finally(() => {
      this.#checkPromise = null;
      this.#onProgress(-1);
    });
    return this.#checkPromise;
  }

  async #fetchManifest(): Promise<EarlyAccessReleaseManifest> {
    const response = await this.#fetch(EARLY_ACCESS_FEED_URL, {
      headers: { "cache-control": "no-cache" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Release feed returned HTTP ${response.status.toString()}`);
    const body = await readBoundedBody(response, MANIFEST_LIMIT_BYTES);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    const manifest = EarlyAccessReleaseManifestSchema.parse(parsed);
    validateReleaseUrls(manifest);
    return manifest;
  }

  async #performCheck(options: UpdateCheckOptions): Promise<void> {
    try {
      const manifest = await this.#fetchManifest();
      if (!isNewerRelease(manifest.version, this.#currentVersion)) {
        if (options.manual) await this.#showNoUpdate(this.#currentVersion);
        return;
      }

      const path = await this.#downloadAndVerify(manifest);
      const update = { path, version: manifest.version };
      if (!(await this.#showReady(update))) return;
      if (!(await this.#canOpenUpdate())) {
        await this.#showBusy();
        return;
      }
      await this.#openUpdate(update);
    } catch (error) {
      if (!options.manual) return;
      const message = error instanceof Error ? error.message : "Unknown Early Access update error";
      await this.#showError(message);
    }
  }

  async #downloadAndVerify(manifest: EarlyAccessReleaseManifest): Promise<string> {
    const versionDirectory = join(this.#cacheDirectory, manifest.version);
    const fileName = basename(new URL(manifest.artifact.url).pathname);
    const partialPath = join(versionDirectory, `${fileName}.partial`);
    const finalPath = join(versionDirectory, fileName);

    await rm(this.#cacheDirectory, { force: true, recursive: true });
    await mkdir(versionDirectory, { mode: 0o700, recursive: true });
    await rm(partialPath, { force: true });
    await rm(finalPath, { force: true });

    try {
      const response = await this.#fetch(manifest.artifact.url, {
        headers: { "cache-control": "no-cache" },
        redirect: "error",
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!response.ok || response.body === null) {
        throw new Error(`Release artifact returned HTTP ${response.status.toString()}`);
      }
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && Number(declaredLength) !== manifest.artifact.size) {
        throw new Error("Release artifact size did not match its manifest");
      }

      const hash = createHash("sha256");
      const destination = await open(partialPath, "wx", 0o600);
      let received = 0;
      try {
        const reader = response.body.getReader();
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            received += next.value.byteLength;
            if (received > manifest.artifact.size) {
              throw new Error("Release artifact exceeded its manifest size");
            }
            await writeReleaseChunk(destination, next.value);
            hash.update(next.value);
            this.#onProgress(received / manifest.artifact.size);
          }
        } finally {
          reader.releaseLock();
        }
      } finally {
        await destination.close();
      }
      if (received !== manifest.artifact.size) {
        throw new Error("Release artifact was truncated");
      }
      const networkDigest = hash.digest();
      const diskHash = createHash("sha256");
      for await (const chunk of createReadStream(partialPath)) diskHash.update(chunk);
      const diskSize = (await stat(partialPath)).size;
      const digest = diskHash.digest();
      if (
        diskSize !== manifest.artifact.size ||
        !networkDigest.equals(digest) ||
        digest.toString("hex") !== manifest.artifact.sha256
      ) {
        throw new Error("Release artifact SHA-256 verification failed");
      }

      const signatureResponse = await this.#fetch(manifest.artifact.signatureUrl, {
        headers: { "cache-control": "no-cache" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!signatureResponse.ok) {
        throw new Error(`Release signature returned HTTP ${signatureResponse.status.toString()}`);
      }
      const signature = await readBoundedBody(signatureResponse, SIGNATURE_LIMIT_BYTES);
      if (!verify(null, digest, this.#publicKeyPem, signature)) {
        throw new Error("Release artifact Ed25519 verification failed");
      }

      await rename(partialPath, finalPath);
      return finalPath;
    } catch (error) {
      await rm(partialPath, { force: true });
      await rm(finalPath, { force: true });
      throw error;
    }
  }
}
