# Issuing each DTE type

Sources: `src/types.ts` (`DteRequest`), `examples/dte-types.ts`,
`guides/prepare-sign.md`, `guides/node.md`, and the contract's `SolicitudDte`,
`Item` and receiver schemas.

## One method, eight types

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
| `"04"` | Nota de remisión (NRE) | excludes VAT | registered receiver, **plus `bienTitulo` (required)** | `receptor.bienTitulo`, `documentosRelacionados?` (01, 03, 11), `descuentoGlobal?`; **no payment fields** |
| `"05"` | Nota de crédito | excludes VAT | like 03 | `documentosRelacionados` (required) |
| `"06"` | Nota de débito | excludes VAT | like 03 | `documentosRelacionados` (required), `numPagoElectronico?` |
| `"07"` | Comprobante de retención (CR) | **no price**: each line is a withholding (`montoSujetoGrav`) | required: the **supplier** withheld from | `items` are retention lines; **no payment fields**; retention agents only (`retention_agent_required`) |
| `"11"` | Factura de exportación (FEX) | no VAT (rate zero) | required: foreign receiver (`ExportRecipient`) | `exportacion` (required) |
| `"14"` | Factura de sujeto excluido (FSE) | the price as is | required: the **seller** you bought from (`ExcludedSubjectRecipient`) | `aplicarReteRenta?` |

The server does not guess the VAT basis: sending a CCF price with VAT included
gives wrong totals, not an error. **15 (Comprobante de donación) is not exposed
by the API contract or the SDK**; do not offer it. 04 and 07 are described in
their own sections below. A key may be restricted to some types
(`dte_type_not_allowed`): a key minted before 04/07 existed does not carry them,
mint it again with those types ticked.

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

### Remission note (04): goods that move without a sale

**What it is for.** A Nota de remisión accompanies goods that change place or hands
**without being sold at that moment**: goods sent on consignment, a transfer
between the company's own establishments, goods on the way to a customer
before the sale is invoiced, goods left in deposit. It still carries the value of
the goods (lines and totals), but it **collects nothing**: there is no payment, no
payment condition and no due date on it. The sale, when it happens, is a 01/03/11.

**Who may issue it.** Any company allowed to issue the type (the key must carry `"04"`).

**Fields** (source: the official 04 schema and Normativa v2.0; Facta rules are marked):

| Field | Required | Notes |
| --- | --- | --- |
| `tipoDte: "04"` | yes | |
| `receptor` | yes | A stored customer (`customerId`) **or** spelled out: `nombre`, `tipoDocumento`, `numDocumento`, `codActividad` (`descActividad` is accepted too). What you spell out wins over the stored customer. The SDK types enforce this. |
| `receptor.bienTitulo` | **yes, no default** | Catalogue 025, the title under which the goods travel: `01` Depósito, `02` Propiedad, `03` Consignación, `04` Traslado, `05` Otros. It is what the document legally states, so Facta never guesses it and a stored customer does not supply it. Missing: `400 invalid_request` (`details.field: "receptor.bienTitulo"`). A code outside the catalogue: `422 validation_failed`. On any other type it is `400`. |
| `receptor.nrc`, `correo`, `direccion` | no | The official 04 schema allows them to be null. (Decision of the product owner, Nov 2026: a CCF requires the receiver's NIT, NRC, activity, address and e-mail; a 04 does not.) |
| `items` | yes | Like a CCF: `precioUni` **excludes** VAT, `cantidad`, `tipoItem`, `tipoVenta` (gravada/exenta/no_sujeta), `montoDescu`. Each line may name the document it belongs to with `numeroDocumento`. |
| `documentosRelacionados` | no | Sealed documents the goods travel with: **01, 03 or 11** only. Short form `{ codigoGeneracion }` (the server completes it from your company's index) or the full form. |
| `descuentoGlobal` | no | `{ modo: "monto" | "porcentaje", valor }`, same shape as on 01/03/11/14. Decision of the product owner (Nov 2026): the Normativa v2.0 lists the global discounts per sale class (`descuNoSuj`, `descuExenta`, `descuGravada`) as valid for FE, CCF and NRE, and the official 04 schema requires them in `resumen`; a remission settles nothing but carries the value of the goods, and that value can be discounted. |
| `observaciones` | no | |

**Not sent, and why.** `condicionOperacion`, `formaPago`, `pagos`, `plazo`, `periodo`
are not in the 04 schema. If you send them anyway they are **ignored** (never an
error), the document is issued without them and the response carries one
`advertencias` entry per field, `{ codigo: "campo_ignorado", campo, mensaje }`
(SDK: `result.ignoredFields`, `ignoredFieldWarnings(result)`). The SDK types do not
offer them. `apendice` is not accepted (`400`).

**Related documents.** A 04 may relate a sealed 01, 03 or 11. A credit or debit
note (05/06) may in turn relate a sealed 03 or 07.

```ts
const nre = await facta.issue({
  tipoDte: "04",
  receptor: {
    nombre: "Comercial Ejemplo, S.A. de C.V.", tipoDocumento: "36", numDocumento: "05110606161016",
    codActividad: "46510",
    nrc: "2513113",                       // optional on a 04
    direccion: { departamento: "06", municipio: "20", distrito: "01", complemento: "Bodega 2, San Miguel" }, // optional
    correo: "bodega@example.com",         // optional
    bienTitulo: "04",                     // required: Traslado
  },
  items: [{ descripcion: "Caja de repuestos", cantidad: 2, precioUni: 25, tipoItem: 1 }],
  descuentoGlobal: { modo: "porcentaje", valor: 10 },   // optional
}, { idempotencyKey: "transfer-0042" });

// As a draft for a person to review (nothing is signed, no number is spent):
await facta.createDraft({ /* same body */ reference: "transfer-0042" }, { idempotencyKey: "transfer-0042" });
```

### Retention receipt (07): a withholding agent's receipt

**What it is for.** A Comprobante de retención is issued by a **withholding agent
designated by Hacienda** when it buys from a smaller supplier: the agent withholds
part of the VAT on that purchase and gives the supplier this receipt, which the
supplier uses to claim the withheld amount. Lines are not products: each line says
**on how much** was withheld and **under which code**.

**Who may issue it.** Only a company marked as a retention agent. Any other company
gets `403 retention_agent_required`, refused **before** any control number is
reserved (nothing is spent). The owner turns it on in the Facta DTE app:
**Cuenta → Perfil fiscal → «agente de retención»**. Mark it only if Hacienda
designated the company as such.

**Fields:**

| Field | Required | Notes |
| --- | --- | --- |
| `tipoDte: "07"` | yes | |
| `receptor` | yes | The **supplier** the withholding is made from: a registered taxpayer (`nombre`, NIT in `numDocumento`, `nrc`, `codActividad`, `direccion`, `correo`) or a `customerId`. |
| `items` | yes, 1 to **500** | Withholding lines, below. |
| `observaciones` | no | |

Withholding line (`RetentionLine`). There is no `cantidad`, `precioUni` or `productId`:

| Field | Required | Notes |
| --- | --- | --- |
| `montoSujetoGrav` | yes | Amount the withholding is made on: greater than zero, at most **two decimals**. |
| `codigoRetencionMH` | yes | `"22"` withholding of 1 % of VAT (art. 162 Código Tributario); `"C4"` withholding of 13 %; `"C9"` other cases, with no fixed rate. Another value: `422 validation_failed`. |
| `ivaRetenido` | **only with `C9`, where it is required** | With `22` and `C4` the server derives it from the code and **sending it is `400`**. |
| `tipoDte`, `numeroDocumento`, `fechaEmision`, `tipoGeneracion` | all-or-nothing group | The document the purchase is documented by: `tipoDte` `"01"` or `"03"`, its `numeroDocumento` (generation code if electronic), `fechaEmision` `YYYY-MM-DD`, `tipoGeneracion` 1 paper / 2 electronic (default 2, only with the document). **Send all of `tipoDte`/`numeroDocumento`/`fechaEmision`, or none**: a paper purchase or a purchase from an excluded subject carries none. A partial group is refused. |
| `descripcion` | no | Free text. |

**Why `ivaRetenido` is derived for 22 and C4 (Facta rule).** The code fixes the rate
(22 = 1 %, C4 = 13 %); the law fixes the rate, not who computes it, and Facta's rule
is that a client never sends computed money (the web app works the same way).
Known limit: a difference of one cent of rounding against the supplier's own
document cannot be adjusted except through `C9`, where you state the amount.

**Ignored with `campo_ignorado`:** `condicionOperacion`, `formaPago`, `pagos`,
`plazo`, `periodo` and `descuentoGlobal`: the 07 has no settlement and no discount
(unlike the 04, which accepts `descuentoGlobal`).

**Related documents.** A credit or debit note (05/06) may relate a sealed 07.

```ts
const cr = await facta.issue({
  tipoDte: "07",
  receptor: {
    nombre: "ZD, S.A. de C.V.", tipoDocumento: "36", numDocumento: "05110606161016",
    nrc: "2513113", codActividad: "46510",
    direccion: { departamento: "06", municipio: "20", distrito: "01", complemento: "Colonia Centro, San Miguel" },
    correo: "proveedor@example.com",
  },
  items: [
    { tipoDte: "03", numeroDocumento: "1BC3E8A1-1111-4111-8111-11111111ABCD", fechaEmision: "2026-10-05",
      montoSujetoGrav: 1000, codigoRetencionMH: "22" },                    // IVA withheld derived: 1 %
    { montoSujetoGrav: 250.5, codigoRetencionMH: "C9", ivaRetenido: 2.5,   // paper purchase: no reference
      descripcion: "Compra en papel" },
  ],
}, { idempotencyKey: "retention-0099" });

await facta.createDraft({ /* same body */ reference: "retention-0099" }, { idempotencyKey: "retention-0099" });
```

**Common mistakes (04 and 07):**

| Mistake | What happens | Do this |
| --- | --- | --- |
| 04 receptor with `nrc`/`correo`/`direccion` filled "to be safe" | Harmless but unnecessary | Only `nombre`, `tipoDocumento`, `numDocumento`, `codActividad`, `bienTitulo` are required |
| 04 without `receptor.bienTitulo` | `400 invalid_request` | Always choose the title (catalogue 025) |
| `bienTitulo` outside 01 to 05, or on another type | `422` / `400` | Only 04, only codes 01 to 05 |
| `pagos`/`formaPago`/`condicionOperacion` on a 04 or 07 | Ignored, with `campo_ignorado` warnings | Leave them out |
| `descuentoGlobal` on a 07 | Ignored with a warning (it is valid on a 04) | Leave it out |
| `ivaRetenido` with `22` or `C4` | `400` | Let the server derive it; use `C9` to state it |
| `C9` without `ivaRetenido` | `400` | State the amount withheld |
| Only some of `tipoDte`/`numeroDocumento`/`fechaEmision` | Refused | All three, or none |
| `cantidad`/`precioUni` on a 07 line | Not part of the line | `montoSujetoGrav` only |
| More than 500 lines, or `montoSujetoGrav` with 3 decimals or ≤ 0 | `400`/`422` | Split the document; two decimals |
| 07 from a company that is not a retention agent | `403 retention_agent_required` | The owner enables «agente de retención» in Cuenta → Perfil fiscal, if Hacienda designated it |
| Key without `"04"`/`"07"` | `dte_type_not_allowed` | Mint a key with those types |

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

`validation_failed` and `retention_mixed_class_unsupported` (422),
`invalid_request` (400) and `retention_agent_required` (403) spend nothing.
