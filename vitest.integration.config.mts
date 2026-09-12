import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Separate from vitest.config.mts on purpose: these tests hit real
// Postgres, real Redis, and (for a few suites) the real Shopify test
// store's Admin API — slower and network-dependent, so they're excluded
// from the default `npm test` run and only run via `npm run test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./vitest.integration.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share real DB rows only within their own uniquely
    // generated shop domains, but run them one file at a time anyway —
    // simpler to reason about than debugging cross-file interference on a
    // shared Postgres/Redis instance.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
    },
  },
});
