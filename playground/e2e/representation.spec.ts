import { expect, test, type Page, type Route } from "@playwright/test";

// «Representación gráfica» of the sale builder, against the Vite dev server with every /api/* call answered here
// (nothing reaches the API, nothing is issued):
//   pnpm exec vite --config playground/vite.config.ts --port 5199
//   PLAYGROUND_BASE_URL=http://localhost:5199 pnpm playground:smoke -g representation

const STATE = {
  environment: "00",
  apiHost: "eobxzotnqzgtpuqvmpkc.supabase.co",
  visitor: { label: "V-3FA9C2", email: null, via: "cookie" },
  auth: "turnstile",
  turnstileSiteKey: null,
  quota: { allowed: true, remainingHour: 20, remainingDay: 100 },
  mail: { allowed: true, remainingHour: 3, remainingDay: 17 },
  whatsapp: false,
  supportedTypes: ["01", "03", "05", "06", "11", "14"],
  catalog: false,
  catalogReceiverTypes: ["01", "03", "05", "06"],
  demo: { customers: [], products: [], builtInReceivers: [], canInvalidate: true },
};

const TEMPLATES = {
  available: true,
  predeterminada: { carta: "carta-a", ticket: "ticket-1" },
  plantillas: [
    { id: "carta-a", tipo: "carta", nombre: "Clásica", origen: "catalogo", permitida: true, clavesDatos: [] },
    { id: "carta-menu", tipo: "carta", nombre: "Menú del día", origen: "catalogo", permitida: false, motivo: "plan", clavesDatos: ["mesa", "mesero", "comensales"] },
    { id: "carta-clinica", tipo: "carta", nombre: "Consulta médica", origen: "catalogo", permitida: true, tiposDte: ["03"], clavesDatos: ["paciente"] },
    { id: "ticket-1", tipo: "ticket", nombre: "Ticket 1", origen: "catalogo", permitida: true, clavesDatos: [] },
    { id: "ticket-resto", tipo: "ticket", nombre: "Restaurante", origen: "catalogo", permitida: true, clavesDatos: ["mesa", "propinaSugerida"] },
  ],
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stub(page: Page, templates: (route: Route) => Promise<void> | void, sessions: unknown[] = []) {
  await page.route("**/api/state", (route) => json(route, STATE));
  await page.route("**/api/issued", (route) => json(route, { issued: [] }));
  await page.route("**/api/registro**", (route) => json(route, { documents: [], total: 0 }));
  await page.route("**/api/plantillas**", templates);
  await page.route("**/api/session", async (route) => {
    sessions.push(route.request().postDataJSON());
    await json(route, { session: "tok-1", total: 1, title: "Venta de prueba", emailTo: null, orderNumber: "ord-1", idempotencyKey: "k.sale-ord-1" });
  });
}

async function openSale(page: Page) {
  await page.goto("/pantallas");
  await expect(page.getByTestId("repr-section")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("repr-section").scrollIntoViewIfNeeded();
}

test("representation: the picker lists the compatible templates, disables the paid one with its reason, and sends the choice and values", async ({ page }) => {
  const sessions: Array<Record<string, unknown>> = [];
  await stub(page, (route) => json(route, TEMPLATES), sessions as unknown[]);
  await openSale(page);

  const carta = page.getByTestId("repr-carta");
  // For a Factura (01) the credit-fiscal-only look is shown disabled with its own reason, the paid one with the plan.
  const menu = carta.locator("option", { hasText: "Menú del día" });
  await expect(menu).toHaveAttribute("disabled", "");
  await expect(menu).toContainText("Requiere plan Lite o Pro");
  const clinica = carta.locator("option", { hasText: "Consulta médica" });
  await expect(clinica).toHaveAttribute("disabled", "");
  await expect(clinica).toContainText("No es compatible con este tipo de documento");
  await expect(carta.locator("option[value=carta-a]")).not.toHaveAttribute("disabled", "");

  // Choosing the restaurant ticket shows its keys; a key of a template that is not chosen is not offered.
  await page.getByTestId("repr-ticket").selectOption("ticket-resto");
  await expect(page.getByTestId("repr-dato-mesa")).toBeVisible();
  await expect(page.getByTestId("repr-dato-propinaSugerida")).toBeVisible();
  await expect(page.getByTestId("repr-dato-mesero")).toHaveCount(0);
  await page.getByTestId("repr-dato-mesa").fill("7");
  await page.getByRole("button", { name: "+ Agregar fila" }).click();
  await page.getByLabel("Etiqueta de la fila 1").fill("Turno");
  await page.getByLabel("Valor de la fila 1").fill("Noche");

  // The custom line needs a type and a description before the sale can be prepared.
  await page.getByLabel("Descripción de la línea 1").fill("Café");
  await page.getByRole("radio", { name: "Bien" }).first().click();
  await page.getByRole("button", { name: "Preparar la venta" }).click();
  await expect(page.getByText("Venta lista")).toBeAttached();

  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.representacion).toEqual({
    plantilla: { ticket: "ticket-resto" },
    datos: { mesa: "7", filas: [{ etiqueta: "Turno", valor: "Noche" }] },
  });
});

test("representation: with an API that has no template list yet, the picker is hidden and the page says so", async ({ page }) => {
  await stub(page, (route) => json(route, { available: false }));
  await openSale(page);
  await expect(page.getByTestId("repr-unavailable")).toContainText("todavía no ofrece elegir la plantilla");
  await expect(page.getByTestId("repr-carta")).toHaveCount(0);
  await expect(page.getByTestId("repr-ticket")).toHaveCount(0);
});

test("representation: a failed list never blocks the sale", async ({ page }) => {
  await stub(page, (route) => json(route, { error: { code: "rate_limited", message: "El playground alcanzó el límite de pruebas por hora; intente en unos minutos.", retryable: true } }, 429));
  await openSale(page);
  await expect(page.getByTestId("repr-failed")).toContainText("Puede emitir igual");
  await expect(page.getByRole("button", { name: "Preparar la venta" })).toBeVisible();
});

test("representation: the section fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, (route) => json(route, TEMPLATES));
  await openSale(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
