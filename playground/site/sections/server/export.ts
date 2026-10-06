// «Copiar para Node», «Copiar para Deno/Bun» and the downloadable project are all
// generated from the recipe file itself: same code, with the SDK imported from the
// package instead of the checkout, plus a small runner that reads the keys from
// environment variables. Nothing here ever contains a credential.

import { makeZip } from "./zip.ts";

export const PACKAGE_VERSION = "0.3.0";
export const STAGING_API_URL = "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";

/** The recipe source with the checkout import pointing at the published package. */
export function portableSource(raw: string): string {
  return raw.replaceAll('"../../../mod.ts"', '"@facta-dte/api"').trim();
}

const RUNNER = `
// ---- Run it -------------------------------------------------------------
// Keys come from the environment, never from this file. Use a facta_test_ key.
const facta = new FactaClient({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  baseUrl: process.env.FACTA_API_BASE_URL ?? "${STAGING_API_URL}",
});

function filesOf(node: unknown, found: Array<[string, Uint8Array]> = [], depth = 0) {
  if (node === null || typeof node !== "object" || depth > 3) return found;
  const o = node as Record<string, unknown>;
  const code = typeof o.codigoGeneracion === "string" ? o.codigoGeneracion : "documento";
  if (typeof o.representacionGrafica === "string") found.push([\`\${code}.pdf\`, Buffer.from(o.representacionGrafica, "base64")]);
  if (typeof o.archivoJson === "string") found.push([\`\${code}.json\`, Buffer.from(o.archivoJson)]);
  if (o.bytes instanceof Uint8Array) found.push([\`\${code}.\${o.kind === "json" ? "json" : "pdf"}\`, o.bytes]);
  for (const child of Object.values(o)) filesOf(child, found, depth + 1);
  return found;
}

const out = await run(facta, sample);
for (const [name, bytes] of filesOf(out)) await writeFile(name, bytes);
console.log(JSON.stringify(out, (key, value) =>
  value instanceof Uint8Array ? \`[\${value.length} bytes]\`
  : ["jws", "archivoJson", "representacionGrafica"].includes(key) ? "[omitted: saved as a file]" : value, 2));
`;

const IMPORTS = `import { writeFile } from "node:fs/promises";
import { Facta as FactaClient } from "@facta-dte/api";
`;

export function nodeScript(raw: string): string {
  return `// Node.js 22+ · pnpm add @facta-dte/api@${PACKAGE_VERSION}
// Run: FACTA_API_KEY=… FACTA_SIGN_KEY=… node --experimental-strip-types recipe.ts
${IMPORTS}${portableSource(raw)}
${RUNNER}`;
}

export function denoBunScript(raw: string): string {
  return `// Deno 2:  deno.json → { "imports": { "@facta-dte/api": "npm:@facta-dte/api@${PACKAGE_VERSION}" } }
//          deno run --allow-net --allow-env --allow-write recipe.ts
// Bun:     bun add @facta-dte/api@${PACKAGE_VERSION} && bun run recipe.ts
${IMPORTS}${portableSource(raw)}
${RUNNER}`;
}

const README = `# Receta de Facta DTE

Proyecto listo para ejecutar con Node.js 22 o superior.

1. \`pnpm install\` (o \`npm install\`).
2. Copie \`.env.example\` a \`.env\` y escriba SU PROPIA llave de pruebas (\`facta_test_…\`) y su llave de firma.
   Nunca use una llave de producción y no suba \`.env\` a un repositorio.
3. \`pnpm start\`.

La receta usa el ambiente de pruebas (00). Cada emisión gasta un correlativo de pruebas y no tiene valor fiscal.
El documento de ejemplo es mínimo: ajuste \`sample\` con sus propios datos.
`;

export function projectFiles(raw: string, recipeId: string): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: `facta-receta-${recipeId}`,
      private: true,
      type: "module",
      scripts: { start: "node --env-file=.env --experimental-strip-types recipe.ts" },
      dependencies: { "@facta-dte/api": PACKAGE_VERSION },
    }, null, 2) + "\n",
    ".env.example": `# Su propia llave de PRUEBAS. Nunca una llave de producción.\nFACTA_API_KEY=facta_test_reemplace-esta-llave\nFACTA_SIGN_KEY=factask_reemplace-esta-llave\nFACTA_API_BASE_URL=${STAGING_API_URL}\n`,
    ".gitignore": ".env\nnode_modules\n*.pdf\n",
    "recipe.ts": nodeScript(raw) + "\n",
    "README.md": README,
  };
}

export function projectZip(raw: string, recipeId: string): Uint8Array {
  return makeZip(projectFiles(raw, recipeId));
}
