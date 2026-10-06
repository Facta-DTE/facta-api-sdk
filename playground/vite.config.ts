import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The site imports the SDK from source (../react.ts, ../src/...), like examples/react-preview,
// so the playground and the package can never diverge. `?raw` imports pull the shown code from
// the files that actually run; the repository root is therefore readable by the dev server.
export default defineConfig({
  root: here("./site"),
  plugins: [react()],
  build: { outDir: here("./dist"), emptyOutDir: true, sourcemap: false },
  server: {
    fs: { allow: [here("..")] },
    // `wrangler dev` serves the site and /api together; `vite` alone proxies /api to it.
    proxy: { "/api": "http://localhost:8787" },
  },
});
