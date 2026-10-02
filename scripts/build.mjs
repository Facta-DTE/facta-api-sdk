import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = require.resolve("esbuild/bin/esbuild");
const tsc = require.resolve("typescript/bin/tsc");

rmSync(resolve(root, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [
  esbuild,
  "mod.ts",
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--target=node22",
  "--outfile=dist/index.js",
], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [
  esbuild,
  "src/file-archive.ts",
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--target=node22",
  "--outfile=dist/file-archive.js",
], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [
  esbuild,
  "node.ts",
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--target=node22",
  "--outfile=dist/node.js",
], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [tsc, "--project", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});

function rewriteDeclarationImports(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      rewriteDeclarationImports(path);
    } else if (entry.name.endsWith(".d.ts")) {
      const source = readFileSync(path, "utf8");
      const consumerSafe = source.replace(
        /((?:from|import)\s+["'](?:\.\.?\/[^"']+))\.ts(["'])/g,
        "$1.js$2",
      );
      writeFileSync(path, consumerSafe);
    }
  }
}

rewriteDeclarationImports(resolve(root, "dist/types"));
