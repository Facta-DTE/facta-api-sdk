// Demo data for the sale builder, read from FACTA_DTE_FIXTURES_JSON.
//
// The variable keeps the shape of the live integration test's
// STAGING_FACTA_DTE_FIXTURES_JSON (scripts/live-dte-fixtures.mjs): an object
// keyed by DTE type whose values are complete test requests. The playground
// also accepts two optional lists, `customers` and `products`, for the sale
// builder. Everything is test data; nothing here is secret.

import type { DteRequest, Recipient } from "../../src/types.ts";

export interface DemoCustomer {
  id: string;
  label: string;
  receptor: Recipient;
}

export interface DemoProduct {
  id: string;
  label: string;
  descripcion: string;
  precioUni: number;
  /** Facta catalog reference, when the key can read the catalog. */
  productId?: string;
}

export interface PlaygroundFixtures {
  customers: DemoCustomer[];
  products: DemoProduct[];
  /** Complete test requests by DTE type, kept for the recipes of later batches. */
  requests: Partial<Record<string, DteRequest>>;
}

export const NO_FIXTURES: PlaygroundFixtures = Object.freeze({ customers: [], products: [], requests: {} }) as PlaygroundFixtures;

const REQUEST_TYPES = ["01", "03", "05", "06", "11", "14"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() !== "" && value.length <= max ? value : null;
}

export class FixturesError extends Error {
  override readonly name = "FixturesError";
}

/** Parse the variable. Throws `FixturesError` (never echoing the content) when it is malformed. */
export function parseFixtures(raw: string | undefined): PlaygroundFixtures {
  if (raw === undefined || raw.trim() === "") return NO_FIXTURES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FixturesError("fixtures_invalid");
  }
  if (!isRecord(value)) throw new FixturesError("fixtures_invalid");

  const requests: Partial<Record<string, DteRequest>> = {};
  for (const type of REQUEST_TYPES) {
    const request = value[type];
    if (request === undefined) continue;
    if (!isRecord(request) || request.tipoDte !== type || !Array.isArray(request.items)) throw new FixturesError("fixtures_invalid");
    requests[type] = request as unknown as DteRequest;
  }

  const customers: DemoCustomer[] = [];
  if (value.customers !== undefined) {
    if (!Array.isArray(value.customers)) throw new FixturesError("fixtures_invalid");
    for (const entry of value.customers) {
      const id = isRecord(entry) ? str(entry.id, 60) : null;
      const label = isRecord(entry) ? str(entry.label, 80) : null;
      if (!isRecord(entry) || id === null || label === null || !isRecord(entry.receptor)) throw new FixturesError("fixtures_invalid");
      customers.push({ id, label, receptor: entry.receptor as Recipient });
    }
  }

  const products: DemoProduct[] = [];
  if (value.products !== undefined) {
    if (!Array.isArray(value.products)) throw new FixturesError("fixtures_invalid");
    for (const entry of value.products) {
      if (!isRecord(entry)) throw new FixturesError("fixtures_invalid");
      const id = str(entry.id, 60);
      const label = str(entry.label, 80);
      const descripcion = str(entry.descripcion, 200);
      const price = entry.precioUni;
      if (id === null || label === null || descripcion === null || typeof price !== "number" || !(price > 0) || price > 10_000) {
        throw new FixturesError("fixtures_invalid");
      }
      const productId = entry.productId === undefined ? undefined : str(entry.productId, 80);
      if (productId === null) throw new FixturesError("fixtures_invalid");
      products.push({ id, label, descripcion, precioUni: price, ...(productId === undefined ? {} : { productId }) });
    }
  }
  return { customers, products, requests };
}

/** What the browser may know about the demo data: labels, prices and whether a customer is a taxpayer (has an NRC), never receptor fields. */
export function publicFixtures(fixtures: PlaygroundFixtures) {
  return {
    customers: fixtures.customers.map(({ id, label, receptor }) => ({ id, label, contributor: typeof receptor.nrc === "string" && receptor.nrc.trim() !== "" })),
    products: fixtures.products.map(({ id, label, descripcion, precioUni }) => ({ id, label, descripcion, precioUni })),
  };
}
