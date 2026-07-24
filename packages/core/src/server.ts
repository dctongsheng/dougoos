import { serve, type ServerType } from "@hono/node-server";
import { openStorage } from "@dougoos/storage";

import { createCoreRuntime, type CoreRuntime } from "./app.js";
import type { CoreRegistry } from "./types.js";

export interface StartCoreOptions {
  readonly allowedOrigins?: readonly string[];
  readonly appVersion: string;
  readonly bearerToken: string;
  readonly databasePath: string;
  readonly instanceId?: string;
  readonly registry: CoreRegistry;
}

export interface CoreServer {
  readonly hostname: "127.0.0.1";
  readonly instanceId: string;
  readonly port: number;
  readonly ready: Promise<boolean>;
  readonly runtime: CoreRuntime;
  close(): Promise<void>;
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    if ("closeAllConnections" in server) server.closeAllConnections();
  });
}

export async function startCore(options: StartCoreOptions): Promise<CoreServer> {
  const storage = openStorage(options.databasePath);
  let runtime: CoreRuntime;
  try {
    runtime = createCoreRuntime(
      {
        appVersion: options.appVersion,
        ...(options.instanceId === undefined ? {} : { instanceId: options.instanceId }),
        registry: options.registry,
        storage,
      },
      {
        ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
        bearerToken: options.bearerToken,
      },
    );
  } catch (error) {
    storage.close();
    throw error;
  }

  let server: ServerType | undefined;
  try {
    const listening = new Promise<number>((resolve, reject) => {
      const createdServer = serve(
        {
          autoCleanupIncoming: true,
          fetch: runtime.app.fetch,
          hostname: "127.0.0.1",
          overrideGlobalObjects: false,
          port: 0,
        },
        (info) => {
          resolve(info.port);
        },
      );
      server = createdServer;
      createdServer.once("error", reject);
    });
    const port = await listening;
    if (server === undefined) throw new Error("Core HTTP server did not start");
    runtime.setBoundPort(port);
    const ready = runtime.initialize();
    const activeServer = server;
    let closePromise: Promise<void> | null = null;
    return {
      close() {
        closePromise ??= (async () => {
          const [runtimeResult, serverResult] = await Promise.allSettled([
            runtime.close(),
            closeServer(activeServer),
          ]);
          if (runtimeResult.status === "rejected") throw runtimeResult.reason;
          if (serverResult.status === "rejected") throw serverResult.reason;
        })();
        return closePromise;
      },
      hostname: "127.0.0.1",
      instanceId: runtime.instanceId,
      port,
      ready,
      runtime,
    };
  } catch (error) {
    if (server !== undefined) await closeServer(server).catch(() => undefined);
    await runtime.close().catch(() => undefined);
    throw error;
  }
}
