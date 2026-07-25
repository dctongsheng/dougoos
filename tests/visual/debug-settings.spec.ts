import { mkdir, writeFile } from "node:fs/promises";

import { test } from "@playwright/test";

import { captureProductionSet } from "./production-harness.js";
import { captureReferenceSet } from "./reference-harness.js";
import { visualReferenceCases } from "./visual-manifest.js";

test("debug settings geometry", async ({ browser }) => {
  const visualCase = visualReferenceCases.find(
    (candidate) => candidate.id === "saas-settings-appearance--saas-1440x900",
  );
  if (visualCase === undefined) throw new Error("Missing settings appearance case");

  const diagnosticCase = {
    ...visualCase,
    landmarks: [
      ...visualCase.landmarks,
      ...Array.from({ length: 8 }, (_, index) => ({
        locator: {
          by: "css" as const,
          value: `[data-screen-label="设置"] > :nth-child(${String(index + 1)})`,
        },
        name: `section-${String(index + 1)}`,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        locator: {
          by: "css" as const,
          value: `[data-screen-label="设置"] > :nth-child(3) > :nth-child(${String(index + 1)})`,
        },
        name: `customize-child-${String(index + 1)}`,
      })),
    ],
  };
  const [reference, production] = await Promise.all([
    captureReferenceSet(browser, { cases: [diagnosticCase] }),
    captureProductionSet(browser, {
      cases: [diagnosticCase],
      includeProductionOnly: false,
      write: false,
    }),
  ]);
  const captures = {
    production: production.captures.get(visualCase.id),
    reference: reference.captures.get(visualCase.id),
  };
  await mkdir("test-results/debug-settings", { recursive: true });
  await Promise.all(
    Object.entries(captures).map(async ([kind, capture]) => {
      if (capture === undefined) return;
      await writeFile(`test-results/debug-settings/${kind}.png`, capture.screenshot);
    }),
  );
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(captures).map(([kind, capture]) => {
          const comparison =
            capture !== undefined && "comparison" in capture.metadata
              ? capture.metadata.comparison
              : undefined;
          return [
            kind,
            {
              comparison,
              errors: kind === "production" ? production.errors : reference.errors,
              landmarks: capture?.metadata.landmarks.map(({ boundingBox, name }) => ({
                boundingBox,
                name,
              })),
            },
          ];
        }),
      ),
      null,
      2,
    ),
  );
});
