import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  plugins: [react(), viteSingleFile()],
  build: { outDir: "../../.preview-build", emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false },
  logLevel: "warn",
});
