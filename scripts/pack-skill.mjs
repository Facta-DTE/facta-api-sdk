// Zips `skills/facta-dte-api/` into `dist/facta-dte-api-skill.zip`, deterministically:
// sorted entries, fixed timestamp, fixed permissions, no compression (stored), no
// dependencies. Same inputs always give the same bytes, so the zip can be compared,
// cached and served as a static asset (the playground reuses this script).
//
// Usage: node scripts/pack-skill.mjs [--out <file>]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SKILL_NAME = "facta-dte-api";
export const SKILL_DIR = join(root, "skills", SKILL_NAME);
export const DEFAULT_OUT = join(root, "dist", `${SKILL_NAME}-skill.zip`);

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === ".DS_Store" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Entries are `facta-dte-api/<relative path>` with forward slashes, sorted by name. */
export function skillFiles(dir = SKILL_DIR) {
  return walk(dir)
    .map((path) => ({ name: `${SKILL_NAME}/${relative(dir, path).split(sep).join("/")}`, data: readFileSync(path) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0; // 00:00:00
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true); // made by Unix
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(38, (0o100644 << 16) >>> 0, true); // regular file, rw-r--r--
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function packSkill(out = DEFAULT_OUT) {
  const files = skillFiles();
  if (!files.some((f) => f.name === `${SKILL_NAME}/SKILL.md`)) throw new Error("skills/facta-dte-api/SKILL.md is missing.");
  const zip = makeZip(files);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, zip);
  return { out, files: files.length, bytes: zip.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const result = packSkill(i > 0 ? resolve(process.argv[i + 1]) : DEFAULT_OUT);
  console.log(`Wrote ${relative(process.cwd(), result.out)} (${result.files} files, ${result.bytes} bytes)`);
}
