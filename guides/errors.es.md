# Catálogo de errores

[English guide](errors.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

Toda falla de la API de Facta, y toda falla que el SDK detecta por su cuenta
alrededor de una llamada a la API, se lanza como un `FactaError`. Esta guía
lista **todos** los `FactaErrorCode` que declara el SDK, con su estado HTTP, si
el SDK lo reintenta solo y qué hacer. Los estados vienen del contrato publicado
de la API (`x-facta-errores`) y de `src/errors.ts` / `src/client.ts`.

## `FactaError`

```ts
import { FactaError } from "@facta-dte/api";

try {
  await facta.issue(request, { idempotencyKey: "sale:1042" });
} catch (error) {
  if (!(error instanceof FactaError)) throw error;  // TypeError, RangeError, AbortError, ...
  switch (error.code) {
    case "mh_rejected":
      console.error("Hacienda rechazó:", error.mhObservations, "gastado:", error.spent);
      break;
    case "rate_limited":
      console.warn("Reintente en", (error.details as { retryAfterSeconds?: number })?.retryAfterSeconds, "s");
      break;
    default:
      console.error(error.code, error.status, error.message);
  }
}
```

| Miembro | Significado |
| --- | --- |
| `name` | `"FactaError"`. |
| `code` | Un `FactaErrorCode`. **Lo único con lo que debe decidir.** |
| `status` | El estado HTTP, o `0` cuando el error se produjo localmente sin respuesta HTTP. |
| `details` | Datos propios de cada código (`unknown`): `validation_failed` → `issues`; `mh_rejected` → `descripcionMsg`, `observaciones`, `codigoGeneracion`, `numeroControl`; `rate_limited` → `window`, `remaining`, `retryAfterSeconds`; `forbidden_scope` → `required`, `granted`; `dte_type_not_allowed` → `allowed`; `sign_key_invalid` → `intentosRestantes`; `return_exceeds_available` → `lineas`. |
| `message` | Texto para la persona que lee un registro (en español desde el servidor, en inglés o español desde el SDK). Puede cambiar en cualquier momento; nunca lo analice. |
| `isRejection` | `true` solo para `mh_rejected`: Hacienda leyó el documento y lo rechazó. |
| `spent` | `{ codigoGeneracion, numeroControl }` cuando la falla gastó un número de control (un rechazo); si no, `null`. |
| `mhObservations` | Las observaciones de Hacienda, textuales (`string[]`). |

El SDK oculta la llave de API, la llave de firma, la llave de apertura y los
tokens de entrega configurados en `message` y `details`, y quita de `details`
los campos con nombre de credencial.

## Reintentos

El SDK reintenta solo, con la misma `Idempotency-Key`, únicamente estos códigos:
`idempotency_in_flight`, `network_error`, `service_unavailable`,
`correlative_unavailable`, `mh_unreachable` y `storage_unavailable`. Hace hasta
`maxRetries` intentos adicionales (por defecto 3), esperando 250 ms, 500 ms,
1 s… (con un tope de 4 s). Cuando se agotan recibe el último error; el resultado
de un POST queda entonces **incierto**: repita la misma petición con la misma
llave (vea [idempotency.es.md](idempotency.es.md)). Cualquier otro código es
definitivo para esa petición.

En las tablas, «Reintento» significa que el SDK lo reintenta automáticamente.

## Credenciales y acceso

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `unauthorized` | 401 (0 local) | no | No llegó `X-Facta-Key` a la API. Localmente: falta `apiKey`, se pasó una llave de apertura (`factauk_`) como `signKey`, un `unlockKey` mal formado, o `syncCatalog`/`syncDestinations` sin `unlockKey`. | Configure la credencial que nombra el mensaje. |
| `invalid_api_key` | 401 | no | La llave no existe, está mal escrita o su secreto no coincide. | Copie la llave completa, con el punto. |
| `key_revoked` | 403 | no | Revocada desde la aplicación. | Acuñe una llave nueva. |
| `key_expired` | 403 | no | Pasó su fecha de vencimiento. | Acuñe una llave nueva. |
| `key_inactive` | 403 | no | Desactivada. | Reactívela en la aplicación. |
| `forbidden_scope` | 403 | no | A la llave le falta el alcance de la ruta (`details.required`, `details.granted`). | Acuñe una llave con ese alcance; los alcances no se editan. |
| `dte_type_not_allowed` | 403 | no | La llave no puede emitir ese `tipoDte` (`details.allowed`). | Acuñe una llave que incluya el tipo. |
| `ip_not_allowed` | 403 | no | La llave tiene lista de direcciones y quien llama no está en ella. | Añada la dirección o el rango CIDR al acuñar. |
| `environment_not_allowed` | 403 | no | El prefijo de la llave y su registro no coinciden, o el ambiente de la llave no es el de su empresa. | Use una llave de producción para una empresa que ya pasó a producción. |
| `sign_key_required` | 401 | no | Una ruta que firma sin `X-Facta-Sign-Key`, o con la llave de apertura. | Pase `signKey` (`factask_…`). |
| `sign_key_invalid` | 401 | no | La llave de firma no abre el vault (`details.intentosRestantes`). | Corrija la llave antes de que el vault se bloquee. |
| `sign_vault_locked` | 403 | no | Cinco intentos fallidos en una hora; la llave queda suspendida. | Reactívela en la aplicación; esperar no ayuda. |
| `sign_vault_missing` | 409 | no | La llave no está provisionada para firmar, o su certificado es de otro NIT. | Vuelva a acuñar la llave desde la aplicación. |

## Petición y validación

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `invalid_request` | 400 (422 local) | no | Cuerpo ausente o que no es JSON, de más de 1 MB, un campo con forma equivocada o un código de generación que no es UUID (`details.field`). Localmente (422): un producto del catálogo con tipo de ítem o unidad de medida inválidos, o con una base de IVA que no corresponde al DTE. | Corrija la petición. No se gastó número. |
| `include_limit_exceeded` | 400 | no | `listDocuments` con `include: ["dte"]` pidió más de 25 filas (`details.maximo`). | Pida 25 o menos y siga con `siguiente`. |
| `validation_failed` | 422 | no | El documento no cumple el esquema oficial de Hacienda (`details.issues`). También lo lanzan localmente (422, antes de cualquier petición) las escrituras de catálogo. | Corrija los campos indicados. No se gastó número. |
| `retention_mixed_class_unsupported` | 422 | no | Se pidió `aplicarReteRenta` en un documento con alguna línea `exenta` o `no_sujeta` (`items[].tipoVenta`). | No se firmó nada ni se gastó número. Emita las líneas exentas o no sujetas en otro documento, o no aplique la retención. |
| `not_found` | 404 | no | No existe ese documento, cliente, producto o ruta para la empresa de la llave. También se lanza localmente cuando un `customerId`/`productId` no está en la foto del catálogo. | Revise el identificador y la empresa de la llave; sincronice el catálogo. |
| `method_not_allowed` | 405 | no | La ruta existe, pero no con ese método. | Solo aparece al llamar a la API fuera de los métodos del SDK. |
| `prepare_token_invalid` | 422 | no | El `prepareToken` venció (15 min), es de otra llave o el documento cambió. | Llame a `prepare` otra vez. Vea [prepare-sign.es.md](prepare-sign.es.md). |
| `not_sealed` | 409 | no | Descarga JSON por defecto de un documento que todavía no tiene sello (contingencia). | Use `{ raw: true }` o espere el sello. Vea [archivo-dte.es.md](archivo-dte.es.md). |
| `catalog_write_disabled` | 403 | no | La empresa no activó «Permitir administrar clientes y productos desde el API». | Actívelo en la aplicación. Vea [catalog-write.es.md](catalog-write.es.md). |
| `catalog_encrypted` | 409 | no | El catálogo de la empresa sigue cifrado, así que la API no puede escribirlo. | Pase el catálogo a texto plano en la aplicación. |

## Idempotencia

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `idempotency_key_required` | 400 | no | Una ruta que no se puede deshacer sin `Idempotency-Key`. El SDK siempre envía una, así que solo aparece con llamadas HTTP directas. | Envíe una llave por operación. |
| `idempotency_key_reuse` | 422 | no | La llave ya se usó con otro cuerpo. | Averigüe por qué cambió el cuerpo; nunca lo oculte con una llave nueva. |
| `idempotency_in_flight` | 409 | **sí** | La primera petición con esa llave sigue trabajando. `details.enVueloSegundos` dice desde cuándo, y `details.codigoGeneracion` nombra el documento cuando ya había empezado algo irreversible. | Espere y repita la misma llave; consulte `getDocumentStatus` del documento nombrado. |

## Devoluciones

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `return_exceeds_available` | 422 | no | Más de lo que queda de una línea (`details.lineas`: `linea`, `solicitado`, `disponible`). | Pida como máximo lo disponible. |
| `return_window_closed` | 422 | no | `fechaEvento` anterior al documento, en el futuro o fuera del plazo de retorno. | Pasado el plazo, el documento ya no admite el evento. |
| `return_type_not_allowed` | 422 | no | El documento no es 01, 11 ni 14. | Use una nota de crédito. |
| `return_pdf_unavailable` | 404 | no | El PDF del evento de retorno ya no se puede dibujar, o se pidió un ticket. | Use la `representacionGrafica` original o su copia guardada. |
| `has_return_events` | 409 | no | `invalidate` sobre un documento con devoluciones selladas. | Corrija con más devoluciones o con una nota de crédito. |

Vea [return-event.es.md](return-event.es.md).

## Límites

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `rate_limited` | 429 | no | La llave llegó a su techo por hora o por día, o a la ventana propia de `/v1/status` (`details.window`, `details.remaining`, `details.retryAfterSeconds`). | Espere `retryAfterSeconds` y repita la misma llave. |
| `amount_limit` | 429 | no | El documento pasa del monto máximo por documento de la llave. Se revisa antes de reservar; no se gasta número. | Suba el techo de la llave o divida la operación. |

## Hacienda y el servicio

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `mh_rejected` | 422 | no | Hacienda leyó el documento y lo rechazó. El número de control **se gastó** (`error.spent`). | Lea `error.mhObservations` y corrija los datos. Repetir la misma llave devuelve el mismo rechazo. |
| `mh_unreachable` | 502 | **sí** | Reservado: la API actual nunca lo devuelve al emitir, donde una falla de transporte se vuelve una contingencia 202. En una anulación significa que no se anuló nada. | Repita la misma llave. |
| `correlative_unavailable` | 503 | **sí** | No se pudo reservar el número de control. No se gastó número. | Repita la misma llave. |
| `service_unavailable` | 503 | **sí** | Una dependencia de Facta no respondió. También se lanza localmente (503) cuando un sobre del vault o del catálogo no pasa su revisión de huella o de formato. | Repita la misma llave; si el error es local, vuelva a sincronizar desde la aplicación. |
| `internal_error` | 500 | no | Una falla no prevista. También se lanza localmente cuando una respuesta no es JSON válido, una respuesta de anulación nombra otro documento o una respuesta de catálogo no trae su registro. | Si se repite, escriba a soporte con la hora y su `keyId`. |

Una contingencia (`estado: "contingencia"`, HTTP 202) **no** es un error: el
documento está firmado y Facta lo retransmitirá.

## Almacenamiento

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `no_storage_destination` | 422 | no | La empresa no tiene ningún destino de almacenamiento conectado y verificado en los últimos 30 días. Se revisa antes de reservar. También lo lanzan localmente (422) `syncDestinations`, cuando la foto de destinos no está publicada, y `syncCatalog`, cuando el catálogo está desactualizado (`details.reason: "catalog_out_of_sync"`). | Conecte o vuelva a sincronizar un destino (o el catálogo) en la aplicación. |
| `storage_unsupported` | 501 | no | El servidor no expone la ruta de almacenamiento administrado (el SDK también le asigna los 404), o una descarga con `source: "managed"` no trajo la prueba de origen. | Actualice el servidor antes de depender de ello. |
| `storage_unavailable` | 503 | **sí** | La copia administrada no se pudo leer o reparar en este momento. | Reintente solo la operación de almacenamiento; nunca vuelva a emitir. |
| `storage_contract_invalid` | 502 (SDK) | no | Una respuesta o un recibo de almacenamiento viene mal formado. En una emisión exitosa aparece en cambio como `result.storageErrorCode`, con el resultado sellado intacto. | Repare la copia después (`recoverOperation` / `retryDocumentStorage`). |

## Entrega

| Código | HTTP | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- | --- |
| `entrega_vencida` | 410 | no | Pasaron más de cinco minutos desde la emisión; el canal queda `vencido`. | No reintente con ese token; entregue por otros medios. |
| `entrega_token_invalido` | 401 | no | El token de entrega no corresponde a este documento y canal, o el documento no tiene. | Use `result.entrega.token` tal cual; lea los estados con `getDelivery`. |
| `canal_no_marcado` | 409 | no | La emisión no marcó ese canal. | Los canales solo se marcan al emitir. |

Un canal que no puede entregar (`fallido`, `sin_credito`, …) es un **estado**,
no un error. Vea [delivery.es.md](delivery.es.md).

## Códigos locales del SDK

Nunca vienen del servidor; `status` es `0`.

| Código | Reintento | Significado | Qué hacer |
| --- | --- | --- | --- |
| `network_error` | **sí** | Sin respuesta útil: falla de conexión o el propio `timeoutMs` del SDK. | Después de los reintentos, repita la misma petición y la misma llave. |
| `operation_outcome_unknown` | no | Puede que una anulación se haya completado, pero su evento firmado no se puede recuperar (venció la ventana segura, o la API solo confirma que ya estaba anulada). | Concilie a mano; no vuelva a anular. |
| `archive_integrity_error` | no | Los datos del archivo local no pasaron una revisión de identidad o de huella, o la identidad de la API (dirección, llave, emisor, ambiente) no es la misma con la que se registró la operación. | Conserve los archivos cifrados; revíselos antes de repararlos. Use el cliente y las credenciales originales. |

## Códigos del cliente de navegador


El cliente de navegador (`@facta-dte/api/browser`) lanza `FactaClientError`, que
trae los mismos códigos más los propios del handler: `session_invalid`,
`session_expired`, `action_not_allowed`, `unauthorized` y `bad_request`, y un
indicador `transport`. Vea [browser.es.md](browser.es.md).

## Lo que no es un `FactaError`

- `TypeError` / `RangeError`: revisiones locales antes de cualquier petición
  (`deliver` inválido, `raw` con un PDF, un ancho de ticket fuera de 40–120, un
  `ReturnRequest` mal formado, una `region` inválida, falta de archivo).
- `DOMException` llamado `AbortError`: se disparó su `AbortSignal`. No prueba
  que el servidor no haya actuado.
- `Error` de la recuperación del archivo: «Request does not match the saved
  fingerprint», «The safe idempotency window (23 h) expired», «Archive
  operation not found».
- `OperationError` / `SyntaxError` de Web Crypto o de JSON cuando una llave de
  apertura es incorrecta o un sobre está dañado.
- Errores propios de los adaptadores de almacenamiento (por ejemplo
  `BridgeArtifactStoreError`).

## Relacionado

- [Patrones de idempotencia](idempotency.es.md) · [Entrega](delivery.es.md) ·
  [Devoluciones](return-event.es.md)
- [Referencia de métodos](reference.es.md) · [Diagnóstico](diagnose.es.md)
