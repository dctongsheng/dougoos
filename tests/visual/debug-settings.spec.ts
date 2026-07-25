import { copyFile, mkdir, writeFile } from "node:fs/promises";

import { test } from "@playwright/test";

import { captureProductionSet } from "./production-harness.js";
import { visualReferenceCases } from "./visual-manifest.js";

test("debug Agent settings", async ({ browser }) => {
  const visualCase = visualReferenceCases.find(
    (candidate) => candidate.id === "saas-settings-agent--saas-1440x900",
  );
  if (visualCase === undefined) throw new Error("Missing Agent settings case");

  const result = await captureProductionSet(browser, {
    cases: [visualCase],
    includeProductionOnly: false,
    write: false,
  });
  const capture = result.captures.get(visualCase.id);
  if (capture === undefined) throw new Error("Missing Agent settings capture");

  await mkdir("test-results/debug-settings", { recursive: true });
  await Promise.all([
    copyFile(
      `tests/visual/reference/screenshots/${visualCase.id}.png`,
      "test-results/debug-settings/reference.png",
    ),
    writeFile("test-results/debug-settings/production.png", capture.screenshot),
  ]);
  console.log(
    JSON.stringify(
      {
        comparison: capture.metadata.comparison,
        errors: result.errors,
        landmarks: capture.metadata.landmarks.map(({ boundingBox, name }) => ({
          boundingBox,
          name,
        })),
      },
      null,
      2,
    ),
  );
});
