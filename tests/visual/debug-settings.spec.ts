import { copyFile, mkdir, writeFile } from "node:fs/promises";

import { test } from "@playwright/test";

import { captureProductionSet } from "./production-harness.js";
import { visualReferenceCases } from "./visual-manifest.js";

const diagnosticIds = new Set([
  "saas-settings-appearance--saas-1280x800",
  "saas-settings-customize--saas-1440x900",
  "saas-settings-customize--saas-1280x800",
]);

test("debug remaining settings cases", async ({ browser }) => {
  const cases = visualReferenceCases.filter((candidate) => diagnosticIds.has(candidate.id));
  if (cases.length !== diagnosticIds.size) throw new Error("Missing settings diagnostic cases");

  const result = await captureProductionSet(browser, {
    cases,
    includeProductionOnly: false,
    write: false,
  });
  await mkdir("test-results/debug-settings", { recursive: true });
  for (const visualCase of cases) {
    const capture = result.captures.get(visualCase.id);
    if (capture === undefined) throw new Error(`Missing settings capture: ${visualCase.id}`);
    await Promise.all([
      copyFile(
        `tests/visual/reference/screenshots/${visualCase.id}.png`,
        `test-results/debug-settings/${visualCase.id}-reference.png`,
      ),
      writeFile(
        `test-results/debug-settings/${visualCase.id}-production.png`,
        capture.screenshot,
      ),
    ]);
  }
  console.log(
    JSON.stringify(
      {
        captures: cases.map((visualCase) => ({
          comparison: result.captures.get(visualCase.id)?.metadata.comparison,
          id: visualCase.id,
        })),
        errors: result.errors,
      },
      null,
      2,
    ),
  );
});
