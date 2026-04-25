import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // "server-only" is a Next.js guard that throws in non-server environments.
      // In tests we replace it with an empty module.
      "server-only": path.resolve(__dirname, "__tests__/__mocks__/server-only.ts"),
      // "next/cache" provides use-cache directives; mock for test environment.
      "next/cache": path.resolve(__dirname, "__tests__/__mocks__/next-cache.ts"),
    },
  },
});
