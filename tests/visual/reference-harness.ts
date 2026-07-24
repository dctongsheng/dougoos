import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { PNG } from "pngjs";
import { format as formatWithPrettier, resolveConfig as resolvePrettierConfig } from "prettier";
import { ssim } from "ssim.js";

import {
  ACCENTS,
  VIEWPORTS,
  visualManifest,
  visualReferenceCases,
  type LandmarkSpec,
  type LocatorSpec,
  type VisualAction,
  type VisualReferenceCase,
} from "./visual-manifest.js";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REFERENCE_ROOT = join(WORKSPACE_ROOT, "tests/visual/reference");
const SCREENSHOT_ROOT = join(REFERENCE_ROOT, "screenshots");
const METADATA_ROOT = join(REFERENCE_ROOT, "metadata");
const RESOLVED_MANIFEST_PATH = join(REFERENCE_ROOT, "manifest.resolved.json");
const RUN_EVIDENCE_PATH = join(REFERENCE_ROOT, "run.json");

const SAAS_SOURCE = join(WORKSPACE_ROOT, "prototypes/agentos/project/AgentOS SaaS.dc.html");
const LANDING_SOURCE = join(WORKSPACE_ROOT, "prototypes/agentos/project/AgentOS Landing.dc.html");
const SUPPORT_SOURCE = join(WORKSPACE_ROOT, "prototypes/agentos/project/support.js");
const PROTOTYPE_README = join(WORKSPACE_ROOT, "prototypes/agentos/README.md");
const REACT_SOURCE = join(WORKSPACE_ROOT, "node_modules/react/umd/react.production.min.js");
const REACT_DOM_SOURCE = join(
  WORKSPACE_ROOT,
  "node_modules/react-dom/umd/react-dom.production.min.js",
);
const INSTRUMENT_FONT_ROOT = join(WORKSPACE_ROOT, "node_modules/@fontsource/instrument-sans/files");
const JETBRAINS_FONT_ROOT = join(WORKSPACE_ROOT, "node_modules/@fontsource/jetbrains-mono/files");

const FIXED_TIME = visualManifest.deterministic.fixedTime;
const RANDOM_SEED = visualManifest.deterministic.randomSeed;
const ANIMATION_SAMPLE_MILLISECONDS = visualManifest.animationSampleMilliseconds;

const FONT_FILES = {
  "instrument-sans-latin-400-normal.woff2": join(
    INSTRUMENT_FONT_ROOT,
    "instrument-sans-latin-400-normal.woff2",
  ),
  "instrument-sans-latin-500-normal.woff2": join(
    INSTRUMENT_FONT_ROOT,
    "instrument-sans-latin-500-normal.woff2",
  ),
  "instrument-sans-latin-600-normal.woff2": join(
    INSTRUMENT_FONT_ROOT,
    "instrument-sans-latin-600-normal.woff2",
  ),
  "instrument-sans-latin-700-normal.woff2": join(
    INSTRUMENT_FONT_ROOT,
    "instrument-sans-latin-700-normal.woff2",
  ),
  "jetbrains-mono-latin-400-normal.woff2": join(
    JETBRAINS_FONT_ROOT,
    "jetbrains-mono-latin-400-normal.woff2",
  ),
  "jetbrains-mono-latin-500-normal.woff2": join(
    JETBRAINS_FONT_ROOT,
    "jetbrains-mono-latin-500-normal.woff2",
  ),
  "jetbrains-mono-latin-700-normal.woff2": join(
    JETBRAINS_FONT_ROOT,
    "jetbrains-mono-latin-700-normal.woff2",
  ),
} as const;

const FONT_CSS = `
@font-face{font-family:"Instrument Sans";font-style:normal;font-display:block;font-weight:400;src:url("/__visual-assets/font/instrument-sans-latin-400-normal.woff2") format("woff2")}
@font-face{font-family:"Instrument Sans";font-style:normal;font-display:block;font-weight:500;src:url("/__visual-assets/font/instrument-sans-latin-500-normal.woff2") format("woff2")}
@font-face{font-family:"Instrument Sans";font-style:normal;font-display:block;font-weight:600;src:url("/__visual-assets/font/instrument-sans-latin-600-normal.woff2") format("woff2")}
@font-face{font-family:"Instrument Sans";font-style:normal;font-display:block;font-weight:700;src:url("/__visual-assets/font/instrument-sans-latin-700-normal.woff2") format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-display:block;font-weight:400;src:url("/__visual-assets/font/jetbrains-mono-latin-400-normal.woff2") format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-display:block;font-weight:500;src:url("/__visual-assets/font/jetbrains-mono-latin-500-normal.woff2") format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-display:block;font-weight:700;src:url("/__visual-assets/font/jetbrains-mono-latin-700-normal.woff2") format("woff2")}
`;

const DETERMINISTIC_STYLE = `
html,body,*{caret-color:transparent!important}
*,*::before,*::after{animation-play-state:paused!important}
`;

const LOCALLY_SUBSTITUTED_EXTERNAL_RESOURCES = new Set([
  "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap",
]);

const INTERVAL_GUARD_JS = `
(() => {
  const nativeSetInterval = globalThis.setInterval.bind(globalThis);
  globalThis.setInterval = (callback, delay, ...args) => {
    if (Number(delay) === 1000) return -2147483647;
    return nativeSetInterval(callback, delay, ...args);
  };
})();
`;

interface ReferenceServer {
  readonly close: () => Promise<void>;
  readonly origin: string;
}

export interface LandmarkBaseline {
  readonly boundingBox: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  } | null;
  readonly count: number;
  readonly name: string;
  readonly style: Record<string, string> | null;
  readonly text: string | null;
}

export interface ReferenceMetadata {
  readonly accent: keyof typeof ACCENTS;
  readonly animationSampleMilliseconds: number;
  readonly browser: {
    readonly name: "chromium";
    readonly version: string;
  };
  readonly captureMode: VisualReferenceCase["captureMode"];
  readonly deterministic: typeof visualManifest.deterministic;
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
  readonly externalRequests: readonly string[];
  readonly fonts: {
    readonly instrumentSans: boolean;
    readonly jetbrainsMono: boolean;
    readonly status: "loaded" | "loading";
  };
  readonly id: string;
  readonly kind: VisualReferenceCase["kind"];
  readonly landmarks: readonly LandmarkBaseline[];
  readonly locale: "zh-CN";
  readonly platform: NodeJS.Platform;
  readonly screenshot: {
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  };
  readonly scroll: VisualReferenceCase["scroll"];
  readonly source: VisualReferenceCase["source"];
  readonly sourceSha256: string;
  readonly surface: VisualReferenceCase["surface"];
  readonly theme: VisualReferenceCase["theme"];
  readonly timezoneId: "Asia/Shanghai";
  readonly viewport: {
    readonly deviceScaleFactor: 1;
    readonly height: number;
    readonly name: VisualReferenceCase["viewport"];
    readonly width: number;
  };
}

export interface CapturedReference {
  readonly metadata: ReferenceMetadata;
  readonly screenshot: Buffer;
}

export interface ReferenceRunResult {
  readonly captures: ReadonlyMap<string, CapturedReference>;
  readonly errors: readonly string[];
}

const mimeFor = (path: string): string => {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose();
      else rejectClose(error);
    });
  });
};

export async function startReferenceServer(): Promise<ReferenceServer> {
  const saasHtml = (await readFile(SAAS_SOURCE, "utf8")).replace(
    '<script src="./support.js"></script>',
    '<script src="/__visual-assets/interval-guard.js"></script>\n<script src="./support.js"></script>',
  );
  const routes = new Map<string, string>([
    ["/prototype/AgentOS%20Landing.dc.html", LANDING_SOURCE],
    ["/prototype/support.js", SUPPORT_SOURCE],
    ["/__visual-assets/react.production.min.js", REACT_SOURCE],
    ["/__visual-assets/react-dom.production.min.js", REACT_DOM_SOURCE],
  ]);
  for (const [name, path] of Object.entries(FONT_FILES)) {
    routes.set(`/__visual-assets/font/${name}`, path);
  }

  const server = createServer((request, response) => {
    const requestUrl = request.url?.split("?")[0] ?? "/";
    if (requestUrl === "/prototype/AgentOS%20SaaS.dc.html" && request.method === "GET") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self' blob:; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' blob:; font-src 'self'; img-src 'self' data: blob:",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(saasHtml);
      return;
    }
    if (requestUrl === "/__visual-assets/interval-guard.js" && request.method === "GET") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
      });
      response.end(INTERVAL_GUARD_JS);
      return;
    }
    const sourcePath = routes.get(requestUrl);
    if (sourcePath === undefined || request.method !== "GET") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self' blob:; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' blob:; font-src 'self'; img-src 'self' data: blob:",
      "content-type": mimeFor(sourcePath),
    });
    createReadStream(sourcePath).pipe(response);
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
    throw new Error("Reference server did not bind an IPv4 port");
  }

  return {
    close: async () => closeServer(server),
    origin: `http://127.0.0.1:${address.port}`,
  };
}

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

const sourceHash = async (visualCase: VisualReferenceCase): Promise<string> => {
  const path = visualCase.surface === "saas" ? SAAS_SOURCE : LANDING_SOURCE;
  const [prototypeSource, supportSource, readmeSource] = await Promise.all([
    readFile(path),
    readFile(SUPPORT_SOURCE),
    readFile(PROTOTYPE_README),
  ]);
  const hash = createHash("sha256");
  hash.update(`prototype:${visualCase.source}\0`);
  hash.update(prototypeSource);
  hash.update("\0support:prototypes/agentos/project/support.js\0");
  hash.update(supportSource);
  hash.update("\0contract:prototypes/agentos/README.md\0");
  hash.update(readmeSource);
  return hash.digest("hex");
};

const initScript = (): string => `
(() => {
  const fontCss = ${JSON.stringify(FONT_CSS)};
  const resources = {
    "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "/__visual-assets/react.production.min.js",
    "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "/__visual-assets/react-dom.production.min.js",
    "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap": "__dougoos_visual_fonts__"
  };
  Object.defineProperty(globalThis, "__resources", {
    configurable: false,
    enumerable: false,
    value: resources
  });
  Object.defineProperty(globalThis, "__resourceBlobs", {
    configurable: false,
    enumerable: false,
    value: { "__dougoos_visual_fonts__": new Blob([fontCss], { type: "text/css" }) }
  });

  let randomState = ${String(RANDOM_SEED)} >>> 0;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };

})();
`;

const sourceUrl = (origin: string, surface: VisualReferenceCase["surface"]): string =>
  surface === "saas"
    ? `${origin}/prototype/AgentOS%20SaaS.dc.html`
    : `${origin}/prototype/AgentOS%20Landing.dc.html`;

const screenRoot = (page: Page): Locator => page.locator("[data-screen-label]").first();

export const resolveLocator = (page: Page, spec: LocatorSpec): Locator => {
  const root = spec.scope === "screen" ? screenRoot(page) : page.locator("body");
  let locator: Locator;
  switch (spec.by) {
    case "css":
      locator = root.locator(spec.value);
      break;
    case "placeholder":
      locator = root.getByPlaceholder(spec.value, { exact: spec.exact ?? true });
      break;
    case "text":
      locator = root.getByText(spec.value, { exact: spec.exact ?? true });
      break;
    case "title":
      locator = root.getByTitle(spec.value, { exact: spec.exact ?? true });
      break;
  }
  if (spec.index === "last") return locator.last();
  if (typeof spec.index === "number") return locator.nth(spec.index);
  return locator.first();
};

const clickSwitchNearText = async (
  page: Page,
  textValue: string,
  scope: "page" | "screen",
): Promise<void> => {
  const anchor = resolveLocator(page, {
    by: "text",
    exact: true,
    scope,
    value: textValue,
  });
  await anchor.scrollIntoViewIfNeeded();
  const clicked = await anchor.evaluate((element) => {
    let current: Element | null = element;
    while (current !== null && current !== document.body) {
      const candidates = [...current.querySelectorAll("div")].filter((candidate) => {
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return (
          Math.abs(rect.width - 36) <= 1 &&
          Math.abs(rect.height - 20) <= 1 &&
          style.cursor === "pointer"
        );
      });
      const candidate = candidates.at(-1);
      if (candidate instanceof HTMLElement) {
        candidate.click();
        return true;
      }
      current = current.parentElement;
    }
    return false;
  });
  if (!clicked)
    throw new Error(`No 36x20 switch found near exact text ${JSON.stringify(textValue)}`);
};

export const applyAction = async (page: Page, action: VisualAction): Promise<void> => {
  switch (action.type) {
    case "click":
      await resolveLocator(page, action.locator).click();
      return;
    case "click-switch-near-text":
      await clickSwitchNearText(page, action.text, action.scope ?? "page");
      return;
    case "fill":
      await resolveLocator(page, action.locator).fill(action.value);
      return;
    case "focus":
      await resolveLocator(page, action.locator).focus();
      return;
    case "hover":
      await resolveLocator(page, action.locator).hover();
      return;
    case "pointer-down": {
      const locator = resolveLocator(page, action.locator);
      await locator.hover();
      await page.mouse.down();
      return;
    }
    case "scroll-into-view":
      await resolveLocator(page, action.locator).scrollIntoViewIfNeeded();
      return;
    case "wait-for-visible":
      await resolveLocator(page, action.locator).waitFor({ state: "visible" });
      return;
    case "scroll":
      await scrollTarget(page, action.target, action.top);
      return;
    case "wait":
      await page.waitForTimeout(action.milliseconds);
  }
};

const interactionAction = (action: VisualAction): boolean =>
  action.type === "focus" || action.type === "hover" || action.type === "pointer-down";

export const scrollTarget = async (
  page: Page,
  target: "main" | "page" | "sidebar",
  top: "bottom" | "middle" | "top" | number,
): Promise<void> => {
  await page.evaluate(
    ({ requestedTarget, requestedTop }) => {
      let element: HTMLElement | null = null;
      if (requestedTarget === "page") {
        const scrollHeight =
          Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) ||
          document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight || window.innerHeight;
        const numericTop =
          requestedTop === "top"
            ? 0
            : requestedTop === "middle"
              ? Math.max(0, (scrollHeight - clientHeight) / 2)
              : requestedTop === "bottom"
                ? Math.max(0, scrollHeight - clientHeight)
                : requestedTop;
        window.scrollTo({ behavior: "instant", left: 0, top: numericTop });
        return;
      }

      if (requestedTarget === "sidebar") {
        element = document.querySelector(
          "#dc-root > .sc-host > div > div:first-child > div:nth-child(2)",
        );
      } else {
        const screen = document.querySelector("[data-screen-label]");
        let candidate = screen?.parentElement ?? null;
        while (candidate !== null) {
          const style = getComputedStyle(candidate);
          if (
            candidate.scrollHeight > candidate.clientHeight &&
            (style.overflowY === "auto" || style.overflowY === "scroll")
          ) {
            element = candidate;
            break;
          }
          candidate = candidate.parentElement;
        }
      }
      if (element === null) return;
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
    },
    { requestedTarget: target, requestedTop: top },
  );
};

export const applyFinalScroll = async (
  page: Page,
  visualCase: VisualReferenceCase,
): Promise<void> => {
  await scrollTarget(page, "page", visualCase.scroll.page);
  if (visualCase.surface === "saas") {
    await scrollTarget(page, "main", visualCase.scroll.main);
    await scrollTarget(page, "sidebar", visualCase.scroll.sidebar);
  }
};

export const settleAnimations = async (page: Page): Promise<void> => {
  await page.evaluate(
    ({ animationSampleMilliseconds, deterministicStyle }) => {
      const style = document.createElement("style");
      style.setAttribute("data-visual-deterministic", "");
      style.textContent = deterministicStyle;
      if (document.querySelector("[data-visual-deterministic]") === null) {
        document.head.appendChild(style);
      }
      for (const animation of document.getAnimations()) {
        animation.pause();
        try {
          const timing = animation.effect?.getComputedTiming();
          const declared = animation.effect?.getTiming();
          const endTime = timing?.endTime;
          animation.currentTime =
            declared?.iterations === Number.POSITIVE_INFINITY
              ? animationSampleMilliseconds
              : typeof endTime === "number" && Number.isFinite(endTime)
                ? endTime
                : 10_000;
        } catch {
          // A detached animation may finish between enumeration and assignment.
        }
      }
    },
    {
      animationSampleMilliseconds: ANIMATION_SAMPLE_MILLISECONDS,
      deterministicStyle: DETERMINISTIC_STYLE,
    },
  );
};

const waitForPrototype = async (page: Page, visualCase: VisualReferenceCase): Promise<void> => {
  await page.waitForFunction(() => {
    const runtime = globalThis as typeof globalThis & {
      __dcRootName?: () => string;
      __dcSetProps?: (name: string, props: Record<string, unknown>) => void;
    };
    return typeof runtime.__dcRootName === "function" && typeof runtime.__dcSetProps === "function";
  });
  await page.evaluate(
    ({ accent, liveSim, theme }) => {
      const runtime = globalThis as typeof globalThis & {
        __dcRootName: () => string;
        __dcSetProps: (name: string, props: Record<string, unknown>) => void;
      };
      runtime.__dcSetProps(runtime.__dcRootName(), { accent, liveSim, theme });
    },
    {
      accent: ACCENTS[visualCase.accent],
      liveSim: false,
      theme: visualCase.theme,
    },
  );
  await page.locator("#dc-root > .sc-host").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const fonts = await page.evaluate(() => ({
    instrumentSans: document.fonts.check('16px "Instrument Sans"'),
    jetbrainsMono: document.fonts.check('16px "JetBrains Mono"'),
    status: document.fonts.status,
  }));
  if (!fonts.instrumentSans || !fonts.jetbrainsMono || fonts.status !== "loaded") {
    throw new Error(`Prototype fonts did not become ready: ${JSON.stringify(fonts)}`);
  }
  await settleAnimations(page);
  const logicErrors = await page.locator(".sc-logic-error").count();
  if (logicErrors > 0) {
    throw new Error(`Prototype rendered ${String(logicErrors)} .sc-logic-error nodes`);
  }
};

const prepareCase = async (page: Page, visualCase: VisualReferenceCase): Promise<void> => {
  const setupActions = visualCase.actions.filter((action) => !interactionAction(action));
  const interactionActions = visualCase.actions.filter(interactionAction);
  for (const action of setupActions) await applyAction(page, action);
  if (visualCase.expectedScreenLabel !== undefined) {
    await page
      .locator(`[data-screen-label="${visualCase.expectedScreenLabel}"]`)
      .waitFor({ state: "visible" });
  }
  await applyFinalScroll(page, visualCase);
  for (const action of interactionActions) await applyAction(page, action);
  if (interactionActions.length === 0) await page.mouse.move(0, 0);
  await settleAnimations(page);
  await page.waitForTimeout(20);
  await settleAnimations(page);
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

export const landmarkBaseline = async (
  page: Page,
  landmark: LandmarkSpec,
): Promise<LandmarkBaseline> => {
  const all = (() => {
    const root = landmark.locator.scope === "screen" ? screenRoot(page) : page.locator("body");
    switch (landmark.locator.by) {
      case "css":
        return root.locator(landmark.locator.value);
      case "placeholder":
        return root.getByPlaceholder(landmark.locator.value, {
          exact: landmark.locator.exact ?? true,
        });
      case "text":
        return root.getByText(landmark.locator.value, {
          exact: landmark.locator.exact ?? true,
        });
      case "title":
        return root.getByTitle(landmark.locator.value, {
          exact: landmark.locator.exact ?? true,
        });
    }
  })();
  const count = await all.count();
  if (count === 0) {
    if (landmark.required ?? true) {
      throw new Error(`Required landmark ${landmark.name} did not resolve`);
    }
    return { boundingBox: null, count, name: landmark.name, style: null, text: null };
  }
  const locator =
    landmark.locator.index === "last"
      ? all.last()
      : typeof landmark.locator.index === "number"
        ? all.nth(landmark.locator.index)
        : all.first();
  const result = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const styleProperties = [
      "align-items",
      "animation-delay",
      "animation-duration",
      "animation-iteration-count",
      "animation-name",
      "animation-timing-function",
      "backdrop-filter",
      "background-color",
      "background-image",
      "border-bottom-color",
      "border-bottom-width",
      "border-left-color",
      "border-left-width",
      "border-radius",
      "border-right-color",
      "border-right-width",
      "border-top-color",
      "border-top-width",
      "box-shadow",
      "color",
      "display",
      "flex-direction",
      "font-family",
      "font-size",
      "font-weight",
      "gap",
      "grid-template-columns",
      "height",
      "justify-content",
      "letter-spacing",
      "line-height",
      "margin-bottom",
      "margin-left",
      "margin-right",
      "margin-top",
      "max-width",
      "min-height",
      "opacity",
      "overflow-x",
      "overflow-y",
      "padding-bottom",
      "padding-left",
      "padding-right",
      "padding-top",
      "position",
      "transform",
      "transition-duration",
      "width",
      "z-index",
    ];
    return {
      boundingBox: {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      },
      style: Object.fromEntries(
        styleProperties.map((property) => [property, style.getPropertyValue(property)]),
      ),
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
    };
  });
  return {
    boundingBox: {
      height: round(result.boundingBox.height),
      width: round(result.boundingBox.width),
      x: round(result.boundingBox.x),
      y: round(result.boundingBox.y),
    },
    count,
    name: landmark.name,
    style: result.style,
    text: result.text,
  };
};

export const domDigest = async (
  page: Page,
): Promise<{ readonly digest: string; readonly visibleElementCount: number }> =>
  page.evaluate(() => {
    const styleProperties = [
      "background-color",
      "background-image",
      "border-bottom-color",
      "border-bottom-width",
      "border-left-color",
      "border-left-width",
      "border-radius",
      "border-right-color",
      "border-right-width",
      "border-top-color",
      "border-top-width",
      "box-shadow",
      "color",
      "display",
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "opacity",
      "overflow-x",
      "overflow-y",
      "position",
      "transform",
      "z-index",
    ];
    const root = document.querySelector("#dc-root") ?? document.body;
    const nodes = [...root.querySelectorAll("*")];
    const records: string[] = [];
    for (const [index, element] of nodes.entries()) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        continue;
      }
      const values = styleProperties.map((property) => style.getPropertyValue(property));
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      records.push(
        [
          index,
          element.tagName,
          element.getAttribute("data-dc-tpl") ?? "",
          Math.round(rect.x * 1000) / 1000,
          Math.round(rect.y * 1000) / 1000,
          Math.round(rect.width * 1000) / 1000,
          Math.round(rect.height * 1000) / 1000,
          ownText,
          ...values,
        ].join("\u001f"),
      );
    }
    const source = records.join("\u001e");
    let first = 2166136261;
    let second = 2246822507;
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 3266489917);
    }
    return {
      digest: `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
        .toString(16)
        .padStart(8, "0")}`,
      visibleElementCount: records.length,
    };
  });

const documentMetadata = async (page: Page): Promise<ReferenceMetadata["document"]> =>
  page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    width: document.documentElement.scrollWidth,
  }));

const fontMetadata = async (page: Page): Promise<ReferenceMetadata["fonts"]> =>
  page.evaluate(() => ({
    instrumentSans: document.fonts.check('16px "Instrument Sans"'),
    jetbrainsMono: document.fonts.check('16px "JetBrains Mono"'),
    status: document.fonts.status,
  }));

const captureOne = async (
  page: Page,
  browserVersion: string,
  origin: string,
  visualCase: VisualReferenceCase,
): Promise<CapturedReference> => {
  const viewport = VIEWPORTS[visualCase.viewport];
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(FIXED_TIME);
  const externalRequests: string[] = [];
  const requestListener = (request: { url(): string }): void => {
    const url = request.url();
    if (!url.startsWith(origin) && !LOCALLY_SUBSTITUTED_EXTERNAL_RESOURCES.has(url)) {
      externalRequests.push(url);
    }
  };
  page.on("request", requestListener);

  try {
    await page.goto(sourceUrl(origin, visualCase.surface), { waitUntil: "domcontentloaded" });
    await waitForPrototype(page, visualCase);
    await prepareCase(page, visualCase);
    const screenshot = await page.screenshot({
      animations: "allow",
      caret: "hide",
      fullPage: visualCase.captureMode === "full-page",
      scale: "css",
      type: "png",
    });
    const landmarks: LandmarkBaseline[] = [];
    for (const landmark of visualCase.landmarks) {
      landmarks.push(await landmarkBaseline(page, landmark));
    }
    const screenshotPath = `screenshots/${visualCase.id}.png`;
    const metadata: ReferenceMetadata = {
      accent: visualCase.accent,
      animationSampleMilliseconds: ANIMATION_SAMPLE_MILLISECONDS,
      browser: { name: "chromium", version: browserVersion },
      captureMode: visualCase.captureMode,
      deterministic: visualManifest.deterministic,
      document: await documentMetadata(page),
      dom: await domDigest(page),
      externalRequests: [...new Set(externalRequests)].sort(),
      fonts: await fontMetadata(page),
      id: visualCase.id,
      kind: visualCase.kind,
      landmarks,
      locale: "zh-CN",
      platform: process.platform,
      screenshot: {
        bytes: screenshot.byteLength,
        path: screenshotPath,
        sha256: sha256(screenshot),
      },
      scroll: visualCase.scroll,
      source: visualCase.source,
      sourceSha256: await sourceHash(visualCase),
      surface: visualCase.surface,
      theme: visualCase.theme,
      timezoneId: "Asia/Shanghai",
      viewport: {
        deviceScaleFactor: 1,
        height: viewport.height,
        name: visualCase.viewport,
        width: viewport.width,
      },
    };
    if (metadata.externalRequests.length > 0) {
      throw new Error(
        `External network requests escaped the local reference server: ${metadata.externalRequests.join(", ")}`,
      );
    }
    return { metadata, screenshot };
  } finally {
    page.off("request", requestListener);
    if (visualCase.interaction === "active") {
      await page.mouse.up().catch(() => undefined);
    }
  }
};

const createContext = async (browser: Browser): Promise<BrowserContext> => {
  const context = await browser.newContext({
    colorScheme: "dark",
    deviceScaleFactor: 1,
    locale: "zh-CN",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    timezoneId: "Asia/Shanghai",
    viewport: VIEWPORTS["saas-1440x900"],
  });
  context.setDefaultTimeout(2_500);
  context.setDefaultNavigationTimeout(5_000);
  await context.addInitScript({ content: initScript() });
  await context.route(/^https:\/\//, async (route) => {
    await route.abort("blockedbyclient");
  });
  return context;
};

export async function captureReferenceSet(
  browser: Browser,
  options: {
    readonly cases?: readonly VisualReferenceCase[];
    readonly onProgress?: (completed: number, total: number, id: string) => void;
  } = {},
): Promise<ReferenceRunResult> {
  const cases = options.cases ?? visualReferenceCases;
  const server = await startReferenceServer();
  const context = await createContext(browser);
  const page = await context.newPage();
  const captures = new Map<string, CapturedReference>();
  const errors: string[] = [];

  try {
    for (const [index, visualCase] of cases.entries()) {
      try {
        captures.set(
          visualCase.id,
          await captureOne(page, browser.version(), server.origin, visualCase),
        );
      } catch (error) {
        errors.push(
          `${visualCase.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      }
      options.onProgress?.(index + 1, cases.length, visualCase.id);
    }
  } finally {
    await context.close();
    await server.close();
  }

  return { captures, errors };
}

const stableMetadata = (metadata: ReferenceMetadata): string =>
  `${JSON.stringify(metadata, null, 2)}\n`;

const resolvedManifestEvidence = async (): Promise<string> => {
  const prettierConfig = await resolvePrettierConfig(RESOLVED_MANIFEST_PATH);
  return formatWithPrettier(JSON.stringify(visualManifest), {
    ...(prettierConfig ?? {}),
    parser: "json",
  });
};

const sourceEvidence = async (): Promise<
  readonly {
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }[]
> =>
  Promise.all(
    [SAAS_SOURCE, LANDING_SOURCE, SUPPORT_SOURCE, PROTOTYPE_README].map(async (path) => ({
      bytes: (await stat(path)).size,
      path: relative(WORKSPACE_ROOT, resolve(path)),
      sha256: sha256(await readFile(path)),
    })),
  );

const runEvidence = async (browserVersion: string): Promise<string> =>
  `${JSON.stringify(
    {
      browser: {
        name: "chromium",
        version: browserVersion,
      },
      caseCount: visualReferenceCases.length,
      deterministic: visualManifest.deterministic,
      fonts: Object.keys(FONT_FILES).map((path) => basename(path)),
      schemaVersion: visualManifest.schemaVersion,
      sources: await sourceEvidence(),
      thresholds: {
        colorPerChannel: visualManifest.colorThresholdPerChannel,
        geometryPixels: visualManifest.geometryThresholdPixels,
        maxDiffPixelRatio: visualManifest.maxDiffPixelRatio,
        ssimMinimum: visualManifest.ssimMinimum,
      },
    },
    null,
    2,
  )}\n`;

const expectedCaptureIds = (): readonly string[] =>
  visualReferenceCases.map((visualCase) => visualCase.id).sort();

const evidenceNames = async (root: string): Promise<readonly string[]> =>
  (await readdir(root)).sort();

const staleEvidenceNames = async (
  root: string,
  expectedNames: ReadonlySet<string>,
): Promise<readonly string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && !expectedNames.has(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const removeStaleEvidence = async (
  root: string,
  expectedNames: ReadonlySet<string>,
): Promise<void> => {
  for (const name of await staleEvidenceNames(root, expectedNames)) {
    await unlink(join(root, name));
  }
};

export interface ImageComparison {
  readonly diffPixelRatio: number;
  readonly maximumChannelDelta: number;
  readonly ssim: number;
}

export interface ReferenceComparisonReport {
  readonly caseCount: number;
  readonly hashDifferentCaseIds: readonly string[];
  readonly maximumChannelDelta: number;
  readonly maximumChannelDeltaCase: string | null;
  readonly maximumDiffPixelRatio: number;
  readonly maximumDiffPixelRatioCase: string | null;
  readonly maximumLandmarkGeometryDelta: number;
  readonly maximumLandmarkGeometryDeltaCase: string | null;
  readonly maximumSemanticColorChannelDelta: number;
  readonly maximumSemanticColorChannelDeltaCase: string | null;
  readonly minimumSsim: number;
  readonly minimumSsimCase: string | null;
}

export const compareImages = (expected: Buffer, actual: Buffer): ImageComparison | string => {
  const first = PNG.sync.read(expected);
  const second = PNG.sync.read(actual);
  if (first.width !== second.width || first.height !== second.height) {
    return `image dimensions differ (${String(first.width)}x${String(first.height)} != ${String(
      second.width,
    )}x${String(second.height)})`;
  }

  let diffPixels = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < first.data.length; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const firstValue = first.data[offset + channel];
      const secondValue = second.data[offset + channel];
      if (firstValue === undefined || secondValue === undefined) {
        return "decoded RGBA buffer length is invalid";
      }
      const delta = Math.abs(firstValue - secondValue);
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
      if (delta > visualManifest.colorThresholdPerChannel) pixelDiffers = true;
    }
    if (pixelDiffers) diffPixels += 1;
  }

  const similarity = ssim(
    {
      data: Uint8ClampedArray.from(first.data),
      height: first.height,
      width: first.width,
    },
    {
      data: Uint8ClampedArray.from(second.data),
      height: second.height,
      width: second.width,
    },
  ).mssim;
  return {
    diffPixelRatio: diffPixels / (first.width * first.height),
    maximumChannelDelta,
    ssim: similarity,
  };
};

const numericDifference = (first: number, second: number): number => Math.abs(first - second);

const maximumLandmarkGeometryDelta = (
  expected: ReferenceMetadata,
  actual: ReferenceMetadata,
): number => {
  let maximum = 0;
  for (const [index, first] of expected.landmarks.entries()) {
    const second = actual.landmarks[index];
    if (
      second === undefined ||
      first.name !== second.name ||
      first.boundingBox === null ||
      second.boundingBox === null
    ) {
      if (first.boundingBox !== second?.boundingBox) return Number.POSITIVE_INFINITY;
      continue;
    }
    for (const key of ["height", "width", "x", "y"] as const) {
      maximum = Math.max(
        maximum,
        numericDifference(first.boundingBox[key], second.boundingBox[key]),
      );
    }
  }
  return maximum;
};

const SEMANTIC_COLOR_STYLE_PROPERTIES = [
  "background-color",
  "border-bottom-color",
  "border-left-color",
  "border-right-color",
  "border-top-color",
  "color",
] as const;

const maximumSemanticColorChannelDelta = (
  expected: ReferenceMetadata,
  actual: ReferenceMetadata,
): number => {
  for (const [index, first] of expected.landmarks.entries()) {
    const second = actual.landmarks[index];
    if (second === undefined || first.name !== second.name) return Number.POSITIVE_INFINITY;
    for (const property of SEMANTIC_COLOR_STYLE_PROPERTIES) {
      const firstValue = first.style?.[property] ?? null;
      const secondValue = second.style?.[property] ?? null;
      if (firstValue !== secondValue) {
        // Computed color serialization is canonical within one Chromium build. Treat any
        // semantic token mismatch conservatively; identical strings prove a channel delta of 0.
        return Number.POSITIVE_INFINITY;
      }
    }
  }
  return 0;
};

const compareMetadata = (
  id: string,
  expected: ReferenceMetadata,
  actual: ReferenceMetadata,
): readonly string[] => {
  const errors: string[] = [];
  const {
    document: expectedDocument,
    landmarks: expectedLandmarks,
    screenshot: expectedScreenshot,
    ...expectedStable
  } = expected;
  const {
    document: actualDocument,
    landmarks: actualLandmarks,
    screenshot: actualScreenshot,
    ...actualStable
  } = actual;

  for (const key of Object.keys(expectedStable) as (keyof typeof expectedStable)[]) {
    const first = JSON.stringify(expectedStable[key]);
    const second = JSON.stringify(actualStable[key]);
    if (first !== second) {
      errors.push(
        `${id}: non-geometric metadata field ${String(key)} differs (${first} != ${second})`,
      );
    }
  }
  if (expectedScreenshot.path !== actualScreenshot.path) {
    errors.push(
      `${id}: screenshot path differs (${expectedScreenshot.path} != ${actualScreenshot.path})`,
    );
  }

  for (const key of ["height", "scrollX", "scrollY", "width"] as const) {
    const delta = numericDifference(expectedDocument[key], actualDocument[key]);
    if (delta > visualManifest.geometryThresholdPixels) {
      errors.push(
        `${id}: document ${key} differs by ${String(delta)}px (${String(
          expectedDocument[key],
        )} != ${String(actualDocument[key])})`,
      );
    }
  }

  if (expectedLandmarks.length !== actualLandmarks.length) {
    errors.push(
      `${id}: landmark list length differs (${String(expectedLandmarks.length)} != ${String(
        actualLandmarks.length,
      )})`,
    );
    return errors;
  }
  for (const [index, first] of expectedLandmarks.entries()) {
    const second = actualLandmarks[index];
    if (second === undefined) continue;
    if (first.name !== second.name || first.count !== second.count || first.text !== second.text) {
      errors.push(
        `${id}: landmark ${first.name} identity/count/text differs (${JSON.stringify({
          count: first.count,
          name: first.name,
          text: first.text,
        })} != ${JSON.stringify({
          count: second.count,
          name: second.name,
          text: second.text,
        })})`,
      );
    }
    if (JSON.stringify(first.style) !== JSON.stringify(second.style)) {
      errors.push(`${id}: landmark ${first.name} computed style differs`);
    }
    if (first.boundingBox === null || second.boundingBox === null) {
      if (first.boundingBox !== second.boundingBox) {
        errors.push(`${id}: landmark ${first.name} presence differs`);
      }
      continue;
    }
    for (const key of ["height", "width", "x", "y"] as const) {
      const delta = numericDifference(first.boundingBox[key], second.boundingBox[key]);
      if (delta > visualManifest.geometryThresholdPixels) {
        errors.push(
          `${id}: landmark ${first.name} ${key} differs by ${String(delta)}px (${String(
            first.boundingBox[key],
          )} != ${String(second.boundingBox[key])})`,
        );
      }
    }
  }
  return errors;
};

const compareCapturedReferences = (
  id: string,
  expected: CapturedReference,
  actual: CapturedReference,
): readonly string[] => {
  const errors = [...compareMetadata(id, expected.metadata, actual.metadata)];
  if (expected.screenshot.equals(actual.screenshot)) return errors;
  const comparison = compareImages(expected.screenshot, actual.screenshot);
  if (typeof comparison === "string") {
    errors.push(`${id}: ${comparison}`);
    return errors;
  }
  if (comparison.diffPixelRatio > visualManifest.maxDiffPixelRatio) {
    errors.push(
      `${id}: diff pixel ratio ${comparison.diffPixelRatio.toFixed(6)} exceeds ${visualManifest.maxDiffPixelRatio.toFixed(
        6,
      )} (per-channel tolerance ${String(
        visualManifest.colorThresholdPerChannel,
      )}, max observed delta ${String(comparison.maximumChannelDelta)})`,
    );
  }
  if (comparison.ssim < visualManifest.ssimMinimum) {
    errors.push(
      `${id}: SSIM ${comparison.ssim.toFixed(6)} is below ${visualManifest.ssimMinimum.toFixed(6)}`,
    );
  }
  return errors;
};

export function summarizeReferenceRuns(
  expected: ReferenceRunResult,
  actual: ReferenceRunResult,
): ReferenceComparisonReport {
  const commonIds = [...expected.captures.keys()].filter((id) => actual.captures.has(id)).sort();
  const hashDifferentCaseIds: string[] = [];
  let maximumChannelDelta = 0;
  let maximumChannelDeltaCase: string | null = null;
  let maximumDiffPixelRatio = 0;
  let maximumDiffPixelRatioCase: string | null = null;
  let maximumLandmarkGeometry = 0;
  let maximumLandmarkGeometryDeltaCase: string | null = null;
  let maximumSemanticColorDelta = 0;
  let maximumSemanticColorChannelDeltaCase: string | null = null;
  let minimumSsim = 1;
  let minimumSsimCase: string | null = null;

  for (const id of commonIds) {
    const first = expected.captures.get(id);
    const second = actual.captures.get(id);
    if (first === undefined || second === undefined) continue;
    const geometry = maximumLandmarkGeometryDelta(first.metadata, second.metadata);
    if (geometry > maximumLandmarkGeometry) {
      maximumLandmarkGeometry = geometry;
      maximumLandmarkGeometryDeltaCase = id;
    }
    const semanticColor = maximumSemanticColorChannelDelta(first.metadata, second.metadata);
    if (semanticColor > maximumSemanticColorDelta) {
      maximumSemanticColorDelta = semanticColor;
      maximumSemanticColorChannelDeltaCase = id;
    }
    if (first.screenshot.equals(second.screenshot)) continue;
    hashDifferentCaseIds.push(id);
    const image = compareImages(first.screenshot, second.screenshot);
    if (typeof image === "string") {
      maximumDiffPixelRatio = Number.POSITIVE_INFINITY;
      maximumDiffPixelRatioCase = id;
      minimumSsim = Number.NEGATIVE_INFINITY;
      minimumSsimCase = id;
      continue;
    }
    if (image.maximumChannelDelta > maximumChannelDelta) {
      maximumChannelDelta = image.maximumChannelDelta;
      maximumChannelDeltaCase = id;
    }
    if (image.diffPixelRatio > maximumDiffPixelRatio) {
      maximumDiffPixelRatio = image.diffPixelRatio;
      maximumDiffPixelRatioCase = id;
    }
    if (image.ssim < minimumSsim) {
      minimumSsim = image.ssim;
      minimumSsimCase = id;
    }
  }

  return {
    caseCount: commonIds.length,
    hashDifferentCaseIds,
    maximumChannelDelta,
    maximumChannelDeltaCase,
    maximumDiffPixelRatio,
    maximumDiffPixelRatioCase,
    maximumLandmarkGeometryDelta: maximumLandmarkGeometry,
    maximumLandmarkGeometryDeltaCase,
    maximumSemanticColorChannelDelta: maximumSemanticColorDelta,
    maximumSemanticColorChannelDeltaCase,
    minimumSsim,
    minimumSsimCase,
  };
}

export function compareReferenceRuns(
  expected: ReferenceRunResult,
  actual: ReferenceRunResult,
): readonly string[] {
  const errors: string[] = [...expected.errors, ...actual.errors];
  const expectedIds = [...expected.captures.keys()].sort();
  const actualIds = [...actual.captures.keys()].sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    errors.push(
      `Capture id sets differ: expected ${JSON.stringify(expectedIds)}, actual ${JSON.stringify(actualIds)}`,
    );
  }
  for (const id of expectedIds) {
    const first = expected.captures.get(id);
    const second = actual.captures.get(id);
    if (first === undefined || second === undefined) continue;
    errors.push(...compareCapturedReferences(id, first, second));
  }
  return errors;
}

export async function writeReferenceSet(result: ReferenceRunResult): Promise<void> {
  if (result.errors.length > 0) {
    throw new Error(`Cannot write failed reference run:\n${result.errors.join("\n")}`);
  }
  const expectedIds = expectedCaptureIds();
  const capturedIds = [...result.captures.keys()].sort();
  if (JSON.stringify(capturedIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      `Cannot write partial or stale reference run: expected ${String(
        expectedIds.length,
      )} manifest cases, received ${String(capturedIds.length)}`,
    );
  }
  await mkdir(SCREENSHOT_ROOT, { recursive: true });
  await mkdir(METADATA_ROOT, { recursive: true });
  for (const [id, capture] of result.captures) {
    await writeFile(join(SCREENSHOT_ROOT, `${id}.png`), capture.screenshot);
    await writeFile(join(METADATA_ROOT, `${id}.json`), stableMetadata(capture.metadata));
  }
  await removeStaleEvidence(SCREENSHOT_ROOT, new Set(expectedIds.map((id) => `${id}.png`)));
  await removeStaleEvidence(METADATA_ROOT, new Set(expectedIds.map((id) => `${id}.json`)));
  await writeFile(RESOLVED_MANIFEST_PATH, await resolvedManifestEvidence());
  const browserVersion = result.captures.values().next().value?.metadata.browser.version;
  if (browserVersion === undefined) {
    throw new Error("Cannot write a reference run without browser evidence");
  }
  await writeFile(RUN_EVIDENCE_PATH, await runEvidence(browserVersion));
}

const verifyEvidenceChain = async (result: ReferenceRunResult): Promise<readonly string[]> => {
  const errors: string[] = [];
  const browserVersion = result.captures.values().next().value?.metadata.browser.version;
  if (browserVersion === undefined) {
    errors.push("Cannot validate committed evidence chain without a captured browser version");
    return errors;
  }

  try {
    const [committedManifest, expectedManifest] = await Promise.all([
      readFile(RESOLVED_MANIFEST_PATH, "utf8"),
      resolvedManifestEvidence(),
    ]);
    if (committedManifest !== expectedManifest) {
      errors.push("manifest.resolved.json does not exactly match the current visual manifest");
    }
  } catch (error) {
    errors.push(
      `cannot validate ${RESOLVED_MANIFEST_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const [committedRun, expectedRun] = await Promise.all([
      readFile(RUN_EVIDENCE_PATH, "utf8"),
      runEvidence(browserVersion),
    ]);
    if (committedRun !== expectedRun) {
      errors.push(
        "run.json does not match the current browser, manifest, deterministic policy, sources, fonts, and thresholds",
      );
    }
  } catch (error) {
    errors.push(
      `cannot validate ${RUN_EVIDENCE_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const expectedIds = expectedCaptureIds();
  const expectedScreenshotNames = expectedIds.map((id) => `${id}.png`);
  const expectedMetadataNames = expectedIds.map((id) => `${id}.json`);
  try {
    const actualScreenshotNames = await evidenceNames(SCREENSHOT_ROOT);
    if (JSON.stringify(actualScreenshotNames) !== JSON.stringify(expectedScreenshotNames)) {
      errors.push(
        `screenshot evidence set has missing or stale extras: expected ${String(
          expectedScreenshotNames.length,
        )}, found ${String(actualScreenshotNames.length)}`,
      );
    }
  } catch (error) {
    errors.push(
      `cannot enumerate ${SCREENSHOT_ROOT}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    const actualMetadataNames = await evidenceNames(METADATA_ROOT);
    if (JSON.stringify(actualMetadataNames) !== JSON.stringify(expectedMetadataNames)) {
      errors.push(
        `metadata evidence set has missing or stale extras: expected ${String(
          expectedMetadataNames.length,
        )}, found ${String(actualMetadataNames.length)}`,
      );
    }
  } catch (error) {
    errors.push(
      `cannot enumerate ${METADATA_ROOT}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return errors;
};

export async function verifyCommittedReferenceSet(
  result: ReferenceRunResult,
): Promise<readonly string[]> {
  const errors: string[] = [...result.errors, ...(await verifyEvidenceChain(result))];
  for (const [id, capture] of result.captures) {
    const screenshotPath = join(SCREENSHOT_ROOT, `${id}.png`);
    const metadataPath = join(METADATA_ROOT, `${id}.json`);
    try {
      const expectedScreenshot = await readFile(screenshotPath);
      const expectedMetadata = JSON.parse(
        await readFile(metadataPath, "utf8"),
      ) as ReferenceMetadata;
      errors.push(
        ...compareCapturedReferences(
          id,
          { metadata: expectedMetadata, screenshot: expectedScreenshot },
          capture,
        ),
      );
    } catch (error) {
      errors.push(
        `${id}: cannot load committed reference ${screenshotPath} / ${metadataPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return errors;
}

export const referencePaths = {
  metadataRoot: METADATA_ROOT,
  referenceRoot: REFERENCE_ROOT,
  screenshotRoot: SCREENSHOT_ROOT,
} as const;
