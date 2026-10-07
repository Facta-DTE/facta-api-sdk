import { describe, expect, it } from "vitest";
import { createOrderStore } from "../site/order-session.ts";
import { addLine, changeQty, formatOrder, orderTotal, parseOrder } from "../site/sections/server/order-webhook-model.ts";
import { customers, orderToRequest, OrderError, priceList } from "../server/recipes/order-webhook.ts";
import { checkDocument } from "../site/receptor/identity.ts";
import { RECIPE_ORDER } from "../site/order-number.ts";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe("order numbers used in this session", () => {
  it("a fresh order is not a repeat; the same one issued again is", () => {
    const store = createOrderStore(() => memory());
    expect(store.find("sale", "PED-1")).toBeNull();
    store.pend("sale", "PED-1", "01", 11.3);
    store.issued({ code: "A", control: "DTE-01-1", ms: 1840, replay: false });
    expect(store.find("sale", "PED-1")).toMatchObject({ type: "01", total: 11.3, code: "A", repeats: 0 });
    expect(store.lastRepeat()).toBeNull();
    store.pend("sale", "PED-1", "01", 11.3);
    store.issued({ code: "A", control: "DTE-01-1", ms: 210, replay: true });
    expect(store.lastRepeat()).toMatchObject({ order: "PED-1", first: { code: "A", ms: 1840 }, again: { code: "A", ms: 210 } });
    expect(store.repeatsOf("A")).toBe(1);
  });
  it("a recipe repeat is recognised by the same generation code, with no server flag", () => {
    const store = createOrderStore(() => memory());
    store.record({ scope: "recipe:x", order: "O1", type: "01", total: 5, code: "C1", control: "k", ms: 900 });
    store.record({ scope: "recipe:x", order: "O1", type: "01", total: 5, code: "C1", control: "k", ms: 100 });
    expect(store.repeatsOf("C1")).toBe(1);
    expect(store.lastRepeat()?.first.ms).toBe(900);
  });
  it("matches by type when the surface keys by type, and keeps scopes apart", () => {
    const store = createOrderStore(() => memory());
    store.record({ scope: "recipe:a", order: "O", type: "01", total: 1, code: "X", control: null, ms: 1 });
    expect(store.find("recipe:a", "O", "01")).not.toBeNull();
    expect(store.find("recipe:a", "O", "03")).toBeNull();
    expect(store.find("recipe:b", "O")).toBeNull();
  });
  it("an order the API remembered but this page did not see still reads as a repeat, first answer unknown", () => {
    const store = createOrderStore(() => memory());
    store.pend("sale", "PED-9", "01", null);
    store.issued({ code: "Z", control: "c", ms: 200, replay: true });
    expect(store.lastRepeat()?.first.code).toBeNull();
    expect(store.find("sale", "PED-9")).not.toBeNull();
  });
  it("survives a reload through sessionStorage and a blocked storage", () => {
    const storage = memory();
    const a = createOrderStore(() => storage);
    a.record({ scope: "sale", order: "P", type: "01", total: 2, code: "K", control: null, ms: 1 });
    expect(createOrderStore(() => storage).find("sale", "P")).not.toBeNull();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const b = createOrderStore(() => blocked);
    expect(() => b.record({ scope: "sale", order: "P", type: "01", total: 2, code: "K", control: null, ms: 1 })).not.toThrow();
    expect(b.find("sale", "P")).not.toBeNull();
  });
  it("fresh numbers skip the ones already used", () => {
    const store = createOrderStore(() => memory());
    store.record({ scope: "sale", order: "N-1", type: "01", total: 1, code: "a", control: null, ms: 1 });
    const queue = ["N-1", "N-1", "N-2"];
    expect(store.fresh("sale", () => queue.shift()!)).toBe("N-2");
  });
  it("validates the recipe order number like the server (≤ 64, letters digits . _ -)", () => {
    expect(RECIPE_ORDER.test("PED-1042")).toBe(true);
    expect(RECIPE_ORDER.test("a".repeat(64))).toBe(true);
    expect(RECIPE_ORDER.test("a".repeat(65))).toBe(false);
    expect(RECIPE_ORDER.test("a b")).toBe(false);
  });
});

describe("the sample shop", () => {
  it("every sample customer carries a valid document", () => {
    for (const c of Object.values(customers)) expect(checkDocument(c.tipoDocumento!, c.numDocumento!).valid).toBe(true);
  });
  it("translates an order into the request, and explains what is wrong in plain Spanish", () => {
    const request = orderToRequest({ orderId: "O", customerRef: "CLI-01", lines: [{ sku: "CAF-250", qty: 2 }] });
    expect(request).toMatchObject({ tipoDte: "01", items: [{ descripcion: "Café molido 250 g", cantidad: 2, precioUni: 4.5 }], receptor: { nombre: "Carlos Ejemplo Rivas" } });
    expect(() => orderToRequest({ orderId: "O", lines: [{ sku: "CAF-999", qty: 1 }] })).toThrow(/El SKU «CAF-999» no está en la lista de precios de la tienda de ejemplo\. Use CAF-250, CAF-500, TAZ-01, FIL-50 o ENV-SV\./);
    expect(() => orderToRequest({ orderId: "O", customerRef: "CLI-9", lines: [{ sku: "CAF-250", qty: 1 }] })).toThrow(OrderError);
  });
  it("the builder: adds, changes quantities, removes at zero and totals by the price list", () => {
    let lines = addLine([], "CAF-250");
    lines = addLine(lines, "CAF-250");
    lines = addLine(lines, "ENV-SV");
    expect(lines).toEqual([{ sku: "CAF-250", qty: 2 }, { sku: "ENV-SV", qty: 1 }]);
    expect(orderTotal(lines)).toBe(12);
    expect(changeQty(lines, "ENV-SV", -1)).toEqual([{ sku: "CAF-250", qty: 2 }]);
    expect(Object.keys(priceList)).toContain("TAZ-01");
  });
  it("writes the order JSON like the board and reads an edited one back", () => {
    const order = { orderId: "ORD-1042", lines: [{ sku: "CAF-250", qty: 2 }, { sku: "ENV-SV", qty: 1 }] };
    expect(formatOrder(order)).toBe('{\n  "orderId": "ORD-1042",\n  "lines": [\n    { "sku": "CAF-250", "qty": 2 },\n    { "sku": "ENV-SV", "qty": 1 }\n  ]\n}');
    expect(parseOrder(formatOrder({ ...order, customerRef: "CLI-02" }))).toEqual({ ...order, customerRef: "CLI-02" });
    expect(parseOrder("{not json")).toBeNull();
    expect(parseOrder('{"orderId":"X","lines":[{"sku":1}]}')).toBeNull();
  });
});
