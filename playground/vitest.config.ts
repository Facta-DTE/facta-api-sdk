import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["playground/test/**/*.test.ts"],
    // The suites build the Worker and the SDK from source; on a loaded machine the 5 s
    // default timed out different tests on each run (6-Oct-2026). None is slow by design.
    testTimeout: 20_000,
  },
});
