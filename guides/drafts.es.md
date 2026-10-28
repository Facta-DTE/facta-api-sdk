# Borradores

[English guide](drafts.md) · [Emisión](prepare-sign.es.md) · [Errores](errors.es.md) · [README en español](../README.es.md)

Un borrador es una factura que su programa deja para que **una persona de la empresa la revise y la emita** desde la aplicación de Facta DTE. No se firma nada ni se gasta número de control hasta que alguien la emita (o usted, con `issueDraft`). El alcance es `draft`; emitir un borrador desde la API además pide `issue` y la llave de firma.

Facta valida el borrador como una emisión hasta el punto en que reservaría un número, resuelve `customerId` / `productId` en el servidor, **sella la solicitud con la llave pública de borradores de la empresa** y no guarda el texto. Lo abre en la aplicación cualquier persona que pueda emitir ese tipo de documento, no solo la titular. Vence a los 30 días; una empresa guarda como máximo 500.

```ts
const draft = await facta.createDraft(
  { tipoDte: "01", items: [{ productId: "…", cantidad: 1 }], customerId: "…", reference: "pedido-77" },
  { idempotencyKey: "pedido-77" },
);
// draft.id, draft.version, draft.totals

const page = await facta.listDrafts({ state: "pendiente", reference: "pedido-77" });
const same = await facta.getDraftByKey("pedido-77"); // del borrador a la factura sin el código de generación

// Cámbielo mientras siga pendiente y nadie lo tenga abierto:
await facta.updateDraft(draft.id, draft.version, { tipoDte: "01", items: [/* … */] });

// Emítalo usted (gasta un número de control; pide `issue` y la llave de firma):
const issued = await facta.issueDraft(draft.id, draft.version, request, { idempotencyKey: "emitir-pedido-77" });
// el resultado de `issue` más `borradorId`

await facta.cancelDraft(draft.id); // solo si está pendiente y nadie lo tiene abierto
```

| Método | Ruta | Notas |
| --- | --- | --- |
| `createDraft(input, options?)` | `POST /v1/drafts` | `input` es la solicitud de `issue` más `id` opcional (su UUID v4) y `reference` (hasta 64 caracteres, sin datos personales). Con el mismo `idempotencyKey` repetir devuelve el mismo borrador; otro contenido es `idempotency_key_reuse`. |
| `listDrafts(options?)` | `GET /v1/drafts` | Solo los de esta llave. Filtros `state`, `reference`; `limit`, `cursor`; `include: "contenido"` agrega la solicitud resuelta de cada borrador si esta llave puede abrir la clave de datos de la empresa (máximo 50 por página). |
| `getDraft(id)` / `getDraftByKey(key)` | `GET /v1/drafts/{id}`, `/by-key/{key}` | Un borrador emitido trae `generationCode`, `controlNumber`, `documentState`, `sealed`, `issuedBy`, `edited`. |
| `updateDraft(id, version, input)` | `PUT /v1/drafts/{id}` | Manda `If-Match: <version>`. Se rechaza si una persona lo tiene abierto, se está emitiendo o ya se resolvió. |
| `cancelDraft(id)` | `DELETE /v1/drafts/{id}` | Solo si está pendiente y cerrado. |
| `issueDraft(id, version, request, options?)` | `POST /v1/drafts/{id}/issue` | Una sola puerta evita la doble emisión: `draft_issuing` / `draft_claimed` (409) no gastaron nada. Un rechazo de Hacienda cuenta como emitido y el borrador no se reabre. |

## Errores que conviene atender

`drafts_not_ready` (409): la persona titular no ha abierto Facta con su vault desde que la empresa comparte su clave de datos; pídale que la abra una vez y repita. `version_mismatch` (409): lea el borrador otra vez. `draft_claimed`, `draft_issuing`, `draft_issued`, `draft_not_issuable`, `item_final` (409): el borrador está en uso o resuelto; léalo con `getDraft`. `inbox_cap_reached` (429): demasiados borradores abiertos. Ninguno se reintenta solo. Todos están en [errors.es.md](errors.es.md#borradores).

Igual que las rutas de la empresa del catálogo, los borradores rechazan una llave de producción (`facta_live_`) mientras la empresa siga en pruebas (`environment_not_allowed`, 403); una llave de pruebas siempre se permite.
