# Entrega por correo y WhatsApp

[English guide](delivery.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

La API de Facta puede enviarle al receptor un documento sellado por correo, por
WhatsApp o por los dos. El SDK no envía nada por su cuenta: usted **marca** los
canales al emitir y luego **inicia** cada canal con su propia petición. Emitir
nunca espera a la entrega, y una entrega que no puede salir se informa como un
estado, nunca como una emisión fallida.

## El flujo en cuatro pasos

1. `issue(request, { deliver })` marca los canales. El resultado sellado trae
   `entrega: { token, venceEn, canales }`.
2. Dentro de los **cinco minutos siguientes a la emisión**,
   `deliverEmail(code, token)` y/o `deliverWhatsApp(code, token)` inician cada
   canal. Una petición por canal.
3. Cada una responde con el estado del canal: final (HTTP 200) o `en_proceso`
   (HTTP 202) cuando el proveedor tarda más.
4. `getDelivery(code)` o `waitForDelivery(code)` leen los estados finales,
   también después de que venció el token.

```ts
import { Facta, isDeliveryLimitReason, type DteRequest } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });
const sale: DteRequest = {
  tipoDte: "01",
  receptor: { nombre: "Ana López", correo: "ana@example.com" },
  items: [{ descripcion: "Café", cantidad: 2, precioUni: 2.5 }],
};

const result = await facta.issue(sale, {
  idempotencyKey: "order-1042",
  deliver: { email: true, whatsapp: { number: "+50370000000", consent: true } },
});

const token = result.estado === "sellado" ? result.entrega?.token : undefined;
if (token) {
  await facta.deliverEmail(result.codigoGeneracion, token);
  await facta.deliverWhatsApp(result.codigoGeneracion, token);
  const status = await facta.waitForDelivery(result.codigoGeneracion, { timeoutMs: 30_000 });
  for (const [channel, state] of Object.entries(status.canales)) {
    if (state?.estado === "enviado") console.log(channel, "enviado a", state.destino);
    else if (isDeliveryLimitReason(state?.motivo)) console.warn(channel, "no pudo salir ahora; ofrezca el PDF");
    else console.warn(channel, state?.estado, state?.motivo);
  }
}
```

## Marcar canales: `deliver`

| Opción | En el cable (`entrega`) | Significado |
| --- | --- | --- |
| `email: true` | `correo: true` | Enviar a `receptor.correo`. |
| `email: "x@y.com"` | `correo: "x@y.com"` | Enviar a esa dirección solo para la entrega; el documento fiscal conserva `receptor.correo`. |
| `whatsapp: { number, consent: true }` | `whatsapp: { numero, consentimiento: true }` | Enviar por WhatsApp. `consent: true` es **su declaración** de que el receptor aceptó; se guarda con el id de la llave y el número enmascarado. |

El SDK revisa `deliver` antes de enviar nada y lanza `TypeError` cuando: no hay
ningún canal marcado, `email` no es `true` ni una dirección, el número de
WhatsApp no parece un teléfono (use `+503…`) o `consent` no es literalmente
`true`.

`entrega` es parte de la petición, así que es parte de la huella de
idempotencia: repetir la misma petición con la misma llave devuelve el mismo
token mientras siga vigente, y cambiar `deliver` con la misma llave es
`idempotency_key_reuse`.

`issueAndArchive(request, { deliver, … })` acepta la misma opción y la manda
con su primera petición (y la guarda en el diario, así que una recuperación la
repite); el token viene en `result.entrega` (el mismo objeto que
`result.emission.entrega`).

**Alcances.** Una llave con el alcance `issue` puede marcar y entregar los dos
canales. Una llave acuñada solo con `entrega:correo` o `entrega:whatsapp`
conserva ese canal. Un canal que la llave no puede usar no impide emitir; el
estado del canal queda `no_permitido`.

## El token de entrega

`result.entrega` (`DeliveryOffer`) trae:

- `token`: un secreto de portador opaco, válido hasta `venceEn` (emisión + 5
  minutos). Guárdelo en su servidor; nunca lo mande a un navegador.
- `venceEn`: vencimiento en ISO-8601.
- `canales`: los canales marcados con su estado inicial y el `destino`
  enmascarado («m•••@example.com»). Los canales no marcados no aparecen.

`token` **no viene** cuando no hay nada que entregar: un documento en
contingencia (los canales quedan `esperando_sello`; la entrega después de una
contingencia todavía no se ofrece) o ningún canal marcado tiene su alcance y su
consentimiento. Hoy no hay forma de obtener un token nuevo pasados los cinco
minutos; entregue los documentos tardíos desde la aplicación de Facta o por sus
propios medios.

## Estados y motivos de cada canal

| `estado` | ¿Final? | Significado |
| --- | --- | --- |
| `pendiente` | no | Marcado, sin iniciar. |
| `en_proceso` | no | Iniciado; el proveedor todavía no responde. |
| `enviado` | sí | Entregado al proveedor. |
| `fallido` | sí | No se pudo enviar; vea `motivo`. |
| `sin_credito` | sí | WhatsApp: el saldo prepagado de la empresa está vacío. |
| `sin_consentimiento` | sí | WhatsApp: no se declaró el consentimiento. |
| `no_permitido` | sí | Los alcances de la llave no incluyen este canal. |
| `vencido` | sí | El token venció antes de iniciar el canal. |
| `esperando_sello` | no se espera | Contingencia: no se envía nada hasta que haya sello. |

`motivo` es un código estable: `smtp_rejected`, `invalid_address`,
`wallet_empty`, `provider_unavailable`, `quota_exceeded`,
`consent_not_attested`, `scope_missing`, `token_expired`, `contingency`,
`document_rejected`, `document_unavailable`, `provider_rejected`,
`outcome_unknown`, `delivery_unavailable`. Pueden aparecer códigos nuevos;
trate los desconocidos como una falla genérica.

`DELIVERY_LIMIT_REASONS` (`quota_exceeded`, `provider_unavailable`) e
`isDeliveryLimitReason(motivo)` distinguen «el mensaje no pudo salir en este
momento» de «algo está mal con la dirección». El documento ya está emitido:
muestre un aviso y ofrezca el PDF o el JSON. Los dos se exportan desde el
paquete raíz y desde `@facta-dte/api/browser`.

WhatsApp se cobra del saldo prepagado de la empresa; el mensaje es la plantilla
aprobada más el documento, nada más. El correo cuenta contra la cuota de
correos de la empresa.

## Iniciar y leer canales

- `deliverEmail(code, token, { signal? })` / `deliverWhatsApp(...)` →
  `DeliveryChannelResult` (el estado del canal más `canal`). Una segunda
  llamada para el mismo canal devuelve el estado actual y no envía un segundo
  mensaje. El SDK quita el token de cualquier mensaje o detalle de error.
- `getDelivery(code, { signal? })` → `DeliveryStatus` con todos los canales.
  Funciona después de que venció el token. Alcance `query`.
- `waitForDelivery(code, { channels?, timeoutMs = 60000, intervalMs = 2000, signal? })`
  consulta `getDelivery` hasta que todos los canales esperados son finales. Si
  se acaba el tiempo **devuelve** el último estado con `settled: false`; no
  lanza.

```ts
const status = await facta.waitForDelivery(code, { channels: ["correo"], timeoutMs: 20_000 });
if (!status.settled) {
  // Sigue pendiente/en_proceso: vuelva a leerlo más tarde con getDelivery(code).
}
```

## En el handler del servidor y en React

Con la ventana de firma de React, ponga `deliver` en la sesión que crea su
servidor (`createFactaSession({ request, idempotencyKey, deliver }, secret)`);
el navegador no puede añadirlo ni cambiarlo. Después de una emisión sellada el
handler inicia por su cuenta los canales marcados, sin esperar más de
`deliveryStartTimeoutMs` (por defecto 1500 ms), y le da al navegador un
`deliveryHandle` en lugar del token de Facta. La ventana muestra una fila
«Entrega» por canal, consulta `delivery.status` cada 2 s hasta 60 s e informa
con `onDelivery(view)`. Detalles: [react-server.md](react-server.md#delivery-by-e-mail-and-whatsapp)
(en inglés). El flujo sin interfaz de `@facta-dte/api/browser` expone la misma
vista como `state.delivery` y `onDelivery` (vea [browser.es.md](browser.es.md)).

## Qué puede salir mal

- **`entrega_vencida` (HTTP 410)**: pasaron más de cinco minutos desde la
  emisión. El canal queda `vencido`; no reintente con ese token.
- **`entrega_token_invalido` (HTTP 401)**: el token no corresponde a este
  documento y canal, está mal escrito o el documento nunca tuvo uno.
- **`canal_no_marcado` (HTTP 409)**: la emisión no marcó ese canal. Los canales
  solo se marcan al emitir.
- **No viene `token` en el resultado**: contingencia, o ningún canal marcado se
  podía entregar (revise `canales` buscando `no_permitido` /
  `sin_consentimiento`).
- **`waitForDelivery` nunca termina**: pidió en `channels` un canal que no se
  marcó; nunca se informa, así que la llamada espera hasta `timeoutMs`.
- **Una entrega fallida no es una emisión fallida**: nunca vuelva a emitir un
  documento porque un canal terminó `fallido`.

## Relacionado

- [El Archivo DTE](archivo-dte.es.md) · [Patrones de idempotencia](idempotency.es.md)
- [Catálogo de errores](errors.es.md) · [Referencia de métodos](reference.es.md)
