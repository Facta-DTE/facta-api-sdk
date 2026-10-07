# Devoluciones (Evento de Retorno)

[English guide](return-event.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

Cuando un cliente devuelve parte de lo que compró, la Normativa 2.0 de Hacienda
lo registra con un **evento de retorno** (Evento de Retorno, código 18 del
CAT-002). No anula ni borra la factura: es su propio documento firmado, con su
propio código de generación y su propio sello, aplicado a una factura sellada.
`registerReturn` lo registra por medio de la API.

## Cuándo puede registrar una devolución

- El documento es una **Factura (01)**, una **Factura de Exportación (11)** o
  una **Factura de Sujeto Excluido (14)**, sellada y **emitida por esta API**.
  Los demás tipos se corrigen con una nota de crédito
  (`return_type_not_allowed`).
- La fecha del evento está dentro del **plazo de retorno**: tres meses desde que
  el documento se generó o se selló (el que venza antes), o dos años para
  facturas de ciertas actividades económicas. `fechaEvento` es por defecto hoy
  en El Salvador y no puede ser anterior al documento ni posterior al plazo
  (`return_window_closed`).
- Lo que devuelve cabe en lo que queda. Puede registrar **varias devoluciones**
  sobre el mismo documento hasta sumar lo que se vendió; Facta lleva el saldo
  por línea y rechaza el exceso antes de firmar (`return_exceeds_available`).

Una devolución **no gasta número de control**, pero igual exige llave de
idempotencia: un reintento no debe restar dos veces las mismas unidades. El SDK
envía `signKey`; el evento se firma con el certificado del emisor.

## La petición

`registerReturn(generationCode, request, options?)` recibe el código de
generación del **documento original** y un `ReturnRequest`:

```ts
interface ReturnRequest {
  items: ReturnItem[];
  fechaEvento?: string; // "AAAA-MM-DD"
}
type ReturnItem =
  | { linea: number; cantidad: number }   // unidades que regresan de esa línea
  | { linea: number; noGravado: number }; // un cargo (+) o abono (-) no gravado
```

- **Las líneas se cuentan desde 1**, como las lee una persona en la factura.
- Cada item lleva **exactamente uno** de `cantidad` (mayor que cero; el precio,
  la descripción y los tributos se copian de la original, y su descuento se
  prorratea) o `noGravado` (distinto de cero; solo mueve el total a pagar, no
  puede pasar de lo que traía la línea ni llevar el signo contrario, y una
  Factura de Sujeto Excluido no lo admite).

El SDK revisa esas formas antes de enviar y lanza `TypeError` / `RangeError`
(al menos un item, `linea` entera desde 1, exactamente uno de los dos montos,
`fechaEvento` como `AAAA-MM-DD`).

```ts
import { Facta, FactaError } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

const result = await facta.registerReturn(invoiceCode, {
  items: [{ linea: 1, cantidad: 2 }, { linea: 3, cantidad: 1 }],
}, { idempotencyKey: `return:${rmaId}` });

if (result.estado === "sellado") {
  console.log("Devolución sellada:", result.codigoGeneracion, result.selloRecibido);
} else {
  // estado "firmado": Hacienda no respondió. Repita con la MISMA llave y la misma petición.
  console.log("Firmada, pendiente con Hacienda:", result.detalle);
}
for (const line of result.disponible) console.log(`línea ${line.linea}: quedan ${line.disponible} de ${line.vendida}`);
```

## El resultado

`ReturnResult` es `ReturnSealed | ReturnPending`. Los dos traen:

| Campo | Significado |
| --- | --- |
| `codigoGeneracion` | El código del **evento de retorno**, no de la factura. |
| `documentoRelacionado` | `{ codigoGeneracion, numeroControl, tipoDte, fecEmi }` de la factura. |
| `totales` (`ReturnTotals`) | `totalGravada`, `totalExenta`, `totalNoSuj`, `totalIva`, `totalPagar` del evento. |
| `documento`, `jws`, `archivoJson` | El documento del evento, su firma y los bytes exactos de su JSON. Guarde `archivoJson` tal cual. |
| `disponible` (`ReturnAvailability[]`) | Por línea, lo que queda **contando ya esta devolución**: `vendida`, `devuelta`, `disponible` y los saldos de `noGravado`. |
| `almacenamiento` | `"retencion"` o `"ninguno"`, cuando se informa. |

- **`ReturnSealed`** (`estado: "sellado"`, HTTP 200) añade `selloRecibido`,
  `fhProcesamiento`, `observaciones`, `representacionGrafica` (PDF tamaño carta
  en base64, o `null` si no se pudo dibujar), `storage`, `storageErrorCode` y
  `anotadoEnElLibro` (`false` cuando Hacienda lo registró pero el libro de Facta
  todavía no anotó el veredicto).
- **`ReturnPending`** (`estado: "firmado"`, HTTP 202) añade `detalle`. El evento
  está firmado y registrado, y sus unidades ya cuentan como devueltas. Repita la
  llamada con la **misma** `idempotencyKey` y la misma petición: el servidor
  reenvía exactamente el mismo `jws`; nunca arma un segundo evento.

## Consultar devoluciones después

`getDocumentStatus(invoiceCode)` incluye, para 01, 11 y 14:

- `retornos` (`ReturnSummary[]`, del más reciente al más antiguo): el código de
  cada evento, `estado` (`firmado`, `sellado` o `rechazado`; uno rechazado no
  resta nada), `fecha`, `selloRecibido`, `totales` y `lineas`.
- `disponible` (`ReturnAvailability[] | null`): lo que todavía se puede devolver
  por línea; `null` cuando la API no tiene el JSON firmado del documento (se
  emitió desde la aplicación de Facta) o el documento ya no está vigente.

```ts
const status = await facta.getDocumentStatus(invoiceCode);
for (const r of status.retornos ?? []) console.log(r.codigoGeneracion, r.estado, r.totales.totalPagar);
const pdf = await facta.downloadDocument(result.codigoGeneracion, "pdf"); // el PDF carta del propio evento
```

Los archivos del evento se descargan con **su propio** código mediante
`downloadDocument(eventCode, "json" | "pdf")`. Un evento de retorno no tiene
ticket.

## Devoluciones y anulación

Un documento con eventos de retorno **sellados** ya no se puede anular:
`invalidate` responde `has_return_events` (HTTP 409) porque Hacienda lo rechaza
(Anexo V 44.4). Corríjalo con más devoluciones o con una nota de crédito. Una
devolución que quedó `firmado` y nunca llegó a Hacienda no impide la anulación;
el servidor la abandona solo pasadas 72 horas sin veredicto. La API también
tiene `DELETE /v1/dte/{codigoGeneracion}/return/{evento}` para abandonarla
antes; **el SDK no tiene un método para eso** en esta versión.

## Qué puede salir mal

| Código | HTTP | Significado y qué hacer |
| --- | --- | --- |
| `return_exceeds_available` | 422 | Más de lo que queda de una línea. `details.lineas` trae, por línea (desde 1), `linea`, `solicitado` y `disponible`. Pida como máximo lo disponible; no se firmó nada. |
| `return_window_closed` | 422 | `fechaEvento` es anterior al documento, está en el futuro o cae después del plazo. Pasado el plazo, el documento ya no admite el evento. |
| `return_type_not_allowed` | 422 | El documento no es 01, 11 ni 14. Use una nota de crédito. |
| `return_pdf_unavailable` | 404 | El PDF del evento ya no se puede dibujar (no queda su JSON firmado) o se pidió un ticket. Use `representacionGrafica` de la respuesta original o su copia guardada. |
| `has_return_events` | 409 | `invalidate` sobre un documento con devoluciones selladas. |
| `validation_failed` | 422 | El documento no tiene sello, está anulado o el evento no cumple el esquema oficial. |
| `mh_rejected` | 422 | Hacienda leyó el evento de retorno y lo rechazó; sus unidades vuelven al saldo. |
| `not_found` | 404 | Ese documento no existe en la empresa de la llave. |

Un `TypeError` o `RangeError` antes de cualquier petición significa que falló la
revisión local de la forma. Nunca reintente un 202 con una llave nueva: eso
intentaría devolver otra vez las mismas unidades.

## Relacionado

- [Patrones de idempotencia](idempotency.es.md) · [Catálogo de errores](errors.es.md)
- [El Archivo DTE](archivo-dte.es.md) · [Referencia de métodos](reference.es.md)
