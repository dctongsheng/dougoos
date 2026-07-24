import { expect, test } from "@playwright/test";

test("launches Chromium and renders a deterministic page", async ({ browserName, page }) => {
  expect(test.info().project.name).toBe("e2e");
  expect(browserName).toBe("chromium");

  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>DougoOS E2E Harness</title>
      </head>
      <body>
        <main>
          <h1 data-testid="title">DougoOS E2E Harness</h1>
          <output data-testid="status">browser-ready</output>
        </main>
      </body>
    </html>
  `);

  await expect(page).toHaveTitle("DougoOS E2E Harness");
  await expect(page.getByTestId("title")).toHaveText("DougoOS E2E Harness");
  await expect(page.getByTestId("status")).toHaveText("browser-ready");
  expect(page.context().browser()?.version()).toMatch(/^\d+\./);
});
