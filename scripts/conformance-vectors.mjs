// Builds the shared fingerprint-v1 / envelopeDigest conformance vectors.
// conformance/fingerprint-v1.vectors.json is GENERATED from this module by
// scripts/build-conformance-vectors.mjs; never edit that file by hand.
import { canonicalJson, envelopeDigest, sha256HexOfText } from "../src/jcs.ts";

/** IEEE 754 binary64 bit patterns from RFC 8785 Appendix B. */
const APPENDIX_B = [
  ["0x0000000000000000", "zero"],
  ["0x8000000000000000", "minus zero"],
  ["0x0000000000000001", "min positive"],
  ["0x8000000000000001", "min negative"],
  ["0x7fefffffffffffff", "max positive"],
  ["0xffefffffffffffff", "max negative"],
  ["0x4340000000000000", "2^53"],
  ["0xc340000000000000", "-2^53"],
  ["0x4430000000000000", "large integer with trailing zeros"],
  ["0x44b52d02c7e14af5", "9.999999999999997e+22"],
  ["0x44b52d02c7e14af6", "1e+23"],
  ["0x44b52d02c7e14af7", "1.0000000000000001e+23"],
  ["0x444b1ae4d6e2ef4e", "999999999999999700000"],
  ["0x444b1ae4d6e2ef4f", "999999999999999900000"],
  ["0x444b1ae4d6e2ef50", "1e+21"],
  ["0x3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
  ["0x3eb0c6f7a0b5ed8d", "0.000001"],
  ["0x41b3de4355555553", "333333333.3333332"],
  ["0x41b3de4355555554", "333333333.33333325"],
  ["0x41b3de4355555555", "333333333.3333333"],
  ["0x41b3de4355555556", "333333333.3333334"],
  ["0x41b3de4355555557", "333333333.33333343"],
  ["0xbecbf647612f3696", "-0.0000033333333333333333"],
  ["0x43143ff3c1cb0959", "1424953923781206.2"],
];

function doubleFromBits(hex) {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(hex));
  return view.getFloat64(0);
}

const DTE_REQUEST = `{
  "tipoDte": "03",
  "receptor": {
    "nit": "0614-010101-101-1",
    "nrc": "123456-7",
    "nombre": "Panadería Ñandú, S.A. de C.V.",
    "correo": "compras@ejemplo.com.sv",
    "direccion": { "departamento": "06", "municipio": "14", "complemento": "Calle Los Pinos #12/B, Col. Escalón" }
  },
  "items": [
    { "descripcion": "Café molido 1/2 lb \\"Santa Ana\\"", "cantidad": 3, "precioUni": 4.5 },
    { "descripcion": "Servicio de entrega\\tzona norte", "cantidad": 1.5, "precioUni": 12.34567891 },
    { "descripcion": "Harina de maíz", "cantidad": 10.0, "precioUni": 0.0000001, "descuento": 0 }
  ],
  "observaciones": "Línea 1\\nLínea 2 \\\\ fin",
  "entrega": { "correo": true, "whatsapp": { "numero": "+50370001234", "consentimiento": true } }
}`;

/** Raw JSON texts, written exactly as a caller's request could be. */
const CASES = [
  ["decimal amount with 8 decimals", '{"precioUni":1234.56789012}'],
  ["small amount 1e-7 written in full", '{"cantidad":0.0000001}'],
  ["1e21 switches to exponent form", '{"n":1e21}'],
  ["1e21 written in full digits", '{"n":1000000000000000000000}'],
  ["trailing zero 10.0 becomes 10", '{"n":10.0}'],
  ["trailing zeros 1.50 become 1.5", '{"n":1.50}'],
  ["exponent notation 1E2 becomes 100", '{"n":1E2}'],
  ["negative zero becomes 0", '{"n":-0}'],
  ["negative zero as -0.0", '{"n":-0.0}'],
  ["largest safe integer", '{"n":9007199254740991}'],
  ["2^53", '{"n":9007199254740992}'],
  ["smallest negative safe integer", '{"n":-9007199254740991}'],
  ["0.1 + 0.2 literal", '{"n":0.30000000000000004}'],
  ["accented names", '{"nombre":"Niño Ángel Güemes Ñandú"}'],
  ["slash is not escaped", '{"url":"https://ejemplo.com/a/b?c=d/e"}'],
  ["quote and backslash", '{"s":"a\\"b\\\\c"}'],
  ["tab and newline use short escapes", '{"s":"a\\tb\\nc\\rd\\be\\ff"}'],
  ["control character U+0001 is lowercase \\u0001", '{"s":"x\\u0001y"}'],
  ["control character U+001F", '{"s":"\\u001f"}'],
  ["U+007F is literal", '{"s":"a\\u007fb"}'],
  ["U+2028 and U+2029 stay literal", '{"s":"a\\u2028b\\u2029c"}'],
  ["emoji outside the BMP", '{"s":"café ☕ 😀"}'],
  ["emoji written as a surrogate pair escape", '{"s":"\\ud83d\\ude00"}'],
  ["escaped ASCII letters decode", '{"s":"\\u0041\\u00f1"}'],
  ["key order: UTF-16 differs from UTF-8 byte order", '{"\\ud83d\\ude00":1,"\\uffff":2,"":3}'],
  ["key order: uppercase before lowercase, digits first", '{"b":1,"B":2,"a":3,"10":4,"9":5,"A":6}'],
  ["key order: accented key after ASCII", '{"é":1,"z":2,"a":3}'],
  ["empty object", "{}"],
  ["empty array", "[]"],
  ["empty object versus empty array in a field", '{"a":{},"b":[]}'],
  ["null field is kept", '{"a":null,"b":1}'],
  ["omitted field", '{"b":1}'],
  ["nested arrays", '{"a":[[1,2],[],[[3]],{"z":1,"a":[]}]}'],
  ["booleans", '{"t":true,"f":false}'],
  ["whitespace in the input is dropped", ' {  "b" : [ 1 , 2 ] ,\n "a" : "x y" } '],
  ["top-level array", '[3,"a",null,{"b":1,"a":2}]'],
  ["top-level string", '"hello"'],
  ["top-level number", "42"],
  ["realistic DTE request with receptor, three items and delivery", DTE_REQUEST],
];

/** Two realistic envelopes, in the API's fixed key order. */
const ENVELOPES = [
  {
    name: "destinations vault envelope with / and + in the base64",
    envelope: {
      id: "5b1d3a52-8f0e-4c4b-9a77-1f6f2d0c9e11",
      kind: "storage_destinations",
      iv: "q83vEjRWeJq8zt/7+Ud3nA==",
      ciphertext: "pxJ2/FhX+0c7yQm9oV3kLw8nTzB5aR1uEoD4sGyHjKfNiMvZxCcWqPlAbU6tY0eSdFgh/RkJ+nXwO2vB1mQ7zLt9aCyEu4Hp8DsIoGj5KfVbNc3Xr0ZqTwYlA6mU+eP2dS/hJ1k=",
      formatVersion: 2,
      revision: 7,
    },
  },
  {
    name: "catalog envelope with revision 1 and padding",
    envelope: {
      id: "c0a8e6d4-2b79-4f3a-8d15-7e9b04a6f3c2",
      kind: "catalog",
      iv: "AAECAwQFBgcICQoL",
      ciphertext: "/+8fT0pR3xYz9Q==",
      formatVersion: 2,
      revision: 1,
    },
  },
];

export async function buildVectors() {
  const fingerprint = [];
  for (const [name, input] of CASES) {
    const jcs = canonicalJson(JSON.parse(input));
    fingerprint.push({ name, input, jcs, sha256: await sha256HexOfText(jcs) });
  }
  for (const [bits, note] of APPENDIX_B) {
    const value = doubleFromBits(bits);
    const input = `[${Object.is(value, -0) ? "-0" : String(value)}]`;
    const jcs = canonicalJson(JSON.parse(input));
    fingerprint.push({ name: `RFC 8785 Appendix B ${bits} (${note})`, input, jcs, sha256: await sha256HexOfText(jcs) });
  }
  const envelopeDigests = [];
  for (const { name, envelope } of ENVELOPES) {
    envelopeDigests.push({
      name,
      envelope,
      serialized: JSON.stringify([envelope]),
      digest: await envelopeDigest(envelope),
    });
  }
  return {
    description: "Generated by scripts/build-conformance-vectors.mjs; do not edit by hand. See fingerprint-v1.md.",
    fingerprintV1: fingerprint,
    envelopeDigest: envelopeDigests,
  };
}

export function serializeVectors(vectors) {
  return JSON.stringify(vectors, null, 2) + "\n";
}
