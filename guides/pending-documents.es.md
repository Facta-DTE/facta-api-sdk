# Documentos pendientes y reintento

[English](pending-documents.md)

Una emisión puede terminar sin que usted sepa si Hacienda selló el documento:
Hacienda no contestó (`202 contingencia`), se cortó su conexión, Facta respondió
`503 service_unavailable`, o la respuesta trajo la advertencia `indice_pendiente` o
`reserva_sin_asentar`. En todos esos casos hay **una sola regla**:

> **Nunca emita otra vez con una llave nueva.** Una emisión nueva es otra venta:
> otro código, otro correlativo, otro documento fiscal. Primero liste lo pendiente
> y termínelo.

## Qué significa «pendiente»

Un documento está **pendiente** cuando Facta ya lo firmó y su número de control ya
se gastó, pero Hacienda todavía no ha dicho sí o no. Existe, es suyo y se le debe a
Hacienda. Se arregla **terminándolo**, no creando otro.

## Paso 1. Liste lo pendiente

```ts
const { pendientes, siguiente } = await facta.listPendingDocuments();
// { estado: "rechazado" } lista los que Hacienda negó; { limit, cursor } paginan.

for (const doc of pendientes) {
  console.log(doc.codigoGeneracion, doc.numeroControl, doc.antiguedadSegundos, doc.reintentable);
}
```

`GET /v1/dte/pendientes` pide el alcance `query` y devuelve solo metadatos (nunca el
documento ni el receptor), del más antiguo al más nuevo. Cada fila dice si es
`reintentable`; si no, `motivoNoReintentable` explica por qué:
`documento_de_la_aplicacion` (lo emitió la aplicación; se reintenta desde
Documentos → Pendientes con Hacienda), `sin_copia_firmada` o `rechazado`.
`plazo.requiereContingencia` pasa a `true` a las 24 horas de la firma: ya no es el
camino normal de transmisión, así que declare el evento de contingencia desde la
aplicación. Facta no bloquea el reintento por eso: pregunta a Hacienda, que decide.

## Paso 2. Reintente, con la misma firma

```ts
import { FactaError } from "@facta-dte/api";

try {
  const result = await facta.retryDocument(doc.codigoGeneracion);
  if (result.estado === "sellado") {
    // result.via: "consulta" (Hacienda ya lo tenía), "retransmision" (se reenviaron
    // los mismos bytes) o "ya_asentado" (ya estaba terminado). No se emitió nada.
    // Con result.advertencias, guarde result.documento y result.jws y llame otra vez.
  } else {
    // "pendiente": Hacienda no contestó. No cambió nada. Intente más tarde.
  }
} catch (error) {
  if (error instanceof FactaError && error.isRejection) {
    // Hacienda lo negó: error.mhObservations dice por qué. El número queda registrado como rechazado.
  } else throw error;
}
```

`POST /v1/dte/{codigoGeneracion}/reintentar` pide el alcance `issue` y la llave de
firma (las credenciales de Hacienda viven en ese vault). **Nunca firma ni numera
nada**: primero le pregunta a Hacienda por el código, y reenvía exactamente los
mismos bytes solo si Hacienda nunca los recibió.

| Hacienda dice | Facta hace | Usted recibe |
| --- | --- | --- |
| «Ya lo sellé» | No reenvía nada. Completa el registro y cierra el número. | `sellado`, `via: "consulta"` |
| «No lo recibí» | Reenvía los mismos bytes. | `sellado`, `via: "retransmision"` |
| «Lo rechacé» | Registra el rechazo. | `FactaError` `mh_rejected` con las palabras de Hacienda |
| (no contesta) | No cambia nada. | `estado: "pendiente"` (HTTP 202) |

Llamarla otra vez sobre un documento sellado no hace nada (`ya_asentado`). Dos
reintentos a la vez no transmiten dos veces: el segundo recibe
`409 retry_in_progress`, que el SDK reintenta por usted tras `retryAfterSeconds`.

## Qué hacer en cada situación

| Lo que ve | Qué significa | Qué hacer |
| --- | --- | --- |
| `503 service_unavailable` (`retryAfterSeconds`) | Algo de Facta no contestó. Si dice que no se pudo dejar constancia del documento firmado, **no se envió nada a Hacienda** y el número se devolvió. | Espere y repita la **misma** petición con la **misma** `idempotencyKey`. |
| `202`, `estado: "contingencia"` al emitir | Firmado; Hacienda no contestó. | Guarde `jws` y `numeroControl`; luego `listPendingDocuments()` y `retryDocument()`. |
| Su proceso se cayó o se cortó la conexión | No sabe si llegó. | Repita la misma petición con la misma llave, o `listPendingDocuments()`. |
| `advertencias: indice_pendiente` | Sellado, pero el registro de Facta DTE no se pudo escribir. La respuesta trae `documento` y `jws`: guárdelos. | `retryDocument()` termina el registro sin reenviar. No emita otra vez. |
| `advertencias: reserva_sin_asentar` | Sellado e indexado; falta cerrar el número. | `retryDocument()`. No emita otra vez. |
| `mh_rejected` desde `retryDocument()` | Hacienda lo negó. | Corrija los datos y envíe una petición nueva que reutilice ese número (vea [idempotencia](idempotency.es.md)); reintentar el mismo documento no cambia el veredicto. |

## Las llaves son más estrictas

Desde el 30-oct-2026 una `Idempotency-Key` que produjo un documento queda atada a
esa venta para siempre. La respuesta guardada dura 7 días; después la misma llave y
cuerpo devuelven el documento que ya existe, reconstruido desde sus copias, y otro
cuerpo es siempre `422 idempotency_key_reuse`. Vea [idempotencia](idempotency.es.md).
Use una llave por venta, para siempre.

## En su sistema

Dé a cada venta cuatro estados: *sellada*, *firmada sin sello (pendiente)*,
*rechazada* y *sin emitir*. Después de cualquier emisión dudosa mire lo pendiente
**antes** de decidir nada, y nunca responda a un `503` o a una conexión cortada
inventando una llave nueva.
