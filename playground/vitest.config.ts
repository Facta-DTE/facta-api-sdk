import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // `.tsx` suites opt into a DOM with `// @vitest-environment happy-dom`.
    include: ["playground/test/**/*.test.{ts,tsx}"],
    // The suites build the Worker and the SDK from source; on a loaded machine the 5 s
    // default timed out different tests on each run (6-Oct-2026). None is slow by design.
    testTimeout: 20_000,
  },
});
