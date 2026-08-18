import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json so tests import the same way
    // application code does.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // The scheduler is pure, so a Node environment is enough — no jsdom needed.
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
