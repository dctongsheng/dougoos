import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "test-results/playwright",
  reporter: [["line"]],
  testDir: ".",
  timeout: 30_000,
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testMatch: /tests\/e2e\/(?!desktop\/).*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop",
      testMatch: /tests\/e2e\/desktop\/.*\.spec\.ts/,
      workers: 1,
    },
    {
      name: "visual",
      testMatch: /tests\/visual\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        viewport: { height: 900, width: 1440 },
      },
    },
  ],
  snapshotPathTemplate: "{testDir}/tests/visual/snapshots/{projectName}/{testFilePath}/{arg}{ext}",
});
