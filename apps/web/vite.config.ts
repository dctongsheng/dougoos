import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const visualTest = mode === "visual-test";
  return {
    build: {
      emptyOutDir: true,
      outDir: visualTest ? "dist/visual-site" : "dist/site",
      rollupOptions: visualTest
        ? {
            input: fileURLToPath(new URL("./visual.html", import.meta.url)),
          }
        : undefined,
    },
    server: {
      host: "127.0.0.1",
    },
  };
});
