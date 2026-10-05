import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: ["test-react/**/*.test.tsx"],
    setupFiles: ["test-react/setup.ts"],
    css: false,
  },
});
