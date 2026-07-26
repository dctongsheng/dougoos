import { expect, test, type Page } from "@playwright/test";

import { startLandingProductionServer } from "../visual/production-harness.js";

interface LandingBrowserEffects {
  readonly anchors: string[];
  readonly beacons: string[];
  readonly cache: string[];
  readonly cookies: string[];
  readonly eventSources: string[];
  readonly fetches: string[];
  readonly forms: string[];
  readonly history: string[];
  readonly indexedDb: string[];
  readonly opens: string[];
  readonly storage: string[];
  readonly websockets: string[];
  readonly xhrs: string[];
}

const EMPTY_EFFECTS: LandingBrowserEffects = {
  anchors: [],
  beacons: [],
  cache: [],
  cookies: [],
  eventSources: [],
  fetches: [],
  forms: [],
  history: [],
  indexedDb: [],
  opens: [],
  storage: [],
  websockets: [],
  xhrs: [],
};

const EFFECT_INSTRUMENTATION = `
(() => {
  const effects = {
    anchors: [],
    beacons: [],
    cache: [],
    cookies: [],
    eventSources: [],
    fetches: [],
    forms: [],
    history: [],
    indexedDb: [],
    opens: [],
    storage: [],
    websockets: [],
    xhrs: [],
  };
  globalThis.__dougoosLandingEffects = effects;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (...args) => {
    effects.fetches.push(String(args[0]));
    return nativeFetch(...args);
  };

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    effects.xhrs.push(String(method) + " " + String(url));
    return nativeXhrOpen.call(this, method, url, ...args);
  };

  const NativeEventSource = globalThis.EventSource;
  if (NativeEventSource) {
    globalThis.EventSource = class extends NativeEventSource {
      constructor(url, options) {
        effects.eventSources.push(String(url));
        super(url, options);
      }
    };
  }

  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      effects.websockets.push(String(url));
      super(url, protocols);
    }
  };

  const nativeBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, data) => {
    effects.beacons.push(String(url));
    return nativeBeacon(url, data);
  };

  const nativeOpen = globalThis.open.bind(globalThis);
  globalThis.open = (...args) => {
    effects.opens.push(String(args[0]));
    return nativeOpen(...args);
  };

  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    effects.anchors.push(this.href + "|" + (this.download || ""));
    return nativeAnchorClick.call(this);
  };

  const nativePushState = history.pushState.bind(history);
  history.pushState = (state, unused, url) => {
    effects.history.push("push:" + String(url));
    return nativePushState(state, unused, url);
  };
  const nativeReplaceState = history.replaceState.bind(history);
  history.replaceState = (state, unused, url) => {
    effects.history.push("replace:" + String(url));
    return nativeReplaceState(state, unused, url);
  };

  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;
  const nativeClear = Storage.prototype.clear;
  Storage.prototype.setItem = function(key, value) {
    effects.storage.push("set:" + String(key));
    return nativeSetItem.call(this, key, value);
  };
  Storage.prototype.removeItem = function(key) {
    effects.storage.push("remove:" + String(key));
    return nativeRemoveItem.call(this, key);
  };
  Storage.prototype.clear = function() {
    effects.storage.push("clear");
    return nativeClear.call(this);
  };

  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (cookieDescriptor?.get && cookieDescriptor?.set) {
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get: cookieDescriptor.get,
      set(value) {
        effects.cookies.push(String(value).split("=", 1)[0] || "[unnamed]");
        return cookieDescriptor.set.call(this, value);
      },
    });
  }
  if (globalThis.cookieStore) {
    const nativeCookieStoreSet = globalThis.cookieStore.set.bind(globalThis.cookieStore);
    globalThis.cookieStore.set = (...args) => {
      const first = args[0];
      effects.cookies.push("store-set:" + String(typeof first === "string" ? first : first?.name));
      return nativeCookieStoreSet(...args);
    };
    const nativeCookieStoreDelete = globalThis.cookieStore.delete.bind(globalThis.cookieStore);
    globalThis.cookieStore.delete = (...args) => {
      const first = args[0];
      effects.cookies.push("store-delete:" + String(typeof first === "string" ? first : first?.name));
      return nativeCookieStoreDelete(...args);
    };
  }

  const nativeIdbOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name, version) {
    effects.indexedDb.push("open:" + String(name));
    return version === undefined
      ? nativeIdbOpen.call(this, name)
      : nativeIdbOpen.call(this, name, version);
  };
  const nativeIdbDelete = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase = function(name) {
    effects.indexedDb.push("delete:" + String(name));
    return nativeIdbDelete.call(this, name);
  };

  if (globalThis.caches) {
    const nativeCacheOpen = CacheStorage.prototype.open;
    CacheStorage.prototype.open = function(name) {
      effects.cache.push("open:" + String(name));
      return nativeCacheOpen.call(this, name);
    };
    const nativeCacheDelete = CacheStorage.prototype.delete;
    CacheStorage.prototype.delete = function(name) {
      effects.cache.push("delete:" + String(name));
      return nativeCacheDelete.call(this, name);
    };
  }

  globalThis.addEventListener("submit", (event) => {
    queueMicrotask(() => {
      if (!event.defaultPrevented) {
        effects.forms.push(event.target instanceof HTMLFormElement ? event.target.method : "unknown");
      }
    });
  });
})();
`;

let server: Awaited<ReturnType<typeof startLandingProductionServer>>;

test.beforeAll(async () => {
  server = await startLandingProductionServer();
});

test.afterAll(async () => {
  if (server !== undefined) await server.close();
});

const openLanding = async (page: Page, width = 1440, path = "/"): Promise<void> => {
  await page.addInitScript({ content: EFFECT_INSTRUMENTATION });
  await page.setViewportSize({ height: width <= 1024 ? 768 : 1000, width });
  await page.goto(new URL(path, server.origin).toString(), { waitUntil: "networkidle" });
  await page.locator("[data-production-ready=true]").waitFor();
  await page.evaluate(async () => document.fonts.ready);
};

const browserEffects = async (page: Page): Promise<LandingBrowserEffects> =>
  page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __dougoosLandingEffects: LandingBrowserEffects;
    };
    return runtime.__dougoosLandingEffects;
  });

const expectNoEffects = async (
  page: Page,
  dynamicRequests: readonly string[],
  downloads: readonly string[],
): Promise<void> => {
  await page.waitForTimeout(20);
  expect(await browserEffects(page)).toEqual(EMPTY_EFFECTS);
  expect(dynamicRequests).toEqual([]);
  expect(downloads).toEqual([]);
};

test("Landing renders every reference section and preserves its two-column 1024 layout", async ({
  page,
}) => {
  await openLanding(page, 1024);

  await expect(page.locator('[data-screen-label="落地页"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/多个 Agent CLI\s*一个控制台/u);
  await expect(page.getByText("AgentOS — workspace / local", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "四步开始体验" })).toBeVisible();
  await expect(page.locator(".early-access-install li")).toHaveCount(4);
  await expect(page.locator(".agent-chip")).toHaveCount(6);
  await expect(page.locator(".feature-card")).toHaveCount(6);
  await expect(page.locator(".route-row")).toHaveCount(3);
  await expect(page.locator(".memory-star")).toHaveCount(8);
  await expect(page.locator(".stats > div")).toHaveCount(4);
  await expect(page.locator(".agent-chip").filter({ hasText: "Claude Agent" })).toContainText(
    "0.2.0 暂不可用",
  );
  await expect(page.locator(".product-card").filter({ hasText: "Claude Agent" })).toContainText(
    "暂不可用",
  );
  await expect(page.locator(".route-card")).not.toContainText("Claude Agent");
  await expect(page.getByText("把所有终端窗口,收进一个 OS", { exact: true })).toBeVisible();

  const productAnimation = await page.locator(".product-window").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: style.animationDuration,
      iteration: style.animationIterationCount,
      name: style.animationName,
      timing: style.animationTimingFunction,
    };
  });
  expect(productAnimation).toEqual({
    duration: "7s",
    iteration: "infinite",
    name: "drift",
    timing: "ease-in-out",
  });
  const versionAnimation = await page.locator(".version-chip > span").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: style.animationDuration,
      iteration: style.animationIterationCount,
      name: style.animationName,
      timing: style.animationTimingFunction,
    };
  });
  expect(versionAnimation).toEqual({
    duration: "1.6s",
    iteration: "infinite",
    name: "pulse",
    timing: "ease",
  });
  const dotAnimations = await page.locator(".product-agent-dot").evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        duration: style.animationDuration,
        iteration: style.animationIterationCount,
        name: style.animationName,
        timing: style.animationTimingFunction,
      };
    }),
  );
  expect(dotAnimations).toHaveLength(6);
  expect(dotAnimations[0]).toMatchObject({
    duration: "1.4s",
    iteration: "infinite",
    name: "pulse",
  });
  expect(dotAnimations[1]).toMatchObject({ duration: "0s", iteration: "1", name: "none" });
  expect(dotAnimations[2]).toMatchObject({
    duration: "0.9s",
    iteration: "infinite",
    name: "pulse",
  });
  expect(dotAnimations[2]?.timing).toContain("steps(1");
  expect(dotAnimations[3]).toMatchObject({ duration: "0s", iteration: "1", name: "none" });
  expect(dotAnimations[4]).toMatchObject({
    duration: "1.4s",
    iteration: "infinite",
    name: "pulse",
  });
  expect(dotAnimations[5]).toMatchObject({ duration: "0s", iteration: "1", name: "none" });

  expect(
    await page
      .locator(".feature-grid")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns),
  ).not.toBe("none");
  expect(
    await page
      .locator(".routing-section")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns),
  ).toMatch(/\S+\s+\S+/u);
  expect(await page.locator("body").evaluate((element) => element.scrollWidth)).toBe(1024);
});

test("download and source CTAs expose only approved release destinations", async ({ page }) => {
  const dynamicRequests: string[] = [];
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (["eventsource", "fetch", "websocket", "xhr"].includes(request.resourceType())) {
      dynamicRequests.push(request.url());
    }
  });
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await openLanding(page);
  const originalUrl = page.url();

  for (const label of ["功能", "Agents", "Memory", "文档"]) {
    await page.locator(".landing-nav").getByRole("button", { exact: true, name: label }).click();
  }
  const downloadUrl = "https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg";
  const downloadLinks = page.locator(`a[href="${downloadUrl}"]`);
  await expect(downloadLinks).toHaveCount(3);
  await expect(page.getByRole("link", { exact: true, name: "免费下载" })).toHaveAttribute(
    "href",
    downloadUrl,
  );
  await expect(page.getByRole("link", { exact: true, name: "下载桌面版" })).toHaveAttribute(
    "href",
    downloadUrl,
  );
  await expect(page.getByRole("link", { exact: true, name: "下载 DougoOS" })).toHaveAttribute(
    "href",
    downloadUrl,
  );
  const sourceUrl = "https://github.com/dctongsheng/dougoos";
  const sourceReleaseUrl = `${sourceUrl}/tree/v0.2.0`;
  await expect(page.getByRole("link", { exact: true, name: "GitHub ↗" })).toHaveAttribute(
    "href",
    sourceUrl,
  );
  const footer = page.locator(".landing-footer");
  await expect(footer.getByRole("link", { exact: true, name: "源代码 v0.2.0" })).toHaveAttribute(
    "href",
    sourceReleaseUrl,
  );
  await expect(
    footer.getByRole("link", { exact: true, name: "许可证 AGPL-3.0-only" }),
  ).toHaveAttribute("href", `${sourceUrl}/blob/v0.2.0/LICENSE`);
  await expect(footer.getByRole("link", { exact: true, name: "第三方许可" })).toHaveAttribute(
    "href",
    "/legal/THIRD_PARTY_NOTICES.md",
  );
  await page.getByRole("button", { exact: true, name: "在线体验 →" }).click();
  await footer.getByRole("button", { exact: true, name: "dougoos.com" }).click();
  await footer.getByRole("button", { exact: true, name: "文档" }).click();
  await footer.getByRole("button", { exact: true, name: "更新日志" }).click();

  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(page.locator(".landing-root")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(page.locator(".landing-root")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { exact: true, name: "登录" }).first().click();
  await page.getByRole("button", { exact: true, name: "注册 dougoos.com" }).click();
  await page.getByRole("button", { name: "关闭登录" }).click();

  expect(page.url()).toBe(originalUrl);
  await expectNoEffects(page, dynamicRequests, downloads);
});

test("login overlay traps focus, returns focus, clears credentials, and stays effect-free", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const dynamicRequests: string[] = [];
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (["eventsource", "fetch", "websocket", "xhr"].includes(request.resourceType())) {
      dynamicRequests.push(request.url());
    }
  });
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await openLanding(page);
  const login = page.getByRole("button", { exact: true, name: "登录" }).first();

  await login.click();
  const dialog = page.getByRole("dialog", { name: "登录 AgentOS" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "关闭登录" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { exact: true, name: "注册 dougoos.com" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "关闭登录" })).toBeFocused();

  await dialog.getByText(/会话记录保存在本机/u).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(login).toBeFocused();

  await login.click();
  await page.locator(".login-overlay").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
  await expect(login).toBeFocused();

  await login.click();
  await page.getByLabel("邮箱").fill("demo@example.test");
  await page.getByLabel("密码").fill("never-persist-this");
  await dialog.getByRole("button", { exact: true, name: "登录" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("演示用户 Ryo")).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await expectNoEffects(page, dynamicRequests, downloads);

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-production-ready=true]").waitFor();
  await page.getByRole("button", { exact: true, name: "登录" }).first().click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { exact: true, name: "GitHub" }).click();
  await expect(page.getByLabel("演示用户 Ryo")).toBeVisible();
  await expectNoEffects(page, dynamicRequests, downloads);

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-production-ready=true]").waitFor();
  await page.getByRole("button", { exact: true, name: "登录" }).first().click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Google" }).click();
  await expect(page.getByLabel("演示用户 Ryo")).toBeVisible();
  await expectNoEffects(page, dynamicRequests, downloads);
});

test("release URL cannot inject prototype scenarios, arbitrary accents, or embedded runtimes", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openLanding(
    page,
    1440,
    "/?scenario=landing-login-open&visualCase=landing-logged-in&accent=url(https%3A%2F%2Fexample.invalid%2Faccent.png)",
  );

  await expect(page.locator(".landing-root")).toHaveAttribute("data-accent", "green");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("html[data-visual-case]")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator("[data-prototype-payload]")).toHaveCount(0);
  expect(requests.some((url) => new URL(url).hostname === "example.invalid")).toBe(false);
  expect(
    await page
      .locator("script")
      .evaluateAll((scripts) =>
        scripts.map((script) => script.getAttribute("src") ?? script.textContent ?? ""),
      ),
  ).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/support\.js|prototypes\/agentos|visualCase|dangerouslySetInnerHTML/u),
    ]),
  );
});
