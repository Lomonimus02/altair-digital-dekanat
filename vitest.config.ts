import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "client/src"),
      "@shared": path.join(root, "shared/src"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    isolate: false,
    setupFiles: ["./server/test/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
