export interface CoreConnection {
  readonly instanceId: string;
  readonly port: number;
  readonly token: string;
}

export type CoreWorkerCommand =
  | {
      readonly appVersion: string;
      readonly databasePath: string;
      readonly previousPort?: number;
      readonly token: string;
      readonly type: "core.start";
    }
  | { readonly type: "core.shutdown" };

export type CoreWorkerEvent =
  | {
      readonly instanceId: string;
      readonly port: number;
      readonly type: "core.ready";
    }
  | {
      readonly code: "CORE_START_FAILED";
      readonly message: string;
      readonly type: "core.failed";
    }
  | { readonly type: "core.stopped" };

export const IPC_CHANNELS = {
  chooseDirectory: "dougoos:dialog:choose-directory",
  coreConnection: "dougoos:core:connection",
  coreRestart: "dougoos:core:restart",
  coreRestarted: "dougoos:core:restarted",
  windowClose: "dougoos:window:close",
  windowMinimize: "dougoos:window:minimize",
  windowToggleMaximize: "dougoos:window:toggle-maximize",
} as const;

export const APP_ORIGIN = "app://dougoos";

export function isTrustedAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "app:" &&
      url.hostname === "dougoos" &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function isCoreWorkerEvent(value: unknown): value is CoreWorkerEvent {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "core.ready":
      return (
        typeof event.instanceId === "string" &&
        event.instanceId.length > 0 &&
        Number.isInteger(event.port) &&
        Number(event.port) >= 1 &&
        Number(event.port) <= 65_535
      );
    case "core.failed":
      return (
        event.code === "CORE_START_FAILED" &&
        typeof event.message === "string" &&
        event.message.length > 0 &&
        event.message.length <= 512
      );
    case "core.stopped":
      return true;
    default:
      return false;
  }
}
