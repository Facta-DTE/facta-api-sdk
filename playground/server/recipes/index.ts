// The recipe registry: for each fixed recipe file, how a validated form becomes
// its input. Visitors send parameters (a type, a code, a JSON order), never code;
// everything below validates them and builds the input from the demo data.

import type { DteRequest, InvalidationRequest, PreparedDte, Recipient } from "../../../mod.ts";
import type { PlaygroundFixtures } from "../fixtures.ts";
import { buildSale, customerFits, MAX_LINES, MAX_TOTAL, SaleError } from "../sale.ts";
import { parseAddress, recipientKey, maskAddress, DeliveryError } from "../delivery.ts";
import type { StashedToken } from "../mail-quota.ts";
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
import * as deliverEmail from "./deliver-email.ts";

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
  /** The same documents with their types (a note may only relate a Crédito fiscal). */
  ownedDocs(): Promise<Array<{ codigoGeneracion: string; tipoDte: string }>>;
  /** The delivery token the Worker kept for a document this visitor issued (valid five minutes), or null. */
  stash(code: string): Promise<StashedToken | null>;
  now: number;
}

export interface Bound {
  /**
   * Idempotency keys that count against the visitor's quota, ONCE the run issued or invalidated something
   * (a failure counts nothing). A key already counted is free.
   */
  quotaKeys: string[];
  /** Keys that are only CHECKED against the quota before the run (a stage that will count later, like `prepare`). */
  gateKeys?: string[];
  /** Set when the run sends an e-mail: counted on the visitor, IP and recipient (gates.ts). */
  mail?: { key: string; /** `recipientKey(...)`, never the address. */ recipient: string; doc?: string; /** False: only check the limits now, count later (the stage that issues; the stage that sends counts). */ commit?: boolean };
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

function codeOf(result: unknown): Array<{ codigoGeneracion: string; tipoDte: string; numeroControl: string; estado: string; total?: number }> {
  if (!isRecord(result)) return [];
  const { codigoGeneracion, tipoDte, numeroControl, estado } = result;
  if ((estado !== "sellado" && estado !== "contingencia") || typeof codigoGeneracion !== "string" || typeof tipoDte !== "string" || typeof numeroControl !== "string") return [];
  const total = isRecord(result.totales) && typeof result.totales.totalPagar === "number" ? result.totales.totalPagar
    : isRecord(result.totales) && typeof result.totales.montoTotalOperacion === "number" ? result.totales.montoTotalOperacion : undefined;
  return [{ codigoGeneracion, tipoDte, numeroControl, estado, ...(total === undefined ? {} : { total }) }];
}

export const RECIPE_TYPES = ["01", "03", "05", "06", "11", "14"] as const;
export type RecipeType = (typeof RECIPE_TYPES)[number];

/**
 * A request for any of the six types: the fixture's complete request when there is one, otherwise the
 * sale builder over a demo customer that fits. Notes (05/06) always relate a document this visitor issued.
 */
async function requestFor(type: RecipeType, ctx: BindContext): Promise<DteRequest> {
  const note = type === "05" || type === "06";
  const fixture = note ? undefined : ctx.fixtures.requests[type];
  if (fixture !== undefined) return fixture;
  if (note && text(ctx.params, "related", 36) === undefined) {
    throw new RecipeError("related_required", "Elija el documento que corrige: la nota debe relacionar uno que usted emitió en este playground.");
  }
  const relatedCode = note ? await ownedCode(ctx, true, "related") : undefined;
  const customer = type === "01" ? undefined : ctx.fixtures.customers.find((c) => customerFits(c.receptor as Record<string, unknown>).includes(type));
  try {
    return buildSale({
      tipoDte: type,
      lines: [{ source: "custom", descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1, tipoItem: type === "11" ? 1 : 2 }],
      ...(customer === undefined ? {} : { receptor: { source: "demo", customerId: customer.id } }),
      ...(relatedCode === undefined ? {} : { relatedCode }),
    }, ctx.fixtures, { owned: await ctx.ownedDocs() }).sale.request;
  } catch (error) {
    if (error instanceof SaleError) {
      throw new RecipeError(error.code, note && error.code !== "related_not_ccf" ? "Elija el documento que corrige: la nota debe relacionar uno que usted emitió en este playground." : error.message);
    }
    throw error;
  }
}

async function ownedCode(ctx: BindContext, required: boolean, name = "code"): Promise<string | undefined> {
  const code = text(ctx.params, name, 36, required);
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
    const type = oneOf(ctx.params, "type", RECIPE_TYPES);
    const input: issueIdempotent.Input = { request: await requestFor(type, ctx), idempotencyKey: `${ctx.baseKey}.${type}` };
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
      const type = oneOf(ctx.params, "type", RECIPE_TYPES);
      const input: prepareSign.Input = { request: await requestFor(type, ctx), idempotencyKey: `${ctx.baseKey}.${type}` };
      return {
        // Preparing reserves a number but issues nothing: the count happens when the document is signed.
        quotaKeys: [],
        gateKeys: [input.idempotencyKey],
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
      quotaKeys: [held.key],
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
    const type = oneOf(ctx.params, "type", RECIPE_TYPES);
    const input: statusRecovery.Input = {
      request: await requestFor(type, ctx),
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

/** What the second stage needs, sealed for the browser to carry: the token never reaches the page. */
interface HeldDelivery {
  code: string;
  token: string;
  masked: string;
  rcpt: string;
}

const deliverEmailDef: RecipeDef = {
  stages: ["issue", "send"],
  async bind(ctx) {
    if (ctx.stage === "issue") {
      let address: string;
      try {
        address = parseAddress(ctx.params.email);
      } catch (error) {
        if (error instanceof DeliveryError) throw new RecipeError(error.code, error.message);
        throw error;
      }
      const input: deliverEmail.IssueInput = { request: await requestFor("01", ctx), idempotencyKey: `${ctx.baseKey}.deliver`, email: address };
      const rcpt = await recipientKey(ctx.secret, address);
      return {
        quotaKeys: [input.idempotencyKey],
        // Marking the e-mail sends nothing yet: the limits are only checked here and counted by the stage that sends.
        mail: { key: `${ctx.baseKey}.mail-check`, recipient: rcpt, commit: false },
        async exec(facta) {
          const out = await deliverEmail.issueWithDelivery(facta, input);
          const offer = out.result.entrega;
          // The token stays on the server. The page gets proof that it exists and when it dies.
          const result = {
            issued: out.result,
            entrega: { tokenRecibido: out.token !== undefined, venceEn: offer?.venceEn ?? null, canales: offer?.canales ?? {} },
          };
          const continuation = out.token === undefined ? undefined
            : await sealJson(ctx.secret, "deliver-email", ctx.email, { code: out.code, token: out.token, masked: maskAddress(address), rcpt }, 10 * 60_000, ctx.now);
          return { result, issued: codeOf(out.result), ...(continuation === undefined ? {} : { continuation }) };
        },
      };
    }
    // Stage «send»: with the sealed hand-over from stage 1, or with a document issued in «Pantallas React»
    // whose five-minute token the Worker kept.
    let held = await openJson<HeldDelivery>(ctx.secret, "deliver-email", ctx.email, ctx.params.continuation, ctx.now);
    if (held === null) {
      const code = await ownedCode(ctx, false);
      if (code === undefined) throw new RecipeError("continuation_invalid", "Primero emita el documento con el correo marcado (paso 1), o elija uno suyo emitido hace menos de cinco minutos.", 410);
      const kept = await ctx.stash(code);
      if (kept === null) {
        throw new RecipeError("delivery_window_closed", "El plazo para entregar ese documento venció (cinco minutos desde que se emitió) o no se marcó el correo. Emita uno nuevo.", 410);
      }
      held = { code, token: kept.token, masked: kept.masked, rcpt: kept.rcpt };
    }
    const input: deliverEmail.SendInput = { code: held.code, token: held.token };
    const { masked } = held;
    return {
      quotaKeys: [],
      // One send per document every ten minutes, and the hourly, daily and per-recipient limits: counted here.
      mail: { key: `${ctx.baseKey}.mail`, recipient: held.rcpt, doc: held.code },
      async exec(facta) {
        const out = await deliverEmail.sendEmail(facta, input);
        return { result: { codigoGeneracion: held.code, destino: masked, ...out } };
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
  "deliver-email": deliverEmailDef,
};
