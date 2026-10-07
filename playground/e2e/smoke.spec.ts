import { expect, test } from "@playwright/test";

// Read-only checks: they never issue a document.
test("the shell loads and navigates every section", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("facturas de verdad");
  for (const label of ["Pantallas React", "Mi propia implementación", "Solo servidor", "Referencia", "Registro", "Inicio"]) {
    await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: label }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("the API is reachable and says it is staging", async ({ request }) => {
  const response = await request.get("/api/state");
  expect([200, 503]).toContain(response.status());
  if (response.status() === 200) {
    const body = await response.json();
    expect(body.environment).toBe("00");
    expect(body.apiHost).toBe("eobxzotnqzgtpuqvmpkc.supabase.co");
  }
});

test("shown code is the executed code", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pg-code pre").first()).toContainText("FactaInvoiceDialog");
});

test("the agent skill is offered on Inicio and Referencia and its zip downloads", async ({ page, request }) => {
  await page.goto("/");
  const card = page.getByTestId("skill-card");
  await expect(card.getByRole("heading", { name: "Skill para su agente de IA" })).toBeVisible();
  const zip = card.getByRole("link", { name: "Descargar la skill (.zip)" });
  await expect(card.getByRole("link", { name: "Verla en GitHub" })).toHaveAttribute("href", /\/skills\/facta-dte-api$/);
  const response = await request.get((await zip.getAttribute("href")) ?? "");
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 2).toString()).toBe("PK");
  await page.goto("/referencia");
  await expect(page.getByTestId("skill-card")).toBeVisible();
});

// Set PLAYGROUND_ISSUE=1 to also issue one Factura in environment 00 (spends staging quota).
test("issues one test Factura end to end", async ({ page }) => {
  test.skip(process.env.PLAYGROUND_ISSUE !== "1", "set PLAYGROUND_ISSUE=1 to issue a real test document");
  await page.goto("/");
  await page.getByRole("button", { name: "Emitir una factura de prueba" }).click();
  await expect(page.getByText(/sellad/i).first()).toBeVisible({ timeout: 45_000 });
});
