import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { visualScenarioIds } from "../../apps/web/src/visual/VisualApp.js";
import {
  captureReferenceSet,
  compareReferenceRuns,
  verifyCommittedReferenceSet,
} from "./reference-harness.js";
import {
  productionOnlyCases,
  validateVisualManifest,
  visualReferenceCases,
} from "./visual-manifest.js";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const sourceFiles = async (root: string): Promise<readonly string[]> => {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)) output.push(path);
    }
  };
  await visit(root);
  return output;
};

test("visual manifest covers the prototype and production-only contract", async () => {
  expect(validateVisualManifest()).toEqual([]);
  expect(visualReferenceCases.length).toBeGreaterThanOrEqual(100);
  const saasProductionCases = productionOnlyCases.filter(
    (visualCase) => visualCase.surface === "saas",
  );
  expect(saasProductionCases).toHaveLength(15);
  expect(saasProductionCases.map((visualCase) => visualCase.id).sort()).toEqual(
    [...visualScenarioIds].sort(),
  );

  const packageJsonPaths = [
    "package.json",
    "apps/cloud/package.json",
    "apps/desktop/package.json",
    "apps/web/package.json",
    "packages/acp/package.json",
    "packages/core/package.json",
    "packages/providers/package.json",
    "packages/shared/package.json",
    "packages/storage/package.json",
  ];
  for (const path of packageJsonPaths) {
    const contents = await readFile(join(WORKSPACE_ROOT, path), "utf8");
    expect(contents, `${path} must not depend on the prototype runtime`).not.toContain(
      "support.js",
    );
  }

  const productionSources = [
    ...(await sourceFiles(join(WORKSPACE_ROOT, "apps"))),
    ...(await sourceFiles(join(WORKSPACE_ROOT, "packages"))),
  ];
  for (const path of productionSources) {
    const contents = await readFile(path, "utf8");
    expect(contents, `${path} must not load the prototype runtime`).not.toMatch(
      /support\.js|AgentOS (?:Landing|SaaS)\.dc\.html/,
    );
  }
});

test("prototype references match committed evidence across two live captures", async ({
  browser,
  browserName,
}) => {
  test.setTimeout(20 * 60_000);
  expect(browserName).toBe("chromium");

  const warmup = await captureReferenceSet(browser);
  expect(warmup.errors, warmup.errors.join("\n")).toEqual([]);
  const first = await captureReferenceSet(browser);
  const second = await captureReferenceSet(browser);
  const errors = [
    ...compareReferenceRuns(first, second),
    ...(await verifyCommittedReferenceSet(first)),
  ];

  expect(errors, errors.join("\n")).toEqual([]);
});
