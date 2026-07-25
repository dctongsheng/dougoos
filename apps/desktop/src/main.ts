import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { IPC_CHANNELS, isTrustedAppUrl, type CoreConnection } from "./contracts.js";
import { CoreProcessManager } from "./core-process.js";
import { writeRotatedDevToken } from "./dev-token.js";
import { handleAppRequest } from "./protocol.js";

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      allowServiceWorkers: false,
      bypassCSP: false,
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: "app",
  },
]);

interface DesktopRuntime {
  readonly manager: CoreProcessManager;
  readonly window: BrowserWindow;
}

let runtime: DesktopRuntime | null = null;
let quitting = false;

function runtimePath(name: "preload.cjs" | "core-worker.js"): string {
  return fileURLToPath(new URL(`./${name}`, import.meta.url));
}

function webRoot(): string {
  if (process.env.DOUGOOS_WEB_DIST !== undefined) return process.env.DOUGOOS_WEB_DIST;
  if (app.isPackaged) return join(process.resourcesPath, "web");
  return fileURLToPath(new URL("../../web/dist/site/", import.meta.url));
}

function senderIsTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return event.senderFrame !== null && isTrustedAppUrl(event.senderFrame.url);
}

function trustedWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
  if (!senderIsTrusted(event)) return null;
  return BrowserWindow.fromWebContents(event.sender);
}

function registerIpc(manager: CoreProcessManager): void {
  ipcMain.handle(IPC_CHANNELS.coreConnection, (event): CoreConnection => {
    if (!senderIsTrusted(event)) throw new Error("Untrusted renderer");
    if (manager.connection === null) throw new Error("Core is not ready");
    return manager.connection;
  });
  ipcMain.handle(IPC_CHANNELS.coreRestart, async (event): Promise<void> => {
    if (!senderIsTrusted(event)) throw new Error("Untrusted renderer");
    await manager.restart();
  });
  ipcMain.handle(IPC_CHANNELS.chooseDirectory, async (event): Promise<string | null> => {
    const window = trustedWindow(event);
    if (window === null) throw new Error("Untrusted renderer");
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择项目目录",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.on(IPC_CHANNELS.windowMinimize, (event) => trustedWindow(event)?.minimize());
  ipcMain.on(IPC_CHANNELS.windowToggleMaximize, (event) => {
    const window = trustedWindow(event);
    if (window === null) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on(IPC_CHANNELS.windowClose, (event) => trustedWindow(event)?.close());
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    backgroundColor: "#0b0f14",
    height: 900,
    minHeight: 640,
    minWidth: 960,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: runtimePath("preload.cjs"),
      sandbox: true,
      webSecurity: true,
    },
    width: 1440,
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  return window;
}

function configureSession(): void {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

async function maybeWriteDevToken(connection: CoreConnection): Promise<void> {
  if (process.env.DOUGOOS_BROWSER_DEBUG !== "1") return;
  const path = process.env.DOUGOOS_DEV_TOKEN_PATH ?? join(dirname(app.getAppPath()), ".dev-token");
  await writeRotatedDevToken(path, connection.token);
}

async function startDesktop(): Promise<void> {
  await app.whenReady();
  configureSession();
  protocol.handle("app", (request) => handleAppRequest(request, webRoot()));

  const window = createWindow();
  await window.loadURL("app://dougoos/startup");
  const manager = new CoreProcessManager({
    appVersion: app.getVersion(),
    databasePath:
      process.env.DOUGOOS_DATABASE_PATH ?? join(app.getPath("userData"), "dougoos.sqlite"),
    defaultConversationDirectory:
      process.env.DOUGOOS_DEFAULT_CONVERSATION_DIRECTORY ??
      join(app.getPath("documents"), "Dogoos"),
    spawn: () =>
      utilityProcess.fork(runtimePath("core-worker.js"), [], {
        cwd: app.getPath("userData"),
        env: { ...process.env },
        serviceName: "DougoOS Core",
        stdio: "ignore",
      }),
  });
  registerIpc(manager);
  manager.onConnection((connection) => {
    void maybeWriteDevToken(connection);
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.coreRestarted);
  });
  runtime = { manager, window };

  try {
    const connection = await manager.start();
    await maybeWriteDevToken(connection);
    if (!window.isDestroyed()) await window.loadURL("app://dougoos/");
  } catch (error) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : "Unknown Core startup failure";
    process.stderr.write(`[dougoos] Core startup failed: ${message}\n`);
    if (!window.isDestroyed()) await window.loadURL("app://dougoos/diagnostic");
  }
}

export function getDesktopRuntimeForTests(): DesktopRuntime {
  if (runtime === null) throw new Error("Desktop runtime is not ready");
  return runtime;
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || runtime === null) return;
  event.preventDefault();
  quitting = true;
  void runtime.manager.stop().finally(() => app.quit());
});

void startDesktop().catch(() => app.exit(1));
