import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DteView } from "../site/components/dte-view.tsx";
import { archivoDteBytes, archivoDteFromStored, archivoDteOf, dteFileName, jwsPayload, parseArchivoDte, rawFileName } from "../shared/archivo-dte.ts";
import { collectFiles } from "../server/recipes/runner.ts";
import { leaksSecret, redact } from "../server/recipes/redact.ts";

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";
const SEAL = "2026A1F3C9E0B7D4E5A60318C2D94B7F6A01E3D8";
const DOCUMENT = {
  identificacion: { version: 1, tipoDte: "01", codigoGeneracion: CODE, numeroControl: "DTE-01-M001P001-000000000000001", fecEmi: "2026-10-06" },
  emisor: { nit: "06140101921011", nombre: "Comercial Prueba", correo: "ventas@example.com" },
  receptor: { nombre: "Cliente ñandú", correo: "cliente@example.com" },
  cuerpoDocumento: [{ numItem: 1, descripcion: "Café", precioUni: 8.5, ventaGravada: 17 }],
  resumen: { totalPagar: 17, totalLetras: "DIECISIETE 00/100 DOLARES" },
};
const JWS = `${b64url('{"alg":"RS512"}')}.${b64url(JSON.stringify(DOCUMENT))}.${b64url("firma")}`;
const HOLDING = JSON.stringify({ codigoGeneracion: CODE, ambiente: "00", jws: JWS });

// What `receiverFile` in packages/storage/src/archive.ts produces for this record: the document, then
// `firmaElectronica`, then `selloRecibido`, two-space JSON. Written out here, not computed by the adapter.
const EXPECTED = JSON.stringify({ ...DOCUMENT, firmaElectronica: JWS, selloRecibido: SEAL }, null, 2);

describe("archivo-dte adapter (mirrors receiverFile)", () => {
  it("builds the same Archivo DTE as the SDK helper fixture", () => {
    expect(archivoDteOf({ documento: DOCUMENT, jws: JWS, selloRecibido: SEAL })).toBe(EXPECTED);
    expect(new TextDecoder().decode(archivoDteBytes(DOCUMENT, JWS, SEAL))).toBe(EXPECTED);
    // Order is part of the contract: document members, then the signature, then the seal.
    expect(Object.keys(JSON.parse(EXPECTED)).slice(-2)).toEqual(["firmaElectronica", "selloRecibido"]);
    expect(EXPECTED).toContain('\n  "emisor": {\n    "nit"');
    // The JWS travels byte for byte and its payload is what is read back.
    expect(parseArchivoDte(EXPECTED)?.firma).toBe(JWS);
    expect(jwsPayload(JWS)).toEqual(DOCUMENT);
  });

  it("reads the document from the JWS payload, not from `documento`", () => {
    expect(archivoDteOf({ documento: { otro: true }, jws: JWS, selloRecibido: SEAL })).toBe(EXPECTED);
    // A JWS that does not decode falls back to `documento`, as the monorepo does.
    expect(JSON.parse(archivoDteOf({ documento: { a: 1 }, jws: "x.y.z", selloRecibido: "S" })!)).toEqual({ a: 1, firmaElectronica: "x.y.z", selloRecibido: "S" });
  });

  it("has no Archivo DTE without a seal (contingency)", () => {
    expect(archivoDteOf({ documento: DOCUMENT, jws: JWS, selloRecibido: null })).toBeNull();
    expect(archivoDteOf({ documento: DOCUMENT, jws: JWS })).toBeNull();
    expect(archivoDteFromStored(HOLDING, null)).toBeNull();
  });

  it("prefers an `archivoDte` the API returns (the later switch)", () => {
    expect(archivoDteOf({ archivoDte: '{"served":"by the api"}', documento: DOCUMENT, jws: JWS, selloRecibido: SEAL })).toBe('{"served":"by the api"}');
  });

  it("normalises the three stored shapes to the same text", () => {
    const record = JSON.stringify({ version: 1, firma: JWS, documento: DOCUMENT, respuestaMh: { selloRecibido: SEAL } });
    const receiver = JSON.stringify({ ...DOCUMENT, firmaElectronica: JWS, selloRecibido: SEAL });
    expect(archivoDteFromStored(HOLDING, SEAL)).toBe(EXPECTED);
    expect(archivoDteFromStored(record)).toBe(EXPECTED);
    expect(archivoDteFromStored(receiver)).toBe(EXPECTED);
    expect(archivoDteFromStored("not json", SEAL)).toBeNull();
    expect(archivoDteFromStored('{"hola":1}', SEAL)).toBeNull();
  });

  it("names the files after the generation code", () => {
    expect(dteFileName(CODE.toLowerCase())).toBe(`${CODE}.json`);
    expect(rawFileName(CODE)).toBe(`${CODE}.raw.json`);
  });
});

describe("collectFiles: JSON DTE and raw", () => {
  const sealed = { codigoGeneracion: CODE, documento: DOCUMENT, jws: JWS, selloRecibido: SEAL, archivoJson: HOLDING };
  const text = (f: { base64?: string }) => Buffer.from(f.base64 ?? "", "base64").toString("utf8");

  it("returns the Archivo DTE as <code>.json and the stored original as <code>.raw.json", () => {
    const files = collectFiles({ result: sealed });
    expect(files.map((f) => [f.role, f.name])).toEqual([["dte", `${CODE}.json`], ["raw", `${CODE}.raw.json`]]);
    expect(text(files[0]!)).toBe(EXPECTED);
    expect(text(files[1]!)).toBe(HOLDING);
  });

  it("offers only the raw file in contingency", () => {
    const files = collectFiles({ ...sealed, selloRecibido: null });
    expect(files.map((f) => [f.role, f.name])).toEqual([["raw", `${CODE}.raw.json`]]);
  });

  it("builds the DTE of a downloaded stored file from the seal next to it, and keeps its bytes as raw", () => {
    const bytes = new TextEncoder().encode(HOLDING);
    const files = collectFiles({ file: { kind: "json", contentType: "application/json", bytes, codigoGeneracion: CODE }, selloRecibido: SEAL });
    expect(files.map((f) => f.name)).toEqual([`${CODE}.json`, `${CODE}.raw.json`]);
    expect(text(files[0]!)).toBe(EXPECTED);
    expect(text(files[1]!)).toBe(HOLDING);
    // No seal known: the raw bytes only.
    expect(collectFiles({ file: { kind: "json", contentType: "application/json", bytes, codigoGeneracion: CODE } }).map((f) => f.role)).toEqual(["raw"]);
  });

  it("never ships a file that carries a credential or a storage path", () => {
    const leaky = { ...sealed, documento: { ...DOCUMENT, apendice: "facta_test_abc.def" }, jws: "x.y.z", archivoJson: '{"path":"DTE/2026/10/a.json"}' };
    expect(collectFiles(leaky)).toEqual([]);
    expect(collectFiles({ ...sealed, archivoJson: "contains mi-valor-secreto" }, ["mi-valor-secreto"]).map((f) => f.role)).toEqual(["dte"]);
  });
});

describe("DteView", () => {
  const unescape = (html: string) => html.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const rawOf = (html: string) => unescape(/data-testid="dte-raw">([\s\S]*?)<\/pre>/.exec(html)![1]!);
  // Spacing and key order that a pretty-printer would change.
  const RAW = `{"codigoGeneracion":"${CODE}",  "jws":"${JWS}",\n\t"nota":"a & b <c>"}`;

  it("shows the document by sections, the seal and the signature in their own blocks", () => {
    const html = renderToStaticMarkup(createElement(DteView, { code: CODE, dte: EXPECTED, raw: RAW }));
    for (const title of ["Identificación", "Emisor", "Receptor", "Cuerpo del documento", "Resumen", "Sello de Hacienda", "Firma electrónica"]) expect(html).toContain(title);
    expect(html).toContain("Cliente ñandú");
    // The visitor's own test document is shown whole: no e-mail masking in the view.
    expect(html).toContain("cliente@example.com");
    expect(html).toContain(SEAL);
    // The signature is truncated on screen; Copiar hands over the whole.
    expect(html).not.toContain(JWS);
    expect(html).toContain("Ver el original (raw)");
    expect(html).toContain("Descargar JSON DTE");
    expect(html).toContain("Descargar JSON original (raw)");
    expect(html).not.toContain('data-testid="dte-raw"');
  });

  it("the raw toggle shows the stored bytes exactly", () => {
    const html = renderToStaticMarkup(createElement(DteView, { code: CODE, dte: EXPECTED, raw: RAW, initiallyRaw: true }));
    expect(rawOf(html)).toBe(RAW);
    expect(html).not.toContain("Sello de Hacienda");
  });

  it("says a contingency document has no seal yet and offers the raw file", () => {
    const html = renderToStaticMarkup(createElement(DteView, { code: CODE, dte: null, raw: RAW }));
    expect(html).toContain("Todavía no tiene sello de Hacienda");
    expect(html).toContain("Descargar JSON original (raw)");
    expect(html).not.toContain("Descargar JSON DTE");
    expect(rawOf(html)).toBe(RAW);
  });

  it("can hide its own downloads when the screen has a bar", () => {
    const html = renderToStaticMarkup(createElement(DteView, { code: CODE, dte: EXPECTED, raw: RAW, downloads: false }));
    expect(html).not.toContain("Descargar JSON");
  });
});

describe("redaction still strips secrets", () => {
  it("omits the bulky members, credentials and paths from the result the page shows", () => {
    const out = JSON.stringify(redact({ codigoGeneracion: CODE, jws: JWS, archivoDte: EXPECTED, archivoJson: HOLDING, documento: DOCUMENT, apiKey: "facta_test_x.y", bucket: "b", path: "DTE/2026/10/a.json", nota: "facta_test_abc.def en DTE/2026/10/a.json" }));
    expect(out).not.toContain("facta_test_abc");
    expect(out).not.toContain("DTE/2026/10");
    expect(out).not.toContain("apiKey");
    expect(out).not.toContain("bucket");
    expect(out).not.toContain(JWS);
    expect(out).toContain("[omitido");
    expect(JSON.parse(out).archivoDte).toBe(`[omitido: ${EXPECTED.length} caracteres]`);
  });

  it("recognises credentials, secrets and storage paths in a file, but not an e-mail", () => {
    expect(leaksSecret("hola ventas@example.com")).toBe(false);
    expect(leaksSecret("llave facta_live_AbC123")).toBe(true);
    expect(leaksSecret("https://x.supabase.co/storage/v1/object/private/f.pdf")).toBe(true);
    expect(leaksSecret("mi-valor-secreto aquí", ["mi-valor-secreto"])).toBe(true);
    expect(leaksSecret("corto", ["abc"])).toBe(false);
  });
});
