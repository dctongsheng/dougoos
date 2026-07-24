import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseRoot = join(workspaceRoot, "apps/web/dist/site");
const searchableExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs"]);
const forbidden = [
  ["production scenario id", /saas-production-/u],
  ["production scenario marker", /data-production-scenario/u],
  ["visual case marker", /data-visual-case/u],
  ["visual-only entry", /visual-main|visual\/VisualApp/u],
  ["visual case query", /[?&](?:scenario|visualCase)=/u],
];
const required = [
  "data-runtime-state",
  "core-starting",
  "migration-error",
  "turn-running",
  "replay-gap",
  "capability-warning",
];

const files = [];
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile() && searchableExtensions.has(extname(entry.name))) files.push(path);
  }
};

await visit(releaseRoot);
const contents = await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")]));
const failures = [];
for (const [path, content] of contents) {
  for (const [label, pattern] of forbidden) {
    if (pattern.test(content)) failures.push(`${path}: forbidden ${label}`);
  }
}
const composite = contents.map(([, content]) => content).join("\n");
for (const token of required) {
  if (!composite.includes(token)) failures.push(`release output: missing ${token}`);
}
if (failures.length > 0) {
  throw new Error(`Web release assertion failed:\n${failures.join("\n")}`);
}
console.log(`Web release assertion passed (${files.length} files).`);
