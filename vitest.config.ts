import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    passWithNoTests: false,
  },
});
