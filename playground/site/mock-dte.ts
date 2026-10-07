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

/** The sealed mock document as an Archivo DTE (what `include: ["dte"]` returns per row). */
export function mockArchivoDte(): string {
  return archivoDteOf(sealed) ?? "";
}
