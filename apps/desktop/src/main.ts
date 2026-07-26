import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { GlobalSnapshotSchema } from "@dougoos/shared";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { IPC_CHANNELS, isTrustedAppUrl, type CoreConnection } from "./contracts.js";
import { CoreProcessManager } from "./core-process.js";
import { writeRotatedDevToken } from "./dev-token.js";
import { handleAppRequest } from "./protocol.js";
import { RELEASE_PUBLIC_KEY_PEM } from "./release-public-key.js";
import { UpdateManager, type UpdateReadyPrompt } from "./update-manager.js";

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
  readonly updates: UpdateManager;
  readonly window: BrowserWindow;
}

let runtime: DesktopRuntime | null = null;
let quitting = false;

app.setName("DougoOS");

const SOURCE_REPOSITORY_URL = "https://github.com/dctongsheng/dougoos";

function sourceReleaseUrl(): string {
  return `${SOURCE_REPOSITORY_URL}/tree/v${app.getVersion()}`;
}

function sourceLicenseUrl(): string {
  return `${SOURCE_REPOSITORY_URL}/blob/v${app.getVersion()}/LICENSE`;
}

function runtimePath(name: "preload.cjs" | "core-worker.js"): string {
  return fileURLToPath(new URL(`./${name}`, import.meta.url));
}

function webRoot(): string {
  if (process.env.DOUGOOS_WEB_DIST !== undefined) return process.env.DOUGOOS_WEB_DIST;
  if (app.isPackaged) return join(process.resourcesPath, "web");
  return fileURLToPath(new URL("../../web/dist/site/", import.meta.url));
}

function thirdPartyNoticesPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "legal", "THIRD_PARTY_NOTICES.md");
  }
  return fileURLToPath(new URL("../../../THIRD_PARTY_NOTICES.md", import.meta.url));
}

async function openThirdPartyNotices(): Promise<void> {
  const error = await shell.openPath(thirdPartyNoticesPath());
  if (error !== "") dialog.showErrorBox("无法打开第三方许可", error);
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

async function hasNoActiveWork(manager: CoreProcessManager): Promise<boolean> {
  const connection = manager.connection;
  if (connection === null) return manager.processId === undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${connection.port}/api/snapshot`, {
      headers: { authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const snapshot = GlobalSnapshotSchema.parse(await response.json());
    return snapshot.activeTurns.length === 0 && snapshot.pendingApprovals.length === 0;
  } catch {
    return false;
  }
}

function createUpdateManager(window: BrowserWindow, manager: CoreProcessManager): UpdateManager {
  const showMessage = async (
    type: "error" | "info" | "warning",
    message: string,
    detail: string,
  ): Promise<void> => {
    await dialog.showMessageBox(window, {
      buttons: ["好"],
      defaultId: 0,
      detail,
      message,
      noLink: true,
      type,
    });
  };
  const showBusy = () =>
    showMessage(
      "warning",
      "暂时不能打开更新包",
      "当前仍有运行中的任务或待审批操作。更新已经下载，请完成或取消这些操作后，再从“DougoOS > 检查更新…”重试。",
    );

  return new UpdateManager({
    cacheDirectory: join(app.getPath("sessionData"), "updates"),
    canOpenUpdate: () => hasNoActiveWork(manager),
    currentVersion: app.getVersion(),
    enabled:
      app.isPackaged &&
      process.platform === "darwin" &&
      process.arch === "arm64" &&
      process.env.DOUGOOS_DISABLE_UPDATES !== "1" &&
      process.env.DOUGOOS_TEST_FAKE_PROVIDER !== "1",
    onProgress: (progress) => window.setProgressBar(progress),
    openUpdate: async (update: UpdateReadyPrompt) => {
      if (!(await hasNoActiveWork(manager))) {
        await showBusy();
        return;
      }
      const openError = await shell.openPath(update.path);
      if (openError !== "") throw new Error(openError);
    },
    publicKeyPem: RELEASE_PUBLIC_KEY_PEM,
    showBusy,
    showError: (message) =>
      showMessage(
        "error",
        "检查更新失败",
        `${message}\n\n当前版本仍可继续使用，也可以前往 https://dougoos.com 手动下载。`,
      ),
    showNoUpdate: (version) =>
      showMessage("info", "已经是最新版", `当前 Early Access 版本为 ${version}。`),
    showReady: async (update) => {
      const result = await dialog.showMessageBox(window, {
        buttons: ["稍后", "打开更新包"],
        cancelId: 0,
        defaultId: 0,
        detail:
          "更新已完成 SHA-256 和 Ed25519 发布签名校验。打开后请退出 DougoOS，再将新版拖入 Applications 替换旧版本。Early Access 未经 Apple 公证，新版本仍可能需要在“隐私与安全性”中选择“仍要打开”。",
        message: `DougoOS ${update.version} 已下载`,
        noLink: true,
        type: "info",
      });
      return result.response === 1;
    },
  });
}

function configureApplicationMenu(updates: UpdateManager): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "DougoOS",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          click: () => {
            void shell.openExternal(sourceReleaseUrl());
          },
          label: "查看源代码…",
        },
        {
          click: () => {
            void shell.openExternal(sourceLicenseUrl());
          },
          label: "开源许可证（AGPL-3.0-only）…",
        },
        {
          click: () => {
            void openThirdPartyNotices();
          },
          label: "第三方许可…",
        },
        { type: "separator" },
        {
          click: () => {
            void updates.check({ manual: true });
          },
          label: "检查更新…",
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function maybeWriteDevToken(connection: CoreConnection): Promise<void> {
  if (process.env.DOUGOOS_BROWSER_DEBUG !== "1") return;
  const path = process.env.DOUGOOS_DEV_TOKEN_PATH ?? join(dirname(app.getAppPath()), ".dev-token");
  await writeRotatedDevToken(path, connection.token);
}

async function startDesktop(): Promise<void> {
  await app.whenReady();
  app.setAboutPanelOptions({
    applicationName: "DougoOS",
    applicationVersion: app.getVersion(),
    copyright: "Copyright © 2026 DougoOS contributors · AGPL-3.0-only · No warranty",
    version: app.getVersion(),
    website: sourceReleaseUrl(),
  });
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
  const updates = createUpdateManager(window, manager);
  configureApplicationMenu(updates);
  registerIpc(manager);
  manager.onConnection((connection) => {
    void maybeWriteDevToken(connection);
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.coreRestarted);
  });
  runtime = { manager, updates, window };
  updates.start();

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
  runtime.updates.stop();
  void runtime.manager.stop().finally(() => app.quit());
});

void startDesktop().catch(() => app.exit(1));
