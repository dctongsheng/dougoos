import { CoreDataSource, type CoreConnectionProvider } from "./core-data-source.js";

declare global {
  interface Window {
    readonly dougoos?: CoreConnectionProvider;
  }
}

export function createBrowserCoreDataSource(): CoreDataSource | undefined {
  const browser = globalThis as typeof globalThis & {
    readonly dougoos?: CoreConnectionProvider;
  };
  return browser.dougoos === undefined ? undefined : new CoreDataSource(browser.dougoos);
}
