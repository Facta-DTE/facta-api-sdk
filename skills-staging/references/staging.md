# Staging: lo que hay ahora y lo que viene

Para quien prueba con TypeScript en **staging** (`@facta-dte/api@next`, API base
`https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1`, llave `facta_test_`, ambiente
`00`). Cada punto de las dos listas se comprobó contra el contrato publicado
(https://staging.factadte.com/api/openapi.yaml) y contra el SDK `0.6.0-next.3`.

## Disponible ahora en staging

- **Descuento por línea: `items[].montoDescu`.** Dinero, no porcentaje, en la misma
  base de IVA que `precioUni` (con IVA en la factura 01, sin IVA en 03/05/06/11, el precio
  tal cual en 14). Entre 0 y `cantidad × precioUni`; fuera de rango es `400`. El resumen
  trae `totalDescu`. Tipado en el SDK: `LineItem.montoDescu`.
- **Varias formas de pago: `pagos[]`** (01, 03, 11, 14). De 1 a 10 filas
  `{ codigo, montoPago, referencia? }`; la suma de `montoPago` debe igualar el total a pagar
  **al centavo** (si no, `422 validation_failed` con `details.totalPagar` y
  `details.sumaPagos`, sin gastar correlativo). No se manda junto a `formaPago` (`400`) ni en
  05/06 (`400`). Tipado: `Pago`, `DteRequest.pagos` (el compilador lo rechaza en 05/06).
- **Códigos de catálogo verificados antes de reservar el correlativo.** Un código fuera del
  catálogo es `422 validation_failed` con `details.field`, `details.catalog` y
  `details.supported`: `formaPago` (CAT-017), `exportacion.recintoFiscal` (CAT-027),
  `exportacion.regimen` (CAT-028, o la forma compuesta `<CAT-033>.<CAT-028>`) y
  `exportacion.tipoRegimen` (CAT-033).
- **Advertencia de campos desconocidos.** Un campo que Facta DTE no conoce (por ejemplo
  `descuento` en lugar de `montoDescu`) **no rechaza la petición**: se ignora, no forma parte
  del documento, y la respuesta sellada trae `advertencias` con `codigo: "campo_desconocido"`,
  `campo` (el camino exacto) y, si es obvio, `sugerencia`; además la cabecera
  `Facta-Warning: campo_desconocido; campos=N`. En el SDK: `result.unknownFields` y
  `result.factaWarning` (solo aparecen cuando hay algo), y los ayudantes `unknownFieldWarnings`
  y `parseFactaWarning`. **Revise la primera respuesta de su integración**: un campo ignorado
  es un descuento, un pago o un régimen que el documento no lleva. Si la petición falla por
  otra razón, las advertencias vienen en `error.details.advertencias`.
- **Los campos desconocidos son siempre una advertencia, nunca un error.** Es una regla fija,
  hoy y en adelante: Facta DTE ignora el campo que no conoce y lo informa con
  `campo_desconocido`; no hay ni habrá un rechazo `400` por eso. Dentro de `entrega`,
  `apendice` y `representacion` un campo de más ya es `400` (esos tres objetos son estrictos).
- **Tratamiento del IVA por línea: `items[].tipoVenta`** (`gravada` por omisión, `exenta`,
  `no_sujeta`). Lo elige usted; Facta no lo deduce. Vale en 01, 03, 05 y 06; en 11 y 14 es
  `422 validation_failed`. Tipado: `LineItem.tipoVenta`.
- **Retención y percepción de IVA del 1 %.** `aplicarRetencionIva` (01 y 03) y
  `aplicarPercepcionIva` (solo 03, sobre las líneas de bienes) son booleanos que usted pide;
  nunca son automáticos y en otro tipo son `400`. Tipados en `DteRequest`: el compilador los
  rechaza en los demás tipos.
- **SDK de PHP.** `v0.2.0-rc.2` incluye `montoDescu`, `pagos` / `Pago`, `tipoVenta`,
  `aplicarRetencionIva` / `aplicarPercepcionIva` y las advertencias `campo_desconocido`
  (`facta-dte/api` en Packagist, pre-lanzamiento).
- **Apuntar el cliente a staging.** `baseUrl: FACTA_STAGING_BASE_URL` (exportado por el SDK) y
  `expectedEnvironment: "00"`.
- **Ya estaban en `0.6.0-next.1`:** el servidor resuelve `customerId` / `productId` (sin
  `syncCatalog`), borradores (`createDraft`…`issueDraft`), administración de webhooks y su
  verificador, `listCatalogChanges`. Vea el CHANGELOG del paquete.

```ts
const result = await facta.issue({
  tipoDte: "01",
  items: [{ descripcion: "Café", cantidad: 2, precioUni: 30, montoDescu: 5 }], // total 55
  pagos: [{ codigo: "01", montoPago: 25 }, { codigo: "02", montoPago: 30, referencia: "VOUCHER-0042" }],
}, { idempotencyKey: `order-${order.id}` });
if (result.estado === "sellado" && result.unknownFields) {
  console.warn("Facta ignoró estos campos:", result.unknownFields);
}
```

## En la próxima versión

Nada de esto existe hoy en staging; no escriba código que lo suponga. (Los campos desconocidos no están en esta lista: son advertencia para siempre.)

- **Descuento global o por porcentaje.** Hoy solo hay `montoDescu` por línea, en dinero; el
  contrato dice que el descuento global no existe todavía en el cable.
- **Retención de renta.** `aplicarReteRenta` existe solo en el sujeto excluido (14), al 10 %
  fijo (art. 156 CT), y es un booleano: no admite otras tasas ni vale en 01/03 (es `400`, por
  campo propio de otro tipo). Con líneas `exenta` o `no_sujeta` es
  `422 retention_mixed_class_unsupported`.
- **`pagos[]` en una operación a crédito.** Con `condicionOperacion` 2 se rechaza (`422`):
  Hacienda no publica cómo se reparte el plazo entre varias formas de pago. A crédito use
  `formaPago` con `plazo` y `periodo`. Con `condicionOperacion` 3 sí se admite.
- **Advertencias en el buzón de borradores.** `POST/PUT /v1/drafts` todavía no avisa de campos
  desconocidos (los descarta del borrador sin decirlo). Emitir (`POST /v1/dte`), preparar
  (`/v1/dte/prepare`) y emitir un borrador sí avisan.

## Si algo no coincide

Compare con https://staging.factadte.com/api/openapi.yaml: es la fuente. Si el contrato y
esta lista difieren, el contrato manda; avise a soporte con el `Idempotency-Key` de la
petición.
