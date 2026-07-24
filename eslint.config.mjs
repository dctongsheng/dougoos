import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".artifacts/**",
      "**/dist/**",
      "**/node_modules/**",
      ".cache/**",
      ".turbo/**",
      "coverage/**",
      "playwright-report/**",
      "prototypes/**",
      "references/**",
      "test-results/**",
      "**/worker-configuration.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["**/*.cts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
