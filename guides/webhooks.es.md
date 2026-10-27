# Cambios del catálogo y webhooks

[English guide](webhooks.md) · [Lecturas del catálogo](catalog.es.md) · [Escritura del catálogo](catalog-write.es.md) · [README en español](../README.es.md)

Desde la 0.6.0 el SDK puede seguir lo que cambia en el catálogo de la empresa sin
leerlo completo cada vez: `listCatalogChanges` para consultar, y los webhooks para que
Facta le avise. Los dos traen **solo ids y revisiones**, nunca el contenido de un
cliente o un producto: lea la ficha con `getCustomer` / `getProduct` y la misma llave.
Los dos piden el alcance `catalog:read` (o `catalog:write`).

## Consultar los cambios

```ts
let since = 0;
let generation: string | null = null;
for (;;) {
  try {
    const page = await facta.listCatalogChanges({ since, generation });
    for (const change of page.changes) await apply(change); // { revision, type, recordId, operation, actor, at }
    since = page.next;
    generation = page.generation;
    if (!page.hasMore) break;
  } catch (error) {
    if (error instanceof FactaError && error.code === "catalog_cursor_expired") {
      // details: { reason, cabeza, generacion }. Lea todo otra vez y siga desde la cabeza.
      const details = error.details as { cabeza: number; generacion: string };
      await resync();
      since = details.cabeza;
      generation = details.generacion;
      continue;
    }
    throw error;
  }
}
```

`catalog_cursor_expired` (HTTP 410) quiere decir que Facta ya no puede continuar desde su
cursor. `error.details.reason` es `generation_changed` (una restauración reemplazó el
historial), `history_pruned` (el historial se guarda 90 días), `cursor_ahead` o
`too_many` (más de 1 000 pendientes). El orden es la revisión del catálogo de la empresa,
así que aparecen los cambios de la persona titular, de un operador o de otra llave.

## Registrar un webhook

```ts
const hook = await facta.createWebhook({
  url: "https://example.com/facta/hook",
  events: ["catalog.customer.updated", "catalog.product.updated"], // sin events: todos
  description: "sincronía de inventario",
});
storeSecurely(hook.secret); // whsec_… se muestra UNA vez; rotateWebhookSecret(hook.id) emite otro
```

La dirección debe ser `https://`, puerto 443, un host público y sin usuario ni contraseña.
Una llave puede tener 5 webhooks (`webhook_limit_reached`) y uno por dirección
(`webhook_duplicate`). Diez entregas agotadas seguidas lo apagan
(`disabledBy: "too_many_failures"`); `updateWebhook(id, { active: true })` lo enciende de
nuevo. `testWebhook(id)` pone en cola una entrega `webhook.test` firmada que sale en el
siguiente minuto.

## Verificar cada entrega

Cada entrega es un `POST` de `{ deliveryId, event, company, recordId, revision, generation, at }`
con la cabecera `Facta-Signature: t=<segundos unix>,v1=<HMAC-SHA256 hexadecimal>`. El HMAC
se calcula sobre `t + "." + cuerpoCrudo` con su secreto. Verifique el cuerpo **crudo** antes
de interpretarlo.

```ts
import { MemoryWebhookReplayStore, verifyWebhook } from "@facta-dte/api";

const replay = new MemoryWebhookReplayStore(); // use un almacén compartido con más de un proceso

app.post("/facta/hook", express.raw({ type: "application/json" }), async (req, res) => {
  const result = await verifyWebhook({
    secret: process.env.FACTA_WEBHOOK_SECRET!,
    header: req.header("Facta-Signature"),
    body: req.body, // Buffer
    replayStore: replay,
  });
  if (!result.ok && result.reason !== "replayed") return res.sendStatus(400);
  if (result.ok) await handle(result.delivery); // luego lea la ficha con su llave
  res.sendStatus(204); // 2xx también para un deliveryId repetido
});
```

`verifyWebhook` nunca lanza por una entrega mala; `constructWebhookEvent` hace la misma
comprobación y lanza `WebhookVerificationError` (`reason`: `malformed_header`,
`stale_timestamp`, `bad_signature`, `malformed_body` o `replayed`). Una entrega con más de
300 s de diferencia se rechaza. En una rotación de secreto la cabecera puede traer dos
`v1`; basta que uno coincida. `signWebhook(secret, body)` produce una cabecera para probar
su receptor.

## Reintentos y orden

Conteste `2xx` en cuanto tenga el cuerpo. Cualquier otra cosa se reintenta (1 min, 5 min,
30 min, 2 h, 6 h; hasta 24 h) con el mismo `deliveryId`, y los reintentos pueden llegar
desordenados: ordene por `revision`. Facta no sigue redirecciones y vuelve a comprobar el
host en cada intento. Revocar la llave termina sus webhooks.
