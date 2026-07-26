import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const legalOutput = join(workspaceRoot, "apps", "cloud", "dist", "site", "legal");
const legalFiles = [
  ["THIRD_PARTY_NOTICES.md", join(workspaceRoot, "THIRD_PARTY_NOTICES.md")],
  [
    "FRONTEND_THIRD_PARTY_LICENSES.txt",
    join(workspaceRoot, "legal", "FRONTEND_THIRD_PARTY_LICENSES.txt"),
  ],
  ["Instrument-Sans-OFL.txt", join(workspaceRoot, "legal", "Instrument-Sans-OFL.txt")],
  ["JetBrains-Mono-OFL.txt", join(workspaceRoot, "legal", "JetBrains-Mono-OFL.txt")],
] as const;

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist/site",
  },
  plugins: [
    {
      apply: "build",
      name: "bundle-legal-materials",
      async writeBundle() {
        await mkdir(legalOutput, { recursive: true });
        await Promise.all(
          legalFiles.map(([destination, source]) =>
            copyFile(source, join(legalOutput, destination)),
          ),
        );
      },
    },
  ],
  server: {
    host: "127.0.0.1",
  },
});
