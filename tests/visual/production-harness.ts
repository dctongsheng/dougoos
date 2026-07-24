import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { PNG } from "pngjs";
import { format as formatWithPrettier } from "prettier";

import {
  applyAction,
  applyFinalScroll,
  compareImages,
  domDigest,
  landmarkBaseline,
  resolveLocator,
  settleAnimations,
  type ImageComparison,
  type LandmarkBaseline,
  type ReferenceMetadata,
} from "./reference-harness.js";
import {
  VIEWPORTS,
  productionOnlyCases,
  visualManifest,
  visualReferenceCases,
  type ProductionOnlyCase,
  type LandingSafetyAction,
  type LandingSafetyExpectation,
  type LandmarkSpec,
  type VisualAction,
  type VisualReferenceCase,
} from "./visual-manifest.js";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAAS_RELEASE_SITE_ROOT = join(WORKSPACE_ROOT, "apps/web/dist/site");
const SAAS_VISUAL_SITE_ROOT = join(WORKSPACE_ROOT, "apps/web/dist/visual-site");
const LANDING_RELEASE_SITE_ROOT = join(WORKSPACE_ROOT, "apps/cloud/dist/site");
const REFERENCE_ROOT = join(WORKSPACE_ROOT, "tests/visual/reference");
const PRODUCTION_ROOT = join(WORKSPACE_ROOT, "tests/visual/production");
const ACTUAL_ROOT = join(PRODUCTION_ROOT, "actual");
const DIFF_ROOT = join(PRODUCTION_ROOT, "diff");
const METADATA_ROOT = join(PRODUCTION_ROOT, "metadata");
const RUN_PATH = join(PRODUCTION_ROOT, "run.json");

const FIXED_TIME = visualManifest.deterministic.fixedTime;
const RANDOM_SEED = visualManifest.deterministic.randomSeed;

export const saasProductionReferenceCases: readonly VisualReferenceCase[] =
  visualReferenceCases.filter(
    (visualCase) => visualCase.surface === "saas" && visualCase.kind !== "source-defect",
  );

export const saasProductionOnlyCases: readonly ProductionOnlyCase[] = productionOnlyCases.filter(
  (visualCase) => visualCase.surface === "saas",
);

export const landingProductionReferenceCases: readonly VisualReferenceCase[] =
  visualReferenceCases.filter(
    (visualCase) => visualCase.surface === "landing" && visualCase.kind !== "source-defect",
  );

export const landingProductionOnlyCases: readonly ProductionOnlyCase[] = productionOnlyCases.filter(
  (visualCase) => visualCase.surface === "landing",
);

export const allProductionReferenceCases: readonly VisualReferenceCase[] = [
  ...saasProductionReferenceCases,
  ...landingProductionReferenceCases,
];

export const allProductionOnlyCases: readonly ProductionOnlyCase[] = [
  ...saasProductionOnlyCases,
  ...landingProductionOnlyCases,
];

export interface ProductionServer {
  readonly close: () => Promise<void>;
  readonly origin: string;
}

interface ProductionScreenshotMetadata {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface ProductionMetadata {
  readonly actionAudit: readonly {
    readonly action: string;
    readonly id: string;
    readonly passed: boolean;
    readonly state: string;
    readonly urlAfter: string;
    readonly urlBefore: string;
  }[];
  readonly accent: VisualReferenceCase["accent"];
  readonly browser: {
    readonly name: "chromium";
    readonly version: string;
  };
  readonly build: {
    readonly kind: "release" | "visual-test";
    readonly sha256: string;
  };
  readonly captureMode: VisualReferenceCase["captureMode"];
  readonly comparison: ImageComparison | null;
  readonly description: string;
  readonly document: {
    readonly height: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly width: number;
  };
  readonly dom: {
    readonly digest: string;
    readonly visibleElementCount: number;
  };
  readonly errors: readonly string[];
  readonly dynamicRequests: readonly {
    readonly method: string;
    readonly resourceType: string;
    readonly sameOrigin: boolean;
    readonly url: string;
  }[];
  readonly downloads: readonly string[];
  readonly externalRequests: readonly string[];
  readonly fonts: {
    readonly instrumentSans: boolean;
    readonly jetbrainsMono: boolean;
    readonly status: FontFaceSetLoadStatus;
  };
  readonly id: string;
  readonly kind: "production-actual" | "production-only";
  readonly landmarks: readonly LandmarkBaseline[];
  readonly locale: "zh-CN";
  readonly productionSha256: string;
  readonly runtimeEffects: readonly Readonly<Record<string, string>>[];
  readonly safetyEffects: readonly Readonly<Record<string, string>>[];
  readonly screenshot: ProductionScreenshotMetadata;
  readonly semanticChecks: readonly {
    readonly actual?: unknown;
    readonly id: string;
    readonly passed: boolean;
  }[];
  readonly storageWrites: readonly string[];
  readonly theme: VisualReferenceCase["theme"];
  readonly timezoneId: "Asia/Shanghai";
  readonly viewport: {
    readonly deviceScaleFactor: 1;
    readonly height: number;
    readonly name: VisualReferenceCase["viewport"];
    readonly width: number;
  };
}

export interface ProductionCapture {
  readonly metadata: ProductionMetadata;
  readonly screenshot: Buffer;
}

export interface ProductionRunResult {
  readonly captures: ReadonlyMap<string, ProductionCapture>;
  readonly errors: readonly string[];
}

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

export const hasExactOrigin = (requestUrl: string, origin: string): boolean => {
  try {
    return new URL(requestUrl).origin === new URL(origin).origin;
  } catch {
    return false;
  }
};

const normalizedEvidenceUrl = (requestUrl: string, origin: string): string => {
  try {
    const url = new URL(requestUrl, origin);
    return hasExactOrigin(url.toString(), origin) ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose();
      else rejectClose(error);
    });
  });
};

const mimeFor = (path: string): string => {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
};

const siteFile = async (
  siteRoot: string,
  entryName: string,
  requestPath: string,
): Promise<string | null> => {
  const pathname = requestPath.split("?")[0] ?? "/";
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(siteRoot, decoded === "/" ? entryName : `.${decoded}`);
  if (candidate !== siteRoot && !candidate.startsWith(`${siteRoot}${sep}`)) return null;
  try {
    const candidateStat = await stat(candidate);
    return candidateStat.isFile() ? candidate : null;
  } catch {
    return null;
  }
};

const startStaticServer = async (
  siteRoot: string,
  description: "release" | "visual-test",
  entryName = "index.html",
): Promise<ProductionServer> => {
  try {
    await stat(join(siteRoot, entryName));
  } catch {
    throw new Error(
      `Production visual harness requires the ${description} build at ${siteRoot}. Run the matching workspace build script first.`,
    );
  }

  const server = createServer((request, response) => {
    void (async () => {
      const sourcePath = await siteFile(siteRoot, entryName, request.url ?? "/");
      if (request.method !== "GET" || sourcePath === null) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
        "content-type": mimeFor(sourcePath),
      });
      createReadStream(sourcePath).pipe(response);
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Production server did not bind an IPv4 port");
  }
  return {
    close: async () => closeServer(server),
    origin: `http://127.0.0.1:${address.port}`,
  };
};

export const startProductionServer = async (): Promise<ProductionServer> =>
  startStaticServer(SAAS_RELEASE_SITE_ROOT, "release");

export const startVisualTestServer = async (): Promise<ProductionServer> =>
  startStaticServer(SAAS_VISUAL_SITE_ROOT, "visual-test", "visual.html");

export const startLandingProductionServer = async (): Promise<ProductionServer> =>
  startStaticServer(LANDING_RELEASE_SITE_ROOT, "release");

const productionSourceHash = async (siteRoot: string): Promise<string> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(siteRoot);
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(`${relative(siteRoot, path)}\0`);
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const deterministicInitScript = (): string => `
(() => {
  const fixed = ${JSON.stringify(FIXED_TIME)};
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixed] : args));
    }
    static now() { return new NativeDate(fixed).getTime(); }
  }
  Object.defineProperty(globalThis, "Date", { configurable: true, value: FixedDate });

  let randomState = ${String(RANDOM_SEED)} >>> 0;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };

  const writes = [];
  Object.defineProperty(globalThis, "__dougoosStorageWrites", {
    configurable: false,
    value: writes
  });
  const safetyEffects = [];
  Object.defineProperty(globalThis, "__dougoosSafetyEffects", {
    configurable: false,
    value: safetyEffects
  });
  const recordSafetyEffect = (category, detail) => {
    safetyEffects.push({ category: String(category), detail: String(detail) });
  };
  const safeUrl = (value) => {
    try {
      const candidate =
        typeof Request !== "undefined" && value instanceof Request ? value.url : String(value);
      const url = new URL(candidate, location.href);
      return url.origin === location.origin ? url.pathname : url.origin + url.pathname;
    } catch {
      return "[non-url]";
    }
  };

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (...args) => {
    recordSafetyEffect("fetch", safeUrl(args[0]));
    return nativeFetch(...args);
  };

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    recordSafetyEffect("xhr", String(method) + " " + safeUrl(url));
    return nativeXhrOpen.call(this, method, url, ...args);
  };

  const NativeEventSource = globalThis.EventSource;
  if (NativeEventSource) {
    globalThis.EventSource = class extends NativeEventSource {
      constructor(url, options) {
        recordSafetyEffect("event-source", safeUrl(url));
        super(url, options);
      }
    };
  }

  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      recordSafetyEffect("websocket", safeUrl(url));
      super(url, protocols);
    }
  };

  const nativeBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, data) => {
    recordSafetyEffect("beacon", safeUrl(url));
    return nativeBeacon(url, data);
  };

  const nativeOpen = globalThis.open.bind(globalThis);
  globalThis.open = (...args) => {
    recordSafetyEffect("window-open", safeUrl(args[0]));
    return nativeOpen(...args);
  };

  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    recordSafetyEffect("anchor", safeUrl(this.href) + "|" + (this.download ? "download" : ""));
    return nativeAnchorClick.call(this);
  };

  const nativePushState = history.pushState.bind(history);
  history.pushState = (state, unused, url) => {
    recordSafetyEffect("history-push", safeUrl(url));
    return nativePushState(state, unused, url);
  };
  const nativeReplaceState = history.replaceState.bind(history);
  history.replaceState = (state, unused, url) => {
    recordSafetyEffect("history-replace", safeUrl(url));
    return nativeReplaceState(state, unused, url);
  };

  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;
  const nativeClear = Storage.prototype.clear;
  Storage.prototype.setItem = function(key, value) {
    writes.push("set:" + String(key));
    recordSafetyEffect("storage", "set:" + String(key));
    return nativeSetItem.call(this, key, value);
  };
  Storage.prototype.removeItem = function(key) {
    writes.push("remove:" + String(key));
    recordSafetyEffect("storage", "remove:" + String(key));
    return nativeRemoveItem.call(this, key);
  };
  Storage.prototype.clear = function() {
    writes.push("clear");
    recordSafetyEffect("storage", "clear");
    return nativeClear.call(this);
  };

  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (cookieDescriptor?.get && cookieDescriptor?.set) {
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get: cookieDescriptor.get,
      set(value) {
        recordSafetyEffect("cookie", String(value).split("=", 1)[0] || "[unnamed]");
        return cookieDescriptor.set.call(this, value);
      }
    });
  }
  if (globalThis.cookieStore) {
    const nativeCookieStoreSet = globalThis.cookieStore.set.bind(globalThis.cookieStore);
    globalThis.cookieStore.set = (...args) => {
      const first = args[0];
      const name = typeof first === "string" ? first : first?.name;
      recordSafetyEffect("cookie-store-set", name || "[unnamed]");
      return nativeCookieStoreSet(...args);
    };
    const nativeCookieStoreDelete = globalThis.cookieStore.delete.bind(globalThis.cookieStore);
    globalThis.cookieStore.delete = (...args) => {
      const first = args[0];
      const name = typeof first === "string" ? first : first?.name;
      recordSafetyEffect("cookie-store-delete", name || "[unnamed]");
      return nativeCookieStoreDelete(...args);
    };
  }

  if (globalThis.IDBFactory) {
    const nativeIdbOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, version) {
      recordSafetyEffect("indexed-db-open", name);
      return version === undefined
        ? nativeIdbOpen.call(this, name)
        : nativeIdbOpen.call(this, name, version);
    };
    const nativeIdbDelete = IDBFactory.prototype.deleteDatabase;
    IDBFactory.prototype.deleteDatabase = function(name) {
      recordSafetyEffect("indexed-db-delete", name);
      return nativeIdbDelete.call(this, name);
    };
  }

  if (globalThis.CacheStorage) {
    const nativeCacheOpen = CacheStorage.prototype.open;
    CacheStorage.prototype.open = function(name) {
      recordSafetyEffect("cache-open", name);
      return nativeCacheOpen.call(this, name);
    };
    const nativeCacheDelete = CacheStorage.prototype.delete;
    CacheStorage.prototype.delete = function(name) {
      recordSafetyEffect("cache-delete", name);
      return nativeCacheDelete.call(this, name);
    };
  }

  globalThis.addEventListener("submit", (event) => {
    queueMicrotask(() => {
      if (!event.defaultPrevented) recordSafetyEffect("form-submit", "unprevented");
    });
  });
})();
`;

const createContext = async (
  browser: Browser,
  allowedOrigins: readonly string[],
): Promise<BrowserContext> => {
  const context = await browser.newContext({
    colorScheme: "dark",
    deviceScaleFactor: 1,
    locale: "zh-CN",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    timezoneId: "Asia/Shanghai",
    viewport: VIEWPORTS["saas-1440x900"],
  });
  context.setDefaultTimeout(3_000);
  context.setDefaultNavigationTimeout(6_000);
  await context.addInitScript({ content: deterministicInitScript() });
  await context.route(/^https?:\/\//, async (route) => {
    const requestUrl = route.request().url();
    if (allowedOrigins.some((origin) => hasExactOrigin(requestUrl, origin))) {
      await route.continue();
    } else await route.abort("blockedbyclient");
  });
  return context;
};

const clickProductionSwitch = async (page: Page, text: string, scope: "page" | "screen") => {
  const anchor = resolveLocator(page, { by: "text", exact: true, scope, value: text });
  await anchor.scrollIntoViewIfNeeded();
  const clicked = await anchor.evaluate((element) => {
    let current: Element | null = element;
    while (current !== null && current !== document.body) {
      const candidate = current.querySelector<HTMLElement>(
        'button.switch,button[role="switch"],button[aria-pressed]',
      );
      if (candidate !== null) {
        candidate.click();
        return true;
      }
      current = current.parentElement;
    }
    return false;
  });
  if (!clicked)
    throw new Error(`No production switch found near exact text ${JSON.stringify(text)}`);
};

const applyProductionAction = async (page: Page, action: VisualAction): Promise<void> => {
  if (action.type === "click-switch-near-text") {
    await clickProductionSwitch(page, action.text, action.scope ?? "page");
    return;
  }
  if (
    action.type === "click" &&
    action.locator.by === "css" &&
    action.locator.value ===
      "#dc-root > .sc-host > div > div:nth-child(2) > div:first-child > div:nth-last-child(2)"
  ) {
    await page.locator(".notification-button").click();
    return;
  }
  await applyAction(page, action);
};

const interactionAction = (action: VisualAction): boolean =>
  action.type === "focus" || action.type === "hover" || action.type === "pointer-down";

const applyProductionFinalScroll = async (
  page: Page,
  visualCase: VisualReferenceCase,
): Promise<void> => {
  await applyFinalScroll(page, visualCase);
  if (visualCase.surface === "landing") return;
  await page.locator(".sidebar-scroll").evaluate((element, requestedTop) => {
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;
    const numericTop =
      requestedTop === "top"
        ? 0
        : requestedTop === "middle"
          ? Math.max(0, (scrollHeight - clientHeight) / 2)
          : requestedTop === "bottom"
            ? Math.max(0, scrollHeight - clientHeight)
            : requestedTop;
    element.scrollTo({ behavior: "instant", left: 0, top: numericTop });
  }, visualCase.scroll.sidebar);
};

const prepareReferenceScenario = async (
  page: Page,
  visualCase: VisualReferenceCase,
): Promise<void> => {
  const setupActions = visualCase.actions.filter((action) => !interactionAction(action));
  const interactionActions = visualCase.actions.filter(interactionAction);
  for (const action of setupActions) await applyProductionAction(page, action);
  if (visualCase.expectedScreenLabel !== undefined) {
    await page
      .locator(`[data-screen-label="${visualCase.expectedScreenLabel}"]`)
      .waitFor({ state: "visible" });
  }
  await applyProductionFinalScroll(page, visualCase);
  for (const action of interactionActions) await applyProductionAction(page, action);
  if (interactionActions.length === 0) await page.mouse.move(0, 0);
  await settleAnimations(page);
  await page.waitForTimeout(20);
  await settleAnimations(page);
};

const waitForProduction = async (page: Page): Promise<void> => {
  await page.locator("[data-production-ready=true]").waitFor({ state: "visible" });
  await page.evaluate(async () => document.fonts.ready);
  await settleAnimations(page);
};

const referenceMetadata = async (id: string): Promise<ReferenceMetadata> =>
  JSON.parse(
    await readFile(join(REFERENCE_ROOT, "metadata", `${id}.json`), "utf8"),
  ) as ReferenceMetadata;

const referenceScreenshot = async (id: string): Promise<Buffer> =>
  readFile(join(REFERENCE_ROOT, "screenshots", `${id}.png`));

const differenceImage = (expected: Buffer, actual: Buffer): Buffer => {
  const first = PNG.sync.read(expected);
  const second = PNG.sync.read(actual);
  if (first.width !== second.width || first.height !== second.height) {
    return actual;
  }
  const output = new PNG({ height: first.height, width: first.width });
  for (let offset = 0; offset < first.data.length; offset += 4) {
    const red = first.data[offset] ?? 0;
    const green = first.data[offset + 1] ?? 0;
    const blue = first.data[offset + 2] ?? 0;
    const delta = Math.max(
      Math.abs(red - (second.data[offset] ?? 0)),
      Math.abs(green - (second.data[offset + 1] ?? 0)),
      Math.abs(blue - (second.data[offset + 2] ?? 0)),
      Math.abs((first.data[offset + 3] ?? 0) - (second.data[offset + 3] ?? 0)),
    );
    if (delta <= visualManifest.colorThresholdPerChannel) {
      const gray = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
      output.data[offset] = gray;
      output.data[offset + 1] = gray;
      output.data[offset + 2] = gray;
      output.data[offset + 3] = 40;
    } else {
      output.data[offset] = 255;
      output.data[offset + 1] = Math.max(0, 96 - delta);
      output.data[offset + 2] = 64;
      output.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(output);
};

const colorChannels = (value: string): readonly number[] | null => {
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (match?.[1] === undefined) return null;
  const channels = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  return channels.every(Number.isFinite) ? channels : null;
};

const colorDelta = (left: string, right: string): number => {
  if (left === right) return 0;
  const first = colorChannels(left);
  const second = colorChannels(right);
  if (first === null || second === null || first.length !== second.length) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(...first.map((channel, index) => Math.abs(channel - (second[index] ?? channel))));
};

const compareLandmarks = (
  id: string,
  expected: readonly LandmarkBaseline[],
  actual: readonly LandmarkBaseline[],
): readonly string[] => {
  const errors: string[] = [];
  if (expected.length !== actual.length) {
    return [
      `${id}: landmark count differs (${String(expected.length)} != ${String(actual.length)})`,
    ];
  }
  const semanticColors = [
    "background-color",
    "border-bottom-color",
    "border-left-color",
    "border-right-color",
    "border-top-color",
    "color",
  ] as const;
  for (const [index, first] of expected.entries()) {
    const second = actual[index];
    if (second === undefined || first.name !== second.name || first.count !== second.count) {
      errors.push(`${id}: landmark ${first.name} identity or count differs`);
      continue;
    }
    if (first.boundingBox === null || second.boundingBox === null) {
      if (first.boundingBox !== second.boundingBox) {
        errors.push(`${id}: landmark ${first.name} presence differs`);
      }
      continue;
    }
    for (const key of ["height", "width", "x", "y"] as const) {
      const delta = Math.abs(first.boundingBox[key] - second.boundingBox[key]);
      if (delta > visualManifest.geometryThresholdPixels) {
        errors.push(`${id}: landmark ${first.name} ${key} differs by ${delta.toFixed(3)}px`);
      }
    }
    for (const property of semanticColors) {
      const delta = colorDelta(first.style?.[property] ?? "", second.style?.[property] ?? "");
      if (delta > visualManifest.colorThresholdPerChannel) {
        errors.push(`${id}: landmark ${first.name} ${property} differs`);
      }
    }
  }
  return errors;
};

const screenshotFor = async (
  page: Page,
  captureMode: VisualReferenceCase["captureMode"],
): Promise<Buffer> =>
  page.screenshot({
    animations: "disabled",
    fullPage: captureMode === "full-page",
    type: "png",
  });

const documentMetadata = async (page: Page) =>
  page.evaluate(() => ({
    height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  }));

const fontMetadata = async (page: Page) =>
  page.evaluate(() => ({
    instrumentSans: document.fonts.check('16px "Instrument Sans"'),
    jetbrainsMono: document.fonts.check('16px "JetBrains Mono"'),
    status: document.fonts.status,
  }));

const storageWrites = async (page: Page): Promise<readonly string[]> =>
  page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __dougoosStorageWrites?: readonly string[];
    };
    return [...(runtime.__dougoosStorageWrites ?? [])];
  });

interface AuditTracker {
  auditEnabled: boolean;
  readonly actionAudit: Array<ProductionMetadata["actionAudit"][number]>;
  readonly downloads: string[];
  readonly dynamicRequests: Array<ProductionMetadata["dynamicRequests"][number]>;
  readonly safetyEffects: Array<Readonly<Record<string, string>>>;
  readonly storageWrites: string[];
}

const drainPageSafetyEffects = async (
  page: Page,
): Promise<{
  readonly safetyEffects: readonly Readonly<Record<string, string>>[];
  readonly storageWrites: readonly string[];
}> =>
  page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __dougoosSafetyEffects?: Array<Readonly<Record<string, string>>>;
      __dougoosStorageWrites?: string[];
    };
    return {
      safetyEffects: runtime.__dougoosSafetyEffects?.splice(0) ?? [],
      storageWrites: runtime.__dougoosStorageWrites?.splice(0) ?? [],
    };
  });

const visualActionDescription = (action: VisualAction): string => {
  if (action.type === "click-switch-near-text") return `switch:${action.text}`;
  if (action.type === "scroll") return `scroll:${action.target}`;
  if (action.type === "wait") return "wait";
  return `${action.type}:${action.locator.by}:${action.locator.value}`;
};

const landingActionDescription = (action: LandingSafetyAction): string => {
  if (action.type === "reload") return "reload";
  if (action.type === "press") return `press:${action.key}`;
  if (action.type === "fill") {
    return `fill:${action.locator.by}:${action.locator.value}`;
  }
  return `${action.type}:${action.locator.by}:${action.locator.value}`;
};

const landingExpectationState = async (
  page: Page,
  expectation: LandingSafetyExpectation,
): Promise<{ readonly passed: boolean; readonly state: string }> => {
  const rootVisible =
    (await page.locator('[data-screen-label="落地页"]').count()) === 1 &&
    (await page.locator('[data-screen-label="落地页"]').isVisible());
  const dialog = page.getByRole("dialog", { name: "登录 AgentOS" });
  const dialogVisible = (await dialog.count()) === 1 && (await dialog.isVisible());
  const loggedIn =
    (await page.getByLabel("演示用户 Ryo").count()) === 1 &&
    (await page.getByLabel("演示用户 Ryo").isVisible());
  const loginVisible =
    (await page.getByRole("button", { exact: true, name: "登录" }).count()) > 0 &&
    (await page.getByRole("button", { exact: true, name: "登录" }).first().isVisible());
  const inputCount = await page.locator(".login-input").count();
  switch (expectation) {
    case "dialog-open":
      return { passed: rootVisible && dialogVisible && !loggedIn, state: "dialog-open" };
    case "dialog-closed":
      return {
        passed: rootVisible && !dialogVisible && loginVisible && !loggedIn,
        state: "dialog-closed",
      };
    case "logged-in":
      return {
        passed: rootVisible && !dialogVisible && loggedIn && inputCount === 0,
        state: "logged-in:Ryo",
      };
    case "logged-out":
      return {
        passed: rootVisible && !dialogVisible && loginVisible && !loggedIn && inputCount === 0,
        state: "logged-out",
      };
    case "root": {
      const theme = await page.locator(".landing-root").getAttribute("data-theme");
      return {
        passed: rootVisible && !dialogVisible && !loggedIn,
        state: `root:${theme ?? "none"}`,
      };
    }
  }
};

const auditAction = async (
  page: Page,
  origin: string,
  tracker: AuditTracker,
  action: string,
  id: string,
  expectation: LandingSafetyExpectation | null,
  perform: () => Promise<void>,
): Promise<void> => {
  const fullUrlBefore = page.url();
  const urlBefore = normalizedEvidenceUrl(fullUrlBefore, origin);
  const dynamicCount = tracker.dynamicRequests.length;
  const downloadCount = tracker.downloads.length;
  await perform();
  await page.waitForTimeout(0);
  const observed = await drainPageSafetyEffects(page);
  tracker.safetyEffects.push(...observed.safetyEffects);
  tracker.storageWrites.push(...observed.storageWrites);
  const expectationResult =
    expectation === null
      ? { passed: true, state: "probe-action-completed" }
      : await landingExpectationState(page, expectation);
  const fullUrlAfter = page.url();
  const urlAfter = normalizedEvidenceUrl(fullUrlAfter, origin);
  const passed =
    fullUrlAfter === fullUrlBefore &&
    tracker.dynamicRequests.length === dynamicCount &&
    tracker.downloads.length === downloadCount &&
    observed.safetyEffects.length === 0 &&
    observed.storageWrites.length === 0 &&
    expectationResult.passed;
  tracker.actionAudit.push({
    action,
    id,
    passed,
    state: expectationResult.state,
    urlAfter,
    urlBefore,
  });
};

const runLandingSafetyAudit = async (
  page: Page,
  origin: string,
  visualCase: ProductionOnlyCase,
  tracker: AuditTracker,
): Promise<void> => {
  for (const [index, action] of (visualCase.probe?.actions ?? []).entries()) {
    await auditAction(
      page,
      origin,
      tracker,
      visualActionDescription(action),
      `page-control-${String(index + 1).padStart(2, "0")}`,
      "root",
      async () => applyProductionAction(page, action),
    );
  }
  for (const action of visualCase.probe?.landingActions ?? []) {
    await auditAction(
      page,
      origin,
      tracker,
      landingActionDescription(action),
      action.id,
      action.expect,
      async () => {
        if (action.type === "reload") {
          tracker.auditEnabled = false;
          try {
            await page.reload({ waitUntil: "networkidle" });
            await waitForProduction(page);
          } finally {
            tracker.auditEnabled = true;
          }
          return;
        }
        if (action.type === "press") {
          await page.keyboard.press(action.key);
          return;
        }
        const locator = resolveLocator(page, action.locator);
        if (action.type === "fill") {
          await locator.fill(action.value);
        } else if (action.type === "click-position") {
          await locator.click({ position: action.position });
        } else {
          await locator.click();
        }
      },
    );
  }
};

const productionLandmark = (
  landmark: LandmarkSpec,
  surface: VisualReferenceCase["surface"],
): LandmarkSpec => {
  if (surface === "landing") return landmark;
  switch (landmark.name) {
    case "root":
      return { ...landmark, locator: { by: "css", value: ".app-shell" } };
    case "sidebar":
      return { ...landmark, locator: { by: "css", value: ".sidebar" } };
    case "topbar":
      return { ...landmark, locator: { by: "css", value: ".topbar" } };
    case "settings-agent-section":
      return { ...landmark, locator: { by: "css", value: ".agent-config-section" } };
    default:
      return landmark;
  }
};

const captureReferenceCase = async (
  page: Page,
  browserVersion: string,
  origin: string,
  visualCase: VisualReferenceCase,
  productionSha256: string,
): Promise<ProductionCapture> => {
  const viewport = VIEWPORTS[visualCase.viewport];
  await page.setViewportSize(viewport);
  const externalRequests: string[] = [];
  const onRequest = (request: { url(): string }) => {
    const url = request.url();
    if (!hasExactOrigin(url, origin)) externalRequests.push(normalizedEvidenceUrl(url, origin));
  };
  page.on("request", onRequest);
  const url = new URL("/", origin);
  url.searchParams.set("accent", visualCase.accent);
  url.searchParams.set("theme", visualCase.theme);
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await waitForProduction(page);
  await prepareReferenceScenario(page, visualCase);

  const [screenshot, reference, expectedMetadata, landmarks, document, dom, fonts, writes] =
    await Promise.all([
      screenshotFor(page, visualCase.captureMode),
      referenceScreenshot(visualCase.id),
      referenceMetadata(visualCase.id),
      Promise.all(
        visualCase.landmarks.map((landmark) =>
          landmarkBaseline(page, productionLandmark(landmark, visualCase.surface)),
        ),
      ),
      documentMetadata(page),
      domDigest(page),
      fontMetadata(page),
      storageWrites(page),
    ]);
  page.off("request", onRequest);

  const comparison = compareImages(reference, screenshot);
  const errors = [
    ...(typeof comparison === "string" ? [`${visualCase.id}: ${comparison}`] : []),
    ...compareLandmarks(visualCase.id, expectedMetadata.landmarks, landmarks),
  ];
  if (typeof comparison !== "string") {
    if (comparison.diffPixelRatio > visualManifest.maxDiffPixelRatio) {
      errors.push(
        `${visualCase.id}: diff pixel ratio ${comparison.diffPixelRatio.toFixed(6)} exceeds ${visualManifest.maxDiffPixelRatio.toFixed(6)}`,
      );
    }
    if (comparison.ssim < visualManifest.ssimMinimum) {
      errors.push(
        `${visualCase.id}: SSIM ${comparison.ssim.toFixed(6)} is below ${visualManifest.ssimMinimum.toFixed(6)}`,
      );
    }
  }
  if (externalRequests.length > 0) {
    errors.push(`${visualCase.id}: external requests observed: ${externalRequests.join(", ")}`);
  }

  return {
    metadata: {
      accent: visualCase.accent,
      actionAudit: [],
      browser: { name: "chromium", version: browserVersion },
      build: { kind: "release", sha256: productionSha256 },
      captureMode: visualCase.captureMode,
      comparison: typeof comparison === "string" ? null : comparison,
      description: visualCase.description,
      document,
      dom,
      downloads: [],
      dynamicRequests: [],
      errors,
      externalRequests,
      fonts,
      id: visualCase.id,
      kind: "production-actual",
      landmarks,
      locale: "zh-CN",
      productionSha256,
      runtimeEffects: [],
      safetyEffects: [],
      screenshot: {
        bytes: screenshot.byteLength,
        path: relative(WORKSPACE_ROOT, join(ACTUAL_ROOT, `${visualCase.id}.png`)),
        sha256: sha256(screenshot),
      },
      semanticChecks: [],
      storageWrites: writes,
      theme: visualCase.theme,
      timezoneId: "Asia/Shanghai",
      viewport: {
        deviceScaleFactor: 1,
        height: viewport.height,
        name: visualCase.viewport,
        width: viewport.width,
      },
    },
    screenshot,
  };
};

const captureProductionOnlyCase = async (
  page: Page,
  browserVersion: string,
  origin: string,
  visualCase: ProductionOnlyCase,
  productionSha256: string,
): Promise<ProductionCapture> => {
  const viewport = VIEWPORTS[visualCase.viewport];
  await page.setViewportSize(viewport);
  const externalRequests: string[] = [];
  const tracker: AuditTracker = {
    actionAudit: [],
    auditEnabled: false,
    downloads: [],
    dynamicRequests: [],
    safetyEffects: [],
    storageWrites: [],
  };
  const onRequest = (request: { method(): string; resourceType(): string; url(): string }) => {
    const requestUrl = request.url();
    if (!hasExactOrigin(requestUrl, origin)) {
      externalRequests.push(normalizedEvidenceUrl(requestUrl, origin));
    }
    if (tracker.auditEnabled) {
      tracker.dynamicRequests.push({
        method: request.method(),
        resourceType: request.resourceType(),
        sameOrigin: hasExactOrigin(requestUrl, origin),
        url: normalizedEvidenceUrl(requestUrl, origin),
      });
    }
  };
  const onDownload = () => {
    if (tracker.auditEnabled) tracker.downloads.push("download-observed");
  };
  page.on("request", onRequest);
  page.on("download", onDownload);
  const url = new URL("/", origin);
  if (visualCase.surface === "saas") url.searchParams.set("visualCase", visualCase.id);
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  if (visualCase.surface === "saas") {
    await page.locator(`html[data-visual-case="${visualCase.id}"]`).waitFor({
      state: "visible",
    });
    await page.evaluate(async () => document.fonts.ready);
    await settleAnimations(page);
  } else {
    await waitForProduction(page);
  }
  const initialEffects = await drainPageSafetyEffects(page);
  tracker.safetyEffects.push(...initialEffects.safetyEffects);
  tracker.storageWrites.push(...initialEffects.storageWrites);
  const screenshot = await screenshotFor(page, "viewport");
  const semanticChecks = [];
  for (const requirement of visualCase.capture.requirements) {
    const locator = resolveLocator(page, requirement.locator);
    let actual: unknown;
    let passed: boolean;
    if (requirement.kind === "visible") {
      actual = (await locator.count()) > 0 && (await locator.first().isVisible());
      passed = actual === true;
    } else if (requirement.kind === "hidden") {
      const count = await locator.count();
      actual = count === 0 ? "absent" : await locator.first().isVisible();
      passed = count === 0 || actual === false;
    } else if (requirement.kind === "enabled") {
      actual = (await locator.count()) > 0 && (await locator.first().isEnabled());
      passed = actual === true;
    } else if (requirement.kind === "disabled") {
      const present = (await locator.count()) > 0;
      const disabled = present && (await locator.first().isDisabled());
      const before = present ? await page.locator("body").textContent() : null;
      if (present) {
        await locator.first().evaluate((element) => {
          if (element instanceof HTMLElement) element.click();
        });
      }
      const after = present ? await page.locator("body").textContent() : null;
      actual = { disabled, noStateChange: before === after };
      passed = disabled && before === after;
    } else if (requirement.kind === "text") {
      actual = (await locator.first().textContent())?.replace(/\s+/g, " ").trim() ?? "";
      passed = String(actual).includes(requirement.includes);
    } else {
      const attributeLocator =
        requirement.locator.by === "css"
          ? page.locator("body").locator(requirement.locator.value)
          : locator;
      actual = [
        ...new Set(
          await attributeLocator.evaluateAll(
            (elements, name) =>
              elements
                .map((element) => element.getAttribute(name))
                .filter((value): value is string => value !== null),
            requirement.name,
          ),
        ),
      ].sort();
      passed = JSON.stringify(actual) === JSON.stringify([...requirement.equals].sort());
    }
    semanticChecks.push({ actual, id: requirement.id, passed });
  }
  const [documentInfo, dom, fonts, landmarks] = await Promise.all([
    documentMetadata(page),
    domDigest(page),
    fontMetadata(page),
    Promise.all(
      visualCase.capture.landmarks.map((landmark) =>
        landmarkBaseline(page, productionLandmark(landmark, visualCase.surface)),
      ),
    ),
  ]);
  tracker.auditEnabled = true;
  if (visualCase.surface === "landing") {
    await runLandingSafetyAudit(page, origin, visualCase, tracker);
  } else {
    for (const [index, action] of (visualCase.probe?.actions ?? []).entries()) {
      await auditAction(
        page,
        origin,
        tracker,
        visualActionDescription(action),
        `probe-${String(index + 1).padStart(2, "0")}`,
        null,
        async () => applyProductionAction(page, action),
      );
    }
  }
  await page.waitForTimeout(0);
  const [remainingEffects, runtimeEffects] = await Promise.all([
    drainPageSafetyEffects(page),
    page.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        __dougoosRuntimeEffects?: readonly Readonly<Record<string, string>>[];
      };
      return [...(runtime.__dougoosRuntimeEffects ?? [])];
    }),
  ]);
  tracker.safetyEffects.push(...remainingEffects.safetyEffects);
  tracker.storageWrites.push(...remainingEffects.storageWrites);
  tracker.auditEnabled = false;
  page.off("request", onRequest);
  page.off("download", onDownload);
  const errors: string[] = [];
  for (const check of semanticChecks) {
    if (!check.passed) {
      errors.push(
        `${visualCase.id}: semantic check ${check.id} failed (actual ${JSON.stringify(
          check.actual,
        )})`,
      );
    }
  }
  for (const action of tracker.actionAudit) {
    if (!action.passed) {
      errors.push(`${visualCase.id}: safety action ${action.id} failed (${action.state})`);
    }
  }
  if (visualCase.surface === "landing") {
    const expectedActionCount =
      (visualCase.probe?.actions.length ?? 0) + (visualCase.probe?.landingActions?.length ?? 0);
    if (tracker.actionAudit.length !== expectedActionCount || expectedActionCount === 0) {
      errors.push(
        `${visualCase.id}: action audit count mismatch (${String(
          tracker.actionAudit.length,
        )}/${String(expectedActionCount)})`,
      );
    }
  }
  if (JSON.stringify(externalRequests) !== JSON.stringify(visualCase.expected.externalRequests)) {
    errors.push(
      `${visualCase.id}: external request contract mismatch (${externalRequests.join(", ")})`,
    );
  }
  if (JSON.stringify(tracker.storageWrites) !== JSON.stringify(visualCase.expected.storageWrites)) {
    errors.push(
      `${visualCase.id}: storage write contract mismatch (${tracker.storageWrites.join(", ")})`,
    );
  }
  if (JSON.stringify(runtimeEffects) !== JSON.stringify(visualCase.expected.runtimeEffects)) {
    errors.push(`${visualCase.id}: runtime effect contract mismatch`);
  }
  if (tracker.safetyEffects.length > 0) {
    errors.push(
      `${visualCase.id}: unsafe browser effects observed (${tracker.safetyEffects
        .map((effect) => effect.category ?? "unknown")
        .join(", ")})`,
    );
  }
  if (tracker.dynamicRequests.length > 0) {
    errors.push(`${visualCase.id}: dynamic requests observed during safety actions`);
  }
  if (tracker.downloads.length > 0) {
    errors.push(`${visualCase.id}: download observed during safety actions`);
  }
  return {
    metadata: {
      accent: "green",
      actionAudit: tracker.actionAudit,
      browser: { name: "chromium", version: browserVersion },
      build: {
        kind: visualCase.surface === "landing" ? "release" : "visual-test",
        sha256: productionSha256,
      },
      captureMode: "viewport",
      comparison: null,
      description: visualCase.description,
      document: documentInfo,
      dom,
      downloads: tracker.downloads,
      dynamicRequests: tracker.dynamicRequests,
      errors,
      externalRequests,
      fonts,
      id: visualCase.id,
      kind: "production-only",
      landmarks,
      locale: "zh-CN",
      productionSha256,
      runtimeEffects,
      safetyEffects: tracker.safetyEffects,
      screenshot: {
        bytes: screenshot.byteLength,
        path: relative(WORKSPACE_ROOT, join(ACTUAL_ROOT, `${visualCase.id}.png`)),
        sha256: sha256(screenshot),
      },
      semanticChecks,
      storageWrites: tracker.storageWrites,
      theme: "dark",
      timezoneId: "Asia/Shanghai",
      viewport: {
        deviceScaleFactor: 1,
        height: viewport.height,
        name: visualCase.viewport,
        width: viewport.width,
      },
    },
    screenshot,
  };
};

const stableJson = async (value: unknown): Promise<string> =>
  formatWithPrettier(JSON.stringify(value), {
    endOfLine: "lf",
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
  });

const writeCapture = async (
  capture: ProductionCapture,
  referenceCase: VisualReferenceCase | undefined,
): Promise<void> => {
  const id = capture.metadata.id;
  await writeFile(join(ACTUAL_ROOT, `${id}.png`), capture.screenshot);
  await writeFile(join(METADATA_ROOT, `${id}.json`), await stableJson(capture.metadata));
  if (referenceCase !== undefined) {
    const expected = await referenceScreenshot(id);
    await writeFile(join(DIFF_ROOT, `${id}.png`), differenceImage(expected, capture.screenshot));
  }
};

const exactStringSet = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

const removeStaleProductionEvidence = async (
  directory: string,
  expectedNames: ReadonlySet<string>,
): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && !expectedNames.has(entry.name)) {
      await unlink(join(directory, entry.name));
    }
  }
};

const assertExactProductionEvidence = async (
  actualNames: readonly string[],
  diffNames: readonly string[],
  metadataNames: readonly string[],
): Promise<void> => {
  const names = async (directory: string): Promise<readonly string[]> =>
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  const [actual, diff, metadata] = await Promise.all([
    names(ACTUAL_ROOT),
    names(DIFF_ROOT),
    names(METADATA_ROOT),
  ]);
  if (!exactStringSet(actual, actualNames)) {
    throw new Error(
      `Production actual evidence set mismatch (${String(actual.length)}/${String(
        actualNames.length,
      )})`,
    );
  }
  if (!exactStringSet(metadata, metadataNames)) {
    throw new Error(
      `Production metadata evidence set mismatch (${String(metadata.length)}/${String(
        metadataNames.length,
      )})`,
    );
  }
  if (!exactStringSet(diff, diffNames)) {
    throw new Error(
      `Production diff evidence set mismatch (${String(diff.length)}/${String(diffNames.length)})`,
    );
  }
};

export async function captureProductionSet(
  browser: Browser,
  options: {
    readonly cases?: readonly VisualReferenceCase[];
    readonly includeProductionOnly?: boolean;
    readonly productionCases?: readonly ProductionOnlyCase[];
    readonly onProgress?: (completed: number, total: number, id: string) => void;
    readonly write?: boolean;
  } = {},
): Promise<ProductionRunResult> {
  const cases = options.cases ?? allProductionReferenceCases;
  const productionCases =
    options.includeProductionOnly === false
      ? []
      : (options.productionCases ?? allProductionOnlyCases);
  const write = options.write ?? true;
  const canonicalReferenceIds = allProductionReferenceCases.map((visualCase) => visualCase.id);
  const canonicalProductionIds = allProductionOnlyCases.map((visualCase) => visualCase.id);
  const canonicalSelection =
    exactStringSet(
      cases.map((visualCase) => visualCase.id),
      canonicalReferenceIds,
    ) &&
    exactStringSet(
      productionCases.map((visualCase) => visualCase.id),
      canonicalProductionIds,
    );
  if (write && !canonicalSelection) {
    throw new Error(
      "Production evidence writes require the complete canonical reference and production-only sets",
    );
  }
  const total = cases.length + productionCases.length;
  const needsSaasRelease = cases.some((visualCase) => visualCase.surface === "saas");
  const needsLandingRelease = [...cases, ...productionCases].some(
    (visualCase) => visualCase.surface === "landing",
  );
  const needsSaasVisual = productionCases.some((visualCase) => visualCase.surface === "saas");
  const [saasReleaseServer, landingReleaseServer, saasVisualServer] = await Promise.all([
    needsSaasRelease ? startProductionServer() : null,
    needsLandingRelease ? startLandingProductionServer() : null,
    needsSaasVisual ? startVisualTestServer() : null,
  ]);
  const context = await createContext(
    browser,
    [saasReleaseServer, landingReleaseServer, saasVisualServer]
      .filter((server): server is ProductionServer => server !== null)
      .map((server) => server.origin),
  );
  const page = await context.newPage();
  const captures = new Map<string, ProductionCapture>();
  const errors: string[] = [];
  const [saasSourceSha256, landingSourceSha256, visualSourceSha256] = await Promise.all([
    saasReleaseServer === null ? null : productionSourceHash(SAAS_RELEASE_SITE_ROOT),
    landingReleaseServer === null ? null : productionSourceHash(LANDING_RELEASE_SITE_ROOT),
    saasVisualServer === null ? null : productionSourceHash(SAAS_VISUAL_SITE_ROOT),
  ]);
  let completed = 0;
  try {
    for (const visualCase of cases) {
      try {
        const server = visualCase.surface === "landing" ? landingReleaseServer : saasReleaseServer;
        const sourceSha256 =
          visualCase.surface === "landing" ? landingSourceSha256 : saasSourceSha256;
        if (server === null || sourceSha256 === null) {
          throw new Error(`${visualCase.surface} release server was not started`);
        }
        const capture = await captureReferenceCase(
          page,
          browser.version(),
          server.origin,
          visualCase,
          sourceSha256,
        );
        captures.set(visualCase.id, capture);
        errors.push(...capture.metadata.errors);
      } catch (error) {
        errors.push(
          `${visualCase.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      }
      completed += 1;
      options.onProgress?.(completed, total, visualCase.id);
    }
    for (const visualCase of productionCases) {
      try {
        const server = visualCase.surface === "landing" ? landingReleaseServer : saasVisualServer;
        const sourceSha256 =
          visualCase.surface === "landing" ? landingSourceSha256 : visualSourceSha256;
        if (server === null || sourceSha256 === null) {
          throw new Error(`${visualCase.surface} production-only server was not started`);
        }
        const capture = await captureProductionOnlyCase(
          page,
          browser.version(),
          server.origin,
          visualCase,
          sourceSha256,
        );
        captures.set(visualCase.id, capture);
        errors.push(...capture.metadata.errors);
      } catch (error) {
        errors.push(
          `${visualCase.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      }
      completed += 1;
      options.onProgress?.(completed, total, visualCase.id);
    }
  } finally {
    await context.close();
    await Promise.all([
      saasReleaseServer?.close(),
      landingReleaseServer?.close(),
      saasVisualServer?.close(),
    ]);
  }

  if (write && errors.length === 0 && captures.size === total) {
    await Promise.all([
      mkdir(ACTUAL_ROOT, { recursive: true }),
      mkdir(DIFF_ROOT, { recursive: true }),
      mkdir(METADATA_ROOT, { recursive: true }),
    ]);
    for (const visualCase of cases) {
      const capture = captures.get(visualCase.id);
      if (capture === undefined) throw new Error(`Missing capture ${visualCase.id}`);
      await writeCapture(capture, visualCase);
    }
    for (const visualCase of productionCases) {
      const capture = captures.get(visualCase.id);
      if (capture === undefined) throw new Error(`Missing capture ${visualCase.id}`);
      await writeCapture(capture, undefined);
    }
    const actualNames = [...canonicalReferenceIds, ...canonicalProductionIds].map(
      (id) => `${id}.png`,
    );
    const metadataNames = [...canonicalReferenceIds, ...canonicalProductionIds].map(
      (id) => `${id}.json`,
    );
    const diffNames = canonicalReferenceIds.map((id) => `${id}.png`);
    await Promise.all([
      removeStaleProductionEvidence(ACTUAL_ROOT, new Set(actualNames)),
      removeStaleProductionEvidence(DIFF_ROOT, new Set(diffNames)),
      removeStaleProductionEvidence(METADATA_ROOT, new Set(metadataNames)),
    ]);
    await assertExactProductionEvidence(actualNames, diffNames, metadataNames);
    await writeFile(
      RUN_PATH,
      await stableJson({
        actualCaseCount: captures.size,
        browser: { name: "chromium", version: browser.version() },
        errors,
        expectedCaseCount: total,
        generatedAt: FIXED_TIME,
        productionOnlyCaseCount: productionCases.length,
        productionReferenceCaseCount: cases.length,
        productionSha256: saasSourceSha256 ?? landingSourceSha256,
        productionSha256BySurface: {
          landing: landingSourceSha256,
          saas: saasSourceSha256,
        },
        visualHarnessSha256: visualSourceSha256,
        schemaVersion: 1,
        thresholds: {
          colorPerChannel: visualManifest.colorThresholdPerChannel,
          geometryPixels: visualManifest.geometryThresholdPixels,
          maxDiffPixelRatio: visualManifest.maxDiffPixelRatio,
          ssimMinimum: visualManifest.ssimMinimum,
        },
      }),
    );
  }
  return { captures, errors };
}

export const productionPaths = {
  actualRoot: ACTUAL_ROOT,
  diffRoot: DIFF_ROOT,
  metadataRoot: METADATA_ROOT,
  productionRoot: PRODUCTION_ROOT,
  runPath: RUN_PATH,
} as const;
