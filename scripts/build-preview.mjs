// Builds ONE self-contained file, preview/index.html (JS and CSS inlined, no
// external requests), for design review of the signing window.
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({ configFile: resolve(root, "examples/react-preview/vite.config.ts") });
mkdirSync(resolve(root, "preview"), { recursive: true });
copyFileSync(resolve(root, ".preview-build/index.html"), resolve(root, "preview/index.html"));
rmSync(resolve(root, ".preview-build"), { recursive: true, force: true });
console.log(`preview/index.html ${(statSync(resolve(root, "preview/index.html")).size / 1024).toFixed(0)} KB`);
