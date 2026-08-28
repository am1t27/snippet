import { defineConfig } from "vitest/config";

// The e2e suite spawns a real server and plays real rounds, so it takes
// minutes. Keep it out of the default `npm test` loop; run it with
// `npm run test:e2e`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "test/e2e/**"],
  },
});
