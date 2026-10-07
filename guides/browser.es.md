# El cliente de navegador sin interfaz

[English guide](browser.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

`@facta-dte/api/browser` es la mitad de la ventana de firma que no depende de
ningún framework: sin React y sin credenciales. Solo habla con el handler que
usted monta en **su** servidor (`createFactaHandler` de
`@facta-dte/api/server`), con un token de sesión opaco que creó su servidor. Los
componentes de React de `@facta-dte/api/react` están construidos sobre él; úselo
directamente con Vue, Svelte, DOM sin framework o una interfaz propia. Esta guía
ordena lo que exporta; el lado del servidor está en
[react-server.md](react-server.md) y la capa de React en [react.md](react.md)
(las dos en inglés).

## Qué se exporta

| Grupo | Exportaciones |
| --- | --- |
| Transporte | `createFactaClient`, `FactaClientError`; tipos `FactaClient`, `FactaDataClient`, `FactaFullClient`, `FactaClientOptions` |
| Máquina de estados de la emisión | `createIssueFlow`, `initialFlowState`; tipos `IssueFlow`, `IssueFlowOptions`, `FlowState`, `FlowStep`, `FlowFailure`, `IssuePhase`, `RunMode` |
| Mensajes | `esMessages`, `mergeMessages`, `fill`, `explainError`; tipos `FactaMessages`, `FactaMessagesOverride` |
| Errores de campos | `describeFields`, `describeFieldPath`; tipo `FieldIssue` |
| Formato | `formatMoney`, `formatQuantity`, `formatDateTime`, `truncateMiddle`, `lineAmount`, `storageTone` (tipo `StorageTone`) |
| Archivos | `archivoDteOf`, `base64ToBytes`, `saveBlob`, `downloadPdf`, `downloadJson` |
| Entrega | `DELIVERY_LIMIT_REASONS`, `isDeliveryLimitReason` |
| Caché de datos | `createFactaCache`; tipos `FactaCache`, `CacheEntry` |
| Apariencia | `appearanceToCssVariables`, `mergeAppearance`, `pickAccentInk`, `resolveAccentInk`, `colorToSrgb`, `resolveMotion`, `resetAppearanceWarnings`; tipos `FactaAppearance`, `FactaVariables`, `FactaTheme`, `FactaDensity`, `FactaMotion`, `FactaSlot`, `FactaStyles`, `InkChoice` |
| Tipos del cable | todo lo de `src/browser/wire.ts`: `IssueSummary`, `SessionInfo`, `DeliveryView`, `StorageSummary`, `DocumentRow`, `DocumentDetail`, `WireError`, `HandlerErrorCode`, … |

## El cliente

`createFactaClient({ endpoint, fetch?, headers?, timeoutMs? })` envía
`{ action, session, ...}` como JSON a `endpoint` con `x-facta-ui: 1` y
credenciales del mismo origen. `headers` puede ser una función (para un token
CSRF, por ejemplo). `timeoutMs` es 60 s por defecto; un tiempo agotado cuenta
como resultado incierto.

```ts
import { createFactaClient, FactaClientError } from "@facta-dte/api/browser";

const client = createFactaClient({ endpoint: "/api/facta", headers: () => ({ "x-csrf-token": csrf() }) });

const info = await client.describe(sessionToken);      // qué se va a emitir, ambiente, vencimiento
try {
  const summary = await client.issue(sessionToken);    // IssueSummary: sellado | contingencia
  console.log(summary.numeroControl, summary.storage, summary.delivery);
} catch (error) {
  if (error instanceof FactaClientError && error.transport) {
    // Sin respuesta útil: verifique (la misma sesión otra vez, o status) en lugar de empezar de nuevo.
  }
}
```

Acciones de sesión: `describe`, `issue`, `status(session, code, statusToken)` y
`deliveryStatus(session, deliveryHandle)`. Acciones de datos (cada una necesita
el permiso correspondiente en el handler; si no, `403 action_not_allowed`):
`listDocuments`, `getDocument`,
`downloadDocument(code, kind, { paperWidthMm?, raw? })`, `getDocumentCopies`,
`retryDocumentStorage`, `listHolding`, `searchCustomers`, `getCustomer`,
`searchProducts`, `getProduct`, `getServiceStatus`, `getStorageStatus`,
`describeInvalidation`, `invalidate`.

`FactaClientError` trae `code`, `status`, `retryable`, `spent` (`true`, o
`{ codigoGeneracion?, numeroControl? }`, cuando se gastó un número; `wasSpent`
como booleano), `observaciones`, `fields` (`{ path, message }[]`),
`statusToken` y `transport` (`true` cuando el navegador nunca recibió una
respuesta útil: sin conexión, tiempo agotado, cuerpo que no es JSON).

## El flujo de emisión

`createIssueFlow({ client, session, run?, messages?, onDelivery?, ... })` es la
máquina de estados de la ventana. Estados (`FlowStep`): `loading` → `review` →
`issuing` → (`verifying`) → `sealed` | `contingency` | `rejected` | `failed` |
`expired`. `initialFlowState()` da el `FlowState` inicial para un primer
dibujo.

```ts
import { createFactaClient, createIssueFlow } from "@facta-dte/api/browser";

const flow = createIssueFlow({ client: createFactaClient({ endpoint: "/api/facta" }), session: sessionToken });
const stop = flow.subscribe((state) => render(state)); // step, info, phase, result, error, delivery
await flow.start();          // carga la sesión -> "review" (o emite de una vez con run: "auto")
await flow.next();           // emitir
// state.error?.canRetry ? flow.retry() : mostrar state.error.explanation
stop();
flow.destroy();
```

Reglas que la máquina aplica, para que una interfaz propia no tenga que
hacerlo:

- Un resultado incierto nunca se reintenta como petición nueva: se reenvía la
  **misma sesión** hasta `maxResends` veces (por defecto 2, separadas por
  `verifyDelayMs`, 1500 ms) y después se consulta `status` cuando existe un
  token de estado.
- `retry()` («Intentar de nuevo») solo se permite cuando `state.error.canRetry`:
  reintentable, nada gastado y resultado conocido.
- La contingencia es un éxito. Los problemas de almacenamiento nunca cambian un
  resultado fiscal.
- La entrega (`state.delivery`, `onDelivery`) se consulta cada
  `deliveryIntervalMs` (2 s) hasta `deliveryTimeoutMs` (60 s) y nunca detiene
  `step`.

`run: "auto" | "auto-close"` salta la revisión y emite en cuanto carga la
sesión; cerrar la ventana es trabajo de la interfaz.

## Mensajes y errores de campos

Todo el texto para el usuario está en español (es-SV, de usted) en
`esMessages`. Cambie cualquier parte con `mergeMessages(override)`;
`explainError(code, messages)` devuelve la explicación de un código de error
(una genérica para los códigos desconocidos); `fill` reemplaza los marcadores
`{nombre}`. `describeFields(fields, messages)` convierte rutas como
`cuerpoDocumento[2].precioUni` en etiquetas como «Precio de la línea 3».

```ts
import { describeFields, explainError, mergeMessages } from "@facta-dte/api/browser";

const messages = mergeMessages({ errors: { rate_limited: "Demasiadas facturas seguidas. Espere un momento." } });
const text = explainError("rate_limited", messages);
const issues = describeFields([{ path: "receptor.nrc", message: "required" }], messages); // label: «NRC del receptor»
```

## Formato, archivos y caché

- `formatMoney(1234.5)` → `$1,234.50` (independiente del idioma del equipo,
  `—` si el valor no sirve); `formatQuantity`,
  `formatDateTime(fecEmi, horEmi)` → `05/10/2026 14:32`,
  `truncateMiddle(code)`; `lineAmount(cantidad, precioUni)` es solo para mostrar
  y redondea a centavos. Nunca lo use para totales fiscales: los `totales` del
  servidor son los que valen.
- `storageTone(summary)` → `"saved" | "pending" | "off" | null` para un
  indicador discreto de almacenamiento.
- `downloadPdf(base64, code)`, `downloadJson(text, code)`, `saveBlob`,
  `base64ToBytes`: entregan a la persona los archivos de un resultado sellado sin
  ir al servidor. Para el JSON prefiera `archivoDteOf(result) ?? result.archivoJson`
  (vea [archivo-dte.es.md](archivo-dte.es.md)).
- `createFactaCache()`: una caché pequeña que sirve lo guardado mientras
  revalida (`get`, `fetch` que comparte las peticiones en curso,
  `revalidate(key, fetcher, staleMs)`, `subscribe`, `invalidate(prefix)`,
  `set`). Los hooks de datos de React comparten una.

## Ayudas de apariencia

Los mismos tokens que la prop `appearance` de React, para cualquier framework:
`appearanceToCssVariables(variables, { dark? })` devuelve propiedades
personalizadas `--facta-*` (y deriva `accentInk`, `accentSoft`, `surface`,
`border`, `muted` y `radiusSm` de lo que usted fijó);
`mergeAppearance(...layers)` combina capas (gana la última);
`pickAccentInk(accent)` elige blanco o `#0b1419` para llegar a 4.5:1 de WCAG
(solo hex y `rgb()`; `resolveAccentInk(accent, element)` le pregunta al
navegador por otras sintaxis de color); `resolveMotion(motion, prefersReduced)`.
La lista de variables está en [react.md](react.md#1-tokens-appearance).

## Qué puede salir mal

- **`403 action_not_allowed`** en una acción de datos: el handler no declaró ese
  permiso (vea [react-server.md](react-server.md#capabilities)).
- **`session_expired` / `session_invalid`**: el token de sesión es demasiado
  viejo o no se firmó con el `sessionSecret` del handler; el flujo pasa a
  `expired`. Cree una sesión nueva en su servidor.
- **`transport: true`**: el resultado es desconocido. No cree una sesión nueva
  para la misma venta; deje que el flujo verifique, o llame a `status`.
- **CORS u otro origen**: el cliente envía `credentials: "same-origin"`; monte
  el handler en el mismo origen o pase un `fetch` que haga lo que su
  configuración necesita.
- **Poner una llave de API en el navegador**: nunca. Este paquete no necesita
  ninguna.

## Relacionado

- [Ventana de firma para React](react.md) · [Lado del servidor y almacenamiento](react-server.md)
- [Entrega](delivery.es.md) · [Catálogo de errores](errors.es.md) ·
  [Referencia de métodos](reference.es.md)
