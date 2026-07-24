import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspaces = [
  ["@dougoos/desktop", "apps/desktop"],
  ["@dougoos/web", "apps/web"],
  ["@dougoos/cloud", "apps/cloud"],
  ["@dougoos/shared", "packages/shared"],
  ["@dougoos/storage", "packages/storage"],
  ["@dougoos/acp", "packages/acp"],
  ["@dougoos/providers", "packages/providers"],
  ["@dougoos/core", "packages/core"],
];

for (const [expectedName, workspacePath] of workspaces) {
  const packageJson = JSON.parse(
    await readFile(join(process.cwd(), workspacePath, "package.json"), "utf8"),
  );
  if (packageJson.type !== "module") {
    throw new Error(`${expectedName} is not ESM`);
  }

  const entryPath = join(process.cwd(), workspacePath, "dist/index.js");
  await access(entryPath);
  const entry = await import(pathToFileURL(entryPath).href);
  if (entry.packageManifest?.name !== expectedName) {
    throw new Error(`${expectedName} build entry did not expose the scaffold manifest`);
  }
}

console.log(`build smoke ok: ${workspaces.length} compiled ESM entries imported`);
