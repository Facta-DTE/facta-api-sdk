# Starter files

Copy-paste starting points, **type-checked against the SDK in CI** (`pnpm skill:check`).
They are adapted from the playground's real, tested code (`playground/server/recipes/*`,
`playground/server/facta.ts`, `playground/site/sections/*/examples/*`), keeping only what a
real integration needs: the playground's Turnstile, per-visitor quota, response masking and
mock mode are removed, and each file says so in its header.

| File | What it is |
| --- | --- |
| `shared-order.ts` | Your order model, price list and `orderToRequest` (replace with your data). The fiscal request is always built on your server. |
| `express-server.ts` | Express: `createFactaHandler` behind `/api/facta` plus a session endpoint. |
| `nextjs-route.ts` | Next.js App Router: the same two routes as `Request → Response` handlers. |
| `react-checkout.tsx` | React page: asks your server for a session, opens `FactaInvoiceDialog` or `useFactaWindow().open()`. |
| `webhook-to-invoice.ts` | Order-paid webhook → idempotent issue → e-mail in two calls. An integration example: Facta DTE has no orders. |

Inside this repo they import `@facta-dte/api`; in your project that resolves to the installed
package. Keys come from environment variables (`FACTA_API_KEY`, `FACTA_SIGN_KEY`,
`FACTA_SESSION_SECRET`) and are never printed. Start with a `facta_test_` key.
