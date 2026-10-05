import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
execFileSync(process.execPath, [
  esbuild,
  "browser.ts",
  "--bundle",
  "--format=esm",
  "--platform=neutral",
  "--target=es2022",
  "--outfile=dist/browser.js",
], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [
  esbuild,
  "react.ts",
  "--bundle",
  "--format=esm",
  "--platform=neutral",
  "--target=es2022",
  "--jsx=automatic",
  "--external:react",
  "--external:react-dom",
  "--external:react/jsx-runtime",
  "--outfile=dist/react.js",
], { cwd: root, stdio: "inherit" });
mkdirSync(resolve(root, "dist/react"), { recursive: true });
copyFileSync(resolve(root, "src/react/styles.css"), resolve(root, "dist/react/styles.css"));
// The server entry is written on its own branch; build it only when present.
if (existsSync(resolve(root, "server.ts"))) {
  execFileSync(process.execPath, [
    esbuild,
    "server.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    "--target=es2022",
    "--outfile=dist/server.js",
  ], { cwd: root, stdio: "inherit" });
}
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
        /((?:from|import)\s+["'](?:\.\.?\/[^"']+))\.tsx?(["'])/g,
        "$1.js$2",
      );
      writeFileSync(path, consumerSafe);
    }
  }
}

rewriteDeclarationImports(resolve(root, "dist/types"));
