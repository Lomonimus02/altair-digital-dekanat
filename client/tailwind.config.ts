import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "tailwindcss";

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  darkMode: "class",
  content: [path.join(root, "index.html"), path.join(root, "src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
        display: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
      boxShadow: {
        glass: "0 12px 40px rgba(16, 42, 32, 0.08), inset 0 1px 0 rgba(255,255,255,0.75)",
      },
    },
  },
  plugins: [],
} satisfies Config;
