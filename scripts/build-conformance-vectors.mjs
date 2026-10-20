// Writes conformance/fingerprint-v1.vectors.json. Run: node scripts/build-conformance-vectors.mjs
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVectors, serializeVectors } from "./conformance-vectors.mjs";

const target = resolve(dirname(fileURLToPath(import.meta.url)), "..", "conformance", "fingerprint-v1.vectors.json");
writeFileSync(target, serializeVectors(await buildVectors()));
console.log(`wrote ${target}`);
