# Catalogue changes and webhooks

[Spanish guide](webhooks.es.md) · [Catalog reads](catalog.md) · [Catalog writes](catalog-write.md) · [English README](../README.md)

From 0.6.0 the SDK can follow what changes in the company catalogue without reading
all of it each time: `listCatalogChanges` to poll, and webhooks so Facta tells you.
Both carry **only ids and revisions**, never a customer's or product's content. Read
the record with `getCustomer` / `getProduct` using the same key. Both need the scope
`catalog:read` (or `catalog:write`).

## Poll the change feed

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
      // details: { reason, cabeza, generacion }. Read everything again, then continue from the head.
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

`catalog_cursor_expired` (HTTP 410) means Facta can no longer continue from your cursor.
`error.details.reason` is `generation_changed` (a restore replaced the history),
`history_pruned` (history is kept 90 days), `cursor_ahead` or `too_many` (more than
1 000 pending). History order is the company's catalogue revision, so changes made by
the owner, an operator or another key all appear.

## Register a webhook

```ts
const hook = await facta.createWebhook({
  url: "https://example.com/facta/hook",
  events: ["catalog.customer.updated", "catalog.product.updated"], // omit for all events
  description: "inventory sync",
});
storeSecurely(hook.secret); // whsec_… shown ONCE; rotateWebhookSecret(hook.id) issues another
```

The URL must be `https://` on port 443, a public host, without credentials. A key can
hold 5 webhooks (`webhook_limit_reached`) and one per URL (`webhook_duplicate`). Ten
exhausted deliveries in a row switch a webhook off (`disabledBy: "too_many_failures"`);
`updateWebhook(id, { active: true })` switches it back on. `testWebhook(id)` queues a
signed `webhook.test` delivery that leaves within the next minute.

## Verify every delivery

Each delivery is a `POST` of `{ deliveryId, event, company, recordId, revision, generation, at }`
with the header `Facta-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`. The HMAC is over
`t + "." + rawBody` with your secret. Verify the **raw** body before parsing it.

```ts
import { MemoryWebhookReplayStore, verifyWebhook } from "@facta-dte/api";

const replay = new MemoryWebhookReplayStore(); // use a shared store with more than one process

app.post("/facta/hook", express.raw({ type: "application/json" }), async (req, res) => {
  const result = await verifyWebhook({
    secret: process.env.FACTA_WEBHOOK_SECRET!,
    header: req.header("Facta-Signature"),
    body: req.body, // Buffer
    replayStore: replay,
  });
  if (!result.ok && result.reason !== "replayed") return res.sendStatus(400);
  if (result.ok) await handle(result.delivery); // then read the record with your key
  res.sendStatus(204); // 2xx for a repeated deliveryId too
});
```

`verifyWebhook` never throws for a bad delivery; `constructWebhookEvent` is the same
check that throws `WebhookVerificationError` (`reason`: `malformed_header`,
`stale_timestamp`, `bad_signature`, `malformed_body` or `replayed`). A delivery older or
newer than 300 s is refused. During a secret rotation the header may carry two `v1`
values; either one matching is enough. `signWebhook(secret, body)` produces a header for
testing your receiver.

## Retries and ordering

Answer `2xx` as soon as you have the body. Anything else is retried (1 min, 5 min,
30 min, 2 h, 6 h; up to 24 h) with the same `deliveryId`, and retries can arrive out of
order: order by `revision`. Facta does not follow redirects and re-checks the host at
every attempt. Revoking the key ends its webhooks.
