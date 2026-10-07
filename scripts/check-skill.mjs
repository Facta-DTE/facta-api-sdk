// Checks the skill without a test framework: format, links, grounding, determinism.
//   - SKILL.md has YAML frontmatter with `name` (= folder) and a `description` that says when to use it;
//   - every relative Markdown link in the skill resolves, and SKILL.md routes to every reference file;
//   - errors.md lists exactly the codes of `FactaErrorCode` (src/errors.ts): none missing, none invented;
//   - the recipes index is current;
//   - the pack is deterministic and complete.
// The templates are compiled separately (`pnpm skill:typecheck`).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { packSkill, SKILL_DIR, SKILL_NAME } from "./pack-skill.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const fail = (message) => problems.push(message);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}
const files = walk(SKILL_DIR);

// 1. Frontmatter.
const skillMd = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const front = /^---\n([\s\S]*?)\n---\n/.exec(skillMd);
if (!front) fail("SKILL.md has no YAML frontmatter.");
else {
  const name = /^name:\s*(.+)$/m.exec(front[1])?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(front[1])?.[1]?.trim() ?? "";
  if (name !== SKILL_NAME) fail(`frontmatter name must be ${SKILL_NAME}, got ${name}.`);
  if (!/^[a-z0-9-]{1,64}$/.test(name ?? "")) fail("frontmatter name must be lowercase letters, digits and hyphens.");
  if (description.length < 80 || description.length > 1024) fail(`description must be 80-1024 characters (is ${description.length}).`);
  for (const needle of ["Facta DTE", "El Salvador", "@facta-dte/api", "HTTP API"]) {
    if (!description.includes(needle)) fail(`description should mention «${needle}».`);
  }
}

// 2. Links.
const linked = new Set();
for (const file of files.filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target)) continue;
    const resolved = resolve(dirname(file), target);
    if (!existsSync(resolved)) fail(`${file.replace(SKILL_DIR + "/", "")}: broken link ${target}`);
    if (file === join(SKILL_DIR, "SKILL.md")) linked.add(resolved);
  }
}
for (const ref of files.filter((f) => f.includes("/references/"))) {
  if (!linked.has(ref)) fail(`SKILL.md does not link ${ref.replace(SKILL_DIR + "/", "")}`);
}

// 3. Error codes are the SDK's own.
const errorsSrc = readFileSync(join(root, "src", "errors.ts"), "utf8");
const union = (/export type FactaErrorCode =([\s\S]*?);\n/.exec(errorsSrc)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const sdkCodes = new Set([...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
const doc = readFileSync(join(SKILL_DIR, "references", "errors.md"), "utf8");
const documented = new Set([...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]));
// Codes the skill documents ahead of the SDK change that introduces them. Remove each entry once its
// SDK PR is in this branch (the check then enforces it like any other code).
const PENDING_CODES = new Set(["catalog_duplicate"]); // SDK PR #38
for (const code of sdkCodes) if (!documented.has(code)) fail(`errors.md is missing FactaErrorCode ${code}.`);
for (const code of documented) if (!sdkCodes.has(code) && !PENDING_CODES.has(code)) fail(`errors.md lists ${code}, which is not a FactaErrorCode.`);
if (sdkCodes.size < 40) fail("could not read FactaErrorCode from src/errors.ts.");

// 4. Recipes index current.
try {
  execFileSync(process.execPath, [join(root, "scripts", "build-skill-recipes.mjs"), "--check"], { stdio: "pipe" });
} catch (error) {
  fail(String(error.stderr ?? error.message).trim());
}

// 5. Secrets: no key-looking literal in the skill.
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (/facta_(?:test|live)_[A-Za-z0-9]{6,}\.|factask_[A-Za-z0-9]{8,}|factauk_[A-Za-z0-9]{8,}/.test(text)) fail(`${file.replace(SKILL_DIR + "/", "")}: contains something that looks like a real key.`);
}

// 6. Pack: deterministic, complete.
const dir = mkdtempSync(join(tmpdir(), "facta-skill-"));
const a = packSkill(join(dir, "a.zip"));
const b = packSkill(join(dir, "b.zip"));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
if (sha(a.out) !== sha(b.out)) fail("the zip is not deterministic.");
if (a.files !== files.length) fail(`the zip has ${a.files} files, the skill has ${files.length}.`);

if (problems.length > 0) {
  console.error(problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
console.log(`skill ok: ${files.length} files, ${sdkCodes.size} error codes, deterministic zip (${a.bytes} bytes)`);
