import { expect, test, type Page } from "@playwright/test";

import { startProductionServer } from "../visual/production-harness.js";

interface BrowserEffects {
  readonly anchors: readonly string[];
  readonly beacons: readonly string[];
  readonly eventSources: readonly string[];
  readonly fetches: readonly string[];
  readonly opens: readonly string[];
  readonly storage: readonly string[];
  readonly websockets: readonly string[];
  readonly xhrs: readonly string[];
}

const EFFECT_INSTRUMENTATION = `
(() => {
  const effects = {
    anchors: [],
    beacons: [],
    eventSources: [],
    fetches: [],
    opens: [],
    storage: [],
    websockets: [],
    xhrs: [],
  };
  globalThis.__dougoosEffects = effects;

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
})();
`;

let server: Awaited<ReturnType<typeof startProductionServer>>;

test.beforeAll(async () => {
  server = await startProductionServer();
});

test.afterAll(async () => {
  await server.close();
});

const openApp = async (page: Page, width = 1440, path = "/") => {
  await page.addInitScript({ content: EFFECT_INSTRUMENTATION });
  await page.setViewportSize({ height: width <= 1024 ? 800 : 900, width });
  await page.goto(new URL(path, server.origin).toString(), { waitUntil: "networkidle" });
  await page.locator("[data-production-ready=true]").waitFor();
};

const agentNav = (page: Page, name: string) =>
  page.locator(".agent-nav-primary").filter({ hasText: name }).first();

const sidebarNav = (page: Page, name: string) =>
  page.locator(".sidebar").getByRole("button", { exact: true, name }).first();

const effects = async (page: Page): Promise<BrowserEffects> =>
  page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __dougoosEffects: BrowserEffects;
    };
    return runtime.__dougoosEffects;
  });

test("Home keyboard contract preserves newline and IME, then Ctrl/Cmd+Enter sends", async ({
  page,
}) => {
  await openApp(page);
  const composer = page.getByLabel("任务内容");

  await composer.fill("第一行");
  await composer.press("Enter");
  await expect(composer).toHaveValue("第一行\n");
  await expect(page.locator('[data-screen-label="新建任务"]')).toBeVisible();

  await composer.dispatchEvent("compositionstart");
  await composer.press("Control+Enter");
  await expect(page.locator('[data-screen-label="新建任务"]')).toBeVisible();
  await composer.dispatchEvent("compositionend");

  await composer.fill("迁移 users 数据库 schema");
  await composer.press("Control+Enter");
  await expect(page.locator('[data-screen-label="Agent 会话"]')).toBeVisible();
  await expect(page.locator(".agent-header")).toContainText("Claude Code");
});

test("Agent composer sends on Enter, preserves Shift+Enter, and ignores composing Enter", async ({
  page,
}) => {
  await openApp(page);
  await agentNav(page, "Pi").click();
  const composer = page.getByLabel("向 Pi 派发任务");

  await composer.fill("第一行");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("第一行\n");
  await expect(page.locator(".user-message")).toHaveCount(0);

  await composer.dispatchEvent("compositionstart");
  await composer.press("Enter");
  await expect(page.locator(".user-message")).toHaveCount(0);
  await composer.dispatchEvent("compositionend");

  await composer.fill("解释 workspace protocol");
  await composer.press("Enter");
  await expect(page.locator(".user-message")).toHaveText("解释 workspace protocol");
  await expect(composer).toHaveValue("");
  await page.waitForTimeout(600);
  await expect(page.locator(".think-message")).toHaveCount(0);
});

test("approval is single-use and notification click marks read while navigating", async ({
  page,
}) => {
  await openApp(page);
  const notification = page.locator(".notification-button");
  await expect(notification).toContainText("2");
  await notification.click();
  await page.getByText("Claude Code 等待确认", { exact: true }).click();
  await expect(page.locator('[data-screen-label="Agent 会话"]')).toBeVisible();
  await expect(notification).toContainText("1");

  const command = "npx prisma migrate deploy";
  await expect(page.locator(".approval-message > code")).toHaveText(`$ ${command}`);
  await page.getByRole("button", { exact: true, name: "批准执行" }).click();
  await expect(page.getByText("✓ 已批准,执行中", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "批准执行" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "拒绝" })).toHaveCount(0);
  const approvedTool = page.locator("details.tool-message").filter({
    has: page.locator(".tool-message-preview", { hasText: command }),
  });
  await expect(approvedTool.locator(".tool-message-preview")).toBeVisible();
  const toolInput = approvedTool.locator('[data-tool-detail="input"]');
  await expect(toolInput).toBeHidden();
  await approvedTool.locator("summary").click();
  await expect(toolInput).toBeVisible();
});

test("constrained sidebar remains reachable and Settings visibility changes the live shell", async ({
  page,
}) => {
  await openApp(page, 1024);
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.getByLabel("切换侧栏").click();
  await expect(page.locator(".app-shell")).not.toHaveClass(/sidebar-collapsed/);

  const settings = page.getByLabel("设置");
  await settings.scrollIntoViewIfNeeded();
  await settings.click();
  const memoryVisibility = page.locator(".visibility-grid button").filter({ hasText: "Memory" });
  await memoryVisibility.click();
  const memoryNav = page.locator(".sidebar .nav-button").filter({ hasText: "Memory" });
  await expect(memoryNav).toHaveCount(0);
  await sidebarNav(page, "新建任务").click();
  await page.getByLabel("设置").click();
  await expect(memoryVisibility).toHaveAttribute("aria-pressed", "false");
  await expect(memoryNav).toHaveCount(0);
  await memoryVisibility.click();
  await expect(memoryNav).toHaveCount(1);
});

test("responsive collapse recovers when resizing from 1024 to desktop width", async ({ page }) => {
  await openApp(page, 1024);
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.setViewportSize({ height: 800, width: 1280 });
  await expect(page.locator(".app-shell")).not.toHaveClass(/sidebar-collapsed/);
  await expect(sidebarNav(page, "新建任务")).toBeVisible();
});

test("Agent, Settings, Queue, and Sessions state survives routes without stale async work", async ({
  page,
}) => {
  await openApp(page);

  await agentNav(page, "Pi").click();
  const composer = page.getByLabel("向 Pi 派发任务");
  await composer.fill("跨路由保留这条消息");
  await composer.press("Enter");
  await sidebarNav(page, "新建任务").click();
  await agentNav(page, "Pi").click();
  await expect(page.getByText("跨路由保留这条消息", { exact: true })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "⚙ 配置" }).click();
  const agentConfigTabs = page.locator(".agent-config-tabs");
  await agentConfigTabs.getByRole("button", { exact: true, name: /Codex CLI/u }).click();
  const alternateModel = page.getByRole("button", { exact: true, name: "o4" });
  await alternateModel.click();
  await sidebarNav(page, "新建任务").click();
  await page.getByLabel("设置").click();
  await expect(
    agentConfigTabs.getByRole("button", { exact: true, name: /Codex CLI/u }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(alternateModel).toHaveAttribute("aria-pressed", "true");

  await sidebarNav(page, "长程任务").click();
  const firstQueue = page.locator(".queue-card").first();
  await firstQueue.getByTitle("Claude Code").click();
  await firstQueue.getByRole("button", { exact: true, name: "派发 →" }).click();
  await expect(firstQueue).toContainText("执行中");
  await sidebarNav(page, "新建任务").click();
  await sidebarNav(page, "长程任务").click();
  await expect(page.locator(".queue-card").first()).toContainText("排队");

  await sidebarNav(page, "Export").scrollIntoViewIfNeeded();
  await sidebarNav(page, "Export").click();
  await page.getByRole("button", { exact: true, name: "生成导出" }).click();
  await expect(page.getByRole("button", { exact: true, name: "生成中…" })).toBeVisible();
  await sidebarNav(page, "新建任务").click();
  await sidebarNav(page, "Export").click();
  await expect(page.getByRole("button", { exact: true, name: "生成导出" })).toBeVisible();

  await sidebarNav(page, "Cloud Sync").click();
  await page.getByRole("button", { exact: true, name: "立即同步" }).click();
  await expect(page.getByRole("button", { exact: true, name: "同步中…" })).toBeVisible();
  await sidebarNav(page, "新建任务").click();
  await sidebarNav(page, "Cloud Sync").click();
  await expect(page.getByRole("button", { exact: true, name: "立即同步" })).toBeVisible();
});

test("queue, export, sync, workflow, skill, and Settings controls stay local-only", async ({
  page,
}) => {
  const requests: string[] = [];
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "fetch" || request.resourceType() === "xhr") {
      requests.push(request.url());
    }
  });
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await openApp(page);

  await sidebarNav(page, "长程任务").click();
  const firstQueue = page.locator(".queue-card").first();
  await firstQueue.getByTitle("Claude Code").click();
  await firstQueue.getByRole("button", { exact: true, name: "派发 →" }).click();
  await expect(firstQueue).toContainText("Claude Code 执行中");
  await expect(firstQueue).toContainText("✓ 已完成", { timeout: 6_000 });

  await sidebarNav(page, "Export").scrollIntoViewIfNeeded();
  await sidebarNav(page, "Export").click();
  await page.getByRole("button", { exact: true, name: "生成导出" }).click();
  await expect(page.getByText(/✓ 已生成 Agent Rules/u)).toBeVisible({ timeout: 3_000 });

  await sidebarNav(page, "Cloud Sync").click();
  await page.getByRole("button", { exact: true, name: "立即同步" }).click();
  await expect(page.getByText("上次同步 刚刚", { exact: true })).toBeVisible({ timeout: 3_000 });

  await agentNav(page, "Hermes").click();
  await page.getByText("技能", { exact: true }).click();
  await page.getByRole("button", { exact: true, name: "▸ 运行" }).first().click();
  await expect(page.getByText("运行技能:行业调研", { exact: true })).toBeVisible();

  const browserEffects = await effects(page);
  expect(requests).toEqual([]);
  expect(downloads).toEqual([]);
  expect(browserEffects).toEqual({
    anchors: [],
    beacons: [],
    eventSources: [],
    fetches: [],
    opens: [],
    storage: [],
    websockets: [],
    xhrs: [],
  });
});

test("production bundle has no prototype bridge or unsafe embedded runtime", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(
    await page
      .locator("script")
      .evaluateAll((scripts) =>
        scripts.map((script) => script.getAttribute("src") ?? script.textContent ?? ""),
      ),
  ).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        /support\.js|prototypes\/agentos|saas-generated|dangerouslySetInnerHTML/u,
      ),
    ]),
  );
  expect(await page.locator("[data-prototype-payload]").count()).toBe(0);
});

test("release URL cannot inject a runtime scenario or arbitrary CSS accent", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openApp(
    page,
    1440,
    "/?scenario=saas-production-core-starting&visualCase=saas-production-migration-error&accent=url(https%3A%2F%2Fexample.invalid%2Faccent.png)",
  );

  await expect(page.locator('[data-screen-label="新建任务"]')).toBeVisible();
  await expect(page.locator("html[data-visual-case]")).toHaveCount(0);
  await expect(page.locator('[data-runtime-state="normal"]')).toBeVisible();
  expect(requests.some((url) => new URL(url).hostname === "example.invalid")).toBe(false);
  expect(
    await page.locator(".app-shell").evaluate((element) => element.getAttribute("style")),
  ).toContain("#3ddc84");
});
