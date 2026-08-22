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
    // `cli/` is included for its argument parsing, which is pure for the same
    // reason the scheduler is — a date typed at a terminal has to resolve to the
    // same instant as one typed in the browser.
    include: ["lib/**/*.test.ts", "cli/**/*.test.mts"],
  },
});
