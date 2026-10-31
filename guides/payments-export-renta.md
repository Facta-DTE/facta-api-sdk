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

## Income-tax withholding (14)

`aplicarReteRenta` (type 14 only) is optional: omitted or `false` means no withholding (`reteRenta` is `0`); `true` applies the **current** income-tax rate (10 % today, art. 156 of the Código Tributario) to the **whole subtotal after per-line discounts** (`montoDescu`; there is no global discount on type 14). What that means:

- It does **not** select lines by `tipoItem`. If a service includes goods as inputs, those materials are part of the operation and stay inside the subtotal. Example: materials of $100 plus labour of $50 give a $150 subtotal; at 10 % the withholding is $15 and the total to pay is $135.
- It is subtracted from the total to pay: `totalPagar = subTotal − reteRenta`.
- A goods-only purchase is not automatically subject just because it carries no VAT; do not present art. 156 as an automatic rule for every purchase from a natural person.
- This is the **legacy mode**: `aplicarReteRenta` always applies to the whole subtotal. A separate explicit per-line mode is available only when the SDK's `/v1/status` response advertises `capabilities.fseIncomeWithholdingPerLine: true`. It uses `incomeWithholding: { mode: "per_line" }` and requires a boolean `applyIncomeWithholding` on every item; omit `aplicarReteRenta` entirely. The server calculates the retention from selected net line amounts after line discounts at its current rate; callers cannot choose a rate or amount. No line is selected from `tipoItem`.
- The per-line selection expresses the caller's requested calculation base; it does not establish that the purchase qualifies for withholding under tax law. It also does not bypass existing unsupported FSE sale-class restrictions.
- `tipoVenta: "exenta"` or `"no_sujeta"` together with `aplicarReteRenta: true` is `422 retention_mixed_class_unsupported`, before a number is spent.
- Read the amount in `result.documento.resumen.reteRenta` and in `result.totales.reteRenta`.

## What `totales` carries

`result.totales` holds the totals the server computed (`totalGravada`, `totalIva`, `totalPagar`, …). Since the staging release that accompanies this guide it also carries, only when the document's `resumen` has the field: `reteRenta` (14), `ivaRete` (01, 03) and `ivaPerci` (03). They are already inside `totalPagar`. Against an older server the keys are simply absent.
