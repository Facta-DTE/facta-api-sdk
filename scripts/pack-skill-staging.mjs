// Builds the STAGING variant of the agent skill: `dist/facta-dte-api-staging-skill.zip`, folder
// `facta-dte-api-staging/`. It is the production skill (skills/facta-dte-api, untouched) with
//   - SKILL.md replaced by skills-staging/SKILL.md,
//   - references/staging.md added from skills-staging/references/,
//   - the four statements that forbid a staging URL rewritten (each replacement must match, or this fails).
// Usage: node scripts/pack-skill-staging.mjs [--out <file>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeZip, skillFiles } from "./pack-skill.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STAGING_SKILL_NAME = "facta-dte-api-staging";
export const STAGING_OUT = join(root, "dist", `${STAGING_SKILL_NAME}-skill.zip`);
const STAGING_URL = "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";

const REPLACEMENTS = {
  "references/setup-and-keys.md": [
    [/## Environments: pruebas \(00\) and producción \(01\)\n\nAlways use Facta's public API\.[\s\S]*?never by\nthe URL\.\*\*\n/,
      `## Environment: staging (pruebas, 00)\n\nThis is the STAGING skill. Always set \`baseUrl\` to the staging API\n(\`FACTA_STAGING_BASE_URL\`, \`${STAGING_URL}\`) and use a \`facta_test_\` key created in\nhttps://staging.factadte.com. The SDK default is the production host; a staging key sent there fails\nwith 401. Production keys (\`facta_live_\`) never go to staging.\n`],
    ["  // Do not set baseUrl: the default is Facta's public API (both environments).",
      "  baseUrl: \"" + STAGING_URL + "\", // staging API (FACTA_STAGING_BASE_URL)"],
    ["pnpm add @facta-dte/api            # or: npm install @facta-dte/api", "pnpm add @facta-dte/api@next       # or: npm install @facta-dte/api@next (the staging SDK)"],
  ],
  "references/recipes.md": [
    ["Your own code must target Facta's\npublic API (omit `baseUrl`) with your own `facta_test_` or `facta_live_` key.",
      "In this staging skill your code must target the staging API (`baseUrl: FACTA_STAGING_BASE_URL`) with your own\n`facta_test_` key; the recipes omit `baseUrl`, so add it."],
  ],
  "templates/README.md": [
    ["Start with a `facta_test_` key on the same public API: no `baseUrl` is set anywhere (never configure a staging or internal URL);",
      "For staging, add `baseUrl: FACTA_STAGING_BASE_URL` to the `Facta` constructor (the templates omit it) and use a `facta_test_` key;"],
  ],
  "references/issuing-dte-types.md": [
    ["- On notes with several related documents,",
      "- `montoDescu` (staging, `@facta-dte/api@next`): this line's discount in money, between 0 and `cantidad × precioUni`. See [staging.md](staging.md).\n- On notes with several related documents,"],
    ["`formaPago` (`\"01\"` = efectivo), `observaciones`.",
      "`formaPago` (`\"01\"` = efectivo; a code outside CAT-017 is `422`), `pagos` (staging: several payment methods, see [staging.md](staging.md)), `observaciones`."],
  ],
};

export function stagingFiles() {
  const out = [];
  for (const file of skillFiles()) {
    const rel = file.name.slice("facta-dte-api/".length);
    if (rel === "SKILL.md") continue;
    let text = file.data.toString("utf8");
    for (const [from, to] of REPLACEMENTS[rel] ?? []) {
      const next = text.replace(from, to);
      if (next === text) throw new Error(`staging skill: replacement did not match in ${rel}: ${String(from).slice(0, 60)}`);
      text = next;
    }
    out.push({ name: `${STAGING_SKILL_NAME}/${rel}`, data: Buffer.from(text) });
  }
  out.push({ name: `${STAGING_SKILL_NAME}/SKILL.md`, data: readFileSync(join(root, "skills-staging", "SKILL.md")) });
  out.push({ name: `${STAGING_SKILL_NAME}/references/staging.md`, data: readFileSync(join(root, "skills-staging", "references", "staging.md")) });
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function packStagingSkill(out = STAGING_OUT) {
  const files = stagingFiles();
  const zip = makeZip(files);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, zip);
  return { out, files: files.length, bytes: zip.length, entries: files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const r = packStagingSkill(i > 0 ? resolve(process.argv[i + 1]) : STAGING_OUT);
  console.log(`Wrote ${relative(process.cwd(), r.out)} (${r.files} files, ${r.bytes} bytes)`);
}
