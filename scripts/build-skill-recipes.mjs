// Generates skills/facta-dte-api/references/recipes.md, the index that maps each integration task to the
// playground recipe that already does it. The two base URLs live HERE and nowhere else:
// switch PLAYGROUND_URL to https://playground.factadte.com and PLAYGROUND_REF to "main" when they move,
// then run `node scripts/build-skill-recipes.mjs`. `--check` fails if the committed file is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLAYGROUND_URL = "https://facta-playground-dev.factadte.workers.dev";
export const GITHUB_REPO = "https://github.com/Facta-DTE/facta-api-sdk";
/** Branch that carries the playground until it reaches main. */
export const PLAYGROUND_REF = "feat/playground-foundation";

const blob = (path) => `${GITHUB_REPO}/blob/${PLAYGROUND_REF}/${path}`;
const R = "playground/server/recipes";

/** [recipe id, file, task, what the recipe shows, caveat?] — ids match `/servidor?receta=<id>`. */
const RECIPES = [
  ["issue-idempotent", "issue-idempotent.ts", "Issue a Factura / CCF safely", "`issue` with your order number as the idempotency key; same key, same document."],
  ["prepare-sign", "prepare-sign.ts", "Review before signing", "`prepare`, review `totales`, `sign` unchanged; two keys (`.prepare`, `.sign`)."],
  ["status-recovery", "status-recovery.ts", "Recover after a timeout", "Replay the same request and key, then `getDocumentStatus`. Never a new key."],
  ["order-webhook", "order-webhook.ts", "Order paid → invoice (webhook)", "Order → `DteRequest` with your own price list; key = order id. An integration example: Facta DTE has no orders."],
  ["deliver-email", "deliver-email.ts", "Issue, then e-mail the document", "Two calls: `issue` marks the channel, `deliverEmail` + `waitForDelivery` with the 5-minute token."],
  ["delivery-status", "delivery-status.ts", "Read a delivery state later", "`getDelivery(code)`; works after the token expired."],
  ["archivo-dte", "archivo-dte.ts", "Give the receiver the JSON", "Archivo DTE vs stored original (`raw: true`), `archivoDteOf`, `not_sealed`."],
  ["documents-storage", "documents-storage.ts", "List and download; PDF and ticket; copies", "`listDocuments` cursor, `downloadDocument` (`pdf`, `json`, `ticket` with `paperWidthMm`), `getDocumentCopies`, `getStorageStatus`."],
  ["catalog-refs", "catalog-refs.ts", "Issue with `customerId` / `productId`", "Catalog modes, listing, ids in the request."],
  ["invalidate", "invalidate.ts", "Cancel a sealed document", "`invalidate` with `tipoAnulacion`, `responsable`, `solicita`. Irreversible."],
  ["register-return", "register-return.ts", "Customer returns part of a sale", "`registerReturn` (Evento de Retorno) with `linea` + `cantidad`."],
  ["diagnose", "diagnose.ts", "Is this key ready?", "`diagnose()` and `catalogState()`; use at start-up and in a health check."],
  ["service-info", "service-info.ts", "What is this key and what does the API offer?", "`status()`, `facta.environment`, `getContract()`."],
  ["region-timings", "region-timings.ts", "Why is a call slow?", "`region()`, `servedRegion`, per-call `debug: { timings: true }`."],
  ["reference-clock", "reference-clock.ts", "Clock for archives and S3 signing", "`facta.clock`; the document's own date is always the server's."],
  ["emergency-store", "emergency-store.ts", "Last-resort storage function", "PART 1 is the function you write; PART 2 is a playground-only simulation harness (skip it).", "simulated"],
];

/** Other real code worth copying from, with the part that is playground-only. */
const OTHER = [
  ["Server wiring: the `Facta` client + `createFactaHandler`", "playground/server/facta.ts", "Strip the timing proxy, the per-visitor quota, the API budget, the cache and `refuseCatalogWrites`: those are playground concerns."],
  ["Own UI, no React: checkout form on `createFactaClient` + `createIssueFlow`", "playground/site/sections/headless/checkout-form.tsx", "Replace `createSession` (the playground's) with a call to your own session endpoint; drop the order-number widget."],
  ["Own UI: point-of-sale keypad with `useFactaIssue`", "playground/site/sections/headless/pos-keypad.tsx", ""],
  ["Own UI: Factura or Crédito fiscal switch (the server builds the request)", "playground/site/sections/headless/credit-switch.tsx", ""],
  ["React: dialog", "playground/site/sections/screens/examples/dialog.tsx", ""],
  ["React: drawer", "playground/site/sections/screens/examples/drawer.tsx", ""],
  ["React: inline window", "playground/site/sections/screens/examples/inline.tsx", ""],
  ["React: issue button", "playground/site/sections/screens/examples/issue-button.tsx", ""],
  ["React: `useFactaWindow().open()`", "playground/site/sections/screens/examples/window-hook.tsx", ""],
  ["React: receipt and downloads", "playground/site/sections/screens/examples/receipt.tsx", ""],
  ["React: delivery rows", "playground/site/sections/screens/examples/delivery.tsx", ""],
  ["React: document list and detail", "playground/site/sections/screens/examples/document-list.tsx", ""],
  ["React: customer and product pickers", "playground/site/sections/screens/examples/pickers.tsx", ""],
  ["React: service status", "playground/site/sections/screens/examples/service-status.tsx", ""],
  ["React: invalidation dialog", "playground/site/sections/screens/examples/invalidate.tsx", ""],
  ["React: appearance tokens", "playground/site/sections/screens/examples/appearance-studio.tsx", ""],
];

export function render() {
  const lines = [];
  lines.push("# Recipes: real, tested code to copy");
  lines.push("");
  lines.push("<!-- Generated by scripts/build-skill-recipes.mjs. Do not edit by hand. -->");
  lines.push("");
  lines.push("The Facta DTE playground is a live site whose every example is a **standalone, runnable integration**");
  lines.push("running against the staging API. Prefer copying from these files over writing from scratch: they are the");
  lines.push("code the playground itself executes and tests. Each recipe file exports `run(facta, input)` and a");
  lines.push("`sample` input; the comment block at the top explains the *why*.");
  lines.push("");
  lines.push(`- Playground: ${PLAYGROUND_URL}/ (recipes at \`${PLAYGROUND_URL}/servidor?receta=<id>\`)`);
  lines.push(`- Source (branch \`${PLAYGROUND_REF}\`): ${GITHUB_REPO}/tree/${PLAYGROUND_REF}/playground`);
  lines.push("");
  lines.push("**What to strip when you copy:** the playground adds concerns a real integration does not have: Turnstile,");
  lines.push("a per-visitor quota and API budget, response masking, redaction and a mock mode. They live in `playground/server/`");
  lines.push("(`guard.ts`, `quota.ts`, `api-budget.ts`, `redact.ts`, `catalog-mask.ts`…), not in the recipe files themselves,");
  lines.push("except where a caveat is noted below. The recipe imports (`../../../mod.ts`) become `@facta-dte/api`.");
  lines.push("The sample data (fictitious shop, customers, SKUs) is for demonstration; use your own.");
  lines.push("");
  lines.push("## Server recipes (`playground/server/recipes/`)");
  lines.push("");
  lines.push("| Task | Recipe file | Try it live | What it shows |");
  lines.push("| --- | --- | --- | --- |");
  for (const [id, file, task, shows, kind] of RECIPES) {
    const live = kind === "simulated" ? `[${id}](${PLAYGROUND_URL}/servidor?receta=${id}) (simulation)` : `[${id}](${PLAYGROUND_URL}/servidor?receta=${id})`;
    lines.push(`| ${task} | [\`${file}\`](${blob(`${R}/${file}`)}) | ${live} | ${shows} |`);
  }
  lines.push("");
  lines.push("Cross-reference: reference files in this skill that explain the same task, in order of use:");
  lines.push("[issuing-dte-types.md](issuing-dte-types.md), [idempotency-and-recovery.md](idempotency-and-recovery.md),");
  lines.push("[files-and-delivery.md](files-and-delivery.md), [contingency-invalidation-return.md](contingency-invalidation-return.md),");
  lines.push("[catalog.md](catalog.md), [debugging.md](debugging.md), [storage-and-emergency.md](storage-and-emergency.md).");
  lines.push("");
  lines.push("## Server wiring, own UI and React components");
  lines.push("");
  lines.push("| What | File | Strip when copying |");
  lines.push("| --- | --- | --- |");
  for (const [what, path, strip] of OTHER) lines.push(`| ${what} | [\`${path.replace("playground/", "")}\`](${blob(path)}) | ${strip === "" ? "Playground chrome only (cards, `pg-*` classes)." : strip} |`);
  lines.push("");
  lines.push("## Starter files in this skill");
  lines.push("");
  lines.push("`templates/` holds the same code already stripped and type-checked against the SDK:");
  lines.push("`express-server.ts`, `nextjs-route.ts`, `react-checkout.tsx`, `webhook-to-invoice.ts` (shared model in");
  lines.push("`shared-order.ts`). Start there; open the recipe for the full story behind a call.");
  lines.push("");
  return lines.join("\n");
}

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = resolve(here, "..", "skills", "facta-dte-api", "references", "recipes.md");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = render();
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "utf8") !== text) {
      console.error("references/recipes.md is out of date: run node scripts/build-skill-recipes.mjs");
      process.exit(1);
    }
    console.log("recipes.md is up to date");
  } else {
    writeFileSync(OUT, text);
    console.log(`Wrote ${join("skills/facta-dte-api/references", "recipes.md")}`);
  }
}
