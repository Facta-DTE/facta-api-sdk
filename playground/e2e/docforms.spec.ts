import { expect, test, type Page } from "@playwright/test";

// «Las tres formas del documento» must look the same wherever it is mounted (board Ticket.dc.html).
// Runs against the Vite dev server in mock mode, because it issues a (fake) document:
//   pnpm exec vite --config playground/vite.config.ts --port 5199
//   PLAYGROUND_BASE_URL=http://localhost:5199 pnpm playground:smoke -g docforms
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 640 };

async function issueWithPos(page: Page) {
  await page.goto("/implementacion?mock=1");
  const pos = page.locator(".hl-card").nth(1);
  await pos.getByRole("button", { name: "1", exact: true }).click();
  await pos.getByRole("button", { name: "Cobrar" }).click();
  await expect(page.locator(".hl-outcome[data-step=sealed]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".docforms")).toBeVisible();
}

for (const size of [PHONE, NARROW]) {
  test(`docforms: the three-way segmented never clips at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await issueWithPos(page);
    const tabs = page.locator(".docforms-seg[role=tablist]");
    const fits = await tabs.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right, view: document.documentElement.clientWidth }));
    expect(fits.scroll).toBeLessThanOrEqual(fits.client);
    expect(fits.right).toBeLessThanOrEqual(fits.view);
    // Ticket is selected by default, so the roll-width segmented is on screen too.
    const roll = page.locator(".docforms-seg--small");
    const rollFits = await roll.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(rollFits.scroll).toBeLessThanOrEqual(rollFits.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test("docforms: it is rendered below the themed example card, not inside it", async ({ page }) => {
  await issueWithPos(page);
  expect(await page.locator(".hl-card .docforms, .hl-stage .docforms, .hl-outcome .docforms").count()).toBe(0);
  await expect(page.getByRole("heading", { name: "El mismo documento, en las formas que puede entregar su sistema" })).toBeVisible();
});

test("docforms: the primary download stays filled inside every example theme", async ({ page }) => {
  await issueWithPos(page);
  const filled = (selector: string) => page.evaluate((host) => {
    const forms = document.querySelector(".docforms")!;
    const parent = forms.parentElement!;
    const home = document.querySelector(host)!;
    home.appendChild(forms); // the worst case: the component inside the themed host
    const button = forms.querySelector(".docforms-btn--primary") as HTMLElement;
    const seg = forms.querySelector(".docforms-seg button[aria-selected=true]") as HTMLElement;
    const style = getComputedStyle(button);
    const result = { background: style.backgroundColor, color: style.color, borderStyle: style.borderTopStyle, segBackground: getComputedStyle(seg).backgroundColor };
    parent.appendChild(forms);
    return result;
  }, selector);
  for (const host of [".hl-outcome.hl-skin-pos", ".hl-stage--pos", ".hl-stage--cafe", ".hl-stage--ccf"]) {
    const look = await filled(host);
    expect(look.background, host).toBe("rgb(22, 119, 168)");
    expect(look.color, host).toBe("rgb(255, 255, 255)");
    expect(look.segBackground, host).toBe("rgb(255, 255, 255)");
  }
});
