# Issuing each DTE type

Sources: `src/types.ts` (`DteRequest`), `examples/dte-types.ts`,
`guides/prepare-sign.md`, `guides/node.md`, and the contract's `SolicitudDte`,
`Item` and receiver schemas.

## One method, six types

`facta.issue(request, { idempotencyKey, deliver?, signal?, debug? })` →
`IssueResult` (`SealedDte | DteInContingency`, discriminated by `estado`).
It reserves the control number, builds and validates against Hacienda's schema,
signs, transmits and writes the index. Needs scope `issue` and a `signKey`.

`DteRequest` is a union keyed by `tipoDte`. Wire field names keep Hacienda's
Spanish spelling; do not translate them.

| `tipoDte` | Document | Line price (`precioUni`) | `receptor` | Own fields |
| --- | --- | --- | --- | --- |
| `"01"` | Factura (FE) | **includes** VAT | optional (omit = consumidor final) | — |
| `"03"` | Comprobante de Crédito Fiscal (CCF) | **excludes** VAT | required: a registered taxpayer | — |
| `"05"` | Nota de crédito | excludes VAT | like 03 | `documentosRelacionados` (required) |
| `"06"` | Nota de débito | excludes VAT | like 03 | `documentosRelacionados` (required), `numPagoElectronico?` |
| `"11"` | Factura de exportación (FEX) | no VAT (rate zero) | required: foreign receiver (`ExportRecipient`) | `exportacion` (required) |
| `"14"` | Factura de sujeto excluido (FSE) | the price as is | required: the **seller** you bought from (`ExcludedSubjectRecipient`) | `aplicarReteRenta?` |

The server does not guess the VAT basis: sending a CCF price with VAT included
gives wrong totals, not an error. **07 (Comprobante de retención) and 15
(Comprobante de donación) are not exposed by the API contract or the SDK**
(`DteType` is `"01" | "03" | "05" | "06" | "11" | "14"`); do not offer them.
A key may be restricted to some types (`dte_type_not_allowed`).

Common request fields (`DteRequestBase`): `items` (1–2000), `condicionOperacion`
(1 contado, 2 crédito, 3 otro), `plazo` (`"01"` days, `"02"` months, `"03"`
years; only for credit), `periodo` (only with `condicionOperacion` 2),
`formaPago` (`"01"` = efectivo), `observaciones`. Payment has its own rules; read
the next section before sending any of it.

### Payment (`formaPago`, `pagos`, credit)

Payment is **not sent anywhere else**: it travels in the same body and becomes
`documento.resumen.pagos`.

| Case | Send | `resumen.pagos` |
| --- | --- | --- |
| Cash, one method (01, 03, 11, 14) | `formaPago` (CAT-017); default `"01"`, `"05"` on 11 | one row, `montoPago` = total to pay |
| Cash, several methods (01, 03, 11, 14) | `pagos[]` (staging / `@facta-dte/api@next` only for now), **no** `formaPago`; sum of `montoPago` = total to pay, to the cent | your rows (`plazo`/`periodo` null) |
| Credit (`condicionOperacion: 2`) | `formaPago` + `plazo` + `periodo`; **never** `pagos` | one row, total + `plazo` + `periodo` |
| 05 / 06 | nothing (no `resumen.pagos` in the schema); `formaPago` is ignored. 06: `numPagoElectronico` | does not exist |

`montoPago` is the total to pay (after withholdings and perception). Example
result for a $25.00 cash sale with `formaPago: "05"`:
`"pagos": [{ "codigo": "05", "montoPago": 25, "referencia": null, "plazo": null, "periodo": null }]`;
on credit the same row carries `"plazo": "01", "periodo": 30`.
CAT-017: 01 billetes y monedas, 02 débito, 03 crédito, 04 cheque, 05
transferencia, 08 dinero electrónico, 09 monedero electrónico, 11 bitcoin, 12
otras criptomonedas, 13 cuentas por pagar del receptor, **14 giro bancario**
(not gift vouchers), 99 otros. On staging, `pagos` on a credit sale is `422
validation_failed` (nothing spent): never "send the payment another way", drop
`pagos` and use `formaPago` + `plazo` + `periodo`. Full guide:
[guides/payments-export-renta.md](../../../guides/payments-export-renta.md).

### Line items (`LineItem`)

```ts
{ descripcion?: string; cantidad: number; precioUni?: number; productId?: string;
  codigo?: string | null; tipoItem?: 1 | 2 | 3 | 4; uniMedida?: number;
  numeroDocumento?: string }
```

- Either describe the line (`descripcion` + `precioUni`) or reference a catalog
  product with `productId` (then those fields complete from the catalog; explicit
  ones win). See [catalog.md](catalog.md).
- `cantidad` > 0 and `precioUni` ≥ 0, up to 8 decimals; they are signed as given.
- `tipoItem`: 1 bien, 2 servicio, 3 ambos, 4 otro (default 2). `uniMedida`:
  59 = unidad (default).
- With a catalog price whose `vat_included` basis does not match the document
  type you get `400` (`reason: catalog_vat_basis`) — send `precioUni` explicitly.
- On notes with several related documents, `numeroDocumento` says which one each
  line belongs to (required as soon as there is more than one).

### VAT classes, withholdings and perception

Per-line `tipoVenta` (`gravada` default | `exenta` | `no_sujeta`; 01/03/05/06
only) and the booleans `aplicarRetencionIva` (01, 03; 1 % retained by the
receiver), `aplicarPercepcionIva` (03; 1 %, goods lines only) and
`aplicarReteRenta` (14) are typed from `0.6.0-next.3`; on `0.5.x` the types
do not declare the first three, so use a direct HTTP call for them. Sending a type's own field on another type is `400`.

### Income-tax withholding (14), exactly as it works today

`aplicarReteRenta` is optional: omitted or `false` = no withholding (`reteRenta` 0);
`true` applies the **current** income-tax rate (10 % today, art. 156 CT) to the
**whole subtotal after per-line discounts** (`montoDescu`; no global discount on
14). It does not select lines by `tipoItem`: goods used as inputs of a service
stay in the base (materials $100 + labour $50 → subtotal $150 → withholding $15,
total $135). A goods-only purchase is not automatically subject just because it
has no VAT. A partial base (goods purchase independent of a service in the same
document) is **not supported** and pending confirmation. Read it in
`documento.resumen.reteRenta` and `totales.reteRenta` (also `ivaRete` on 01/03 and
`ivaPerci` on 03 when present). With an `exenta` or `no_sujeta` line it is
`422 retention_mixed_class_unsupported`.

### Exports (11): what Hacienda requires

For **goods** (`tipoItemExpor` 1 or 3) Hacienda requires `exportacion.tipoRegimen`
(CAT-033: `EX-1` definitive, `EX-2` temporary, `EX-3` re-export, `TA-1` transit),
`regimen` (CAT-028: `"1000.000"` or composite `"EX-1.1000.000"`; `"EX-1"` alone is
refused) and `recintoFiscal` (CAT-027: one specific customs office/free zone, e.g.
`"02"` Marítima de Acajutla, `"03"` Aérea de Comalapa, `"01"` Terrestre San
Bartolo) even though its schema marks them optional. **Facta does not enforce
this yet** (it validates them only when present), so a goods export without them
is signed and Hacienda rejects it. Always send all three for goods:

```ts
exportacion: { tipoItemExpor: 1, incoterms: "09", recintoFiscal: "02",
               tipoRegimen: "EX-1", regimen: "1000.000", flete: 150, seguro: 20 }
```

## Examples (from `examples/dte-types.ts`)

```ts
import type { DteRequest } from "@facta-dte/api";

// 01 — Factura, anonymous consumer
const fe: DteRequest = { tipoDte: "01", items: [{ descripcion: "Coffee", cantidad: 2, precioUni: 1.5 }] };

// 01 — named consumer (e-mail is what delivery uses)
const feNamed: DteRequest = {
  tipoDte: "01",
  receptor: { nombre: "Ana López", correo: "ana@example.com" },
  items: [{ descripcion: "Coffee", cantidad: 2, precioUni: 1.5 }],
};

// 03 — Crédito fiscal: the receiver is a registered taxpayer
const ccf: DteRequest = {
  tipoDte: "03",
  receptor: {
    nombre: "Comercial de Prueba, S.A. de C.V.",
    tipoDocumento: "36",              // CAT-022: 36 NIT, 13 DUI
    numDocumento: "06140000000001",   // digits only: NIT 14, DUI 9
    nrc: "1234567",
    codActividad: "46510",
    descActividad: "Venta al por mayor de equipo",
    direccion: { departamento: "06", municipio: "20", complemento: "Colonia Centro, San Miguel" },
    correo: "compras@example.com",
  },
  items: [{ descripcion: "Servicio de instalación", cantidad: 1, precioUni: 25 }], // price WITHOUT VAT
};

// 05 / 06 — notes adjust a SEALED document. Short form: just its codigoGeneracion
// (the API reads type and date from your company's index). Full form for documents
// not in Facta's index: { tipoDocumento, numeroDocumento, fechaEmision, tipoGeneracion? }.
const nc: DteRequest = {
  tipoDte: "05",
  documentosRelacionados: [{ codigoGeneracion: "REPLACE-WITH-A-SEALED-DOCUMENT-OF-THIS-COMPANY" }],
  receptor: { nombre: "Comercial de Prueba, S.A. de C.V.", tipoDocumento: "36", numDocumento: "06140000000001" },
  items: [{ descripcion: "Returned printer", cantidad: 1, precioUni: 125 }],
};
// 06 adds the optional numPagoElectronico: "POS-2048".

// 11 — Exportación: foreign receiver, exportacion block, no VAT
const fex: DteRequest = {
  tipoDte: "11",
  receptor: {
    nombre: "Overseas buyer LLC", numDocumento: "US-998877",
    codPais: "US", nombrePais: "United States", complemento: "Miami, Florida",
    tipoPersona: 2,                   // 1 natural, 2 jurídica
    descActividad: "Import and distribution", correo: "buyer@example.com",
  },
  // 1 goods, 2 services, 3 both; incoterms = CAT-031 CODE only ("01".."11").
  // Goods: Hacienda also requires recintoFiscal, tipoRegimen and regimen (see "Exports" above).
  exportacion: { tipoItemExpor: 1, incoterms: "09", recintoFiscal: "02", tipoRegimen: "EX-1", regimen: "1000.000" },
  items: [{ descripcion: "Coffee beans", cantidad: 10, precioUni: 15 }],
};

// 14 — Sujeto excluido: the receptor is the SELLER; address is mandatory
const fse: DteRequest = {
  tipoDte: "14",
  receptor: {
    numDocumento: "012345678", tipoDocumento: "13", nombre: "Excluded subject",
    codActividad: "47111",
    direccion: { departamento: "06", municipio: "20", complemento: "Downtown, San Miguel" },
  },
  aplicarReteRenta: false, // income-tax withholding at the current rate (10 % today) on the whole subtotal; never automatic, you ask for it
  items: [{ descripcion: "Local service", cantidad: 1, precioUni: 50 }],
};
```

Receiver requirements recap:

- **01**: nothing required. A named receiver may carry `nombre`, `correo`, etc.
- **03 / 05 / 06**: a registered taxpayer: name, document type and number, `nrc`,
  activity (`codActividad`, `descActividad`), address with department and
  municipality codes (`direccion`), `correo`. Hacienda validates the NIT: a wrong
  one is `mh_rejected` (and spends a number). A `customerId` can stand in for the
  fields (see catalog.md).
- **11**: `nombre`, `numDocumento`, `codPais` (2 letters, CAT-020),
  `nombrePais`, `complemento` (free-text address), `tipoPersona` (1|2),
  `descActividad` (5–150 chars), `correo`. `tipoDocumento` defaults to `"37"`.
- **14**: `numDocumento`, `nombre`, `direccion`. A DUI is 9 digits.
- Identity numbers: digits only (DUI 9, NIT 14). The SDK checks the same rules
  before sending for catalog writes; for issuing, Hacienda's schema is the judge
  (`validation_failed`, no number spent).

## The result

```ts
if (result.estado === "sellado") {
  result.codigoGeneracion; result.numeroControl; result.selloRecibido;
  result.totales;               // server-computed; never recompute
  result.archivoDte;            // string | undefined: the file for the receiver
  result.archivoJson;           // stored original — archive this verbatim
  result.representacionGrafica; // PDF, base64
  result.storage;               // managed-copy receipt (JSON / PDF states)
  result.entrega;               // only if you marked channels: { token, venceEn, canales }
  result.advertencias;          // server warnings, e.g. destinations_stale, sin_almacenamiento_duradero
} else {
  result.detalle;               // "contingencia": see contingency-invalidation-return.md
}
```

Archive `jws` / `archivoJson` exactly as returned. Re-serializing `documento`
does not reproduce the bytes Hacienda validated.

## Prepare, review, then sign (only when someone must approve first)

```ts
const preparer = new Facta({ apiKey });                       // no signKey needed
const signer = new Facta({ apiKey, signKey });
const prepared = await preparer.prepare(request, { idempotencyKey: `po-77:prepare` });
// show prepared.totales and prepared.documento to the reviewer — do not edit them
const result = await signer.sign(prepared, { idempotencyKey: `po-77:sign` }); // within 15 minutes
```

- `prepare` **reserves a control number**. A `prepare` that is never signed leaves
  a reserved number to account for. Do not prepare speculatively.
- Pass the `PreparedDte` to `sign` **unchanged** (`prepareToken` is a MAC over the
  canonical document; it expires after **15 minutes**). To change anything,
  prepare again.
- **Two distinct idempotency keys.** Keys are scoped per API key, not per route;
  reusing the `prepare` key on `sign` is `422 idempotency_key_reuse` and nothing
  is signed.
- `prepare_token_invalid` (422): expired, another API key, or the document
  changed → prepare again.
- If no one needs to review, use `issue`: it spends no number on documents nobody
  signs.

## Rejection and spent numbers

`mh_rejected` (422): Hacienda read the document and refused it. The number **was
spent**; `error.spent` is `{ codigoGeneracion, numeroControl }` and
`error.mhObservations` is Hacienda's text verbatim. Replaying the same key returns
the same rejection. A corrected document is a different body, so it needs a new
key; store `error.spent` with your order for reconciliation. Never "fix" a
rejection by reusing the old key with new data (`idempotency_key_reuse`).

`validation_failed` and `retention_mixed_class_unsupported` (422) and
`invalid_request` (400) spend nothing.
