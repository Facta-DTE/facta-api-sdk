# Tiempos de depuración

[English guide](timings.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

Cuando una llamada es lenta, conviene saber dónde se fue el tiempo: la
autenticación, la reserva de idempotencia, abrir el vault de firma, la
respuesta de Hacienda, el PDF. Con los tiempos de depuración la API devuelve,
junto al resultado, cuánto tardó cada paso de su proceso. Es una **ayuda para
depurar**: viene apagada y no está pensada para quedarse encendida en código de
producción.

## Cómo encenderlo

Para todo el cliente, en cada llamada de esa instancia:

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  debug: { timings: true },
});
```

O para una sola llamada, con el miembro `debug` de sus opciones. El valor de la
llamada gana sobre el del cliente, así que `{ debug: { timings: false } }` apaga
para esa llamada lo que el cliente tiene encendido.

```ts
const result = await facta.issue(request, {
  idempotencyKey: order.id,
  debug: { timings: true },
});
for (const { step, ms, startedAtMs } of result.debug?.timings ?? []) {
  console.log(step.padEnd(24), ms.toFixed(1), "ms", startedAtMs === undefined ? "" : `@${startedAtMs.toFixed(1)}`);
}
console.log("total", result.debug?.totalMs, "desde", result.debug?.source);
```

Con la opción encendida el SDK envía la cabecera `X-Facta-Debug: timings`. Sin
ella la cabecera nunca se envía y la respuesta de la API no cambia.

## Qué devuelve

`result.debug` es un `DebugInfo`:

| Campo | Significado |
| --- | --- |
| `timings: DebugTiming[]` | Una entrada por paso medido: `step` (un nombre fijo), `ms` (duración) y, cuando el cuerpo lo trae, `startedAtMs` (inicio, medido desde que la petición llegó a la función). |
| `totalMs` | Desde la llegada hasta que se armó el informe. Si la fuente no lo trae, la suma de los pasos. |
| `source` | `"body"` cuando el SDK leyó el miembro `debug` del cuerpo, `"server-timing"` cuando tuvo que leer la cabecera `Server-Timing`. |

Los nombres de paso son fases como `auth`, `rate_limit_admit`,
`idempotency_claim`, `vault_open`, `jws_sign`, `mh_transmit`, `pdf_render`,
`index_write`, `managed_upload`, o llamadas a la base (`rpc.<función>`,
`db.<MÉTODO>.<tabla>`). Nunca llevan datos del documento, identificadores,
rutas ni secretos. Unas fases contienen a otras y los pasos en paralelo se
solapan, así que no sume todos los `ms`; compare `startedAtMs` para ver qué
corrió a la vez.

El SDK valida el informe porque llega de la red y no es de fiar: descarta las
entradas sin `step` de texto o sin `ms` finito y no negativo, y recorta los
nombres de paso a 80 caracteres.

## Qué llamadas informan tiempos

`DebugInfo` está tipado en `SealedDte`, `DteInContingency`, `PreparedDte`,
`DocumentStatus`, `DeliveryStatus` y `DeliveryChannelStatus`, y la opción
`debug` la aceptan `issue`, `prepare`, `sign`, `status`, `getDocumentStatus`,
`deliverEmail`, `deliverWhatsApp`, `getDelivery` y `waitForDelivery`.

El contrato publicado de la API documenta los tiempos para `POST /v1/dte`,
`POST /v1/dte/prepare`, `POST /v1/dte/sign` y la descarga de archivos
(`GET /v1/dte/{codigoGeneracion}/file`, solo con `Server-Timing`); las demás
rutas pueden ignorar la cabecera, y entonces `result.debug` simplemente no
viene. Dos límites del SDK:

- `downloadDocument` devuelve bytes, y el SDK no lee `Server-Timing` en
  respuestas binarias, así que el resultado de una descarga no trae `debug`.
- Un `FactaError` no trae tiempos, aunque la API haya puesto un miembro
  `debug` en el cuerpo del error.

Una repetición con la misma `Idempotency-Key` también acepta la opción; el
informe describe entonces la repetición, no la emisión original.

## Leer la cabecera usted mismo

Si llama a la API sin el SDK, o quiere la cabecera tal cual, el formato de
`Server-Timing` es estándar: `auth;dur=41.2, mh_transmit;dur=812.5,
total;dur=2310.4`. Una métrica llamada `total` es el total, no un paso. Las
herramientas de desarrollo del navegador la muestran en la pestaña de tiempos
del panel de red.

## Qué puede salir mal

- **`result.debug` viene `undefined`**: la opción estaba apagada para esa
  llamada, la ruta no informa tiempos o el servidor es anterior a la función.
- **Dejarlo encendido en producción**: cada respuesta crece y los nombres
  internos de los pasos terminan en sus registros. Enciéndalo para investigar y
  luego apáguelo. El SDK nunca le entrega un miembro `debug` que usted no pidió.
- **La suma de todos los `ms` da más que `totalMs`**: los pasos se anidan y se
  solapan.
- **Tiempos de una llamada que falló**: no están disponibles en `FactaError`;
  reproduzca con una llamada exitosa o use el panel de red del navegador.

## Relacionado

- [Fijación de región](region.es.md): la causa más común de llamadas lentas.
- [Diagnóstico](diagnose.es.md) · [Referencia de métodos](reference.es.md)
