// Dev-only fixtures for `?mock=1`: a complete document as the API returns it (signed JWS, Hacienda's seal and the
// stored holding file), and the same document in contingency. Imported only by `mock.ts`.

import { archivoDteOf } from "../shared/archivo-dte.ts";

const b64url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export const MOCK_CODE = "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F777";
export const MOCK_SEAL = "2026A1F3C9E0B7D4E5A60318C2D94B7F6A01E3D8";

export const MOCK_DOCUMENT = {
  identificacion: { version: 1, ambiente: "00", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000215", codigoGeneracion: MOCK_CODE, tipoModelo: 1, tipoOperacion: 1, tipoContingencia: null, motivoContin: null, fecEmi: "2026-10-06", horEmi: "10:42:11", tipoMoneda: "USD" },
  emisor: { nit: "06140101921011", nrc: "1234567", nombre: "Comercial Prueba, S.A. de C.V.", nombreComercial: "Café Prueba", codActividad: "47190", descActividad: "Venta al por menor de otros productos", direccion: { departamento: "06", municipio: "14", complemento: "Colonia Escalón, San Salvador" }, telefono: "22223333", correo: "ventas@example.com", codEstableMH: "M001", codPuntoVentaMH: "P001" },
  receptor: { tipoDocumento: "13", numDocumento: "053085465", nombre: "Cliente de prueba", nrc: null, codActividad: null, descActividad: null, direccion: null, telefono: null, correo: "cliente@example.com" },
  cuerpoDocumento: [
    { numItem: 1, tipoItem: 1, cantidad: 2, codigo: "CAFE-01", descripcion: "Café de altura, bolsa de 1 lb", precioUni: 8.5, montoDescu: 0, ventaGravada: 17, ivaItem: 1.96 },
    { numItem: 2, tipoItem: 2, cantidad: 1, codigo: null, descripcion: "Servicio de entrega", precioUni: 3.5, montoDescu: 0, ventaGravada: 3.5, ivaItem: 0.4 },
  ],
  resumen: { totalGravada: 20.5, subTotal: 20.5, totalDescu: 0, totalIva: 2.36, montoTotalOperacion: 20.5, totalPagar: 20.5, totalLetras: "VEINTE 50/100 DOLARES", condicionOperacion: 1, pagos: null },
  apendice: null,
};

export const MOCK_JWS = `${b64url(JSON.stringify({ alg: "RS512", typ: "JWT" }))}.${b64url(JSON.stringify(MOCK_DOCUMENT))}.${b64url("firma-de-demostracion-".repeat(12))}`;

const holding = JSON.stringify({ codigoGeneracion: MOCK_CODE, ambiente: "00", jws: MOCK_JWS });
const sealed = { codigoGeneracion: MOCK_CODE, documento: MOCK_DOCUMENT, jws: MOCK_JWS, selloRecibido: MOCK_SEAL, archivoJson: holding };

const bytes = (text: string) => new TextEncoder().encode(text);
const base64 = (text: string) => { const b = bytes(text); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };

/** What a recipe run returns for a sealed document, or for one in contingency (no seal, so no Archivo DTE). */
export function mockRecipeFiles(contingency: boolean) {
  const raw = { role: "raw", name: `${MOCK_CODE}.raw.json`, contentType: "application/json", size: bytes(holding).length, base64: base64(holding) };
  const pdf = { name: `${MOCK_CODE}.pdf`, contentType: "application/pdf", size: 20, base64: "JVBERi0xLjQKJSBtdWVzdHJhCg==" };
  if (contingency) return [pdf, raw];
  const dte = archivoDteOf(sealed) ?? "";
  return [pdf, { role: "dte", name: `${MOCK_CODE}.json`, contentType: "application/json", size: bytes(dte).length, base64: base64(dte) }, raw];
}

/** The stored holding file the SDK handler serves for `documents.download` kind json. */
export const mockHoldingBase64 = () => base64(holding);

/**
 * A small valid PDF for the dev mock: a ticket at `widthMm` (or a letter page when none) with a few text lines,
 * so the preview can be looked at without an API. Development only.
 */
export function mockPdfBase64(widthMm?: number): string {
  const w = widthMm === undefined ? 612 : Math.round(widthMm * 2.8346);
  const h = widthMm === undefined ? 792 : 430;
  const lines = widthMm === undefined
    ? ["FACTURA ELECTRONICA", "Hoja carta (mock)", `Codigo: ${MOCK_CODE}`, "TOTAL A PAGAR  $1.13"]
    : ["COMERCIAL DEMO, S.A. DE C.V.", "FACTURA ELECTRONICA", `Ticket ${widthMm} mm (mock)`, "----------------------", "1 x Servicio de prueba   1.00", "TOTAL A PAGAR  $1.13", "", "Sello de recepcion", MOCK_SEAL.slice(0, 20) + "..."];
  const size = widthMm === undefined ? 14 : 8;
  const x = widthMm === undefined ? 56 : 10;
  const stream = `BT /F1 ${size} Tf ${x} ${h - 30} Td ${size + 6} TL ${lines.map((l) => `(${l.replace(/[()\\]/g, "")}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(out);
}
