import { chromium } from "@playwright/test";

import {
  captureReferenceSet,
  compareReferenceRuns,
  summarizeReferenceRuns,
  verifyCommittedReferenceSet,
  writeReferenceSet,
  type ReferenceRunResult,
} from "./reference-harness.js";
import { validateVisualManifest, visualReferenceCases } from "./visual-manifest.js";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const stabilityOnly = args.has("--stability-only");
const check = !stabilityOnly && (args.has("--check") || !write);
const caseArgument = process.argv.find((value) => value.startsWith("--case="));
const casePattern = caseArgument?.slice("--case=".length);
const selectedCases =
  casePattern === undefined
    ? visualReferenceCases
    : visualReferenceCases.filter((visualCase) => visualCase.id.includes(casePattern));
if (selectedCases.length === 0) {
  throw new Error(`--case=${casePattern ?? ""} did not match a visual reference`);
}
if (write && casePattern !== undefined) {
  throw new Error("--write cannot be combined with --case; reference writes must be complete");
}
const requestedPasses = (() => {
  const argument = process.argv.find((value) => value.startsWith("--passes="));
  if (argument === undefined) return 2;
  const value = Number(argument.slice("--passes=".length));
  if (!Number.isInteger(value) || value < 2) {
    throw new Error("--passes must be an integer greater than or equal to 2");
  }
  return value;
})();

const manifestErrors = validateVisualManifest();
if (manifestErrors.length > 0) {
  throw new Error(`Visual manifest contract failed:\n${manifestErrors.join("\n")}`);
}

const browser = await chromium.launch({ headless: true });
const runs: ReferenceRunResult[] = [];
try {
  process.stdout.write(`visual reference warmup (${String(selectedCases.length)} cases)\n`);
  const warmup = await captureReferenceSet(browser, {
    cases: selectedCases,
    onProgress: (completed, total, id) => {
      if (completed === total || completed % 50 === 0) {
        process.stdout.write(`  warmup ${String(completed)}/${String(total)} ${id}\n`);
      }
    },
  });
  if (warmup.errors.length > 0) {
    throw new Error(`Visual reference warmup failed:\n${warmup.errors.join("\n")}`);
  }
  for (let pass = 1; pass <= requestedPasses; pass += 1) {
    process.stdout.write(
      `visual reference pass ${String(pass)}/${String(requestedPasses)} (${String(selectedCases.length)} cases)\n`,
    );
    const run = await captureReferenceSet(browser, {
      cases: selectedCases,
      onProgress: (completed, total, id) => {
        if (completed === total || completed % 10 === 0) {
          process.stdout.write(`  ${String(completed)}/${String(total)} ${id}\n`);
        }
      },
    });
    runs.push(run);
    if (run.errors.length > 0) {
      throw new Error(`Visual reference pass ${String(pass)} failed:\n${run.errors.join("\n")}`);
    }
  }
} finally {
  await browser.close();
}

const first = runs[0];
if (first === undefined) throw new Error("No visual reference pass was captured");
const stabilityErrors = runs
  .slice(1)
  .flatMap((run, index) =>
    compareReferenceRuns(first, run).map((error) => `pass 1 vs ${String(index + 2)}: ${error}`),
  );
for (const [index, run] of runs.slice(1).entries()) {
  const report = summarizeReferenceRuns(first, run);
  process.stdout.write(
    [
      `pass 1 vs ${String(index + 2)} metrics:`,
      `hash-different=${String(report.hashDifferentCaseIds.length)}/${String(report.caseCount)}`,
      `max-diff-ratio=${report.maximumDiffPixelRatio.toFixed(8)} (${report.maximumDiffPixelRatioCase ?? "none"})`,
      `max-channel-delta=${String(report.maximumChannelDelta)} (${report.maximumChannelDeltaCase ?? "none"})`,
      `max-semantic-color-delta=${String(report.maximumSemanticColorChannelDelta)} (${report.maximumSemanticColorChannelDeltaCase ?? "none"})`,
      `min-SSIM=${report.minimumSsim.toFixed(8)} (${report.minimumSsimCase ?? "none"})`,
      `max-landmark-delta=${report.maximumLandmarkGeometryDelta.toFixed(3)}px (${report.maximumLandmarkGeometryDeltaCase ?? "none"})`,
    ].join(" "),
  );
  process.stdout.write("\n");
  if (report.hashDifferentCaseIds.length > 0) {
    process.stdout.write(`  hash-different cases: ${report.hashDifferentCaseIds.join(", ")}\n`);
  }
}
if (stabilityErrors.length > 0) {
  throw new Error(`Reference capture is not deterministic:\n${stabilityErrors.join("\n")}`);
}
process.stdout.write(
  `captured ${String(first.captures.size)} references across ${String(requestedPasses)} threshold-compliant passes\n`,
);

if (write) {
  await writeReferenceSet(first);
  process.stdout.write(
    `wrote ${String(first.captures.size)} stable prototype references after ${String(requestedPasses)} threshold-compliant passes\n`,
  );
}

if (check) {
  const committedErrors = await verifyCommittedReferenceSet(first);
  if (committedErrors.length > 0) {
    throw new Error(`Committed reference self-check failed:\n${committedErrors.join("\n")}`);
  }
  process.stdout.write(
    `verified ${String(first.captures.size)} committed references and ${String(requestedPasses)} threshold-compliant live passes\n`,
  );
}
