# Payment, exports and income-tax withholding

[Spanish guide](payments-export-renta.es.md) · [English README](../README.md) · [Method reference](reference.md)

Three things integrators most often get wrong when issuing with `issue()`: how the payment is reported, what Hacienda requires of an export, and what the income-tax withholding really does. Everything here is about the request body of `POST /v1/dte`; there is no second call for the payment.

## How payment is reported

The payment is not sent anywhere else: it travels in the same body and Facta turns it into `documento.resumen.pagos`.

| Case | Send | What lands in `resumen.pagos` |
| --- | --- | --- |
| Cash sale, one method (01, 03, 11, 14) | `formaPago`; without it `"01"` (`"05"` on 11) | one row, `montoPago` = total to pay |
| Cash sale, several methods (01, 03, 11, 14) | `pagos[]` and **no** `formaPago`; `montoPago` values add up to the total to pay | your rows, as sent |
| Credit sale (`condicionOperacion: 2`) | `formaPago` + `plazo` + `periodo`; **never** `pagos` | one row with the total, `plazo` and `periodo` |
| Credit note (05) / debit note (06) | nothing: they settle nothing and their official schema has no `resumen.pagos`. `formaPago` is ignored, `pagos` is `400` (and a type error). 06 may carry `numPagoElectronico` | the field does not exist |

`montoPago` is always the **total to pay** (`resumen.totalPagar`), that is, after withholdings and perception.

`formaPago` is a CAT-017 code: `01` billetes y monedas, `02` tarjeta de débito, `03` tarjeta de crédito, `04` cheque, `05` transferencia o depósito bancario, `08` dinero electrónico, `09` monedero electrónico, `11` bitcoin, `12` otras criptomonedas, `13` cuentas por pagar del receptor, `14` giro bancario, `99` otros. Any other value is `422 validation_failed` before a number is spent.

One method:

```ts
const fe = await facta.issue({
  tipoDte: "01",
  formaPago: "05",
  items: [{ descripcion: "Coffee", cantidad: 1, precioUni: 25 }],
}, { idempotencyKey: "order-1" });
// fe.documento.resumen.pagos
// [{ codigo: "05", montoPago: 25, referencia: null, plazo: null, periodo: null }]
```

Several methods (`pagos` replaces `formaPago`; the sum must equal the total to the cent, otherwise `422 validation_failed` with `details.totalPagar` and `details.sumaPagos`):

```ts
await facta.issue({
  tipoDte: "01",
  items: [{ descripcion: "Coffee", cantidad: 2, precioUni: 50 }],
  pagos: [
    { codigo: "01", montoPago: 40 },
    { codigo: "02", montoPago: 60, referencia: "VOUCHER-0042" },
  ],
}, { idempotencyKey: "order-2" });
// resumen.pagos: both rows, each with plazo: null and periodo: null
```

Credit (no `pagos`; `plazo` is `"01"` days, `"02"` months, `"03"` years):

```ts
const credit = await facta.issue({
  tipoDte: "01",
  condicionOperacion: 2,
  formaPago: "05",
  plazo: "01",
  periodo: 30,
  items: [{ descripcion: "Coffee", cantidad: 1, precioUni: 25 }],
}, { idempotencyKey: "order-3" });
// resumen.pagos: [{ codigo: "05", montoPago: 25, referencia: null, plazo: "01", periodo: 30 }]
```

`pagos` together with a credit sale is `422 validation_failed` and spends nothing: Hacienda does not publish how a term is split across several methods, so Facta does not guess. Remove `pagos` and use the credit body above. With `condicionOperacion: 3` (other) `pagos` is accepted.

## Exports (11)

For an export of **goods** (`tipoItemExpor` 1, or 3), Hacienda requires `exportacion.tipoRegimen`, `exportacion.regimen` and `exportacion.recintoFiscal`, even though its schema marks them optional: without them the document passes the schema and Hacienda rejects it on receipt. **Facta does not enforce this yet**: it validates those fields only when they are present, so a goods export without them is signed and transmitted (and the number is spent). Always send them for goods; for services (`tipoItemExpor` 2) they may be omitted.

- `recintoFiscal`: one **specific customs office or free zone**, a CAT-027 code (for example `01` Terrestre San Bartolo, `02` Marítima de Acajutla, `03` Aérea de Comalapa, `04` Terrestre Las Chinamas, `05` Terrestre La Hachadura, `06` Terrestre Santa Ana, `07` Terrestre San Cristóbal, `08` Terrestre Anguiatú, `09` Terrestre El Amatillo, `10` Marítima La Unión, `11` Terrestre El Poy, `12` Terrestre Metalío, `31` Aérea Ilopango; the free zones and bonded warehouses run from `15` to `99`). The full CAT-027 table is in the [API guide](https://sdk.factadte.com/guias/emitir/).
- `tipoRegimen` (CAT-033): `EX-1` definitive export, `EX-2` temporary export, `EX-3` re-export, `TA-1` customs transit.
- `regimen` (CAT-028): `"1000.000"` (definitive export, common regime) or the composite `"EX-1.1000.000"`. `"EX-1"` alone is a regime *type* and is refused here.

```ts
await facta.issue({
  tipoDte: "11",
  formaPago: "05",
  receptor: {
    nombre: "Acme Imports LLC", tipoDocumento: "37", numDocumento: "98-7654321",
    codPais: "US", nombrePais: "Estados Unidos", complemento: "100 Main St, Miami, FL",
    tipoPersona: 2, descActividad: "Food import", correo: "buying@acme.example",
  },
  exportacion: {
    tipoItemExpor: 1,
    incoterms: "09",
    recintoFiscal: "02",
    tipoRegimen: "EX-1",
    regimen: "1000.000",
    flete: 150,
    seguro: 20,
  },
  items: [{ descripcion: "Roasted coffee, 69 kg sacks", cantidad: 10, precioUni: 300 }],
}, { idempotencyKey: "export-1" });
```

## Global discount (`descuentoGlobal`)

One discount for the whole sale, the way the Facta app writes it, on 01, 03, 11 and 14:

```ts
const status = await facta.status();
if (status.capabilities?.descuentoGlobal !== true) throw new Error("This API does not read descuentoGlobal yet.");

await facta.issue({
  tipoDte: "01",
  items: [{ descripcion: "Café", cantidad: 10, precioUni: 2 }],
  descuentoGlobal: { modo: "porcentaje", valor: 10 }, // or { modo: "monto", valor: 12.5 }
}, { idempotencyKey: "order-81" });
```

- `modo` is required: `"porcentaje"` (points, 10 = 10 %, at most 100) or `"monto"` (dollars). `valor` is greater than zero with at most two decimals.
- It applies **after** the line discounts (`montoDescu`). A `monto` is in the **same VAT basis as `precioUni`** of that type: VAT included on 01, excluded on 03 and 11.
- Facta allocates it: a percentage goes on every sale class (gravada, exenta, no sujeta) and is written to `resumen.porcentajeDescuento`; an amount is split in proportion over the classes and adds up to the cent. On 11 it all goes to `descuGravada`; on 14 to `resumen.descu`.
- Everything after it is computed on the discounted amounts: VAT, `aplicarRetencionIva`, `aplicarPercepcionIva`, `aplicarReteRenta`, `totalPagar`, and the sum `pagos[]` must match. Read the result in `resumen.descuNoSuj` / `descuExenta` / `descuGravada` (or `descu` on 14) and `totales.totalDescu`.
- More than the subtotal is `400 invalid_request` with `details.field: "descuentoGlobal"` and `details.subtotal`; a bad `modo`, an out-of-range `valor` or another key inside the object is `400` on that field. On a credit (05) or debit (06) note it is `400 global_discount_not_supported`: a note's amounts come from the document it corrects. None of these spends a number. `null` is the same as leaving it out.
- The same field works in `prepare()`, `createDraft()` and `updateDraft()`. Without `capabilities.descuentoGlobal` an older API ignores the field and only warns about it (`campo_desconocido`), so check the capability before relying on it.

## Non-taxed lines (`noGravado`)

A charge or credit that does not affect the tax base («Cargos/Abonos que no afectan la base imponible», Manual Funcional del Sistema de Transmisión v2.0 §XII) is its **own line** on 01, 03, 05, 06 and 11. A loan instalment is the usual case: the interest is a sale (exempt here), the repaid capital is not.

```ts
const status = await facta.status();
if (status.capabilities?.noGravado !== true) throw new Error("This API does not accept noGravado lines yet.");

const result = await facta.issue({
  tipoDte: "03",
  receptor: { customerId },
  items: [
    { descripcion: "Intereses de la cuota 7", cantidad: 1, precioUni: 1250, tipoItem: 2, tipoVenta: "exenta" },
    { descripcion: "Capital", noGravado: 50000, tipoItem: 2, codigo: "CAP" }, // a NonTaxedLine
  ],
}, { idempotencyKey: "loan-77-instalment-7" });
// result.totales.totalNoGravado === 50000, already inside totalPagar.
```

- The line is `{ descripcion, noGravado, tipoItem, codigo? }` (`NonTaxedLine`). `noGravado` > 0 is a charge (adds to the total to pay), < 0 a credit (subtracts); never 0, at most 8 decimals. `tipoItem` (1 bien, 2 servicio, 3 ambos) is **required**: Facta never picks it for you.
- Facta writes it as the Manual says (cantidad 1, `uniMedida` 99, `precioUni` 0, every sale column and tax 0) and adds it **only** to `resumen.totalNoGravado` and `totalPagar`. VAT, subtotal, `montoTotalOperacion`, line and global discounts, and the bases of `aplicarRetencionIva` / `aplicarPercepcionIva` do not move. `pagos[]` must add up to the new `totalPagar`.
- It cannot carry `cantidad`, `precioUni`, `montoDescu`, `tipoVenta` or `productId`: the types refuse them, and so does the server (`400 invalid_request` naming the field). `uniMedida` may be left out; if sent it must be 99.
- The document needs at least one sale line (gravada, exenta or no sujeta) above zero: `400 non_taxed_requires_sale_line`. On 14 (FSE) it is `400 non_taxed_not_supported`. The SDK checks both before sending (a `FactaError` with that code, status 0, `details.local: true`), so nothing is reserved. Credits that leave the total below zero are `400 non_taxed_total_negative` from the server. None of these spends a number.
- **Exports (11):** every good or service you sell is a sale line, taxed at 0 %. Only a charge that is **not** a sale, such as reimbursing a courier cost paid for the buyer, goes as `noGravado`:

```ts
items: [
  { descripcion: "Software development, October", cantidad: 1, precioUni: 4800, tipoItem: 2 },
  { descripcion: "Reembolso de gastos de courier", noGravado: 35.4, tipoItem: 2 },
],
```

- Credit (05) and debit (06) notes accept their own non-taxed lines too. The same line works in `prepare()`, `issueAndArchive()`, `createDraft()`, `updateDraft()` and `issueDraft()`. Full example: [`examples/non-taxed-lines.ts`](../examples/non-taxed-lines.ts).

## Income-tax withholding (14)

`aplicarReteRenta` (type 14 only) is optional: omitted or `false` means no withholding (`reteRenta` is `0`); `true` applies the **current** income-tax rate (10 % today, art. 156 of the Código Tributario) to the **whole subtotal after discounts** (per-line `montoDescu` and `descuentoGlobal`, which lands in `resumen.descu` on type 14). What that means:

- It does **not** select lines by `tipoItem`. If a service includes goods as inputs, those materials are part of the operation and stay inside the subtotal. Example: materials of $100 plus labour of $50 give a $150 subtotal; at 10 % the withholding is $15 and the total to pay is $135.
- It is subtracted from the total to pay: `totalPagar = subTotal − reteRenta`.
- A goods-only purchase is not automatically subject just because it carries no VAT; do not present art. 156 as an automatic rule for every purchase from a natural person.
- A **partial base** (withholding only the service when one document joins an independent goods purchase with a service) is **not supported** and is pending confirmation.
- `tipoVenta: "exenta"` or `"no_sujeta"` together with `aplicarReteRenta: true` is `422 retention_mixed_class_unsupported`, before a number is spent.
- Read the amount in `result.documento.resumen.reteRenta` and in `result.totales.reteRenta`.

## What `totales` carries

`result.totales` holds the totals the server computed (`totalGravada`, `totalIva`, `totalPagar`, …). Since the staging release that accompanies this guide it also carries, only when the document's `resumen` has the field: `reteRenta` (14), `ivaRete` (01, 03), `ivaPerci` (03) and `totalNoGravado` (01, 03, 05, 06, 11). They are already inside `totalPagar`. Against an older server the keys are simply absent.
