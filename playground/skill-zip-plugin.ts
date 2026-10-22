// Serves and builds the agent-skill zip as a static asset of the playground.
//
// `playground:build` writes `dist/facta-dte-api-skill.zip` (the Worker serves it from its static assets, like
// any other file), built from `skills/facta-dte-api/` by the SAME script the SDK's CI uses (scripts/pack-skill.mjs),
// so the download is byte-for-byte the CI artifact. `vite` (dev) serves the same bytes from memory.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { makeZip, skillFiles } from "../scripts/pack-skill.mjs";

export const SKILL_ZIP_FILE = "facta-dte-api-skill.zip";

export function skillZipBytes(): Uint8Array {
  return makeZip(skillFiles());
}

export function skillZipPlugin(): Plugin {
  return {
    name: "facta-skill-zip",
    configureServer(server) {
      server.middlewares.use(`/${SKILL_ZIP_FILE}`, (_req, res) => {
        res.setHeader("content-type", "application/zip");
        res.setHeader("content-disposition", `attachment; filename="${SKILL_ZIP_FILE}"`);
        res.end(Buffer.from(skillZipBytes()));
      });
    },
    writeBundle(options) {
      const dir = options.dir;
      if (dir === undefined) throw new Error("facta-skill-zip: the build has no output directory.");
      const target = join(dir, SKILL_ZIP_FILE);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, skillZipBytes());
    },
  };
}
