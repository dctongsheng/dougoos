import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  allProductionOnlyCases,
  allProductionReferenceCases,
  captureProductionSet,
  hasExactOrigin,
  landingProductionOnlyCases,
  landingProductionReferenceCases,
  saasProductionOnlyCases,
  saasProductionReferenceCases,
  productionPaths,
  startVisualTestServer,
} from "./production-harness.js";

const readCanonicalRun = async (): Promise<Buffer | null> => {
  try {
    return await readFile(productionPaths.runPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
};

test("Landing production references pass their dedicated 15 plus 1 evidence gate", async ({
  browser,
  browserName,
}) => {
  test.setTimeout(3 * 60_000);
  expect(browserName).toBe("chromium");
  expect(landingProductionReferenceCases).toHaveLength(15);
  expect(landingProductionOnlyCases).toHaveLength(1);

  const canonicalRunBefore = await readCanonicalRun();
  const result = await captureProductionSet(browser, {
    cases: landingProductionReferenceCases,
    productionCases: landingProductionOnlyCases,
    write: false,
  });
  const canonicalRunAfter = await readCanonicalRun();
  expect(result.captures.size).toBe(16);
  expect(result.errors, result.errors.join("\n")).toEqual([]);
  expect(canonicalRunAfter).toEqual(canonicalRunBefore);
});

test("partial production evidence writes are rejected without touching the canonical run", async ({
  browser,
}) => {
  const canonicalRunBefore = await readCanonicalRun();
  await expect(
    captureProductionSet(browser, {
      cases: landingProductionReferenceCases,
      productionCases: landingProductionOnlyCases,
      write: true,
    }),
  ).rejects.toThrow(/complete canonical/u);
  const canonicalRunAfter = await readCanonicalRun();
  expect(canonicalRunAfter).toEqual(canonicalRunBefore);
});

test("origin matching rejects similar host-port prefixes", () => {
  expect(hasExactOrigin("http://127.0.0.1:1234/path", "http://127.0.0.1:123")).toBe(false);
  expect(hasExactOrigin("http://127.0.0.1:123/path", "http://127.0.0.1:123")).toBe(true);
});

test("SaaS and Landing production scenarios emit complete actual/diff/metadata evidence and pass gates", async ({
  browser,
  browserName,
}) => {
  test.setTimeout(20 * 60_000);
  expect(browserName).toBe("chromium");
  expect(saasProductionReferenceCases).toHaveLength(138);
  expect(saasProductionOnlyCases).toHaveLength(16);
  expect(landingProductionReferenceCases).toHaveLength(15);
  expect(landingProductionOnlyCases).toHaveLength(1);
  expect(allProductionReferenceCases).toHaveLength(153);
  expect(allProductionOnlyCases).toHaveLength(17);

  const result = await captureProductionSet(browser);
  expect(result.errors, result.errors.slice(0, 80).join("\n")).toEqual([]);
  expect(result.captures.size).toBe(
    allProductionReferenceCases.length + allProductionOnlyCases.length,
  );
});

test("subscribed snapshots atomically rerender and old sources cannot publish after replacement", async ({
  page,
}) => {
  const server = await startVisualTestServer();
  try {
    await page.goto(`${server.origin}/?sourceSwap=1`, { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { exact: true, name: "SOURCE_A" })).toBeVisible();

    await page.locator("[data-source-emit-current=true]").click();
    await expect(page.getByRole("button", { exact: true, name: "SOURCE_A_R2" })).toBeVisible();

    const sourceAAgentName = await page
      .locator(".picker-button")
      .first()
      .locator("strong")
      .textContent();
    expect(sourceAAgentName).not.toBeNull();
    await page
      .locator(".agent-nav-primary")
      .filter({ hasText: sourceAAgentName ?? "" })
      .click();
    await expect(page.locator(".message-list")).toContainText("SOURCE_A_R2_MESSAGE");

    await page.locator('[data-nav-label="长程任务"]').click();
    await expect(page.locator(".queue-card").first()).toContainText("完成");

    await page.getByLabel("设置").click();
    await expect(page.locator(".agent-config-tabs button")).toHaveCount(1);
    await expect(page.locator(".permission-profile-field select")).toHaveValue("agent-full-access");

    await page.locator('[data-nav-label="新建任务"]').click();
    await page.locator("[data-source-swap=true]").click();
    await expect(page.getByRole("button", { exact: true, name: "SOURCE_B" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-source-unsubscribed", "SOURCE_A");
    const sourceBAgentName = await page
      .locator(".picker-button")
      .first()
      .locator("strong")
      .textContent();
    expect(sourceBAgentName).not.toBeNull();
    expect(sourceBAgentName).not.toBe(sourceAAgentName);

    await page.locator("[data-source-emit-old=true]").click();
    await page.waitForTimeout(50);
    await expect(page.getByRole("button", { exact: true, name: "SOURCE_B" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "SOURCE_A_R3" })).toHaveCount(0);

    await page.locator("[data-source-emit-current=true]").click();
    await expect(page.getByRole("button", { exact: true, name: "SOURCE_B_R2" })).toBeVisible();
  } finally {
    await server.close();
  }
});

test("all production-only semantic and effect probes pass independently", async ({ browser }) => {
  const result = await captureProductionSet(browser, {
    cases: [],
    write: false,
  });
  expect(result.captures.size).toBe(allProductionOnlyCases.length);
  expect(result.errors, result.errors.join("\n")).toEqual([]);
});

test("recovery mode disables every reachable demo write without mutating state", async ({
  page,
}) => {
  const server = await startVisualTestServer();
  try {
    await page.goto(`${server.origin}/?visualCase=saas-production-core-restart`, {
      waitUntil: "networkidle",
    });
    await page.locator("[data-production-ready=true]").waitFor();

    const approval = page.getByRole("button", { exact: true, name: "批准执行" });
    await expect(approval).toBeDisabled();
    const before = await page.locator(".message-list").textContent();
    await approval.evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.locator(".message-list")).toHaveText(before ?? "");

    await page.locator('[data-nav-label="新建任务"]').click();
    await expect(page.getByLabel("任务内容")).toBeDisabled();
    await expect(page.locator(".suggestion-list button").first()).toBeDisabled();

    await page.locator('[data-nav-label="长程任务"]').click();
    await expect(page.locator(".queue-actions button").first()).toBeDisabled();

    await page.locator(".agent-nav-primary").filter({ hasText: "Hermes" }).click();
    await page.locator(".agent-module-tabs").getByText("技能", { exact: true }).click();
    await expect(page.getByRole("button", { exact: true, name: "▸ 运行" }).first()).toBeDisabled();

    await page.locator('[data-nav-label="Workflows"]').click();
    await expect(page.locator(".hz-workflow-card button").first()).toBeDisabled();

    await page.getByLabel("设置").click();
    await expect(page.locator(".visibility-grid button").first()).toBeDisabled();
    await expect(page.locator(".permission-profile-field select").first()).toBeDisabled();
  } finally {
    await server.close();
  }
});
