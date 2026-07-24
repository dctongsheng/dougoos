const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

interface CoreConnection {
  readonly instanceId: string;
  readonly port: number;
  readonly token: string;
}

const channels = {
  chooseDirectory: "dougoos:dialog:choose-directory",
  coreConnection: "dougoos:core:connection",
  coreRestart: "dougoos:core:restart",
  coreRestarted: "dougoos:core:restarted",
  windowClose: "dougoos:window:close",
  windowMinimize: "dougoos:window:minimize",
  windowToggleMaximize: "dougoos:window:toggle-maximize",
} as const;

const api = Object.freeze({
  chooseDirectory(): Promise<string | null> {
    return ipcRenderer.invoke(channels.chooseDirectory) as Promise<string | null>;
  },
  closeWindow(): void {
    ipcRenderer.send(channels.windowClose);
  },
  getCoreConnection(): Promise<CoreConnection> {
    return ipcRenderer.invoke(channels.coreConnection) as Promise<CoreConnection>;
  },
  minimizeWindow(): void {
    ipcRenderer.send(channels.windowMinimize);
  },
  onCoreRestart(listener: () => void): () => void {
    const handler = (): void => listener();
    ipcRenderer.on(channels.coreRestarted, handler);
    return () => ipcRenderer.removeListener(channels.coreRestarted, handler);
  },
  restartCore(): Promise<void> {
    return ipcRenderer.invoke(channels.coreRestart) as Promise<void>;
  },
  toggleMaximizeWindow(): void {
    ipcRenderer.send(channels.windowToggleMaximize);
  },
});

contextBridge.exposeInMainWorld("dougoos", api);
