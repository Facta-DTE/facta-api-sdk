// The recipe registry: for each fixed recipe file, how a validated form becomes
// its input. Visitors send parameters (a type, a code, a JSON order), never code;
// everything below validates them and builds the input from the demo data.

import type { DteRequest, InvalidationRequest, PreparedDte, Recipient } from "../../../mod.ts";
import type { PlaygroundFixtures } from "../fixtures.ts";
import { buildSale, MAX_LINES, MAX_TOTAL } from "../sale.ts";
import type { ExecOutcome } from "./runner.ts";
import { openJson, sealJson } from "./seal.ts";
import type { Facta } from "../../../src/client.ts";
import * as issueIdempotent from "./issue-idempotent.ts";
import * as prepareSign from "./prepare-sign.ts";
import * as statusRecovery from "./status-recovery.ts";
import * as invalidate from "./invalidate.ts";
import * as documentsStorage from "./documents-storage.ts";
import * as catalogRefs from "./catalog-refs.ts";
import * as orderWebhook from "./order-webhook.ts";

export class RecipeError extends Error {
  override readonly name = "RecipeError";
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export interface BindContext {
  stage: string;
  params: Record<string, unknown>;
  fixtures: PlaygroundFixtures;
  email: string;
  /** `<visitorTag>.<runId>`: a retry of the same run reuses it, a new run gets a new one. */
  baseKey: string;
  /** `<visitorTag>`: for keys that must survive across runs (a webhook's order id). */
  tag: string;
  secret: string;
  hasCatalog: boolean;
  /** True when this visitor issued the code (issued-codes.ts `ownsDocument`). */
  owns(code: string): Promise<boolean>;
  /** Codes this visitor issued, newest first. */
  mine(): Promise<string[]>;
  now: number;
}

export interface Bound {
  /** Idempotency keys that count against the visitor's quota. A key already counted is free. */
  quotaKeys: string[];
  exec(facta: Facta): Promise<ExecOutcome>;
}

export interface RecipeDef {
  stages: readonly string[];
  bind(ctx: BindContext): Promise<Bound>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(params: Record<string, unknown>, name: string, max: number, required = false): string | undefined {
  const value = params[name];
  if (value === undefined || value === null || value === "") {
    if (required) throw new RecipeError("param_invalid", `Falta el campo «${name}».`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length > max) throw new RecipeError("param_invalid", `El campo «${name}» no es válido.`);
  return value.trim();
}

function oneOf<T extends string>(params: Record<string, unknown>, name: string, allowed: readonly T[]): T {
  const value = params[name];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new RecipeError("param_invalid", `El campo «${name}» no es válido.`);
  return value as T;
}

function codeOf(result: unknown): Array<{ codigoGeneracion: string; tipoDte: string; numeroControl: string; estado: string }> {
  if (!isRecord(result)) return [];
  const { codigoGeneracion, tipoDte, numeroControl, estado } = result;
  if ((estado !== "sellado" && estado !== "contingencia") || typeof codigoGeneracion !== "string" || typeof tipoDte !== "string" || typeof numeroControl !== "string") return [];
  return [{ codigoGeneracion, tipoDte, numeroControl, estado }];
}

/** A complete fixture request, or the anonymous FE the sale builder makes without any demo data. */
function requestFor(type: "01" | "03", fixtures: PlaygroundFixtures): DteRequest {
  const fixture = fixtures.requests[type];
  if (fixture !== undefined) return fixture;
  if (type === "01") {
    return buildSale({ tipoDte: "01", lines: [{ descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1, tipoItem: 2 }] }, fixtures).sale.request;
  }
  throw new RecipeError("fixture_missing", "Falta el ejemplo de Crédito Fiscal en los datos de demostración del playground.", 503);
}

async function ownedCode(ctx: BindContext, required: boolean): Promise<string | undefined> {
  const code = text(ctx.params, "code", 36, required);
  if (code === undefined) return undefined;
  if (!UUID.test(code)) throw new RecipeError("param_invalid", "El código de generación no es válido.");
  if (!(await ctx.owns(code))) {
    throw new RecipeError("not_owned", "Solo puede usar documentos emitidos desde su sesión del playground.", 403);
  }
  return code;
}

const issueDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const type = oneOf(ctx.params, "type", ["01", "03"] as const);
    const input: issueIdempotent.Input = { request: requestFor(type, ctx.fixtures), idempotencyKey: `${ctx.baseKey}.${type}` };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await issueIdempotent.run(facta, input);
        return { result: out.result, issued: codeOf(out.result) };
      },
    };
  },
};

const prepareSignDef: RecipeDef = {
  stages: ["prepare", "sign"],
  async bind(ctx) {
    if (ctx.stage === "prepare") {
      const type = oneOf(ctx.params, "type", ["01", "03"] as const);
      const input: prepareSign.Input = { request: requestFor(type, ctx.fixtures), idempotencyKey: `${ctx.baseKey}.${type}` };
      return {
        quotaKeys: [input.idempotencyKey],
        async exec(facta) {
          const prepared = await prepareSign.prepare(facta, input);
          const continuation = await sealJson(ctx.secret, "prepare-sign", ctx.email, { prepared, key: input.idempotencyKey }, 10 * 60_000, ctx.now);
          return { result: prepared, keep: ["documento"], continuation };
        },
      };
    }
    const held = await openJson<{ prepared: PreparedDte; key: string }>(ctx.secret, "prepare-sign", ctx.email, ctx.params.continuation, ctx.now);
    if (held === null) throw new RecipeError("continuation_invalid", "El documento preparado venció o no es suyo. Vuelva a prepararlo.", 410);
    const input: prepareSign.Input = { request: { tipoDte: "01", items: [] }, idempotencyKey: held.key };
    return {
      quotaKeys: [],
      async exec(facta) {
        const result = await prepareSign.sign(facta, held.prepared, input);
        return { result, issued: codeOf(result) };
      },
    };
  },
};

const statusRecoveryDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const type = oneOf(ctx.params, "type", ["01", "03"] as const);
    const input: statusRecovery.Input = {
      request: requestFor(type, ctx.fixtures),
      idempotencyKey: `${ctx.baseKey}.${type}`,
      ...(ctx.params.simulateTimeout === true ? { simulateTimeoutMs: 250 } : {}),
    };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await statusRecovery.run(facta, input);
        return { result: out, issued: codeOf(out.result) };
      },
    };
  },
};

const digits = (type: string) => (type === "13" ? /^\d{9}$/ : type === "36" ? /^\d{14}$/ : /^[A-Za-z0-9-]{1,20}$/);

const invalidateDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const code = (await ownedCode(ctx, true))!;
    const tipoAnulacion = Number(oneOf(ctx.params, "tipoAnulacion", ["1", "2", "3"] as const)) as 1 | 2 | 3;
    const motivo = text(ctx.params, "motivo", 200);
    const replacement = text(ctx.params, "replacement", 36);
    if (tipoAnulacion === 3 && motivo === undefined) throw new RecipeError("param_invalid", "El tipo 3 requiere un motivo.");
    if (tipoAnulacion === 1 && (replacement === undefined || !UUID.test(replacement))) {
      throw new RecipeError("param_invalid", "El tipo 1 requiere el código de generación del documento de reemplazo.");
    }
    const nombre = text(ctx.params, "responsableNombre", 100, true)!;
    const tipoDocumento = oneOf(ctx.params, "responsableTipo", ["13", "36", "37"] as const);
    const numDocumento = text(ctx.params, "responsableNumero", 20, true)!;
    if (!digits(tipoDocumento).test(numDocumento)) {
      throw new RecipeError("param_invalid", tipoDocumento === "13" ? "El DUI lleva 9 dígitos, sin guion." : tipoDocumento === "36" ? "El NIT lleva 14 dígitos, sin guiones." : "El número de documento no es válido.");
    }
    const person = { nombre, tipoDocumento, numDocumento };
    const request: InvalidationRequest = {
      tipoAnulacion,
      ...(motivo === undefined ? {} : { motivo }),
      ...(tipoAnulacion === 1 ? { codigoGeneracionReemplazo: replacement! } : {}),
      responsable: person,
      solicita: person,
    };
    const input: invalidate.Input = { codigoGeneracion: code, request, idempotencyKey: `${ctx.tag}.void.${code}` };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await invalidate.run(facta, input);
        return { result: out.result, invalidated: [code] };
      },
    };
  },
};

const documentsDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const code = await ownedCode(ctx, false);
    const kind = oneOf(ctx.params, "kind", ["pdf", "json"] as const);
    const limit = Number(oneOf(ctx.params, "limit", ["5", "10", "25"] as const));
    // The key's issuer holds every visitor's documents: list only the codes this visitor issued.
    const input: documentsStorage.Input = { kind, limit, onlyCodes: await ctx.mine(), ...(code === undefined ? {} : { codigoGeneracion: code }) };
    return {
      quotaKeys: [],
      async exec(facta) {
        return { result: await documentsStorage.run(facta, input) };
      },
    };
  },
};

const catalogDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    if (!ctx.hasCatalog) throw new RecipeError("catalog_unavailable", "El catálogo no está habilitado en este playground (falta la llave de desbloqueo).", 503);
    const customerId = text(ctx.params, "customerId", 80);
    const productId = text(ctx.params, "productId", 80);
    const cantidad = ctx.params.cantidad === undefined || ctx.params.cantidad === "" ? 1 : Number(ctx.params.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) throw new RecipeError("param_invalid", "La cantidad debe ser un entero entre 1 y 10.");
    if (customerId !== undefined && productId === undefined) throw new RecipeError("param_invalid", "Elija también un producto para emitir.");
    const key = `${ctx.baseKey}.catalog`;
    const input: catalogRefs.Input = {
      cantidad,
      idempotencyKey: key,
      ...(customerId === undefined ? {} : { customerId }),
      ...(productId === undefined ? {} : { productId }),
    };
    return {
      quotaKeys: productId === undefined ? [] : [key],
      async exec(facta) {
        const out = await catalogRefs.run(facta, input);
        return { result: out, issued: codeOf(out.result) };
      },
    };
  },
};

const orderDef: RecipeDef = {
  stages: ["run"],
  async bind(ctx) {
    const raw = ctx.params.order;
    if (typeof raw !== "string" || raw.length > 2_000) throw new RecipeError("order_invalid", "El pedido debe ser un JSON de hasta 2,000 caracteres.");
    let order: unknown;
    try {
      order = JSON.parse(raw);
    } catch {
      throw new RecipeError("order_invalid", "El pedido no es un JSON válido.");
    }
    if (!isRecord(order) || typeof order.orderId !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(order.orderId)) {
      throw new RecipeError("order_invalid", "El pedido necesita un orderId de letras, números y guiones (hasta 40).");
    }
    if (!Array.isArray(order.lines) || order.lines.length < 1 || order.lines.length > MAX_LINES) {
      throw new RecipeError("order_invalid", `El pedido necesita entre 1 y ${MAX_LINES} líneas.`);
    }
    const priceList: orderWebhook.Input["priceList"] = {};
    let total = 0;
    const lines: orderWebhook.Order["lines"] = [];
    for (const line of order.lines) {
      const sku = isRecord(line) ? line.sku : undefined;
      const qty = isRecord(line) ? line.qty : undefined;
      const product = ctx.fixtures.products.find((p) => p.id === sku);
      if (product === undefined) throw new RecipeError("order_invalid", "Una línea usa un sku que no es un producto de demostración.");
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 1000) throw new RecipeError("order_invalid", "Cada qty debe ser un entero entre 1 y 1000.");
      priceList[product.id] = { descripcion: product.descripcion, precioUni: product.precioUni };
      total = Math.round((total + qty * product.precioUni) * 100) / 100;
      lines.push({ sku: product.id, qty });
    }
    if (total > MAX_TOTAL) throw new RecipeError("order_invalid", `El total de un pedido de prueba no puede pasar de $${MAX_TOTAL}.`);
    const customers: Record<string, Recipient> = {};
    let customerRef: string | undefined;
    if (order.customerRef !== undefined) {
      const customer = ctx.fixtures.customers.find((c) => c.id === order.customerRef);
      if (customer === undefined) throw new RecipeError("order_invalid", "customerRef no es un cliente de demostración.");
      customers[customer.id] = customer.receptor;
      customerRef = customer.id;
    }
    const input: orderWebhook.Input = {
      order: { orderId: order.orderId, ...(customerRef === undefined ? {} : { customerRef }), lines },
      priceList,
      customers,
      // The order id IS the key, scoped to the visitor: delivering the same order twice issues once.
      idempotencyKey: `${ctx.tag}.order-${order.orderId}`,
    };
    return {
      quotaKeys: [input.idempotencyKey],
      async exec(facta) {
        const out = await orderWebhook.run(facta, input);
        return { result: out, issued: codeOf(out.result) };
      },
    };
  },
};

export const RECIPES: Readonly<Record<string, RecipeDef>> = {
  "issue-idempotent": issueDef,
  "prepare-sign": prepareSignDef,
  "status-recovery": statusRecoveryDef,
  "invalidate": invalidateDef,
  "documents-storage": documentsDef,
  "catalog-refs": catalogDef,
  "order-webhook": orderDef,
};
