import { defineConfig } from "vitest/config";

// E2E only: a real server process and real rounds, so one file at a time and
// generous timeouts.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.js"],
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 30000,
  },
});
