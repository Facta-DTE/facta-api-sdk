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

## Descuento global (`descuentoGlobal`)

Un descuento para toda la venta, como lo escribe la aplicación de Facta, en 01, 03, 11 y 14:

```ts
const status = await facta.status();
if (status.capabilities?.descuentoGlobal !== true) throw new Error("Esta API todavía no lee descuentoGlobal.");

await facta.issue({
  tipoDte: "01",
  items: [{ descripcion: "Café", cantidad: 10, precioUni: 2 }],
  descuentoGlobal: { modo: "porcentaje", valor: 10 }, // o { modo: "monto", valor: 12.5 }
}, { idempotencyKey: "pedido-81" });
```

- `modo` es obligatorio: `"porcentaje"` (puntos, 10 = 10 %, como máximo 100) o `"monto"` (dólares). `valor` es mayor que cero y lleva como máximo dos decimales.
- Se aplica **después** de los descuentos por línea (`montoDescu`). Un `monto` va en la **misma base de IVA que `precioUni`** de ese tipo: con IVA en el 01, sin IVA en el 03 y el 11.
- Facta lo reparte: un porcentaje se aplica a cada tipo de venta (gravada, exenta, no sujeta) y queda en `resumen.porcentajeDescuento`; un monto se reparte en proporción entre los tipos y cuadra al centavo. En el 11 todo cae en `descuGravada`; en el 14, en `resumen.descu`.
- Todo lo que sigue se calcula ya descontado: IVA, `aplicarRetencionIva`, `aplicarPercepcionIva`, `aplicarReteRenta`, `totalPagar` y la suma que tiene que dar `pagos[]`. El resultado se lee en `resumen.descuNoSuj` / `descuExenta` / `descuGravada` (o `descu` en el 14) y `totales.totalDescu`.
- Más que el subtotal es `400 invalid_request` con `details.field: "descuentoGlobal"` y `details.subtotal`; un `modo` mal escrito, un `valor` fuera de rango u otra clave dentro del objeto es `400` sobre ese campo. En una nota de crédito (05) o de débito (06) es `400 global_discount_not_supported`: los montos de una nota salen del documento que corrige. Ninguno de estos rechazos gasta número. `null` es lo mismo que omitirlo.
- El mismo campo sirve en `prepare()`, `createDraft()` y `updateDraft()`. Sin `capabilities.descuentoGlobal`, una API anterior ignora el campo y solo lo advierte (`campo_desconocido`): revise la capacidad antes de depender de él.

## Líneas no gravadas (`noGravado`)

Un cargo o abono que no afecta la base imponible («Cargos/Abonos que no afectan la base imponible», Manual Funcional del Sistema de Transmisión v2.0 §XII) es una **línea propia** en 01, 03, 05, 06 y 11. El caso típico es la cuota de un préstamo: el interés es una venta (aquí exenta), el capital que se devuelve no lo es.

```ts
const status = await facta.status();
if (status.capabilities?.noGravado !== true) throw new Error("Esta API todavía no acepta líneas noGravado.");

const result = await facta.issue({
  tipoDte: "03",
  receptor: { customerId },
  items: [
    { descripcion: "Intereses de la cuota 7", cantidad: 1, precioUni: 1250, tipoItem: 2, tipoVenta: "exenta" },
    { descripcion: "Capital", noGravado: 50000, tipoItem: 2, codigo: "CAP" }, // una NonTaxedLine
  ],
}, { idempotencyKey: "prestamo-77-cuota-7" });
// result.totales.totalNoGravado === 50000, ya dentro de totalPagar.
```

- La línea es `{ descripcion, noGravado, tipoItem, codigo? }` (`NonTaxedLine`). `noGravado` > 0 es un cargo (suma al total a pagar), < 0 un abono (resta); nunca 0, con 8 decimales como máximo. `tipoItem` (1 bien, 2 servicio, 3 ambos) es **obligatorio**: Facta no lo elige por usted.
- Facta la escribe como dice el Manual (cantidad 1, `uniMedida` 99, `precioUni` 0, todas las ventas y tributos en 0) y la suma **solo** a `resumen.totalNoGravado` y a `totalPagar`. El IVA, el subtotal, `montoTotalOperacion`, los descuentos por línea y global, y las bases de `aplicarRetencionIva` / `aplicarPercepcionIva` no se mueven. `pagos[]` tiene que sumar el nuevo `totalPagar`.
- No lleva `cantidad`, `precioUni`, `montoDescu`, `tipoVenta` ni `productId`: los tipos los rechazan, y el servidor también (`400 invalid_request` con el campo). `uniMedida` puede omitirse; si va, tiene que ser 99.
- El documento necesita al menos una línea de venta (gravada, exenta o no sujeta) mayor que cero: `400 non_taxed_requires_sale_line`. En el 14 (FSE) es `400 non_taxed_not_supported`. El SDK revisa las dos cosas antes de enviar (un `FactaError` con ese código, status 0, `details.local: true`), así que no se reserva nada. Los abonos que dejan el total por debajo de cero son `400 non_taxed_total_negative`, del servidor. Ninguno gasta número.
- **Exportaciones (11):** todo bien o servicio que usted vende es una línea de venta, gravada al 0 %. Solo un cargo que **no** es venta, como reembolsar un courier pagado por cuenta del comprador, va como `noGravado`:

```ts
items: [
  { descripcion: "Desarrollo de software, octubre", cantidad: 1, precioUni: 4800, tipoItem: 2 },
  { descripcion: "Reembolso de gastos de courier", noGravado: 35.4, tipoItem: 2 },
],
```

- Las notas de crédito (05) y de débito (06) también admiten sus propias líneas no gravadas. La misma línea sirve en `prepare()`, `issueAndArchive()`, `createDraft()`, `updateDraft()` e `issueDraft()`. Ejemplo completo: [`examples/non-taxed-lines.ts`](../examples/non-taxed-lines.ts).

## Retención de renta (14)

`aplicarReteRenta` (solo en el tipo 14) es opcional: omitida o `false` no retiene (`reteRenta` vale `0`); `true` aplica la tasa **vigente** de renta (hoy 10 %, art. 156 del Código Tributario) sobre **todo el subtotal después de los descuentos** (`montoDescu` por línea y `descuentoGlobal`, que en el tipo 14 queda en `resumen.descu`). Qué significa:

- **No** selecciona líneas según `tipoItem`. Si un servicio incluye bienes como insumos, esos materiales forman parte de la operación y quedan dentro del subtotal. Ejemplo: materiales de $100 más mano de obra de $50 dan un subtotal de $150; al 10 % la retención es $15 y el total a pagar es $135.
- Se resta del total a pagar: `totalPagar = subTotal − reteRenta`.
- Una compra solo de bienes no queda sujeta automáticamente por no llevar IVA; no presente el art. 156 como regla automática para toda compra a una persona natural.
- Una **base parcial** (retener solo el servicio cuando un mismo documento reúne una compra de bienes independiente y un servicio) **no está soportada** y sigue pendiente de confirmación.
- `tipoVenta: "exenta"` o `"no_sujeta"` junto con `aplicarReteRenta: true` es `422 retention_mixed_class_unsupported`, antes de gastar correlativo.
- El monto se lee en `result.documento.resumen.reteRenta` y en `result.totales.reteRenta`.

## Qué trae `totales`

`result.totales` lleva los totales que calculó el servidor (`totalGravada`, `totalIva`, `totalPagar`, …). Con el lanzamiento a staging que acompaña esta guía también lleva, solo cuando el `resumen` del documento tiene el campo: `reteRenta` (14), `ivaRete` (01, 03), `ivaPerci` (03) y `totalNoGravado` (01, 03, 05, 06, 11). Ya están dentro de `totalPagar`. Contra un servidor anterior las claves simplemente no aparecen.
