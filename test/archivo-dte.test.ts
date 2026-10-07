import { assertEquals } from "jsr:@std/assert@1";
import { archivoDteOf } from "../mod.ts";
import { archivoDteOf as browserArchivoDteOf } from "../src/browser/index.ts";

const b64url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The signed payload, with non-ASCII text and a fractional amount.
const DOCUMENT = {
  identificacion: { version: 1, ambiente: "00", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000042", codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34" },
  receptor: { nombre: "María Ñandú", numDocumento: "000000019" },
  cuerpoDocumento: [{ numItem: 1, descripcion: "Año nuevo", cantidad: 1, precioUni: 1234.56 }],
  resumen: { totalPagar: 1234.56 },
};
const JWS = `${b64url('{"alg":"RS512"}')}.${b64url(JSON.stringify(DOCUMENT))}.c2lnbmF0dXJl`;
const SEAL = "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD";

// What the server's `receiverFile` writes: the document's keys, the JWS as
// `firmaElectronica`, the seal as `selloRecibido`, two-space indentation.
const SERVER_BYTES = `{
  "identificacion": {
    "version": 1,
    "ambiente": "00",
    "tipoDte": "01",
    "numeroControl": "DTE-01-M001P001-000000000000042",
    "codigoGeneracion": "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34"
  },
  "receptor": {
    "nombre": "María Ñandú",
    "numDocumento": "000000019"
  },
  "cuerpoDocumento": [
    {
      "numItem": 1,
      "descripcion": "Año nuevo",
      "cantidad": 1,
      "precioUni": 1234.56
    }
  ],
  "resumen": {
    "totalPagar": 1234.56
  },
  "firmaElectronica": "${JWS}",
  "selloRecibido": "${SEAL}"
}`;

Deno.test("archivoDteOf builds the exact bytes the server writes", () => {
  const built = archivoDteOf({ documento: DOCUMENT, jws: JWS, selloRecibido: SEAL });
  assertEquals(built, SERVER_BYTES);
  assertEquals(new TextEncoder().encode(built!), new TextEncoder().encode(SERVER_BYTES));
  const parsed = JSON.parse(built!);
  assertEquals(parsed.firmaElectronica, JWS);
  assertEquals(parsed.selloRecibido, SEAL);
  assertEquals(browserArchivoDteOf({ documento: DOCUMENT, jws: JWS, selloRecibido: SEAL }), SERVER_BYTES);
});

Deno.test("the server's archivoDte wins whenever it is present", () => {
  assertEquals(archivoDteOf({ archivoDte: '{"from":"server"}', documento: DOCUMENT, jws: JWS, selloRecibido: SEAL }), '{"from":"server"}');
});

Deno.test("the JWS payload is the document; documento is the fallback for an opaque JWS", () => {
  const differing = { ...DOCUMENT, resumen: { totalPagar: 1 } };
  assertEquals(archivoDteOf({ documento: differing, jws: JWS, selloRecibido: SEAL }), SERVER_BYTES);
  const opaque = archivoDteOf({ documento: DOCUMENT, jws: "header.payload.sig", selloRecibido: SEAL });
  assertEquals(JSON.parse(opaque!).firmaElectronica, "header.payload.sig");
  assertEquals(JSON.parse(opaque!).resumen, DOCUMENT.resumen);
});

Deno.test("there is no Archivo DTE without a seal, a signature or a document", () => {
  assertEquals(archivoDteOf({ documento: DOCUMENT, jws: JWS }), null);
  assertEquals(archivoDteOf({ documento: DOCUMENT, jws: JWS, selloRecibido: null }), null);
  assertEquals(archivoDteOf({ documento: DOCUMENT, selloRecibido: SEAL }), null);
  assertEquals(archivoDteOf({ jws: "header.payload.sig", selloRecibido: SEAL }), null);
  assertEquals(archivoDteOf({}), null);
});

Deno.test("a signature that is not a JWS is written as null, like the server does", () => {
  assertEquals(JSON.parse(archivoDteOf({ documento: DOCUMENT, jws: "not-a-jws", selloRecibido: SEAL })!).firmaElectronica, null);
});
