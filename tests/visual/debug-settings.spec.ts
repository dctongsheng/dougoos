import { copyFile, mkdir, writeFile } from "node:fs/promises";

import { test } from "@playwright/test";

import { captureProductionSet } from "./production-harness.js";
import { captureReferenceSet } from "./reference-harness.js";
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
  const customizeCase = cases.find(
    (visualCase) => visualCase.id === "saas-settings-customize--saas-1440x900",
  );
  if (customizeCase === undefined) throw new Error("Missing customize geometry case");
  const referenceGeometryCase = {
    ...customizeCase,
    landmarks: Array.from({ length: 6 }, (_, index) => ({
      locator: {
        by: "css" as const,
        value: `[data-screen-label="设置"] > div:nth-child(3) > div:nth-child(4) > div:nth-child(2) > div:nth-child(${String(index + 1)})`,
      },
      name: `agent-visibility-${String(index + 1)}`,
    })),
  };
  const productionGeometryCase = {
    ...customizeCase,
    landmarks: Array.from({ length: 6 }, (_, index) => ({
      locator: {
        by: "css" as const,
        value: `.customize-section > .visibility-group:nth-child(4) > .visibility-grid > button:nth-child(${String(index + 1)})`,
      },
      name: `agent-visibility-${String(index + 1)}`,
    })),
  };
  const [referenceGeometry, productionGeometry] = await Promise.all([
    captureReferenceSet(browser, { cases: [referenceGeometryCase] }),
    captureProductionSet(browser, {
      cases: [productionGeometryCase],
      includeProductionOnly: false,
      write: false,
    }),
  ]);
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
        geometry: {
          production: productionGeometry.captures
            .get(customizeCase.id)
            ?.metadata.landmarks.map(({ boundingBox, name, style }) => ({
              boundingBox,
              name,
              style,
            })),
          reference: referenceGeometry.captures
            .get(customizeCase.id)
            ?.metadata.landmarks.map(({ boundingBox, name, style }) => ({
              boundingBox,
              name,
              style,
            })),
        },
      },
      null,
      2,
    ),
  );
});
