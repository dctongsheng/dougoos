import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "@playwright/test";
import { PNG } from "pngjs";

import { allProductionReferenceCases, captureProductionSet } from "./production-harness.js";

const caseArgument = process.argv.find((value) => value.startsWith("--case="));
const caseId = caseArgument?.slice("--case=".length);
if (caseId === undefined || caseId.length === 0) {
  throw new Error("--case=<exact visual case id> is required");
}

const visualCase = allProductionReferenceCases.find((candidate) => candidate.id === caseId);
if (visualCase === undefined) {
  throw new Error(`Unknown production visual case: ${caseId}`);
}

const workspaceRoot = new URL("../../", import.meta.url);
const outputDirectory = new URL(`../../.artifacts/visual-diagnostic/${caseId}/`, import.meta.url);
const referencePath = new URL(
  `../../tests/visual/reference/screenshots/${caseId}.png`,
  import.meta.url,
);

const browser = await chromium.launch({ headless: true });
try {
  const result = await captureProductionSet(browser, {
    cases: [visualCase],
    includeProductionOnly: false,
    write: false,
  });
  const capture = result.captures.get(caseId);
  if (capture === undefined) {
    throw new Error(`Production capture was not produced: ${result.errors.join("\n")}`);
  }

  const reference = await readFile(referencePath);
  const expected = PNG.sync.read(reference);
  const actual = PNG.sync.read(capture.screenshot);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `Image dimensions differ: ${expected.width}x${expected.height} != ${actual.width}x${actual.height}`,
    );
  }

  const diff = new PNG({ height: expected.height, width: expected.width });
  for (let index = 0; index < expected.data.length; index += 4) {
    const red = Math.abs(expected.data[index] - actual.data[index]);
    const green = Math.abs(expected.data[index + 1] - actual.data[index + 1]);
    const blue = Math.abs(expected.data[index + 2] - actual.data[index + 2]);
    const changed = red > 1 || green > 1 || blue > 1;
    diff.data[index] = changed ? 255 : 0;
    diff.data[index + 1] = changed ? 64 : 0;
    diff.data[index + 2] = changed ? 64 : 0;
    diff.data[index + 3] = changed ? 255 : 0;
  }

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(new URL("actual.png", outputDirectory), capture.screenshot),
    writeFile(new URL("reference.png", outputDirectory), reference),
    writeFile(new URL("diff.png", outputDirectory), PNG.sync.write(diff)),
    writeFile(
      new URL("metadata.json", outputDirectory),
      `${JSON.stringify(
        {
          caseId,
          errors: result.errors,
          metadata: capture.metadata,
          workspaceRoot: join(workspaceRoot.pathname, ""),
        },
        null,
        2,
      )}\n`,
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        caseId,
        comparison: capture.metadata.comparison,
        errors: result.errors,
        landmarks: capture.metadata.landmarks,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
