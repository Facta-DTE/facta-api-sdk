# Patrones de idempotencia

[English guide](idempotency.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

Emitir un DTE gasta un número de control, y un número de control nunca se puede
reciclar. Si una petición se queda sin respuesta y usted la vuelve a mandar como
una petición nueva, puede terminar con dos documentos fiscales para una sola
venta. La cabecera `Idempotency-Key` lo evita: el servidor recuerda la primera
respuesta de una llave y la devuelve otra vez en lugar de repetir el trabajo.
Esta guía explica cómo elegir llaves, qué reintenta el SDK por usted y cómo
recuperarse cuando no sabe si una petición llegó.

## Las reglas

Vienen del contrato publicado de la API:

- **Rutas que exigen llave**: `POST /v1/dte` (`issue`), `POST /v1/dte/prepare`,
  `POST /v1/dte/sign`, `POST /v1/dte/{codigoGeneracion}/invalidate` y
  `POST /v1/dte/{codigoGeneracion}/return`. Sin ella la API responde
  `400 idempotency_key_required`.
- **Alcance** `(llave de API, Idempotency-Key)`: dos integradores pueden usar la
  misma cadena sin chocar.
- **Misma llave, mismo cuerpo**: vuelve la respuesta guardada (con
  `Idempotency-Replayed: true`). Eso incluye un rechazo de Hacienda: la
  repetición devuelve el mismo `422 mh_rejected` sin gastar otro número.
- **Misma llave, otro cuerpo**: `422 idempotency_key_reuse`.
- **Mientras la primera petición sigue trabajando**: `409 idempotency_in_flight`;
  no se encola.
- **Vigencia de 24 horas.** Después la llave queda libre: la misma petición un
  día después es una **venta nueva**, no un reintento.

## Qué hace el SDK por usted

- Cada POST lleva una `Idempotency-Key`. Si usted pasa `idempotencyKey`, esa es
  la llave; si no, el SDK crea un UUID aleatorio **una vez por llamada**. Desde
  el SDK no verá `idempotency_key_required`.
- La misma llave se reutiliza en cada reintento automático de esa llamada. El
  SDK reintenta solo `idempotency_in_flight`, `network_error` (incluido su
  propio tiempo agotado), `service_unavailable`, `correlative_unavailable`,
  `mh_unreachable` y `storage_unavailable`, hasta `maxRetries` (por defecto 3),
  esperando 250 ms, 500 ms, 1 s… con un tope de 4 s. Los rechazos y las demás
  respuestas 4xx nunca se reintentan.
- Una llave creada por el SDK vive solo en memoria. Si su proceso se reinicia,
  el siguiente intento lleva otra llave. **Por eso conviene que usted ponga la
  suya.**

## Patrón: una llave por operación de negocio

Use un identificador que su sistema ya tenga y que sobreviva a un reinicio: un
número de pedido, un ticket del punto de venta, un id de pago. Derive una llave
por operación fiscal, no una por pedido, cuando un pedido puede generar varios
documentos.

```ts
import { Facta, FactaError, type DteRequest } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

// Un webhook de pago puede llegar más de una vez para el mismo pedido.
export async function onPaymentConfirmed(event: { orderId: string; lines: DteRequest["items"] }) {
  const request: DteRequest = { tipoDte: "01", items: event.lines };
  // Mismo pedido -> misma llave -> mismo documento, aunque el webhook llegue varias veces.
  return await facta.issue(request, { idempotencyKey: `sale:${event.orderId}` });
}

// Una nota de crédito posterior para ese pedido es otra operación, así que otra llave.
const creditNoteKey = (orderId: string, n: number) => `credit-note:${orderId}:${n}`;
```

Arme la petición de forma determinista a partir del pedido guardado (mismo
orden de campos, mismos valores) para que una repetición produzca el mismo
cuerpo. Las llaves deben ser cadenas estables e imprimibles; manténgalas muy por
debajo de unos cientos de caracteres.

## Recuperar un resultado incierto

Cuando `issue` termina lanzando `network_error` (u otro código reintentable
después de los reintentos del SDK), usted no sabe si el servidor emitió el
documento, y tampoco tiene su `codigoGeneracion`. Repita **la misma petición
con la misma llave** dentro de las 24 horas: recibe la respuesta guardada,
incluido el código. Después use `getDocumentStatus` para lo que pase más
adelante (que se selle una contingencia, por ejemplo).

```ts
import { FactaError, type DteRequest } from "@facta-dte/api";

const request: DteRequest = { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2.5 }] };

async function issueSafely(request: DteRequest, key: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await facta.issue(request, { idempotencyKey: key });
    } catch (error) {
      if (!(error instanceof FactaError)) throw error;
      if (error.code === "idempotency_key_reuse") throw error; // el cuerpo cambió: es un error, no lo oculte
      const uncertain = ["network_error", "service_unavailable", "correlative_unavailable", "idempotency_in_flight"];
      if (!uncertain.includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
    }
  }
  throw new Error(`Resultado de ${key} desconocido; repítalo más tarde con la misma llave y la misma petición.`);
}

const result = await issueSafely(request, "sale:1042");
if (result.estado === "contingencia") {
  const later = await facta.getDocumentStatus(result.codigoGeneracion);
  console.log(later.estado); // "sellado" cuando Hacienda confirme
}
```

Nunca «arregle» un resultado incierto emitiendo con una llave nueva. Guarde la
llave junto al pedido antes del primer intento, para que un proceso reiniciado
pueda repetirla.

## Recuperación duradera entre reinicios

Cuando la repetición tiene que sobrevivir a una caída entre la petición y la
escritura en su base de datos, use `issueAndArchive` con un archivo duradero.
Escribe un diario cifrado (la petición, su hash y la llave) **antes** de la
petición fiscal, y `recoverOperation(operationId)` repite después la misma llave
y la misma petición:

```ts
// `facta` se creó con `runtime: { version: 1, archive }` (por ejemplo un FileInvoiceArchive).
const archived = await facta.issueAndArchive(request, {
  operationId: "sale:1042",
  idempotencyKey: "sale:1042",
  includeTicket: false,
});
// Después de un reinicio, por cada diario pendiente:
for (const op of await facta.listPendingOperations()) {
  await facta.recoverOperation(op.id);
}
```

La recuperación se niega a repetir cuando la petición ya no coincide con la
huella guardada, cuando cambió la identidad de la API (dirección, llave, emisor,
ambiente) o cuando la operación tiene más de **23 horas** (el SDK se detiene una
hora antes de que el servidor olvide la llave). Esos casos necesitan a una
persona: revise el documento con `getDocumentStatus` o `listDocuments` antes de
hacer cualquier otra cosa.

Las anulaciones tienen el mismo par: `invalidateAndArchive` y
`recoverInvalidation`. Cuando venció la ventana segura, o la API confirma que el
documento ya estaba anulado sin devolver el evento, lanzan `FactaError` con
`operation_outcome_unknown`: concilie a mano; no vuelva a anular.

## Rechazos y números gastados

`mh_rejected` significa que Hacienda leyó el documento y lo rechazó; el número
de control **sí** se gastó. `error.spent` trae `{ codigoGeneracion,
numeroControl }` y `error.mhObservations` las palabras de Hacienda. Repetir la
misma llave devuelve el mismo rechazo. Un documento corregido tiene otro cuerpo,
así que necesita una llave nueva. El SDK no tiene una opción para mandar el
número gastado con la petición corregida; cómo se relaciona la corrección con
ese número lo maneja el servidor y los registros de Facta, así que guarde
`error.spent` con su pedido para conciliar.

## Qué puede salir mal

- **`idempotency_key_reuse` (422)**: su código armó otro cuerpo para la misma
  llave (un precio distinto, una hora nueva en `observaciones`, otro
  `deliver`). Busque el error; no cambie a una llave nueva para esconderlo.
- **`idempotency_in_flight` (409)** después de todos los reintentos: la primera
  petición sigue trabajando (Hacienda puede tardar unos 40 s). Espere y repita
  la misma llave.
- **Repetir después de 24 horas**: emite un segundo documento. Concilie antes
  con `getDocumentStatus` / `listDocuments`.
- **`AbortSignal`**: cancelar detiene la espera y los reintentos locales; no
  prueba que el servidor no aceptó la petición. Repita la llave para saberlo.
- **Llaves aleatorias en un proceso sin estado**: una caída pierde la llave.
  Derive las llaves de identificadores de negocio guardados.

## Relacionado

- [Preparar y firmar](prepare-sign.es.md) · [Catálogo de errores](errors.es.md)
- [Adaptadores de almacenamiento](storage-adapters.es.md) para archivos ·
  [Referencia de métodos](reference.es.md)
