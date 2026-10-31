# Pago, exportaciones y retención de renta

[English guide](payments-export-renta.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

Tres cosas que más se confunden al emitir con `issue()`: cómo se informa el pago, qué exige Hacienda en una exportación y qué hace realmente la retención de renta. Todo esto es el cuerpo de `POST /v1/dte`; no hay una segunda llamada para el pago.

## Cómo se informa el pago

El pago no se manda a otro lado: viaja en el mismo cuerpo y Facta lo convierte en `documento.resumen.pagos`.

| Caso | Qué mandar | Qué queda en `resumen.pagos` |
| --- | --- | --- |
| Contado, un medio (01, 03, 11, 14) | `formaPago`; sin él, `"01"` (`"05"` en la 11) | una fila, `montoPago` = total a pagar |
| Contado, varios medios (01, 03, 11, 14) | `pagos[]` y **no** `formaPago`; los `montoPago` suman el total a pagar | sus filas, tal cual |
| Crédito (`condicionOperacion: 2`) | `formaPago` + `plazo` + `periodo`; **nunca** `pagos` | una fila con el total, `plazo` y `periodo` |
| Nota de crédito (05) / de débito (06) | nada: no liquidan y su esquema oficial no tiene `resumen.pagos`. `formaPago` se ignora, `pagos` es `400` (y error de tipos). La 06 puede llevar `numPagoElectronico` | el campo no existe |

`montoPago` es siempre el **total a pagar** (`resumen.totalPagar`), es decir, ya con retenciones y percepción.

`formaPago` es un código de CAT-017: `01` billetes y monedas, `02` tarjeta de débito, `03` tarjeta de crédito, `04` cheque, `05` transferencia o depósito bancario, `08` dinero electrónico, `09` monedero electrónico, `11` bitcoin, `12` otras criptomonedas, `13` cuentas por pagar del receptor, `14` giro bancario, `99` otros. Cualquier otro valor es `422 validation_failed` antes de gastar correlativo.

Un solo medio:

```ts
const fe = await facta.issue({
  tipoDte: "01",
  formaPago: "05",
  items: [{ descripcion: "Café", cantidad: 1, precioUni: 25 }],
}, { idempotencyKey: "order-1" });
// fe.documento.resumen.pagos
// [{ codigo: "05", montoPago: 25, referencia: null, plazo: null, periodo: null }]
```

Varios medios (`pagos` reemplaza a `formaPago`; la suma debe igualar el total al centavo, si no `422 validation_failed` con `details.totalPagar` y `details.sumaPagos`):

```ts
await facta.issue({
  tipoDte: "01",
  items: [{ descripcion: "Café", cantidad: 2, precioUni: 50 }],
  pagos: [
    { codigo: "01", montoPago: 40 },
    { codigo: "02", montoPago: 60, referencia: "VOUCHER-0042" },
  ],
}, { idempotencyKey: "order-2" });
// resumen.pagos: las dos filas, cada una con plazo: null y periodo: null
```

Crédito (sin `pagos`; `plazo` es `"01"` días, `"02"` meses, `"03"` años):

```ts
const credit = await facta.issue({
  tipoDte: "01",
  condicionOperacion: 2,
  formaPago: "05",
  plazo: "01",
  periodo: 30,
  items: [{ descripcion: "Café", cantidad: 1, precioUni: 25 }],
}, { idempotencyKey: "order-3" });
// resumen.pagos: [{ codigo: "05", montoPago: 25, referencia: null, plazo: "01", periodo: 30 }]
```

`pagos` junto con una venta a crédito es `422 validation_failed` y no gasta nada: Hacienda no publica cómo se reparte un plazo entre varios medios y Facta no lo adivina. Quite `pagos` y use el cuerpo de crédito de arriba. Con `condicionOperacion: 3` (otro) `pagos` sí se admite.

## Exportaciones (11)

En una exportación de **bienes** (`tipoItemExpor` 1, o 3) Hacienda exige `exportacion.tipoRegimen`, `exportacion.regimen` y `exportacion.recintoFiscal`, aunque su esquema los marque opcionales: sin ellos el documento pasa el esquema y Hacienda lo rechaza al recibirlo. **Facta todavía no lo exige**: valida esos campos solo cuando vienen, así que una exportación de bienes sin ellos se firma y se transmite (y el correlativo se gasta). Envíelos siempre en bienes; en servicios (`tipoItemExpor` 2) pueden omitirse.

- `recintoFiscal`: una **aduana o zona franca concreta**, un código de CAT-027 (por ejemplo `01` Terrestre San Bartolo, `02` Marítima de Acajutla, `03` Aérea de Comalapa, `04` Terrestre Las Chinamas, `05` Terrestre La Hachadura, `06` Terrestre Santa Ana, `07` Terrestre San Cristóbal, `08` Terrestre Anguiatú, `09` Terrestre El Amatillo, `10` Marítima La Unión, `11` Terrestre El Poy, `12` Terrestre Metalío, `31` Aérea Ilopango; las zonas francas y depósitos van del `15` al `99`). La tabla completa de CAT-027 está en la [guía de la API](https://sdk.factadte.com/guias/emitir/).
- `tipoRegimen` (CAT-033): `EX-1` exportación definitiva, `EX-2` exportación temporal, `EX-3` reexportación, `TA-1` tránsito aduanero.
- `regimen` (CAT-028): `"1000.000"` (exportación definitiva, régimen común) o la forma compuesta `"EX-1.1000.000"`. `"EX-1"` solo es un *tipo* de régimen y aquí se rechaza.

```ts
await facta.issue({
  tipoDte: "11",
  formaPago: "05",
  receptor: {
    nombre: "Acme Imports LLC", tipoDocumento: "37", numDocumento: "98-7654321",
    codPais: "US", nombrePais: "Estados Unidos", complemento: "100 Main St, Miami, FL",
    tipoPersona: 2, descActividad: "Importación de alimentos", correo: "compras@acme.example",
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
  items: [{ descripcion: "Café tostado, sacos de 69 kg", cantidad: 10, precioUni: 300 }],
}, { idempotencyKey: "export-1" });
```

## Retención de renta (14)

`aplicarReteRenta` (solo en el tipo 14) es opcional: omitida o `false` no retiene (`reteRenta` vale `0`); `true` aplica la tasa **vigente** de renta (hoy 10 %, art. 156 del Código Tributario) sobre **todo el subtotal después de los descuentos por línea** (`montoDescu`; en el tipo 14 no hay descuento global). Qué significa:

- **No** selecciona líneas según `tipoItem`. Si un servicio incluye bienes como insumos, esos materiales forman parte de la operación y quedan dentro del subtotal. Ejemplo: materiales de $100 más mano de obra de $50 dan un subtotal de $150; al 10 % la retención es $15 y el total a pagar es $135.
- Se resta del total a pagar: `totalPagar = subTotal − reteRenta`.
- Una compra solo de bienes no queda sujeta automáticamente por no llevar IVA; no presente el art. 156 como regla automática para toda compra a una persona natural.
- Una **base parcial** (retener solo el servicio cuando un mismo documento reúne una compra de bienes independiente y un servicio) **no está soportada** y sigue pendiente de confirmación.
- `tipoVenta: "exenta"` o `"no_sujeta"` junto con `aplicarReteRenta: true` es `422 retention_mixed_class_unsupported`, antes de gastar correlativo.
- El monto se lee en `result.documento.resumen.reteRenta` y en `result.totales.reteRenta`.

## Qué trae `totales`

`result.totales` lleva los totales que calculó el servidor (`totalGravada`, `totalIva`, `totalPagar`, …). Con el lanzamiento a staging que acompaña esta guía también lleva, solo cuando el `resumen` del documento tiene el campo: `reteRenta` (14), `ivaRete` (01, 03) e `ivaPerci` (03). Ya están dentro de `totalPagar`. Contra un servidor anterior las claves simplemente no aparecen.
