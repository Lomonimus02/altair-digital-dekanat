import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "@shared": path.resolve(root, "../shared/src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5317,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4317", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ["@mlc-ai/web-llm"],
  },
});
