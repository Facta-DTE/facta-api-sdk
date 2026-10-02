// The guard that keeps the SDK's two promises honest.
//
// `docs/plan/tareas/sdks-de-la-api.md` §5 asks for exactly this: a test that
// fails if fiscal vocabulary or a signing primitive appears in the client. It
// is cheap and it is the only thing that stops a well-meaning pull request from
// "just computing the VAT locally to save a round trip".
//
// ONE DEVIATION FROM THE DOC'S LITERAL LIST, and it is deliberate: the doc bans
// the bare word `sign`, but the API HAS a route called `/v1/dte/sign` and a
// method named `sign` that calls it. Banning the string would ban naming the
// endpoint. What is banned instead is every primitive that could actually
// PRODUCE a signature — which is the property the rule is really about.

import { assertEquals } from "jsr:@std/assert@1";

const SOURCES = [
  "src/archive.ts",
  "src/client.ts",
  "src/printing.ts",
  "src/catalog.ts",
  "src/diagnostics.ts",
  "src/errors.ts",
  "src/file-archive.ts",
  "src/bridge-artifact-destination.ts",
  "src/gdrive-artifact-destination.ts",
  "src/onedrive-artifact-destination.ts",
  "src/supabase-artifact-destination.ts",
  "src/types.ts",
  "mod.ts",
  "node.ts",
];

/** Anything that could compute money. A rate, a rounding, a total. */
const FISCAL_PATTERNS: Array<[string, RegExp]> = [
  ["una tasa de IVA", /0\.13|1\.13|13\s*\/\s*100|\*\s*13\b/],
  ["un cálculo de venta gravada", /ventaGravada\s*=/],
  ["un cálculo de total", /total(?:Pagar|Iva|Gravada)\s*=[^=]/],
  ["armar un numeroControl", /["'`]DTE-\$\{|DTE-%s|padStart\(15/],
  ["un catálogo del MH", /CAT-0\d\d/],
];

/** Anything that could produce a signature. */
const SIGNING_PATTERNS: Array<[string, RegExp]> = [
  ["RS512", /RS512/],
  ["PKCS#1", /PKCS1|pkcs8|RSASSA/],
  ["una llave privada", /privateKey|private_key/i],
  ["operación de firma WebCrypto", /crypto\.subtle\.(?:sign|verify)\s*\(/],
  ["crypto de Node", /["']node:crypto["']|require\(["']crypto["']\)/],
  // Public fingerprint/validity facts from the API status contract are safe
  // to inspect. Parsing a certificate or importing its signing material is not.
  ["material de certificado", /\.crt\b|parseMhCertificate|importSigningKey/i],
];

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../${path}`, import.meta.url));
}

Deno.test("el SDK no lleva ni una regla fiscal", async () => {
  for (const source of SOURCES) {
    const text = await read(source);
    for (const [what, pattern] of FISCAL_PATTERNS) {
      assertEquals(pattern.test(text), false, `${source} contiene ${what}`);
    }
  }
});

Deno.test("el SDK no puede sign nada", async () => {
  for (const source of SOURCES) {
    const text = await read(source);
    for (const [what, pattern] of SIGNING_PATTERNS) {
      assertEquals(pattern.test(text), false, `${source} contiene ${what}`);
    }
  }
});

Deno.test("el ejemplo hola-factura cabe en veinte líneas de código", async () => {
  // La medida del §9: si no cabe, se corrige la API, no el ejemplo.
  const text = await read("examples/hola-factura.ts");
  const code = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//"));
  assertEquals(
    code.length <= 20,
    true,
    `hola-factura tiene ${code.length} líneas de código`,
  );
});
